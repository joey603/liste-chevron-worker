/**
 * API רשימת מורשים (Google Apps Script + Google Sheet).
 *
 * Colonnes:
 *   שם פרטי | שם משפחה | סוג | הערות | תאריך סיום (YYYY-MM-DD, optionnel)
 *
 * Propriétés du script:
 *   ACCESS_SECRET (obligatoire)
 *   SPREADSHEET_ID (optionnel si le script est lié à la Sheet)
 *
 * À chaque action "list", les lignes dont תאריך סיום est dépassé sont supprimées.
 */

var HEADER_ROW = 1
var DATA_START = 2
var DEFAULT_COL = {
  firstName: 1,
  lastName: 2,
  kind: 3,
  notes: 4,
  expiresOn: 5,
}

function doGet() {
  return json_({
    ok: true,
    service: 'authorized-list-api',
    message: 'API רשימת מורשים. Utilisez POST JSON (text/plain).',
  })
}

function doPost(e) {
  try {
    var secret = PropertiesService.getScriptProperties().getProperty('ACCESS_SECRET') || ''
    if (!secret) {
      return json_({ ok: false, error: 'relay_not_configured' })
    }
    var raw = (e && e.postData && e.postData.contents) || ''
    if (!raw) return json_({ ok: false, error: 'invalid_json' })
    var body = JSON.parse(raw)
    if (String(body.secret || '') !== secret) {
      return json_({ ok: false, error: 'unauthorized' })
    }

    var sheet = getDataSheet_()
    var col = detectColumns_(sheet)
    ensureHeader_(sheet, col)
    col = detectColumns_(sheet)

    var action = String(body.action || 'list').trim()
    if (action === 'list') {
      var expiredRemoved = purgeExpired_(sheet, col)
      return json_({
        ok: true,
        people: listPeople_(sheet, col),
        updatedAt: spreadsheetUpdatedAt_(),
        expiredRemoved: expiredRemoved,
      })
    }
    if (action === 'upsert') {
      var person = body.person || {}
      var saved = upsertPerson_(sheet, col, person)
      return json_({
        ok: true,
        person: saved,
        people: listPeople_(sheet, col),
        updatedAt: spreadsheetUpdatedAt_(),
      })
    }
    if (action === 'delete') {
      var id = String(body.id || '').trim()
      if (!deletePerson_(sheet, col, id)) {
        return json_({ ok: false, error: 'not_found' })
      }
      return json_({
        ok: true,
        people: listPeople_(sheet, col),
        updatedAt: spreadsheetUpdatedAt_(),
      })
    }
    return json_({ ok: false, error: 'unknown_action' })
  } catch (err) {
    return json_({
      ok: false,
      error: err && err.message ? String(err.message) : 'api_failed',
    })
  }
}

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || ''
  id = String(id).trim()
  if (id) return SpreadsheetApp.openById(id)
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  if (!ss) throw new Error('no_spreadsheet')
  return ss
}

function getDataSheet_() {
  var sheet = getSpreadsheet_().getSheets()[0]
  if (!sheet) throw new Error('no_sheet')
  return sheet
}

function spreadsheetUpdatedAt_() {
  try {
    return DriveApp.getFileById(getSpreadsheet_().getId()).getLastUpdated().toISOString()
  } catch (err) {
    return new Date().toISOString()
  }
}

function cellText_(value) {
  if (value == null) return ''
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd')
  }
  return String(value).trim()
}

function localDateKey_(date) {
  return Utilities.formatDate(date || new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
}

function normalizeExpiresOn_(raw) {
  if (raw == null || raw === '') return ''
  if (Object.prototype.toString.call(raw) === '[object Date]') {
    return localDateKey_(raw)
  }
  var text = String(raw).trim()
  if (!text) return ''
  var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3]
  var he = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text)
  if (he) {
    return he[3] + '-' + ('0' + he[2]).slice(-2) + '-' + ('0' + he[1]).slice(-2)
  }
  return ''
}

function isExpired_(expiresOn) {
  var day = normalizeExpiresOn_(expiresOn)
  if (!day) return false
  return day < localDateKey_(new Date())
}

function detectColumns_(sheet) {
  var header = sheet.getRange(HEADER_ROW, 1, HEADER_ROW, 12).getValues()[0]
  var firstName = 0
  var lastName = 0
  var kind = 0
  var notes = 0
  var expiresOn = 0
  for (var i = 0; i < header.length; i++) {
    var h = cellText_(header[i]).toLowerCase()
    if (!h || h === '#' || h === 'מספר') continue
    var col = i + 1
    if (/שם\s*פרטי|first/.test(h)) firstName = col
    else if (/שם\s*משפחה|last/.test(h)) lastName = col
    else if (/סוג|type|kind/.test(h)) kind = col
    else if (/תאריך|סיום|תפוג|expir|until|end|valid/.test(h)) expiresOn = col
    else if (/הערות|notes|remark|comment/.test(h)) notes = col
  }
  if (!firstName && !lastName && !kind) {
    return {
      firstName: DEFAULT_COL.firstName,
      lastName: DEFAULT_COL.lastName,
      kind: DEFAULT_COL.kind,
      notes: DEFAULT_COL.notes,
      expiresOn: DEFAULT_COL.expiresOn,
    }
  }
  if (!firstName) firstName = 2
  if (!lastName) lastName = 3
  if (!kind) kind = 5
  if (!notes) notes = kind === 5 ? 6 : 4
  if (!expiresOn) expiresOn = Math.max(notes, kind) + 1
  return {
    firstName: firstName,
    lastName: lastName,
    kind: kind,
    notes: notes,
    expiresOn: expiresOn,
  }
}

function ensureHeader_(sheet, col) {
  var a1 = cellText_(sheet.getRange(HEADER_ROW, col.firstName).getValue())
  if (!a1) {
    sheet.getRange(HEADER_ROW, DEFAULT_COL.firstName).setValue('שם פרטי').setFontWeight('bold')
    sheet.getRange(HEADER_ROW, DEFAULT_COL.lastName).setValue('שם משפחה').setFontWeight('bold')
    sheet.getRange(HEADER_ROW, DEFAULT_COL.kind).setValue('סוג').setFontWeight('bold')
    sheet.getRange(HEADER_ROW, DEFAULT_COL.notes).setValue('הערות').setFontWeight('bold')
    sheet.getRange(HEADER_ROW, DEFAULT_COL.expiresOn).setValue('תאריך סיום').setFontWeight('bold')
    return
  }
  var exp = cellText_(sheet.getRange(HEADER_ROW, col.expiresOn).getValue())
  if (!exp) {
    sheet.getRange(HEADER_ROW, col.expiresOn).setValue('תאריך סיום').setFontWeight('bold')
  }
}

function parseKind_(raw) {
  var v = cellText_(raw).toLowerCase().replace(/\s+/g, '')
  if (
    v === 'וויזיטור' ||
    v === 'ויזיטור' ||
    v === 'visitor' ||
    v === 'ללאכרטיס' ||
    v === 'cardless'
  ) {
    return 'visitor'
  }
  return 'permanent'
}

function kindLabel_(kind) {
  return kind === 'visitor' ? 'ויזיטור' : 'קבוע'
}

function rowToPerson_(sheet, col, row) {
  var firstName = cellText_(sheet.getRange(row, col.firstName).getValue())
  var lastName = cellText_(sheet.getRange(row, col.lastName).getValue())
  var kindRaw = cellText_(sheet.getRange(row, col.kind).getValue())
  var notes = cellText_(sheet.getRange(row, col.notes).getValue())
  var expiresOn = normalizeExpiresOn_(sheet.getRange(row, col.expiresOn).getValue())
  if (!firstName && !lastName && !kindRaw && !notes && !expiresOn) return null
  return {
    id: 'row:' + row,
    firstName: firstName,
    lastName: lastName,
    kind: parseKind_(kindRaw),
    notes: notes,
    expiresOn: expiresOn,
  }
}

function listPeople_(sheet, col) {
  var last = Math.max(sheet.getLastRow(), DATA_START - 1)
  var people = []
  for (var row = DATA_START; row <= last; row++) {
    var person = rowToPerson_(sheet, col, row)
    if (person) people.push(person)
  }
  return people
}

function purgeExpired_(sheet, col) {
  var last = Math.max(sheet.getLastRow(), DATA_START - 1)
  var removed = 0
  for (var row = last; row >= DATA_START; row--) {
    var person = rowToPerson_(sheet, col, row)
    if (!person) continue
    if (!isExpired_(person.expiresOn)) continue
    sheet.deleteRow(row)
    removed++
  }
  return removed
}

function parseRowId_(id) {
  var m = /^row:(\d+)$/.exec(String(id || '').trim())
  if (!m) return 0
  return Number(m[1])
}

function writePersonRow_(sheet, col, row, person) {
  var firstName = cellText_(person.firstName)
  var lastName = cellText_(person.lastName)
  var kind = parseKind_(person.kind)
  var notes = cellText_(person.notes)
  var expiresOn = normalizeExpiresOn_(person.expiresOn)
  sheet.getRange(row, col.firstName).setValue(firstName)
  sheet.getRange(row, col.lastName).setValue(lastName)
  sheet.getRange(row, col.kind).setValue(kindLabel_(kind))
  sheet.getRange(row, col.notes).setValue(notes)
  sheet.getRange(row, col.expiresOn).setValue(expiresOn || '')
  return {
    id: 'row:' + row,
    firstName: firstName,
    lastName: lastName,
    kind: kind,
    notes: notes,
    expiresOn: expiresOn,
  }
}

function upsertPerson_(sheet, col, person) {
  var row = parseRowId_(person && person.id)
  if (row >= DATA_START) {
    var existing = rowToPerson_(sheet, col, row)
    if (existing) return writePersonRow_(sheet, col, row, person)
  }
  var last = Math.max(sheet.getLastRow(), DATA_START - 1)
  var newRow = last + 1
  if (newRow < DATA_START) newRow = DATA_START
  return writePersonRow_(sheet, col, newRow, person || {})
}

function deletePerson_(sheet, col, id) {
  var row = parseRowId_(id)
  if (row < DATA_START) return false
  var existing = rowToPerson_(sheet, col, row)
  if (!existing) return false
  sheet.deleteRow(row)
  return true
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  )
}
