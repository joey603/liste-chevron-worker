import { useState } from 'react'
import { restoreUiInteractivity } from './captureDomToPng'
import type { AuthorizedPerson } from './types'

type Props = {
  excelPath: string
  peopleCount: number
  /** Une seule écriture : chemin + liste (évite d’écraser le chemin). */
  onSynced: (payload: {
    path: string
    people: AuthorizedPerson[]
    message?: string
  }) => void | Promise<void>
  onToast: (message: string) => void
}

/**
 * Barre compacte pour créer / lier / recharger le fichier Excel « רשימת מורשים »
 * (partagé via Drive avec le directeur).
 */
export default function AuthorizedPeopleSyncBar({
  excelPath,
  peopleCount,
  onSynced,
  onToast,
}: Props) {
  const [busy, setBusy] = useState(false)

  async function createExcel() {
    if (!window.listeApi?.createAuthorizedListExcel) {
      onToast('יצירת קובץ זמינה רק באפליקציה המותקנת')
      return
    }
    setBusy(true)
    try {
      const result = await window.listeApi.createAuthorizedListExcel({
        defaultName: 'רשימת מורשים.xlsx',
      })
      if (!result.ok || !result.path) {
        if ('error' in result && result.error) {
          onToast(`יצירת הקובץ נכשלה: ${result.error}`)
        }
        return
      }
      await onSynced({
        path: result.path,
        people: [],
        message: 'נוצר קובץ רשימת מורשים — מלאו אותו ב־Excel / Drive',
      })
    } finally {
      setBusy(false)
      restoreUiInteractivity()
    }
  }

  async function pickExcel() {
    if (!window.listeApi?.pickAuthorizedListExcel) {
      onToast('בחירת קובץ זמינה רק באפליקציה המותקנת')
      return
    }
    setBusy(true)
    try {
      const picked = await window.listeApi.pickAuthorizedListExcel()
      if (!picked.ok || !picked.path) return
      await loadFromExcel(picked.path)
    } finally {
      setBusy(false)
      restoreUiInteractivity()
    }
  }

  async function loadFromExcel(filePath: string) {
    if (!window.listeApi?.readAuthorizedListExcel) {
      onToast('קריאת Excel זמינה רק באפליקציה המותקנת')
      return
    }
    const result = await window.listeApi.readAuthorizedListExcel(filePath)
    if (!result.ok) {
      onToast(
        result.error === 'not_found'
          ? 'קובץ ה־Excel לא נמצא — בחרו שוב את הקובץ'
          : `טעינת Excel נכשלה${result.error ? `: ${result.error}` : ''}`,
      )
      return
    }
    await onSynced({
      path: filePath,
      people: result.people,
      message: `נטענו ${result.people.length} מורשים מקובץ ה־Excel`,
    })
  }

  async function reloadExcel() {
    const filePath = excelPath.trim()
    if (!filePath) {
      onToast('צרו או בחרו קובץ Excel תחילה')
      return
    }
    setBusy(true)
    try {
      await loadFromExcel(filePath)
    } finally {
      setBusy(false)
    }
  }

  const pathLabel = excelPath.trim()
    ? excelPath
    : 'אין קובץ — צרו או בחרו «רשימת מורשים.xlsx»'

  return (
    <div className="roster-excel-bar authorized-excel-bar">
      <input
        id="authorized-excel-path"
        className="roster-excel-path-input"
        value={excelPath}
        readOnly
        placeholder="קובץ רשימת מורשים (Excel / Drive)"
        aria-label="קובץ Excel רשימת מורשים"
        dir="ltr"
        title={pathLabel}
      />
      <span className="authorized-excel-count" title="מספר מורשים שנטענו">
        {peopleCount}
      </span>
      <div className="roster-excel-actions">
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: 'auto' }}
          disabled={busy}
          onClick={() => void createExcel()}
        >
          צור קובץ
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => void pickExcel()}
        >
          בחר קובץ
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || !excelPath.trim()}
          onClick={() => void reloadExcel()}
        >
          טען מהקובץ
        </button>
      </div>
    </div>
  )
}
