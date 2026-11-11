import { absolutePositionToRelativePosition } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import {
  extractPositionedReviewBlocks,
  parseReviewDocument,
  type PositionedReviewBlock,
  type ReviewDocumentMapping,
} from './reviewContent'

export type FindingRelativeAnchor = {
  version: 2
  relativeFrom: string
  relativeTo: string
}

export type FindingAnchorResult =
  | { anchorStatus: 'located'; anchor: FindingRelativeAnchor; from: number; to: number }
  | { anchorStatus: 'unlocated'; anchor: null }

export type FindingAnchorRequest = {
  quote: string
  occurrence?: number
  sectionLabel?: string | null
}

export type FindingAnchorer = {
  locate: (request: FindingAnchorRequest) => FindingAnchorResult
  dispose: () => void
}

type NormalizedIndex = {
  text: string
  positions: number[]
  blockStarts: number[]
}

const SINGLE_QUOTE_PATTERN = /[\u2018\u2019\u201a\u201b\u2032`\u00b4]/g
const DOUBLE_QUOTE_PATTERN = /[\u201c\u201d\u201e\u201f\u2033\u00ab\u00bb]/g
const WHITESPACE_PATTERN = /^[\s\u200b]$/u

const UNLOCATED: FindingAnchorResult = { anchorStatus: 'unlocated', anchor: null }

function normalizeCharacter(character: string): string {
  if (WHITESPACE_PATTERN.test(character)) return ' '
  return character
    .replace(SINGLE_QUOTE_PATTERN, "'")
    .replace(DOUBLE_QUOTE_PATTERN, '"')
}

export function normalizeFindingText(value: string): string {
  let normalized = ''
  for (const character of value) {
    const mapped = normalizeCharacter(character)
    if (mapped === ' ' && (normalized.length === 0 || normalized.endsWith(' '))) continue
    normalized += mapped
  }
  return normalized.trimEnd()
}

function buildNormalizedIndex(blocks: PositionedReviewBlock[]): NormalizedIndex {
  let text = ''
  const positions: number[] = []
  const blockStarts: number[] = []
  const append = (character: string, position: number) => {
    const mapped = normalizeCharacter(character)
    if (mapped === ' ' && (text.length === 0 || text.endsWith(' '))) return
    text += mapped
    for (let unit = 0; unit < mapped.length; unit += 1) {
      positions.push(mapped === ' ' ? -1 : position + unit)
    }
  }
  for (const block of blocks) {
    if (text.length > 0) append(' ', -1)
    blockStarts.push(text.length)
    for (const segment of block.segments) {
      if (segment.position < 0) {
        append(' ', -1)
        continue
      }
      let offset = 0
      for (const character of segment.text) {
        append(character, segment.position + offset)
        offset += character.length
      }
    }
  }
  return { text, positions, blockStarts }
}

function findOccurrence(
  haystack: string,
  needle: string,
  occurrence: number,
  range: { start: number; end: number },
): number | null {
  let cursor = range.start
  let seen = 0
  while (cursor <= range.end - needle.length) {
    const found = haystack.indexOf(needle, cursor)
    if (found < 0 || found + needle.length > range.end) return null
    seen += 1
    if (seen === occurrence) return found
    cursor = found + 1
  }
  return null
}

function normalizeLabel(value: string): string {
  return normalizeFindingText(value).toLocaleLowerCase()
}

function resolveSectionRange(
  blocks: PositionedReviewBlock[],
  index: NormalizedIndex,
  sectionLabel: string,
): { start: number; end: number } | null {
  const wanted = normalizeLabel(sectionLabel)
  if (!wanted) return null
  const headings = blocks
    .map((block, position) => ({ block, position }))
    .filter(({ block }) => block.kind === 'heading')
  const exact = headings.find(({ block }) => normalizeLabel(block.text) === wanted)
  const partial = exact ?? headings.find(({ block }) => {
    const heading = normalizeLabel(block.text)
    return heading.includes(wanted) || wanted.includes(heading)
  })
  if (!partial) return null
  const level = partial.block.level ?? 1
  const next = headings.find(({ block, position }) => (
    position > partial.position && (block.level ?? 1) <= level
  ))
  const start = index.blockStarts[partial.position] ?? 0
  const end = next ? index.blockStarts[next.position] ?? index.text.length : index.text.length
  return { start, end }
}

function encodeRelativePosition(
  position: number,
  fragment: Y.XmlFragment,
  mapping: ReviewDocumentMapping,
): string {
  const relative = absolutePositionToRelativePosition(position, fragment, mapping)
  return Buffer.from(Y.encodeRelativePosition(relative)).toString('base64')
}

export function createFindingAnchorer(
  yjsState: Buffer | Uint8Array | null | undefined,
): FindingAnchorer {
  const parsed = parseReviewDocument(yjsState)
  if (!parsed) {
    return { locate: () => UNLOCATED, dispose: () => undefined }
  }
  const blocks = extractPositionedReviewBlocks(parsed.doc)
  const index = buildNormalizedIndex(blocks)
  return {
    locate(request) {
      const needle = normalizeFindingText(request.quote)
      if (!needle) return UNLOCATED
      const occurrence = Math.max(1, request.occurrence ?? 1)
      const sectionRange = request.sectionLabel
        ? resolveSectionRange(blocks, index, request.sectionLabel)
        : null
      const start = (sectionRange
        ? findOccurrence(index.text, needle, occurrence, sectionRange)
        : null)
        ?? findOccurrence(index.text, needle, occurrence, { start: 0, end: index.text.length })
      if (start === null) return UNLOCATED
      const from = index.positions[start]
      const lastPosition = index.positions[start + needle.length - 1]
      if (from === undefined || lastPosition === undefined || from < 0 || lastPosition < 0) {
        return UNLOCATED
      }
      const to = lastPosition + 1
      return {
        anchorStatus: 'located',
        anchor: {
          version: 2,
          relativeFrom: encodeRelativePosition(from, parsed.fragment, parsed.mapping),
          relativeTo: encodeRelativePosition(to, parsed.fragment, parsed.mapping),
        },
        from,
        to,
      }
    },
    dispose() {
      parsed.ydoc.destroy()
    },
  }
}
