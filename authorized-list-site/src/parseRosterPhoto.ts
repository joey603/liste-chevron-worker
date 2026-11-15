import { createWorker } from 'tesseract.js'
import type { AuthorizedKind } from './types'

export type ParsedRosterPerson = {
  firstName: string
  lastName: string
  company: string
  kind: AuthorizedKind
}

const HEADER_RE = /last\s*name/i
const SKIP_TOKEN_RE =
  /^(last|name|first|company|work|site|dept\.?|unit|national|id|nationality)$/i

function isChevronCompany(company: string): boolean {
  return company.replace(/\s+/g, '').toUpperCase() === 'CHEVRON'
}

function cleanLine(line: string): string {
  return line
    .replace(/[|│]+/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim()
}

function looksLikeNationalId(token: string): boolean {
  return /^\d{6,12}$/.test(token)
}

function looksLikeSiteOrDept(token: string): boolean {
  return /^(CWH|VISIT|VISITOR|DEPT|UNIT|SITE)$/i.test(token)
}

/** Parse une ligne OCR du format Last / First / Company / … */
export function parseRosterLine(line: string): ParsedRosterPerson | null {
  const cleaned = cleanLine(line)
  if (!cleaned || HEADER_RE.test(cleaned)) return null

  const tokens = cleaned.split(' ').filter(Boolean)
  if (tokens.length < 3) return null
  if (SKIP_TOKEN_RE.test(tokens[0])) return null

  let companyIdx = tokens.findIndex((t) => /^CHEVRON$/i.test(t))
  if (companyIdx < 0) {
    const idIdx = tokens.findIndex(looksLikeNationalId)
    if (idIdx >= 3) {
      // Remonter : Nationality? Id <- Dept <- Site <- Company
      let i = idIdx - 1
      while (i >= 2 && looksLikeSiteOrDept(tokens[i])) i -= 1
      companyIdx = i
    } else {
      // Prénom + nom mono-token : Company en 3ᵉ colonne
      companyIdx = 2
    }
  }

  if (companyIdx < 2 || companyIdx >= tokens.length) return null

  const lastName = tokens[0].trim()
  const firstName = tokens.slice(1, companyIdx).join(' ').trim()
  const company = tokens[companyIdx].trim()
  if (!lastName || !firstName || !company) return null
  if (SKIP_TOKEN_RE.test(lastName) || SKIP_TOKEN_RE.test(firstName)) return null
  if (looksLikeNationalId(lastName) || looksLikeNationalId(firstName)) return null

  return {
    lastName,
    firstName,
    company,
    kind: isChevronCompany(company) ? 'permanent' : 'visitor',
  }
}

export function parseRosterText(text: string): ParsedRosterPerson[] {
  const seen = new Set<string>()
  const people: ParsedRosterPerson[] = []
  for (const raw of text.split(/\r?\n/)) {
    const person = parseRosterLine(raw)
    if (!person) continue
    const key = `${person.lastName}|${person.firstName}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    people.push(person)
  }
  return people
}

export async function parseRosterImage(
  file: Blob,
  onProgress?: (ratio: number) => void,
): Promise<ParsedRosterPerson[]> {
  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (
        m.status === 'recognizing text' &&
        typeof m.progress === 'number' &&
        onProgress
      ) {
        onProgress(m.progress)
      }
    },
  })
  try {
    const {
      data: { text },
    } = await worker.recognize(file)
    return parseRosterText(text)
  } finally {
    await worker.terminate()
  }
}
