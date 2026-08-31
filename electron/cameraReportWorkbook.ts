import ExcelJS from 'exceljs'
import type { CameraReportsArchive } from '../src/cameraReportArchive'
import type { CameraReport } from '../src/cameraReport'
import {
  buildCameraDaySheetModelsForMonth,
  buildCameraLogRows,
  CAMERA_LOG_HEADERS,
  CAMERA_XLS_EVENT_PANELS,
  CAMERA_XLS_LAYOUT,
  CAMERA_XLS_LEGENDS,
  cameraXlsColWidth,
  cameraXlsColorArgb,
  cameraXlsLogColWidthsPx,
  cameraXlsRowHeightPt,
  daysInCalendarMonth,
  formatCameraGuardWithHours,
  getShiftLabel,
  type CameraDaySheetModel,
} from '../src/cameraReportDaySheet'
import {
  buildMonthlyCameraReport,
  mergeReportIntoMonthly,
  type MonthlyCameraReport,
} from '../src/cameraReportMonthly'
import { hebrewMonthName } from '../src/shiftReportPaths'

const C = CAMERA_XLS_LAYOUT.colors
const COLORS = {
  blue: cameraXlsColorArgb(C.blue),
  blueDark: cameraXlsColorArgb(C.borderBlue),
  black: cameraXlsColorArgb(C.black),
  white: cameraXlsColorArgb(C.white),
  stripe: cameraXlsColorArgb(C.stripe),
  greyDark: cameraXlsColorArgb(C.greyDark),
  blueLight: cameraXlsColorArgb(C.blueLight),
  border: cameraXlsColorArgb(C.border),
  borderDark: cameraXlsColorArgb(C.borderDark),
  borderLegend: cameraXlsColorArgb(C.borderLegend),
  rosterHead: cameraXlsColorArgb(C.rosterHead),
  rosterShift: cameraXlsColorArgb(C.rosterShift),
  linkBlue: cameraXlsColorArgb(C.linkBlue),
  greenTab: cameraXlsColorArgb(C.tabGreen),
  greyTab: 'FFAAAAAA',
} as const

const ROW_BODY = cameraXlsRowHeightPt(CAMERA_XLS_LAYOUT.rowHeightPx)
const ROW_HEAD = cameraXlsRowHeightPt(CAMERA_XLS_LAYOUT.headerRowHeightPx)
const ROW_ROSTER = cameraXlsRowHeightPt(CAMERA_XLS_LAYOUT.rosterRowHeightPx)

const LOG_HEADER_ROW = 2
const LOG_BODY_START_ROW = 3
const LOG_FIRST_COL = 4
const LOG_LAST_COL = 9
const RIGHT_LABEL_COL = 16
const RIGHT_GRID_COL = 17

const LEFT_NAME_W = CAMERA_XLS_LAYOUT.leftWidthPx - CAMERA_XLS_LAYOUT.rosterShiftWidthPx
const RIGHT_GRID_W = CAMERA_XLS_LAYOUT.rightWidthPx - CAMERA_XLS_LAYOUT.eventLabelWidthPx

type MonthlyInput = {
  year: number
  month: number
  archive?: CameraReportsArchive | Record<string, Record<string, unknown>>
  currentReport?: CameraReport | Record<string, unknown>
}

function cellBorder(
  color = COLORS.border,
  sides: Partial<Record<'top' | 'left' | 'bottom' | 'right', boolean>> = {},
): Partial<ExcelJS.Borders> {
  const all = { top: true, left: true, bottom: true, right: true, ...sides }
  const side = { style: 'thin' as const, color: { argb: color } }
  return {
    top: all.top ? side : undefined,
    left: all.left ? side : undefined,
    bottom: all.bottom ? side : undefined,
    right: all.right ? side : undefined,
  }
}

function fillCell(
  cell: ExcelJS.Cell,
  argb: string,
  opts?: {
    bold?: boolean
    color?: string
    size?: number
    align?: 'center' | 'right' | 'left'
    underline?: boolean
    borders?: Partial<ExcelJS.Borders>
  },
) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
  cell.font = {
    bold: opts?.bold ?? false,
    color: { argb: opts?.color ?? COLORS.black },
    size: opts?.size ?? CAMERA_XLS_LAYOUT.fontMain,
    name: 'Calibri',
    underline: opts?.underline,
  }
  cell.alignment = {
    vertical: 'middle',
    horizontal: opts?.align ?? 'center',
    readingOrder: 'rtl',
    wrapText: false,
    indent: 0,
    shrinkToFit: false,
  }
  cell.border = opts?.borders ?? cellBorder()
}

function setRowHeight(sheet: ExcelJS.Worksheet, row: number, px: number) {
  sheet.getRow(row).height = cameraXlsRowHeightPt(px)
}

function monthlyFromInput(input: MonthlyInput): MonthlyCameraReport {
  let monthly = buildMonthlyCameraReport(
    input.archive as CameraReportsArchive | undefined,
    input.year,
    input.month,
  )
  if (input.currentReport) {
    monthly = mergeReportIntoMonthly(
      monthly,
      input.currentReport as CameraReport,
    )
  }
  return monthly
}

function writeLeftPanel(
  sheet: ExcelJS.Worksheet,
  model: CameraDaySheetModel,
  lastBodyRow: number,
) {
  setRowHeight(sheet, 2, 16)
  sheet.mergeCells('A2:B2')
  fillCell(sheet.getCell('A2'), COLORS.greyDark, {
    bold: true,
    color: COLORS.white,
    size: CAMERA_XLS_LAYOUT.fontSm,
    borders: cellBorder(COLORS.borderDark),
  })
  sheet.getCell('A2').value = model.displayDate

  sheet.mergeCells('A3:B5')
  for (let r = 3; r <= 5; r++) setRowHeight(sheet, r, 20)
  fillCell(sheet.getCell('A3'), COLORS.greyDark, {
    bold: true,
    color: COLORS.blueLight,
    size: CAMERA_XLS_LAYOUT.fontDay,
    borders: cellBorder(COLORS.borderDark),
  })
  sheet.getCell('A3').value = model.day || ' '

  setRowHeight(sheet, 6, 16)
  sheet.mergeCells('A6:B6')
  fillCell(sheet.getCell('A6'), COLORS.greyDark, {
    bold: true,
    color: COLORS.white,
    borders: cellBorder(COLORS.borderDark),
  })
  sheet.getCell('A6').value = model.weekday

  const rosterTitleRow = 8
  setRowHeight(sheet, rosterTitleRow, 18)
  fillCell(sheet.getCell(`A${rosterTitleRow}`), COLORS.rosterHead, {
    bold: true,
    align: 'right',
    size: CAMERA_XLS_LAYOUT.fontSm,
  })
  sheet.mergeCells(`A${rosterTitleRow}:B${rosterTitleRow}`)
  sheet.getCell(`A${rosterTitleRow}`).value = 'מי במשמרת ?'

  model.roster.forEach((item, index) => {
    const r = rosterTitleRow + 1 + index
    setRowHeight(sheet, r, CAMERA_XLS_LAYOUT.rosterRowHeightPx)
    fillCell(sheet.getCell(`A${r}`), COLORS.rosterShift, {
      bold: true,
      size: CAMERA_XLS_LAYOUT.fontSm,
      borders: cellBorder(COLORS.border, { right: true }),
    })
    sheet.getCell(`A${r}`).value = getShiftLabel(item.shift)
    fillCell(sheet.getCell(`B${r}`), COLORS.white, {
      align: 'right',
      size: CAMERA_XLS_LAYOUT.fontSm,
    })
    sheet.getCell(`B${r}`).value =
      formatCameraGuardWithHours(
        item.guardName,
        item.shiftStart,
        item.shiftEnd,
      ) || ' '
  })

  const legendTitleRow = 12
  setRowHeight(sheet, legendTitleRow, 18)
  fillCell(sheet.getCell(`A${legendTitleRow}`), COLORS.rosterHead, {
    bold: true,
    align: 'right',
    size: CAMERA_XLS_LAYOUT.fontSm,
  })
  sheet.mergeCells(`A${legendTitleRow}:B${legendTitleRow}`)
  sheet.getCell(`A${legendTitleRow}`).value = 'מקרא אירועים'

  CAMERA_XLS_LEGENDS.forEach((item, index) => {
    const r = legendTitleRow + 1 + index
    setRowHeight(sheet, r, 18)
    sheet.mergeCells(`A${r}:B${r}`)
    fillCell(sheet.getCell(`A${r}`), item.excelArgb, {
      align: 'right',
      size: CAMERA_XLS_LAYOUT.fontSm,
      borders: cellBorder(COLORS.borderLegend, { bottom: index < CAMERA_XLS_LEGENDS.length - 1 }),
    })
    sheet.getCell(`A${r}`).value = item.text
  })

  const mailRow = 18
  setRowHeight(sheet, mailRow, 16)
  sheet.mergeCells(`A${mailRow}:B${mailRow}`)
  fillCell(sheet.getCell(`A${mailRow}`), COLORS.white, {
    bold: true,
    align: 'right',
    color: COLORS.linkBlue,
    underline: true,
    size: CAMERA_XLS_LAYOUT.fontSm,
    borders: cellBorder(COLORS.white, { top: false, left: false, right: false, bottom: false }),
  })
  sheet.getCell(`A${mailRow}`).value = 'שלח/י לקב"ט ב- Mail'

  const monthlyRow = 19
  setRowHeight(sheet, monthlyRow, 22)
  sheet.mergeCells(`A${monthlyRow}:B${monthlyRow}`)
  fillCell(sheet.getCell(`A${monthlyRow}`), COLORS.blue, {
    bold: true,
    color: COLORS.white,
    borders: cellBorder(COLORS.blueDark),
  })
  sheet.getCell(`A${monthlyRow}`).value = 'סיכום חודשי'

  for (let r = monthlyRow + 1; r <= lastBodyRow; r++) {
    setRowHeight(sheet, r, CAMERA_XLS_LAYOUT.rowHeightPx)
    sheet.mergeCells(`A${r}:B${r}`)
    fillCell(sheet.getCell(`A${r}`), COLORS.white, {
      borders: cellBorder(COLORS.white, { top: false, left: false, right: false, bottom: false }),
    })
    sheet.getCell(`A${r}`).value = ' '
  }
}

function writeLogTable(sheet: ExcelJS.Worksheet, model: CameraDaySheetModel) {
  setRowHeight(sheet, LOG_HEADER_ROW, CAMERA_XLS_LAYOUT.headerRowHeightPx)

  CAMERA_LOG_HEADERS.forEach((label, index) => {
    const cell = sheet.getCell(LOG_HEADER_ROW, LOG_FIRST_COL + index)
    fillCell(cell, COLORS.black, {
      bold: true,
      color: COLORS.white,
      borders: cellBorder(COLORS.black),
    })
    cell.value = label
  })

  sheet.mergeCells(LOG_HEADER_ROW, RIGHT_LABEL_COL, LOG_HEADER_ROW, RIGHT_GRID_COL + 1)
  fillCell(sheet.getCell(LOG_HEADER_ROW, RIGHT_LABEL_COL), COLORS.black, {
    bold: true,
    color: COLORS.white,
    borders: cellBorder(COLORS.black),
  })
  sheet.getCell(LOG_HEADER_ROW, RIGHT_LABEL_COL).value = 'אירועי היום'

  const logRows = buildCameraLogRows(model)
  logRows.forEach((row, index) => {
    const excelRow = LOG_BODY_START_ROW + index
    setRowHeight(sheet, excelRow, CAMERA_XLS_LAYOUT.rowHeightPx)

    if (row.kind === 'empty-day') {
      sheet.mergeCells(excelRow, LOG_FIRST_COL, excelRow, LOG_LAST_COL)
      const cell = sheet.getCell(excelRow, LOG_FIRST_COL)
      fillCell(cell, COLORS.white, { align: 'center', size: CAMERA_XLS_LAYOUT.fontSm })
      cell.value = row.text
      return
    }

    if (row.kind === 'shift-banner') {
      const values = [
        row.guardName || ' ',
        row.shiftStart,
        row.shiftEnd,
        'משמרת',
        getShiftLabel(row.shift),
        ' ',
      ]
      values.forEach((value, colIndex) => {
        const cell = sheet.getCell(excelRow, LOG_FIRST_COL + colIndex)
        fillCell(cell, COLORS.blue, {
          bold: true,
          color: COLORS.white,
          align: colIndex === 5 ? 'right' : 'center',
          borders: cellBorder(COLORS.blueDark),
        })
        cell.value = value
      })
      return
    }

    if (row.kind === 'event') {
      const values = [
        row.event.guardName,
        row.event.start,
        row.event.end,
        row.event.eventType,
        row.event.description,
        row.event.notes,
      ]
      values.forEach((value, colIndex) => {
        const cell = sheet.getCell(excelRow, LOG_FIRST_COL + colIndex)
        fillCell(cell, COLORS.white, {
          bold: true,
          align: colIndex >= 4 ? 'right' : 'center',
        })
        cell.value = value || ' '
      })
      return
    }

    for (let col = LOG_FIRST_COL; col <= LOG_LAST_COL; col++) {
      const cell = sheet.getCell(excelRow, col)
      fillCell(cell, row.alt ? COLORS.stripe : COLORS.white)
      cell.value = ' '
    }
  })

  return LOG_BODY_START_ROW + logRows.length - 1
}

function writeRightPanels(sheet: ExcelJS.Worksheet, lastBodyRow: number) {
  let startRow = LOG_BODY_START_ROW
  for (const panel of CAMERA_XLS_EVENT_PANELS) {
    for (let i = 0; i < panel.rows; i++) {
      const r = startRow + i
      setRowHeight(sheet, r, CAMERA_XLS_LAYOUT.rowHeightPx)
      const labelCell = sheet.getCell(r, RIGHT_LABEL_COL)
      fillCell(labelCell, panel.excelArgb, {
        bold: true,
        size: CAMERA_XLS_LAYOUT.fontSm,
        borders: cellBorder(COLORS.border, { right: true, bottom: i === panel.rows - 1 }),
      })
      labelCell.value = i === 0 ? panel.label : ' '

      sheet.mergeCells(r, RIGHT_GRID_COL, r, RIGHT_GRID_COL + 1)
      const gridCell = sheet.getCell(r, RIGHT_GRID_COL)
      fillCell(gridCell, COLORS.white, {
        borders: cellBorder(COLORS.border, {
          top: true,
          left: false,
          right: true,
          bottom: i === panel.rows - 1,
        }),
      })
      gridCell.value = ' '
    }
    startRow += panel.rows
  }

  for (let r = startRow; r <= lastBodyRow; r++) {
    setRowHeight(sheet, r, CAMERA_XLS_LAYOUT.rowHeightPx)
    fillCell(sheet.getCell(r, RIGHT_LABEL_COL), COLORS.white, {
      borders: cellBorder(COLORS.white, { top: false, left: false, right: false, bottom: false }),
    })
    sheet.getCell(r, RIGHT_LABEL_COL).value = ' '
    sheet.mergeCells(r, RIGHT_GRID_COL, r, RIGHT_GRID_COL + 1)
    fillCell(sheet.getCell(r, RIGHT_GRID_COL), COLORS.white, {
      borders: cellBorder(COLORS.white, { top: false, left: false, right: false, bottom: false }),
    })
    sheet.getCell(r, RIGHT_GRID_COL).value = ' '
  }
}

function applySheetDimensions(sheet: ExcelJS.Worksheet) {
  const logWidths = cameraXlsLogColWidthsPx()
  sheet.getColumn('A').width = cameraXlsColWidth(CAMERA_XLS_LAYOUT.rosterShiftWidthPx)
  sheet.getColumn('B').width = cameraXlsColWidth(LEFT_NAME_W)
  sheet.getColumn('C').width = 0.4
  logWidths.forEach((px, index) => {
    sheet.getColumn(LOG_FIRST_COL + index).width = cameraXlsColWidth(px)
  })
  for (let col = 10; col <= 15; col++) {
    sheet.getColumn(col).width = 0.4
  }
  sheet.getColumn(RIGHT_LABEL_COL).width = cameraXlsColWidth(
    CAMERA_XLS_LAYOUT.eventLabelWidthPx,
  )
  const gridHalf = RIGHT_GRID_W / 2
  sheet.getColumn(RIGHT_GRID_COL).width = cameraXlsColWidth(gridHalf)
  sheet.getColumn(RIGHT_GRID_COL + 1).width = cameraXlsColWidth(gridHalf)
}

function writeDaySheet(sheet: ExcelJS.Worksheet, model: CameraDaySheetModel) {
  sheet.views = [
    {
      rightToLeft: true,
      showGridLines: false,
      zoomScale: 100,
    },
  ]
  sheet.properties.defaultRowHeight = ROW_BODY

  applySheetDimensions(sheet)

  const lastBodyRow = writeLogTable(sheet, model)
  writeLeftPanel(sheet, model, lastBodyRow)
  writeRightPanels(sheet, lastBodyRow)

  sheet.pageSetup = {
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.2,
      right: 0.2,
      top: 0.3,
      bottom: 0.3,
      header: 0,
      footer: 0,
    },
  }
}

export function cameraReportMonthlyWorkbookFileName(
  year: number,
  month: number,
): string {
  return `יומן מצלמות ${hebrewMonthName(month)} ${year}.xlsx`
}

export async function buildCameraMonthlyWorkbookBuffer(
  input: MonthlyInput,
): Promise<Buffer> {
  const monthly = monthlyFromInput(input)
  const dayModels = buildCameraDaySheetModelsForMonth(
    input.year,
    input.month,
    monthly.days,
  )
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Liste Chevron'
  workbook.created = new Date()

  const totalDays = daysInCalendarMonth(input.year, input.month)
  for (let day = 1; day <= 31; day++) {
    const sheet = workbook.addWorksheet(String(day), {
      properties: {
        tabColor: {
          argb: day <= totalDays ? COLORS.greenTab : COLORS.greyTab,
        },
      },
    })
    if (day <= totalDays) {
      writeDaySheet(sheet, dayModels[day - 1])
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export async function writeCameraMonthlyWorkbook(
  filePath: string,
  input: MonthlyInput,
): Promise<void> {
  const buffer = await buildCameraMonthlyWorkbookBuffer(input)
  const fs = await import('node:fs/promises')
  await fs.writeFile(filePath, buffer)
}
