import ExcelJS from 'exceljs'
import fs from 'node:fs'
import path from 'node:path'

/** קבוע = barre עובדים · וויזיטור = barre שמות לשיוך */
export type AuthorizedKind = 'permanent' | 'visitor'

/** Personne autorisée à entrer (liste partagée Excel / Drive). */
export type AuthorizedPersonExcelRow = {
  id: string
  firstName: string
  lastName: string
  idNumber: string
  kind: AuthorizedKind
  notes: string
  updatedAt: string
}

const HEADER_ROW = 1
const DATA_START_ROW = 2

/** Format actuel : שם פרטי | שם משפחה | סוג */
const COL = {
  firstName: 1, // A
  lastName: 2, // B
  kind: 3, // C
} as const

function cellText(value: ExcelJS.CellValue): string {
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

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

/** Accepte קבוע / וויזיטור + anciens libellés. */
export function parseAuthorizedKind(raw: string): AuthorizedKind {
  const v = raw.trim().toLowerCase().replace(/\s+/g, '')
  if (
    !v ||
    v === 'קבוע' ||
    v === 'permanent' ||
    v === 'worker' ||
    v === 'עובד' ||
    v === 'fixed'
  ) {
    return 'permanent'
  }
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

const KIND_OPTIONS = ['קבוע', 'ויזיטור'] as const
/** Lignes avec liste déroulante (nouvelles saisies incluses). */
const KIND_DROPDOWN_ROWS = 500

export function authorizedKindLabel(kind: AuthorizedKind): string {
  return kind === 'visitor' ? 'ויזיטור' : 'קבוע'
}

function applyKindDropdown(sheet: ExcelJS.Worksheet) {
  const col = COL.kind
  const range = `${sheet.getColumn(col).letter}${DATA_START_ROW}:${sheet.getColumn(col).letter}${KIND_DROPDOWN_ROWS}`
  sheet.dataValidations.add(range, {
    type: 'list',
    allowBlank: true,
    formulae: [`"${KIND_OPTIONS.join(',')}"`],
    showErrorMessage: true,
    errorStyle: 'error',
    errorTitle: 'סוג',
    error: 'בחרו קבוע או ויזיטור בלבד',
    showInputMessage: false,
  })
}

type ColumnMap = {
  firstName: number
  lastName: number
  kind: number
}

/** Détecte les colonnes (format court ou anciens formats avec # / ת.ז. / הערות). */
function detectColumns(sheet: ExcelJS.Worksheet): ColumnMap {
  const header = sheet.getRow(HEADER_ROW)
  let firstName = 0
  let lastName = 0
  let kind = 0

  header.eachCell({ includeEmpty: false }, (cell, col) => {
    const h = cellText(cell.value).toLowerCase()
    if (!h || h === '#' || h === 'מספר') return
    if (/שם\s*פרטי|first/.test(h)) firstName = col
    else if (/שם\s*משפחה|last/.test(h)) lastName = col
    else if (/סוג|type|kind/.test(h)) kind = col
    else if (/הערות|notes|עובד|כרטיס/.test(h) && !kind) kind = col
  })

  // Format actuel sans en-têtes ambigus
  if (!firstName && !lastName && !kind) {
    return { firstName: 1, lastName: 2, kind: 3 }
  }

  // Ancien format : # | פרטי | משפחה | ת.ז. | סוג/הערות
  if (!firstName) firstName = 2
  if (!lastName) lastName = 3
  if (!kind) kind = 5

  return { firstName, lastName, kind }
}

function ensureHeader(sheet: ExcelJS.Worksheet) {
  // Effacer d'éventuelles anciennes colonnes D–F
  for (let c = 1; c <= 8; c++) {
    sheet.getCell(HEADER_ROW, c).value = null
  }
  const headers: Array<[number, string]> = [
    [COL.firstName, 'שם פרטי'],
    [COL.lastName, 'שם משפחה'],
    [COL.kind, 'סוג'],
  ]
  for (const [col, label] of headers) {
    sheet.getCell(HEADER_ROW, col).value = label
    sheet.getCell(HEADER_ROW, col).font = { bold: true }
  }
  sheet.getColumn(COL.firstName).width = 16
  sheet.getColumn(COL.lastName).width = 16
  sheet.getColumn(COL.kind).width = 12
}

function clearDataRows(sheet: ExcelJS.Worksheet) {
  const last = Math.max(sheet.rowCount, DATA_START_ROW)
  for (let r = DATA_START_ROW; r <= last; r++) {
    for (let c = 1; c <= 8; c++) {
      sheet.getCell(r, c).value = null
    }
  }
}

export async function readAuthorizedListExcel(
  filePath: string,
): Promise<
  | { ok: true; people: AuthorizedPersonExcelRow[] }
  | { ok: false; error: string }
> {
  try {
    if (!filePath.trim()) return { ok: false, error: 'no_path' }
    if (!fs.existsSync(filePath)) return { ok: false, error: 'not_found' }
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(filePath)
    const sheet = workbook.worksheets[0]
    if (!sheet) return { ok: false, error: 'no_sheet' }

    const cols = detectColumns(sheet)
    const people: AuthorizedPersonExcelRow[] = []
    const now = new Date().toISOString()
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber < DATA_START_ROW) return
      const firstName = cellText(row.getCell(cols.firstName).value)
      const lastName = cellText(row.getCell(cols.lastName).value)
      const kindRaw = cellText(row.getCell(cols.kind).value)
      if (!firstName && !lastName) return
      // Ignorer une ligne d'en-tête dupliquée
      if (firstName === 'שם פרטי' || kindRaw === 'סוג') return

      people.push({
        id: makeId(),
        firstName,
        lastName,
        idNumber: '',
        kind: parseAuthorizedKind(kindRaw),
        notes: '',
        updatedAt: now,
      })
    })
    return { ok: true, people }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'read_failed',
    }
  }
}

export async function writeAuthorizedListExcel(
  filePath: string,
  people: AuthorizedPersonExcelRow[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!filePath.trim()) return { ok: false, error: 'no_path' }
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const workbook = new ExcelJS.Workbook()
    if (fs.existsSync(filePath)) {
      await workbook.xlsx.readFile(filePath)
    } else {
      workbook.addWorksheet('מורשים')
    }

    const sheet = workbook.worksheets[0] ?? workbook.addWorksheet('מורשים')
    ensureHeader(sheet)
    clearDataRows(sheet)
    applyKindDropdown(sheet)

    people.forEach((p, index) => {
      const row = DATA_START_ROW + index
      sheet.getCell(row, COL.firstName).value = p.firstName.trim()
      sheet.getCell(row, COL.lastName).value = p.lastName.trim()
      sheet.getCell(row, COL.kind).value = authorizedKindLabel(
        p.kind === 'visitor' ? 'visitor' : 'permanent',
      )
    })

    await workbook.xlsx.writeFile(filePath)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'write_failed'
    if (/EBUSY|EPERM|EACCES|locked|busy/i.test(message)) {
      return { ok: false, error: 'file_locked' }
    }
    return { ok: false, error: message }
  }
}

/** Crée un fichier Excel modèle vide (pour Drive / le directeur). */
export async function createAuthorizedListTemplate(
  filePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return writeAuthorizedListExcel(filePath, [])
}

export function getAuthorizedListFileMtime(filePath: string): number | null {
  try {
    if (!filePath.trim() || !fs.existsSync(filePath)) return null
    return fs.statSync(filePath).mtimeMs
  } catch {
    return null
  }
}
