import { useState } from 'react'
import { restoreUiInteractivity } from './captureDomToPng'
import {
  createId,
  type AuthorizedPerson,
  type CardlessPerson,
  type Worker,
} from './types'

type Props = {
  excelPath: string
  peopleCount: number
  /** עובדים → קבוע dans le Excel initial */
  workers: Worker[]
  /** שמות ויזיטור → ויזיטור dans le Excel initial */
  visitors: CardlessPerson[]
  /** Une seule écriture : chemin + liste (évite d’écraser le chemin). */
  onSynced: (payload: {
    path: string
    people: AuthorizedPerson[]
    message?: string
  }) => void | Promise<void>
  onToast: (message: string) => void
}

function nameKey(firstName: string, lastName: string): string {
  return `${firstName.trim().toLowerCase()}|${lastName.trim().toLowerCase()}`
}

/** Construit la liste Excel à partir des listes de l'app. */
function buildPeopleFromApp(
  workers: Worker[],
  visitors: CardlessPerson[],
): AuthorizedPerson[] {
  const seen = new Set<string>()
  const people: AuthorizedPerson[] = []
  const now = new Date().toISOString()

  const push = (
    firstName: string,
    lastName: string,
    kind: AuthorizedPerson['kind'],
  ) => {
    const f = firstName.trim()
    const l = lastName.trim()
    if (!f && !l) return
    const key = nameKey(f, l)
    if (seen.has(key)) return
    seen.add(key)
    people.push({
      id: createId(),
      firstName: f,
      lastName: l,
      idNumber: '',
      kind,
      notes: '',
      updatedAt: now,
    })
  }

  for (const w of workers) {
    push(w.firstName, w.lastName, 'permanent')
  }
  for (const v of visitors) {
    push(v.firstName, v.lastName, 'visitor')
  }
  return people
}

/**
 * Barre compacte pour créer / lier / recharger le fichier Excel « רשימת מורשים »
 * (partagé via Drive avec le directeur).
 */
export default function AuthorizedPeopleSyncBar({
  excelPath,
  peopleCount,
  workers,
  visitors,
  onSynced,
  onToast,
}: Props) {
  const [busy, setBusy] = useState(false)

  async function createExcelFromAppList() {
    if (
      !window.listeApi?.createAuthorizedListExcel ||
      !window.listeApi?.writeAuthorizedListExcel
    ) {
      onToast('יצירת קובץ זמינה רק באפליקציה המותקנת')
      return
    }
    const people = buildPeopleFromApp(workers, visitors)
    if (people.length === 0) {
      onToast('אין שמות ברשימה — הוסיפו עובדים או ויזיטורים תחילה')
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
      const written = await window.listeApi.writeAuthorizedListExcel({
        filePath: result.path,
        people,
      })
      if (!written.ok) {
        onToast(
          written.error === 'file_locked'
            ? 'ה־Excel פתוח — סגרו ושמרו שוב'
            : `שמירה ל־Excel נכשלה${written.error ? `: ${written.error}` : ''}`,
        )
        return
      }
      const permanentCount = people.filter((p) => p.kind === 'permanent').length
      const visitorCount = people.filter((p) => p.kind === 'visitor').length
      await onSynced({
        path: result.path,
        people,
        message: `נוצר Excel עם ${people.length} שמות (${permanentCount} קבוע · ${visitorCount} ויזיטור)`,
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
    : 'אין קובץ — צרו מהרשימה או בחרו קובץ'

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
          onClick={() => void createExcelFromAppList()}
          title="יוצר Excel עם כל העובדים (קבוע) ושמות הוויזיטור (ויזיטור)"
        >
          צור מהרשימה
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
