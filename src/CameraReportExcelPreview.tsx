import type { CameraReport } from './cameraReport'
import type { CameraReportsArchive } from './cameraReportArchive'
import {
  buildCameraDaySheetModel,
  buildCameraLogRows,
  CAMERA_LOG_HEADERS,
  CAMERA_XLS_EVENT_PANELS,
  CAMERA_XLS_LEGENDS,
  daysInCalendarMonth,
  formatCameraGuardWithHours,
  getShiftLabel,
} from './cameraReportDaySheet'
import { parseShiftReportDate } from './shiftReportPaths'

type Props = {
  report: CameraReport
  archive?: CameraReportsArchive
  onDaySelect?: (day: number) => void
}

export default function CameraReportExcelPreview({
  report,
  archive,
  onDaySelect,
}: Props) {
  const parsed = parseShiftReportDate(report.date)
  const dayArchive = archive?.[report.date.trim()]
  const model = buildCameraDaySheetModel(report.date, dayArchive, report)
  const logRows = buildCameraLogRows(model)
  const activeTab = model.day || parsed?.day || 1
  const monthDays =
    parsed != null
      ? daysInCalendarMonth(parsed.year, parsed.month)
      : 31

  return (
    <article className="camera-xls-preview" dir="rtl">
      <div className="camera-xls-workspace">
        <aside className="camera-xls-left">
          <div className="camera-xls-datebox">
            <div className="camera-xls-date-text">{model.displayDate}</div>
            <div className="camera-xls-date-num">{model.day || ' '}</div>
            <div className="camera-xls-date-weekday">{model.weekday}</div>
          </div>

          <div className="camera-xls-roster">
            <div className="camera-xls-roster-title">מי במשמרת ?</div>
            {model.roster.map((item) => (
              <div
                key={item.shift}
                className={`camera-xls-roster-row${
                  report.shift === item.shift ? ' is-active' : ''
                }`}
              >
                <span className="camera-xls-roster-shift">
                  {getShiftLabel(item.shift)}
                </span>
                <span className="camera-xls-roster-name">
                  {formatCameraGuardWithHours(
                    item.guardName,
                    item.shiftStart,
                    item.shiftEnd,
                  ) || '\u00a0'}
                </span>
              </div>
            ))}
          </div>

          <div className="camera-xls-legend-block">
            <div className="camera-xls-legend-title">מקרא אירועים</div>
            {CAMERA_XLS_LEGENDS.map((item, index) => (
              <div
                key={item.text}
                className={`camera-xls-legend-item ${CAMERA_XLS_LEGEND_CLASS[index]}`}
              >
                {item.text}
              </div>
            ))}
          </div>

          <div className="camera-xls-mail">שלח/י לקב&quot;ט ב- Mail</div>
          <div className="camera-xls-monthly-btn">סיכום חודשי</div>
        </aside>

        <div className="camera-xls-center">
          <table className="camera-xls-log">
            <thead>
              <tr className="camera-xls-log-head">
                {CAMERA_LOG_HEADERS.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logRows.map((row, index) => {
                if (row.kind === 'empty-day') {
                  return (
                    <tr key={`empty-${index}`} className="camera-xls-log-row is-empty-day">
                      <td colSpan={6}>{row.text}</td>
                    </tr>
                  )
                }
                if (row.kind === 'shift-banner') {
                  return (
                    <tr key={`banner-${row.shift}-${index}`} className="camera-xls-shift-banner">
                      <td>{row.guardName || ' '}</td>
                      <td>{row.shiftStart}</td>
                      <td>{row.shiftEnd}</td>
                      <td>משמרת</td>
                      <td>{getShiftLabel(row.shift)}</td>
                      <td>&nbsp;</td>
                    </tr>
                  )
                }
                if (row.kind === 'event') {
                  const event = row.event
                  return (
                    <tr key={event.id} className="camera-xls-log-row has-data">
                      <td>{event.guardName}</td>
                      <td>{event.start}</td>
                      <td>{event.end}</td>
                      <td>{event.eventType}</td>
                      <td>{event.description}</td>
                      <td>{event.notes}</td>
                    </tr>
                  )
                }
                return (
                  <tr
                    key={`blank-${index}`}
                    className={`camera-xls-log-row${row.alt ? ' is-alt' : ''}`}
                  >
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <aside className="camera-xls-right">
          <div className="camera-xls-events-head">אירועי היום</div>

          {CAMERA_XLS_EVENT_PANELS.map((panel) => (
            <div
              key={panel.label}
              className={`camera-xls-event-panel ${CAMERA_XLS_EVENT_CLASS[panel.label]}`}
            >
              <div className="camera-xls-event-label">{panel.label}</div>
              <div className="camera-xls-event-grid" />
            </div>
          ))}
        </aside>
      </div>

      <div className="camera-xls-tabbar">
        {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
          const isDisabled = day > monthDays
          const TabTag = onDaySelect && !isDisabled ? 'button' : 'span'
          return (
            <TabTag
              key={day}
              type={TabTag === 'button' ? 'button' : undefined}
              className={`camera-xls-tab${
                day === activeTab ? ' is-active' : ''
              }${isDisabled ? ' is-disabled' : ''}`}
              onClick={
                onDaySelect && !isDisabled
                  ? () => onDaySelect(day)
                  : undefined
              }
              disabled={TabTag === 'button' ? isDisabled : undefined}
            >
              {day}
            </TabTag>
          )
        })}
      </div>
    </article>
  )
}

const CAMERA_XLS_LEGEND_CLASS = [
  'is-shift',
  'is-emergency',
  'is-patrol',
  'is-drill',
  'is-scan',
] as const

const CAMERA_XLS_EVENT_CLASS: Record<string, string> = {
  חירום: 'is-emergency',
  תרגיל: 'is-drill',
  'רכב הסיור': 'is-patrol',
  'חוף דור': 'is-shore',
}
