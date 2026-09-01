import {
  isValidScan,
  normalizeCameraReport,
  sortScansByTime,
  type CameraReport,
} from './cameraReport'
import type { CameraDayArchive } from './cameraReportArchive'
import { SHIFT_LABELS, type ShiftKind } from './shiftReport'
import { parseShiftReportDate } from './shiftReportPaths'

export const CAMERA_SHIFT_ORDER: ShiftKind[] = ['morning', 'afternoon', 'night']

export type CameraExcelEventRow = {
  id: string
  guardName: string
  start: string
  end: string
  eventType: string
  description: string
  notes: string
  shift: ShiftKind
}

export type CameraShiftPreviewBlock = {
  shift: ShiftKind
  report: CameraReport
  guardName: string
  events: CameraExcelEventRow[]
}

export type CameraDaySheetModel = {
  date: string
  day: number
  weekday: string
  displayDate: string
  shiftBlocks: CameraShiftPreviewBlock[]
  roster: Array<{
    shift: ShiftKind
    guardName: string
    shiftStart: string
    shiftEnd: string
  }>
}

export function hebrewWeekdayForDate(dateStr: string): string {
  const parsed = parseShiftReportDate(dateStr)
  if (!parsed) return ''
  const d = new Date(parsed.year, parsed.month - 1, parsed.day)
  return d.toLocaleDateString('he-IL', { weekday: 'long' })
}

export function formatCameraDisplayDate(dateStr: string): string {
  const parsed = parseShiftReportDate(dateStr)
  if (!parsed) return dateStr
  const d = new Date(parsed.year, parsed.month - 1, parsed.day)
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function formatCameraDayDate(
  year: number,
  month: number,
  day: number,
): string {
  const dd = String(day).padStart(2, '0')
  const mm = String(month).padStart(2, '0')
  return `${dd}.${mm}.${year}`
}

export function daysInCalendarMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function formatCameraGuardWithHours(
  guardName: string,
  shiftStart: string,
  shiftEnd: string,
): string {
  const name = guardName.trim()
  if (!name) return ''
  if (shiftStart.trim() && shiftEnd.trim()) {
    return `${name} (${shiftStart}–${shiftEnd})`
  }
  return name
}

export function shouldShowCameraShiftBanner(report: CameraReport): boolean {
  return Boolean(report.guardName.trim()) || report.scans.some(isValidScan)
}

function getDayShiftReport(
  dayArchive: CameraDayArchive | undefined,
  date: string,
  shift: ShiftKind,
  current?: CameraReport | null,
): CameraReport | null {
  const dayKey = date.trim()
  const raw =
    current?.date.trim() === dayKey && current.shift === shift
      ? current
      : dayArchive?.[shift]
  if (!raw) return null
  return normalizeCameraReport({ ...raw, date: dayKey, shift })
}

export function buildCameraDaySheetModel(
  dateFormatted: string,
  dayArchive?: CameraDayArchive,
  current?: CameraReport | null,
): CameraDaySheetModel {
  const parsed = parseShiftReportDate(dateFormatted)
  const day = parsed?.day ?? 0
  const shiftBlocks: CameraShiftPreviewBlock[] = []
  const roster: CameraDaySheetModel['roster'] = []

  for (const shift of CAMERA_SHIFT_ORDER) {
    const report = getDayShiftReport(dayArchive, dateFormatted, shift, current)
    const guardName = report?.guardName.trim() ?? ''
    roster.push({
      shift,
      guardName,
      shiftStart: report?.shiftStart ?? '',
      shiftEnd: report?.shiftEnd ?? '',
    })

    if (!report || !shouldShowCameraShiftBanner(report)) continue

    const events = sortScansByTime(report.scans.filter(isValidScan), {
      shiftStart: report.shiftStart,
      shiftEnd: report.shiftEnd,
    }).map(
      (scan) => ({
        id: `${shift}-${scan.id}`,
        guardName,
        start: scan.start,
        end: scan.end,
        eventType: 'סריקה',
        description: 'מצלמות',
        notes: '',
        shift,
      }),
    )

    shiftBlocks.push({ shift, report, guardName, events })
  }

  return {
    date: dateFormatted,
    day,
    weekday: hebrewWeekdayForDate(dateFormatted),
    displayDate: formatCameraDisplayDate(dateFormatted),
    shiftBlocks,
    roster,
  }
}

export function buildCameraDaySheetModelsForMonth(
  year: number,
  month: number,
  days: Record<string, CameraDayArchive | undefined>,
): CameraDaySheetModel[] {
  const totalDays = daysInCalendarMonth(year, month)
  const models: CameraDaySheetModel[] = []
  for (let day = 1; day <= totalDays; day++) {
    const date = formatCameraDayDate(year, month, day)
    models.push(buildCameraDaySheetModel(date, days[date]))
  }
  return models
}

export function getShiftLabel(shift: ShiftKind): string {
  return SHIFT_LABELS[shift]
}

/** Nombre minimum de lignes vides dans le journal — identique preview / Excel. */
export const CAMERA_LOG_EMPTY_ROWS = 28

export const CAMERA_LOG_HEADERS = [
  'שם המדווח',
  'התחלה',
  'סיום',
  'סוג האירוע',
  'תיאור האירוע',
  'הערות',
] as const

export const CAMERA_XLS_LEGENDS = [
  { text: 'החלפת משמרת', color: '#bdd7ee', excelArgb: 'FFBDD7EE' },
  { text: 'חירום', color: '#ffc7ce', excelArgb: 'FFFFC7CE' },
  { text: 'רכב הסיור', color: '#c6efce', excelArgb: 'FFC6EFCE' },
  { text: 'תרגיל', color: '#ffe699', excelArgb: 'FFFFE699' },
  { text: 'סריקה / חוף דור / אחר', color: '#e2efda', excelArgb: 'FFE2EFDA' },
] as const

/** Dimensions & couleurs partagées preview ↔ Excel (px / hex). */
export const CAMERA_XLS_LAYOUT = {
  previewWidthPx: 1100,
  leftWidthPx: 148,
  rightWidthPx: 168,
  rosterShiftWidthPx: 42,
  eventLabelWidthPx: 52,
  rowHeightPx: 18,
  headerRowHeightPx: 22,
  rosterRowHeightPx: 28,
  eventPanelHeightPx: 72,
  fontMain: 11,
  fontSm: 10,
  fontDay: 34,
  cellPadY: 1,
  cellPadX: 3,
  leftGapPx: 4,
  colors: {
    page: '#ffffff',
    shell: '#bdbdbd',
    border: '#8ea9db',
    borderDark: '#404040',
    borderBlue: '#2f5597',
    borderLegend: '#d9d9d9',
    greyDark: '#595959',
    blueLight: '#5b9bd5',
    blue: '#4472c4',
    black: '#000000',
    white: '#ffffff',
    stripe: '#dce6f1',
    rosterHead: '#d9e1f2',
    rosterShift: '#f9f9f9',
    rosterActive: '#e2efda',
    linkBlue: '#0563c1',
    mailBg: 'transparent',
    tabGreen: '#217346',
    tabGreenDark: '#1a5c38',
    tabGreenLight: '#1e6b41',
    tabInactiveText: 'rgba(255, 255, 255, 0.82)',
    tabDisabledOpacity: 0.35,
  },
  logColWidthPct: [14, 8, 8, 12, 14, 44] as const,
} as const

export function cameraXlsCenterWidthPx(): number {
  return (
    CAMERA_XLS_LAYOUT.previewWidthPx -
    CAMERA_XLS_LAYOUT.leftWidthPx -
    CAMERA_XLS_LAYOUT.rightWidthPx
  )
}

export function cameraXlsLogColWidthsPx(): number[] {
  const center = cameraXlsCenterWidthPx()
  return CAMERA_XLS_LAYOUT.logColWidthPct.map(
    (pct) => Math.round((center * pct) / 100),
  )
}

export function cameraXlsRowHeightPt(px: number): number {
  return Math.round((px * 72) / 96)
}

export function cameraXlsColWidth(px: number): number {
  return Math.max(1.2, Math.round(((px - 5) / 7) * 10) / 10)
}

export function cameraXlsEventPanelRows(): number {
  return Math.max(
    1,
    Math.round(
      CAMERA_XLS_LAYOUT.eventPanelHeightPx / CAMERA_XLS_LAYOUT.rowHeightPx,
    ),
  )
}

export const CAMERA_XLS_EVENT_PANELS = [
  { label: 'חירום', color: '#ffc7ce', excelArgb: 'FFFFC7CE' },
  { label: 'תרגיל', color: '#ffe699', excelArgb: 'FFFFE699' },
  { label: 'רכב הסיור', color: '#c6efce', excelArgb: 'FFC6EFCE' },
  { label: 'חוף דור', color: '#ffffff', excelArgb: 'FFFFFFFF' },
].map((panel) => ({
  ...panel,
  rows: cameraXlsEventPanelRows(),
}))

export function cameraXlsColorArgb(hex: string): string {
  const clean = hex.replace('#', '').toUpperCase()
  return clean.length === 6 ? `FF${clean}` : 'FFFFFFFF'
}

export type CameraLogRow =
  | { kind: 'empty-day'; text: string }
  | {
      kind: 'shift-banner'
      guardName: string
      shiftStart: string
      shiftEnd: string
      shift: ShiftKind
    }
  | { kind: 'event'; event: CameraExcelEventRow }
  | { kind: 'blank'; alt: boolean }

export function getCameraLogFilledCount(model: CameraDaySheetModel): number {
  return model.shiftBlocks.reduce(
    (sum, block) => sum + 1 + block.events.length,
    0,
  )
}

/** Lignes du journal central — source unique pour preview et export Excel. */
export function buildCameraLogRows(model: CameraDaySheetModel): CameraLogRow[] {
  const rows: CameraLogRow[] = []
  const filledCount = getCameraLogFilledCount(model)

  if (model.shiftBlocks.length === 0) {
    rows.push({
      kind: 'empty-day',
      text: 'אין משמרות מולאות ליום זה',
    })
  } else {
    for (const block of model.shiftBlocks) {
      rows.push({
        kind: 'shift-banner',
        guardName: block.guardName,
        shiftStart: block.report.shiftStart,
        shiftEnd: block.report.shiftEnd,
        shift: block.shift,
      })
      for (const event of block.events) {
        rows.push({ kind: 'event', event })
      }
    }
  }

  const blankCount = Math.max(0, CAMERA_LOG_EMPTY_ROWS - filledCount)
  for (let i = 0; i < blankCount; i++) {
    rows.push({ kind: 'blank', alt: (filledCount + i) % 2 === 0 })
  }

  return rows
}
