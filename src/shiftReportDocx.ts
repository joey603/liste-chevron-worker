import {
  AlignmentType,
  BorderStyle,
  Document,
  HighlightColor,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
  type IParagraphOptions,
} from 'docx'
import {
  SHIFT_LABELS,
  SHIFT_NOTE_YELLOW_HIGHLIGHT,
  normalizeShiftReportTexts,
  type ShiftReport,
  type ShiftReportTexts,
} from './shiftReport'
import {
  buildShiftReportDocumentModel,
  SHIFT_REPORT_DOCUMENT_TITLE,
} from './shiftReportDocument'
import {
  cssColorToHex,
  parseRichHtmlSegments,
  stripHtml,
} from './shiftRichText'
import { shiftReportFileName as buildShiftReportFileName } from './shiftReportPaths'

export { buildShiftReportFileName as shiftReportFileName }

const THIN = { style: BorderStyle.SINGLE, size: 8, color: '000000' }
const BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN }
const PAGE_WIDTH = 9360
const CELL_PAD = { top: 150, bottom: 150, left: 180, right: 180 }
const RTL_MARK = '\u200F'
const HEBREW_LANGUAGE = { value: 'he-IL', bidirectional: 'he-IL' } as const
const HEBREW_FONT = {
  ascii: 'Arial',
  hAnsi: 'Arial',
  cs: 'Arial',
} as const
const RTL_BULLET_INDENT = { right: 720, hanging: 360 }

type ParagraphOpts = IParagraphOptions

function rtlText(text: string, mark = true): string {
  if (!text) return text
  if (!mark || text.startsWith(RTL_MARK)) return text
  return `${RTL_MARK}${text}`
}

function rtlParagraph(
  options: ParagraphOpts & {
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]
  },
): Paragraph {
  const { alignment = AlignmentType.START, run: _run, ...rest } = options
  return new Paragraph({
    ...rest,
    bidirectional: true,
    alignment,
  })
}

function emptyRtlRun(): TextRun {
  return new TextRun({
    text: '',
    language: HEBREW_LANGUAGE,
    font: HEBREW_FONT,
  })
}

function shiftTable(
  rows: TableRow[],
  columnWidths: number[],
): Table {
  return new Table({
    width: { size: PAGE_WIDTH, type: WidthType.DXA },
    columnWidths,
    visuallyRightToLeft: true,
    rows,
  })
}

function mapHighlight(
  cssColor?: string,
): (typeof HighlightColor)[keyof typeof HighlightColor] | undefined {
  if (!cssColor) return undefined
  const hex = cssColorToHex(cssColor)
  if (!hex) {
    const c = cssColor.replace(/\s/g, '').toLowerCase()
    if (c === 'transparent' || c === 'rgba(0,0,0,0)') return undefined
    return HighlightColor.YELLOW
  }
  // Associe la couleur la plus proche parmi les surlignages Word
  const map: Array<{
    hex: string
    value: (typeof HighlightColor)[keyof typeof HighlightColor]
  }> = [
    { hex: 'FFFF00', value: HighlightColor.YELLOW },
    { hex: '00FF00', value: HighlightColor.GREEN },
    { hex: 'CCFF99', value: HighlightColor.GREEN },
    { hex: '90EE90', value: HighlightColor.GREEN },
    { hex: '00FFFF', value: HighlightColor.CYAN },
    { hex: '99FFFF', value: HighlightColor.CYAN },
    { hex: 'FF00FF', value: HighlightColor.MAGENTA },
    { hex: 'FF99CC', value: HighlightColor.MAGENTA },
    { hex: 'FFC0CB', value: HighlightColor.MAGENTA },
    { hex: 'FFCC99', value: HighlightColor.DARK_YELLOW },
    { hex: 'FFA500', value: HighlightColor.DARK_YELLOW },
    { hex: '0000FF', value: HighlightColor.BLUE },
    { hex: 'FF0000', value: HighlightColor.RED },
    { hex: '000000', value: HighlightColor.BLACK },
    { hex: 'FFFFFF', value: HighlightColor.WHITE },
  ]
  const exact = map.find((m) => m.hex === hex)
  if (exact) return exact.value

  // Distance RGB simple
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  let best: (typeof HighlightColor)[keyof typeof HighlightColor] =
    HighlightColor.YELLOW
  let bestDist = Infinity
  for (const m of map) {
    const mr = Number.parseInt(m.hex.slice(0, 2), 16)
    const mg = Number.parseInt(m.hex.slice(2, 4), 16)
    const mb = Number.parseInt(m.hex.slice(4, 6), 16)
    const dist = (r - mr) ** 2 + (g - mg) ** 2 + (b - mb) ** 2
    if (dist < bestDist) {
      bestDist = dist
      best = m.value
    }
  }
  return best
}

function he(
  text: string,
  opts?: {
    bold?: boolean
    italics?: boolean
    size?: number
    color?: string
    underline?: boolean
    highlight?: (typeof HighlightColor)[keyof typeof HighlightColor]
    font?: string
  },
  mark = true,
) {
  const color = opts?.color ? cssColorToHex(opts.color) ?? opts.color.replace(/^#/, '') : undefined
  return new TextRun({
    text: rtlText(text, mark),
    bold: opts?.bold,
    italics: opts?.italics,
    size: opts?.size ?? 22,
    font: opts?.font
      ? { ascii: opts.font, hAnsi: opts.font, cs: opts.font }
      : HEBREW_FONT,
    language: HEBREW_LANGUAGE,
    color,
    underline: opts?.underline ? { type: UnderlineType.SINGLE } : undefined,
    highlight: opts?.highlight,
  })
}

function rtlBreak(): TextRun {
  return new TextRun({ break: 1, language: HEBREW_LANGUAGE, font: HEBREW_FONT })
}

function richHtmlToRuns(
  html: string,
  defaults?: {
    bold?: boolean
    italics?: boolean
    size?: number
    color?: string
    underline?: boolean
  },
): TextRun[] {
  const segments = parseRichHtmlSegments(html)
  if (segments.length === 0) {
    const plain = stripHtml(html)
    return plain ? [he(plain, defaults)] : [emptyRtlRun()]
  }
  return segments.flatMap((seg, index) => {
    const segmentText = index === 0 ? rtlText(seg.text) : seg.text
    // Les styles HTML de l’app priment ; les defaults ne comblent que le manquant
    const runOpts = {
      bold: seg.style.bold ?? defaults?.bold,
      italics: seg.style.italics ?? defaults?.italics,
      underline: seg.style.underline ?? defaults?.underline,
      color: seg.style.color ?? defaults?.color,
      size: seg.style.size ?? defaults?.size,
      font: seg.style.font,
      highlight: mapHighlight(seg.style.highlight),
    }
    // Word TextRun n’accepte pas vraiment \\n : découpe en runs + break
    if (!segmentText.includes('\n')) return [he(segmentText, runOpts, false)]
    const parts = segmentText.split('\n')
    const runs: TextRun[] = []
    parts.forEach((part, i) => {
      if (part) runs.push(he(part, runOpts))
      if (i < parts.length - 1) {
        runs.push(rtlBreak())
      }
    })
    return runs
  })
}

function richLineParagraph(
  html: string,
  defaults?: {
    bold?: boolean
    italics?: boolean
    size?: number
    color?: string
    underline?: boolean
  },
  bullet = false,
) {
  return rtlParagraph({
    spacing: { after: 80 },
    indent: bullet ? RTL_BULLET_INDENT : undefined,
    children: bullet
      ? [he('•\t', defaults), ...richHtmlToRuns(html, defaults)]
      : richHtmlToRuns(html, defaults),
  })
}

function plainBulletParagraph(
  text: string,
  opts?: { bold?: boolean; color?: string },
) {
  return rtlParagraph({
    spacing: { after: 80 },
    indent: RTL_BULLET_INDENT,
    children: text ? [he('•\t', opts), he(text, opts, false)] : [emptyRtlRun()],
  })
}

function p(
  children: TextRun[] | string,
  opts?: {
    bold?: boolean
    italics?: boolean
    size?: number
    color?: string
    underline?: boolean
    center?: boolean
    spacingAfter?: number
    pageBreakBefore?: boolean
  },
) {
  const runs =
    typeof children === 'string'
      ? children
        ? [he(children, opts)]
        : [emptyRtlRun()]
      : children
  return rtlParagraph({
    alignment: opts?.center ? AlignmentType.CENTER : AlignmentType.START,
    spacing: { after: opts?.spacingAfter ?? 100 },
    pageBreakBefore: opts?.pageBreakBefore,
    children: runs,
  })
}

function cell(
  children: Paragraph[],
  opts?: { width?: number; shading?: string },
) {
  return new TableCell({
    borders: BORDERS,
    width: { size: opts?.width ?? 2000, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: CELL_PAD,
    shading: opts?.shading
      ? { type: ShadingType.CLEAR, fill: opts.shading }
      : undefined,
    children: children.length > 0
      ? children
      : [rtlParagraph({ children: [emptyRtlRun()] })],
  })
}

function labelCell(
  label: string,
  value: string,
  width: number,
  shading?: string,
) {
  return cell(
    [
      rtlParagraph({
        children: [he(`${label}: ${value || ' '}`, { bold: true })],
      }),
    ],
    { width, shading },
  )
}

function headerPara(text: string) {
  return rtlParagraph({
    alignment: AlignmentType.CENTER,
    children: [he(text, { bold: true, size: 20 })],
  })
}

function bodyPara(
  text: string,
  opts?: {
    bold?: boolean
    center?: boolean
    color?: string
    highlight?: (typeof HighlightColor)[keyof typeof HighlightColor]
  },
) {
  return rtlParagraph({
    alignment: opts?.center ? AlignmentType.CENTER : AlignmentType.START,
    children: text
      ? [
          he(text, {
            bold: opts?.bold,
            color: opts?.color,
            highlight: opts?.highlight,
          }),
        ]
      : [emptyRtlRun()],
  })
}

function checkMark(on: boolean) {
  return on ? 'V' : ''
}

function badMark(on: boolean) {
  return on ? 'X' : ''
}

function emptyLines(count: number) {
  return Array.from({ length: count }, () => p(''))
}

/** Construit un .docx calqué sur le modèle Word d’origine (משמרת). */
export async function buildShiftReportDocx(
  report: ShiftReport,
  textsInput?: ShiftReportTexts | null,
): Promise<Blob> {
  const texts = normalizeShiftReportTexts(textsInput)
  const model = buildShiftReportDocumentModel(report, texts)
  const shiftLabel = SHIFT_LABELS[model.report.shift]

  const metaTable = shiftTable(
    [
      new TableRow({
        children: [
          labelCell('תאריך', model.report.date, 4680, 'FFFFFF'),
          labelCell('שומר/ת נכנס', model.report.guardIn, 4680, 'E7E6E6'),
        ],
      }),
      new TableRow({
        children: [
          labelCell('משמרת', shiftLabel, 4680, 'FFFFFF'),
          labelCell('שומר/ת יוצא', model.report.guardOut, 4680, 'D9E1F2'),
        ],
      }),
    ],
    [4680, 4680],
  )

  const deptHeader = new TableRow({
    children: [
      cell([headerPara("מס'")], { width: 700, shading: 'D9E1F2' }),
      cell([headerPara('סוג פריט/ציוד')], { width: 2800, shading: 'D9E1F2' }),
      cell([headerPara('תקין')], { width: 900, shading: 'D9E1F2' }),
      cell([headerPara('לא תקין')], { width: 900, shading: 'D9E1F2' }),
      cell([headerPara('הערות')], { width: 4060, shading: 'D9E1F2' }),
    ],
  })

  const deptRows = model.report.deptEquipment.map(
    (row, index) =>
      new TableRow({
        children: [
          cell([bodyPara(String(index + 1), { center: true })], { width: 700 }),
          cell([bodyPara(row.name)], { width: 2800 }),
          cell(
            [
              bodyPara(checkMark(row.status === 'ok'), {
                bold: true,
                center: true,
              }),
            ],
            { width: 900 },
          ),
          cell(
            [
              bodyPara(badMark(row.status === 'bad'), {
                bold: true,
                center: true,
              }),
            ],
            { width: 900 },
          ),
          cell([bodyPara(row.notes)], { width: 4060 }),
        ],
      }),
  )

  const deptTable = shiftTable([deptHeader, ...deptRows], [
    700, 2800, 900, 900, 4060,
  ])

  const stationHeader = new TableRow({
    children: [
      cell([headerPara("מס'")], { width: 700, shading: 'D9E1F2' }),
      cell([headerPara('סוג פריט/ציוד')], { width: 2800, shading: 'D9E1F2' }),
      cell([headerPara('כמות')], { width: 900, shading: 'D9E1F2' }),
      cell([headerPara('בפועל')], { width: 900, shading: 'D9E1F2' }),
      cell([headerPara('הערות')], { width: 4060, shading: 'D9E1F2' }),
    ],
  })

  const stationRows = model.report.stationEquipment.map((row, index) => {
    const yellow = row.notes.includes(SHIFT_NOTE_YELLOW_HIGHLIGHT)
    return new TableRow({
      children: [
        cell([bodyPara(`${index + 1}.`, { center: true })], { width: 700 }),
        cell([bodyPara(row.name)], { width: 2800 }),
        cell([bodyPara(String(row.quantity), { center: true })], {
          width: 900,
        }),
        cell(
          [bodyPara(checkMark(row.present), { bold: true, center: true })],
          { width: 900 },
        ),
        cell(
          [
            bodyPara(row.notes, {
              bold: Boolean(row.notes),
              color: row.notes ? 'FF0000' : undefined,
              highlight: yellow ? HighlightColor.YELLOW : undefined,
            }),
          ],
          { width: 4060 },
        ),
      ],
    })
  })

  const stationTable = shiftTable([stationHeader, ...stationRows], [
    700, 2800, 900, 900, 4060,
  ])

  const title = p(SHIFT_REPORT_DOCUMENT_TITLE, {
    bold: true,
    center: true,
    size: 28,
    underline: true,
    color: '666666',
  })

  const children: (Paragraph | Table)[] = [
    title,
    p(''),
    metaTable,
    p(''),
    rtlParagraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [
        he(model.texts.journalRuleLead, { bold: true, italics: true, size: 20 }),
        he(model.texts.journalRuleHighlight, {
          bold: true,
          italics: true,
          size: 20,
          highlight: HighlightColor.YELLOW,
        }),
      ],
    }),
    shiftTable(
      [
        new TableRow({
          children: [
            cell(
              model.texts.reminders.map((line) =>
                richLineParagraph(line, { bold: true, color: 'FF0000' }, true),
              ),
              { width: PAGE_WIDTH },
            ),
          ],
        }),
      ],
      [PAGE_WIDTH],
    ),
    ...emptyLines(2),
    p('תקלות פתוחות:', { bold: true, underline: true, size: 24 }),
    shiftTable(
      [
        new TableRow({
          children: [
            cell(
              [
                ...model.texts.openFaultsFixed.map((line) =>
                  richLineParagraph(line, { bold: true, color: 'FF0000' }, true),
                ),
                ...model.extraFaults.map((line) =>
                  plainBulletParagraph(line, { bold: true, color: '000000' }),
                ),
              ],
              { width: PAGE_WIDTH },
            ),
          ],
        }),
      ],
      [PAGE_WIDTH],
    ),
    ...emptyLines(1),
    p('הערות כלליות :', { bold: true, underline: true, size: 24 }),
    shiftTable(
      [
        new TableRow({
          children: [
            cell(
              model.texts.generalNotesHtml.map((line) =>
                richLineParagraph(line, { bold: true }, true),
              ),
              { width: PAGE_WIDTH },
            ),
          ],
        }),
      ],
      [PAGE_WIDTH],
    ),
    p('בדיקת ציוד מחלקתי', {
      bold: true,
      underline: true,
      size: 24,
      pageBreakBefore: true,
    }),
    p(''),
    deptTable,
    p(''),
    p('עמדת מאבטח', { bold: true, underline: true, size: 24 }),
    stationTable,
  ]

  const doc = new Document({
    styles: {
      default: {
        document: {
          paragraph: {
            bidirectional: true,
            alignment: AlignmentType.START,
          } as IParagraphOptions,
          run: {
            language: HEBREW_LANGUAGE,
            font: HEBREW_FONT,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720,
              bottom: 720,
              left: 720,
              right: 720,
            },
          },
        },
        children,
      },
    ],
  })

  return Packer.toBlob(doc)
}

export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer()
  return new Uint8Array(buf)
}
