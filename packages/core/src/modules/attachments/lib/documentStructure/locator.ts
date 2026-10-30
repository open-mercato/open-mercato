import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  DOCUMENT_STRUCTURE_ANCHOR_KEY_LENGTH,
  documentAnchorKeySchema,
  documentSectionLocatorSchema,
  type DocumentSectionLocator,
} from './types'

export const DOCUMENT_CITATION_REF_MAX_LENGTH = 300
export const DOCUMENT_HEADING_PATH_SEPARATOR = '›'

const PAGE_SEGMENT = /^page:(\d+)(?:-(\d+))?(?:#(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?))?$/
const SECTION_SEGMENT = /^sec=(.+)$/
const CHARS_SEGMENT = /^chars=(\d+)-(\d+)$/
const ESCAPED_CHARACTERS = /[%;\r\n]/g

export type DocumentSectionLocatorInput = {
  pageStart?: number | null
  pageEnd?: number | null
  region?: [number, number, number, number] | null
  section?: string | null
  charStart?: number | null
  charEnd?: number | null
}

export type DocumentCitationRef = {
  attachmentId: string
  anchorKey: string
}

export type DocumentAnchorKeyInput = {
  numberLabel: string | null
  headingPath: readonly string[]
  duplicateOrdinal?: number | null
}

export type DocumentCitationInput = {
  numberLabel: string | null
  heading: string | null
  pageStart: number | null
  pageEnd: number | null
}

function escapeSectionValue(value: string): string {
  return value.replace(ESCAPED_CHARACTERS, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}

function unescapeSectionValue(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function toLocator(input: DocumentSectionLocatorInput): DocumentSectionLocator {
  const pageStart = input.pageStart ?? null
  return documentSectionLocatorSchema.parse({
    pageStart,
    pageEnd: input.pageEnd ?? pageStart,
    region: input.region ?? null,
    section: input.section ?? null,
    charStart: input.charStart ?? null,
    charEnd: input.charEnd ?? null,
  })
}

export function normalizeAnchorPart(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

export function resolveSectionReference(numberLabel: string | null, headingPath: readonly string[]): string | null {
  const label = numberLabel ? normalizeAnchorPart(numberLabel) : ''
  if (label) return label
  const path = headingPath.map(normalizeAnchorPart).filter((part) => part.length > 0)
  return path.length ? path.join(DOCUMENT_HEADING_PATH_SEPARATOR) : null
}

export function formatSectionLocator(input: DocumentSectionLocatorInput): string {
  const locator = toLocator(input)
  const segments: string[] = []
  if (locator.pageStart !== null && locator.pageEnd !== null) {
    const pages = locator.pageEnd === locator.pageStart ? `${locator.pageStart}` : `${locator.pageStart}-${locator.pageEnd}`
    segments.push(locator.region ? `page:${pages}#${locator.region.join(',')}` : `page:${pages}`)
  }
  if (locator.section !== null) segments.push(`sec=${escapeSectionValue(locator.section)}`)
  if (locator.charStart !== null && locator.charEnd !== null) segments.push(`chars=${locator.charStart}-${locator.charEnd}`)
  return segments.join(';')
}

export function parseSectionLocator(value: string): DocumentSectionLocator | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const draft: DocumentSectionLocatorInput = {}
  const seen = new Set<string>()
  for (const segment of value.split(';')) {
    const pageMatch = PAGE_SEGMENT.exec(segment)
    if (pageMatch) {
      if (seen.has('page') || seen.has('sec') || seen.has('chars')) return null
      seen.add('page')
      draft.pageStart = Number(pageMatch[1])
      draft.pageEnd = pageMatch[2] !== undefined ? Number(pageMatch[2]) : draft.pageStart
      if (pageMatch[3] !== undefined) {
        draft.region = [Number(pageMatch[3]), Number(pageMatch[4]), Number(pageMatch[5]), Number(pageMatch[6])]
      }
      continue
    }
    const sectionMatch = SECTION_SEGMENT.exec(segment)
    if (sectionMatch) {
      if (seen.has('sec') || seen.has('chars')) return null
      seen.add('sec')
      const section = unescapeSectionValue(sectionMatch[1])
      if (section === null) return null
      draft.section = section
      continue
    }
    const charsMatch = CHARS_SEGMENT.exec(segment)
    if (charsMatch) {
      if (seen.has('chars')) return null
      seen.add('chars')
      draft.charStart = Number(charsMatch[1])
      draft.charEnd = Number(charsMatch[2])
      continue
    }
    return null
  }
  const pageStart = draft.pageStart ?? null
  const parsed = documentSectionLocatorSchema.safeParse({
    pageStart,
    pageEnd: draft.pageEnd ?? pageStart,
    region: draft.region ?? null,
    section: draft.section ?? null,
    charStart: draft.charStart ?? null,
    charEnd: draft.charEnd ?? null,
  })
  return parsed.success ? parsed.data : null
}

export function buildAnchorKey(input: DocumentAnchorKeyInput): string {
  const label = input.numberLabel ? normalizeAnchorPart(input.numberLabel) : ''
  const path = input.headingPath.map(normalizeAnchorPart).join(DOCUMENT_HEADING_PATH_SEPARATOR)
  const duplicateOrdinal = input.duplicateOrdinal ?? 0
  if (!Number.isInteger(duplicateOrdinal) || duplicateOrdinal < 0) {
    throw new Error('[internal] duplicateOrdinal must be a non-negative integer')
  }
  const parts = [label, path]
  if (duplicateOrdinal > 0) parts.push(String(duplicateOrdinal))
  return createHash('sha256').update(parts.join('|'), 'utf8').digest('hex').slice(0, DOCUMENT_STRUCTURE_ANCHOR_KEY_LENGTH)
}

const citationRefSchema = z.object({
  attachmentId: z.string().uuid(),
  anchorKey: documentAnchorKeySchema,
})

export function buildCitationRef(input: DocumentCitationRef): string {
  const parsed = citationRefSchema.parse(input)
  const ref = `${parsed.attachmentId}#${parsed.anchorKey}`
  if (ref.length > DOCUMENT_CITATION_REF_MAX_LENGTH) {
    throw new Error('[internal] citation ref exceeds the maximum length')
  }
  return ref
}

export function parseCitationRef(value: string): DocumentCitationRef | null {
  if (typeof value !== 'string' || value.length > DOCUMENT_CITATION_REF_MAX_LENGTH) return null
  const separatorIndex = value.indexOf('#')
  if (separatorIndex <= 0 || separatorIndex !== value.lastIndexOf('#')) return null
  const parsed = citationRefSchema.safeParse({
    attachmentId: value.slice(0, separatorIndex),
    anchorKey: value.slice(separatorIndex + 1),
  })
  return parsed.success ? parsed.data : null
}

export function buildCitation(input: DocumentCitationInput): string {
  const label = input.numberLabel ? normalizeAnchorPart(input.numberLabel) : ''
  const heading = input.heading ? normalizeAnchorPart(input.heading) : ''
  const title = [label, heading].filter((part) => part.length > 0).join(' ')
  const pageStart = input.pageStart
  const pageEnd = input.pageEnd ?? pageStart
  let pages = ''
  if (pageStart !== null && pageEnd !== null) {
    pages = pageEnd > pageStart ? `pp. ${pageStart}–${pageEnd}` : `p. ${pageStart}`
  }
  if (title && pages) return `${title} (${pages})`
  return title || pages
}
