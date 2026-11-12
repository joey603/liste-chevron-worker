/**
 * API locale (même contrat que authorized-list-api.gs) sur un .xlsx.
 *
 *   EXCEL_PATH=... ACCESS_SECRET=local-excel node scripts/local-excel-api.mjs
 *
 * Puis dans .env : VITE_API_URL=http://127.0.0.1:8788
 * Lien : http://localhost:5175/#/s/local-excel
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'

const PORT = Number(process.env.PORT || 8788)
const SECRET = (process.env.ACCESS_SECRET || 'local-excel').trim()
const EXCEL_PATH =
  process.env.EXCEL_PATH ||
  '/Users/yoelibarthel/Documents/רשימת אישורים/רשימת מורשים.xlsx'

const HEADER_ROW = 1
const DATA_START = 2
const DEFAULT_COL = {
  firstName: 1,
  lastName: 2,
  kind: 3,
  notes: 4,
  expiresOn: 5,
}

function cellText(value) {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim()
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim()
    if ('result' in value && value.result != null) return String(value.result).trim()
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((p) => p.text ?? '').join('').trim()
    }
  }
  return ''
}

function localDateKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function normalizeExpiresOn(raw) {
  if (raw == null || raw === '') return ''
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return localDateKey(raw)
  }
  const text = String(raw).trim()
  if (!text) return ''
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const he = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text)
  if (he) {
    return `${he[3]}-${he[2].padStart(2, '0')}-${he[1].padStart(2, '0')}`
  }
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) return localDateKey(parsed)
  return ''
}

function isExpired(expiresOn, now = new Date()) {
  const day = normalizeExpiresOn(expiresOn)
  if (!day) return false
  return day < localDateKey(now)
}

function parseKind(raw) {
  const v = cellText(raw).toLowerCase().replace(/\s+/g, '')
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

function kindLabel(kind) {
  return kind === 'visitor' ? 'ויזיטור' : 'קבוע'
}

function detectColumns(sheet) {
  const header = sheet.getRow(HEADER_ROW)
  let firstName = 0
  let lastName = 0
  let kind = 0
  let notes = 0
  let expiresOn = 0
  header.eachCell({ includeEmpty: false }, (cell, col) => {
    const h = cellText(cell.value).toLowerCase()
    if (!h || h === '#' || h === 'מספר') return
    if (/שם\s*פרטי|first/.test(h)) firstName = col
    else if (/שם\s*משפחה|last/.test(h)) lastName = col
    else if (/סוג|type|kind/.test(h)) kind = col
    else if (/תאריך|סיום|תפוג|expir|until|end\s*date|valid/.test(h)) {
      expiresOn = col
    } else if (/הערות|notes|remark|comment/.test(h)) notes = col
  })
  if (!firstName && !lastName && !kind) return { ...DEFAULT_COL }
  if (!firstName) firstName = 2
  if (!lastName) lastName = 3
  if (!kind) kind = 5
  if (!notes) notes = kind === 5 ? 6 : 4
  if (!expiresOn) expiresOn = Math.max(notes, kind) + 1
  return { firstName, lastName, kind, notes, expiresOn }
}

function ensureExpiresHeader(sheet, col) {
  const label = cellText(sheet.getRow(HEADER_ROW).getCell(col.expiresOn).value)
  if (!label) {
    sheet.getRow(HEADER_ROW).getCell(col.expiresOn).value = 'תאריך סיום'
    sheet.getRow(HEADER_ROW).getCell(col.expiresOn).font = { bold: true }
  }
}

function rowToPerson(sheet, col, row) {
  const firstName = cellText(sheet.getRow(row).getCell(col.firstName).value)
  const lastName = cellText(sheet.getRow(row).getCell(col.lastName).value)
  const kindRaw = cellText(sheet.getRow(row).getCell(col.kind).value)
  const notes = cellText(sheet.getRow(row).getCell(col.notes).value)
  const expiresOn = normalizeExpiresOn(
    sheet.getRow(row).getCell(col.expiresOn).value,
  )
  if (!firstName && !lastName && !kindRaw && !notes && !expiresOn) return null
  return {
    id: `row:${row}`,
    firstName,
    lastName,
    kind: parseKind(kindRaw),
    notes,
    expiresOn,
  }
}

function listPeople(sheet, col) {
  const last = Math.max(sheet.rowCount, DATA_START - 1)
  const people = []
  for (let row = DATA_START; row <= last; row += 1) {
    const person = rowToPerson(sheet, col, row)
    if (person) people.push(person)
  }
  return people
}

async function loadWorkbook() {
  if (!fs.existsSync(EXCEL_PATH)) {
    throw new Error(`excel_not_found: ${EXCEL_PATH}`)
  }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(EXCEL_PATH)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('no_sheet')
  const col = detectColumns(sheet)
  ensureExpiresHeader(sheet, col)
  return { workbook, sheet, col }
}

async function saveWorkbook(workbook) {
  const dir = path.dirname(EXCEL_PATH)
  const base = path.basename(EXCEL_PATH, path.extname(EXCEL_PATH))
  const tmp = path.join(dir, `.${base}.tmp.xlsx`)
  await workbook.xlsx.writeFile(tmp)
  fs.renameSync(tmp, EXCEL_PATH)
}

function writePersonRow(sheet, col, row, person) {
  const firstName = cellText(person.firstName)
  const lastName = cellText(person.lastName)
  const kind = parseKind(person.kind)
  const notes = cellText(person.notes)
  const expiresOn = normalizeExpiresOn(person.expiresOn)
  sheet.getRow(row).getCell(col.firstName).value = firstName
  sheet.getRow(row).getCell(col.lastName).value = lastName
  sheet.getRow(row).getCell(col.kind).value = kindLabel(kind)
  sheet.getRow(row).getCell(col.notes).value = notes
  sheet.getRow(row).getCell(col.expiresOn).value = expiresOn || null
  return { id: `row:${row}`, firstName, lastName, kind, notes, expiresOn }
}

function parseRowId(id) {
  const m = /^row:(\d+)$/.exec(String(id || '').trim())
  return m ? Number(m[1]) : 0
}

function updatedAt() {
  try {
    return fs.statSync(EXCEL_PATH).mtime.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

/** Supprime les lignes expirées (du bas vers le haut) et renvoie la liste restante. */
async function purgeExpired(workbook, sheet, col) {
  const last = Math.max(sheet.rowCount, DATA_START - 1)
  let removed = 0
  for (let row = last; row >= DATA_START; row -= 1) {
    const person = rowToPerson(sheet, col, row)
    if (!person) continue
    if (!isExpired(person.expiresOn)) continue
    sheet.spliceRows(row, 1)
    removed += 1
  }
  if (removed > 0) await saveWorkbook(workbook)
  return removed
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(body)
}

async function handlePost(body) {
  if (!SECRET || String(body.secret || '') !== SECRET) {
    return { status: 401, data: { ok: false, error: 'unauthorized' } }
  }
  const { workbook, sheet, col } = await loadWorkbook()
  const action = String(body.action || 'list').trim()

  if (action === 'list') {
    const expiredRemoved = await purgeExpired(workbook, sheet, col)
    return {
      status: 200,
      data: {
        ok: true,
        people: listPeople(sheet, col),
        updatedAt: updatedAt(),
        expiredRemoved,
      },
    }
  }

  if (action === 'upsert') {
    const person = body.person || {}
    const row = parseRowId(person.id)
    let saved
    if (row >= DATA_START && rowToPerson(sheet, col, row)) {
      saved = writePersonRow(sheet, col, row, person)
    } else {
      const last = Math.max(sheet.rowCount, DATA_START - 1)
      const newRow = Math.max(last + 1, DATA_START)
      saved = writePersonRow(sheet, col, newRow, person)
    }
    await saveWorkbook(workbook)
    return {
      status: 200,
      data: {
        ok: true,
        person: saved,
        people: listPeople(sheet, col),
        updatedAt: updatedAt(),
      },
    }
  }

  if (action === 'delete') {
    const row = parseRowId(body.id)
    if (row < DATA_START || !rowToPerson(sheet, col, row)) {
      return { status: 200, data: { ok: false, error: 'not_found' } }
    }
    sheet.spliceRows(row, 1)
    await saveWorkbook(workbook)
    return {
      status: 200,
      data: {
        ok: true,
        people: listPeople(sheet, col),
        updatedAt: updatedAt(),
      },
    }
  }

  return { status: 400, data: { ok: false, error: 'unknown_action' } }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  if (req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'authorized-list-local-excel',
      excelPath: EXCEL_PATH,
      message: 'API locale Excel. POST JSON (text/plain).',
    })
    return
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' })
    return
  }

  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = raw ? JSON.parse(raw) : {}
    const result = await handlePost(body)
    sendJson(res, result.status, result.data)
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : 'api_failed',
    })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Local Excel API: http://127.0.0.1:${PORT}`)
  console.log(`Excel: ${EXCEL_PATH}`)
  console.log(`Secret: ${SECRET}`)
  console.log(`Ouvrir: http://localhost:5175/#/s/${SECRET}`)
})
