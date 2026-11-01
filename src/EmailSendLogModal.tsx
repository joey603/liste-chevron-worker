import type { CameraMonthlyEmailSentLogItem, ShiftEmailSentLogItem } from './types'

type Props = {
  kind?: 'shift' | 'camera'
  entries: Array<ShiftEmailSentLogItem | CameraMonthlyEmailSentLogItem>
  loading?: boolean
  onClose: () => void
}

function formatSentAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL')
  } catch {
    return iso
  }
}

function periodLabel(
  kind: 'shift' | 'camera',
  entry: ShiftEmailSentLogItem | CameraMonthlyEmailSentLogItem,
): string {
  if (kind === 'camera' && 'monthKey' in entry) {
    return entry.label || entry.monthKey
  }
  if ('date' in entry) return entry.date
  return '—'
}

function formatReportsLabel(
  kind: 'shift' | 'camera',
  entry: ShiftEmailSentLogItem | CameraMonthlyEmailSentLogItem,
): string {
  const names = entry.attachmentNames?.filter(Boolean) ?? []
  if (names.length > 0) {
    return names
      .map((name) =>
        name
          .replace(/^משמרת\s+/u, '')
          .replace(/^יומן מצלמות\s+/u, '')
          .replace(/\.(docx|xlsx)$/iu, '')
          .trim(),
      )
      .filter(Boolean)
      .join(' · ')
  }
  return kind === 'camera' ? 'יומן מצלמות חודשי' : 'בוקר, צוהריים, לילה'
}

export default function EmailSendLogModal({
  kind = 'shift',
  entries,
  loading = false,
  onClose,
}: Props) {
  const title =
    kind === 'camera'
      ? 'יומן שליחות — דוח מצלמות'
      : 'יומן שליחות — דוחות משמרת'
  const periodHeader = kind === 'camera' ? 'חודש הדוח' : 'יום הדוח'
  const reportsHeader = kind === 'camera' ? 'קובץ שנשלח' : 'דוחות שנשלחו'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal email-send-log-modal"
        role="dialog"
        aria-labelledby="email-send-log-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="email-send-log-title">{title}</h3>
        <p className="shift-settings-test-hint">
          {kind === 'camera'
            ? 'חודשים שבהם יומן המצלמות נשלח והתקבל בדוא״ל — רק שליחות שהצליחו. אם מחליפים את אימייל המנהל, אפשר לשלוח שוב.'
            : 'ימים שבהם דוחות המשמרת נשלחו והתקבלו בדוא״ל — רק שליחות שהצליחו. אם מחליפים את אימייל המנהל, אפשר לשלוח שוב לאותו יום.'}
        </p>
        {loading ? (
          <p>טוען…</p>
        ) : entries.length === 0 ? (
          <p>אין שליחות רשומות.</p>
        ) : (
          <div className="shift-table-wrap email-send-log-table-wrap">
            <table className="shift-table email-send-log-table">
              <thead>
                <tr>
                  <th>{periodHeader}</th>
                  <th>{reportsHeader}</th>
                  <th>סטטוס</th>
                  <th>מועד שליחה</th>
                  <th>נמען</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const key =
                    kind === 'camera' && 'monthKey' in entry
                      ? `${entry.monthKey}-${entry.sentAt}`
                      : `${'date' in entry ? entry.date : ''}-${entry.sentAt}`
                  return (
                    <tr key={key}>
                      <td>{periodLabel(kind, entry)}</td>
                      <td>{formatReportsLabel(kind, entry)}</td>
                      <td>
                        <span
                          className={`email-send-log-status${
                            entry.messageId ? ' is-received' : ' is-sent'
                          }`}
                        >
                          {entry.messageId ? 'התקבל' : 'נשלח'}
                        </span>
                      </td>
                      <td>{formatSentAt(entry.sentAt)}</td>
                      <td>{entry.to || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: 'auto' }}
            onClick={onClose}
          >
            סגור
          </button>
        </div>
      </div>
    </div>
  )
}
