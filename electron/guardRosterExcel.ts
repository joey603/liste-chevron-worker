import ExcelJS from 'exceljs'
import fs from 'node:fs'
import path from 'node:path'

export type GuardRosterExcelRow = {
  id: string
  firstName: string
  lastName: string
  job: string
  phone: string
  company: string
  shift: string
  idCard: string
  emergencyContactPhone: string
  emergencyContactName: string
  address: string
  addedAt: string
}

const HEADER_ROW = 4
const DATA_START_ROW = 5

/** Colonnes Sheet1 (רוסטר צרעה.xlsx) */
const COL = {
  index: 1, // A
  firstName: 2, // B F/Name
  lastName: 3, // C L/Name
  job: 4, // D Job
  phone: 5, // E Phone
  company: 6, // F Company
  shift: 7, // G Shift
  idCard: 8, // H ID card #
  emergencyPhone: 9, // I Emergency Contact #
  emergencyName: 10, // J Emg. Contact Name
  address: 11, // K Address
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

function ensureHeader(sheet: ExcelJS.Worksheet) {
  if (!cellText(sheet.getCell(2, 5).value)) {
    sheet.getCell(2, 5).value = 'TLC Security'
  }
  const headers: Array<[number, string]> = [
    [COL.firstName, 'F/Name'],
    [COL.lastName, 'L/Name'],
    [COL.job, 'Job'],
    [COL.phone, 'Phone'],
    [COL.company, 'Company'],
    [COL.shift, 'Shift'],
    [COL.idCard, 'ID card #'],
    [COL.emergencyPhone, 'Emergency Contact #'],
    [COL.emergencyName, 'Emg. Contact Name'],
    [COL.address, 'Address'],
  ]
  for (const [col, label] of headers) {
    if (!cellText(sheet.getCell(HEADER_ROW, col).value)) {
      sheet.getCell(HEADER_ROW, col).value = label
    }
  }
}

function clearDataRows(sheet: ExcelJS.Worksheet) {
  const last = Math.max(sheet.rowCount, DATA_START_ROW)
  for (let r = DATA_START_ROW; r <= last; r++) {
    for (let c = 1; c <= 11; c++) {
      sheet.getCell(r, c).value = null
    }
  }
}

export async function readGuardRosterExcel(
  filePath: string,
): Promise<{ ok: true; guards: GuardRosterExcelRow[] } | { ok: false; error: string }> {
  try {
    if (!filePath.trim()) return { ok: false, error: 'no_path' }
    if (!fs.existsSync(filePath)) return { ok: false, error: 'not_found' }
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(filePath)
    const sheet = workbook.worksheets[0]
    if (!sheet) return { ok: false, error: 'no_sheet' }

    const guards: GuardRosterExcelRow[] = []
    const now = new Date().toISOString()
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber < DATA_START_ROW) return
      const firstName = cellText(row.getCell(COL.firstName).value)
      const lastName = cellText(row.getCell(COL.lastName).value)
      const phone = cellText(row.getCell(COL.phone).value)
      const address = cellText(row.getCell(COL.address).value)
      const emergencyContactName = cellText(row.getCell(COL.emergencyName).value)
      const emergencyContactPhone = cellText(row.getCell(COL.emergencyPhone).value)
      const job = cellText(row.getCell(COL.job).value)
      const company = cellText(row.getCell(COL.company).value)
      const shift = cellText(row.getCell(COL.shift).value)
      const idCard = cellText(row.getCell(COL.idCard).value)
      if (
        !firstName &&
        !lastName &&
        !phone &&
        !address &&
        !emergencyContactName &&
        !emergencyContactPhone &&
        !idCard
      ) {
        return
      }
      guards.push({
        id: makeId(),
        firstName,
        lastName,
        job: job || 'guard',
        phone,
        company: company || 'G1',
        shift,
        idCard,
        emergencyContactPhone,
        emergencyContactName,
        address,
        addedAt: now,
      })
    })
    return { ok: true, guards }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'read_failed',
    }
  }
}

export async function writeGuardRosterExcel(
  filePath: string,
  guards: GuardRosterExcelRow[],
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
      workbook.addWorksheet('Sheet1')
      workbook.addWorksheet('Sheet2')
      workbook.addWorksheet('Sheet3')
    }

    const sheet = workbook.worksheets[0] ?? workbook.addWorksheet('Sheet1')
    ensureHeader(sheet)
    clearDataRows(sheet)

    guards.forEach((g, index) => {
      const row = DATA_START_ROW + index
      sheet.getCell(row, COL.index).value = index + 1
      sheet.getCell(row, COL.firstName).value = g.firstName.trim()
      sheet.getCell(row, COL.lastName).value = g.lastName.trim()
      sheet.getCell(row, COL.job).value = (g.job || 'guard').trim()
      sheet.getCell(row, COL.phone).value = g.phone.trim()
      sheet.getCell(row, COL.company).value = (g.company || 'G1').trim()
      sheet.getCell(row, COL.shift).value = g.shift.trim()
      sheet.getCell(row, COL.idCard).value = g.idCard.trim()
      sheet.getCell(row, COL.emergencyPhone).value =
        g.emergencyContactPhone.trim()
      sheet.getCell(row, COL.emergencyName).value =
        g.emergencyContactName.trim()
      sheet.getCell(row, COL.address).value = g.address.trim()
    })

    await workbook.xlsx.writeFile(filePath)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'write_failed'
    // Fichier ouvert dans Excel → verrou Windows
    if (/EBUSY|EPERM|EACCES|locked|busy/i.test(message)) {
      return { ok: false, error: 'file_locked' }
    }
    return { ok: false, error: message }
  }
}
