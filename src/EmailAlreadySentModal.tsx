type Props = {
  sentAt?: string
  messageId?: string
  to?: string
  resending?: boolean
  onClose: () => void
  onResend: () => void
}

function formatSentAt(iso?: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('he-IL')
  } catch {
    return iso
  }
}

export default function EmailAlreadySentModal({
  sentAt,
  messageId,
  to,
  resending = false,
  onClose,
  onResend,
}: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="alertdialog"
        aria-labelledby="email-already-sent-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="email-already-sent-title">דוא״ל כבר נשלח</h3>
        <p>
          הדוא״ל נשלח בהצלחה בעבר. השליחה אומתה מול שרת SMTP (לא רק באפליקציה).
        </p>
        {sentAt ? (
          <p>
            <strong>מועד:</strong> {formatSentAt(sentAt)}
          </p>
        ) : null}
        {to ? (
          <p>
            <strong>נמען:</strong> {to}
          </p>
        ) : null}
        {messageId ? (
          <p>
            <strong>מזהה SMTP:</strong>{' '}
            <code style={{ wordBreak: 'break-all' }}>{messageId}</code>
          </p>
        ) : (
          <p className="shift-settings-test-hint">
            אין מזהה SMTP שמור לשליחה זו (שליחה ישנה).
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: 'auto' }}
            onClick={onClose}
            disabled={resending}
          >
            סגור
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: 'auto' }}
            onClick={onResend}
            disabled={resending}
          >
            {resending ? 'שולח…' : 'שלח שוב'}
          </button>
        </div>
      </div>
    </div>
  )
}
