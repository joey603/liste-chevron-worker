import type { ShiftReport, ShiftReportTexts } from './shiftReport'

/** Titre affiché dans la prévisualisation et le fichier Word. */
export const SHIFT_REPORT_DOCUMENT_TITLE =
  'דו״ח משמרת מאבטח מרלוג צרעה'

export type ShiftReportDocumentModel = {
  title: string
  report: ShiftReport
  texts: ShiftReportTexts
  extraFaults: string[]
}

export function buildShiftReportDocumentModel(
  report: ShiftReport,
  texts: ShiftReportTexts,
): ShiftReportDocumentModel {
  return {
    title: SHIFT_REPORT_DOCUMENT_TITLE,
    report,
    texts,
    extraFaults: report.openIssues
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  }
}
