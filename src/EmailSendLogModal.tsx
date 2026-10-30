import type { ShiftEmailSentLogItem } from './types'

type Props = {
  entries: ShiftEmailSentLogItem[]
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

function formatReportsLabel(entry: ShiftEmailSentLogItem): string {
  const names = entry.attachmentNames?.filter(Boolean) ?? []
  if (names.length === 0) return 'בוקר, צוהריים, לילה'
  return names
    .map((name) =>
      name
        .replace(/^משמרת\s+/u, '')
        .replace(/\.docx$/iu, '')
        .trim(),
    )
    .filter(Boolean)
    .join(' · ')
}

export default function EmailSendLogModal({
  entries,
  loading = false,
  onClose,
}: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal email-send-log-modal"
        role="dialog"
        aria-labelledby="email-send-log-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="email-send-log-title">יומן שליחות — דוחות משמרת</h3>
        <p className="shift-settings-test-hint">
          ימים שבהם דוחות המשמרת נשלחו והתקבלו בדוא״ל (Gmail / SMTP) — רק
          שליחות שהצליחו.
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
                  <th>יום הדוח</th>
                  <th>דוחות שנשלחו</th>
                  <th>סטטוס</th>
                  <th>מועד שליחה</th>
                  <th>נמען</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={`${entry.date}-${entry.sentAt}`}>
                    <td>{entry.date}</td>
                    <td>{formatReportsLabel(entry)}</td>
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
                ))}
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
