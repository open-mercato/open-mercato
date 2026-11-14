import type { PositionedReviewBlock } from './reviewBlocks'
import { normalizeFindingCharacter, normalizeFindingText } from './findingTextNormalization'

export type FindingQuoteRequest = {
  quote: string
  occurrence?: number
  sectionLabel?: string | null
}

export type FindingQuoteRange = { from: number; to: number }

export type FindingQuoteLocator = (request: FindingQuoteRequest) => FindingQuoteRange | null

type NormalizedIndex = {
  text: string
  positions: number[]
  blockStarts: number[]
}

function buildNormalizedIndex(blocks: PositionedReviewBlock[]): NormalizedIndex {
  let text = ''
  const positions: number[] = []
  const blockStarts: number[] = []
  const append = (character: string, position: number) => {
    const mapped = normalizeFindingCharacter(character)
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

export function createFindingQuoteLocator(blocks: PositionedReviewBlock[]): FindingQuoteLocator {
  const index = buildNormalizedIndex(blocks)
  return (request) => {
    const needle = normalizeFindingText(request.quote)
    if (!needle) return null
    const occurrence = Math.max(1, request.occurrence ?? 1)
    const sectionRange = request.sectionLabel
      ? resolveSectionRange(blocks, index, request.sectionLabel)
      : null
    const start = (sectionRange
      ? findOccurrence(index.text, needle, occurrence, sectionRange)
      : null)
      ?? findOccurrence(index.text, needle, occurrence, { start: 0, end: index.text.length })
    if (start === null) return null
    const from = index.positions[start]
    const lastPosition = index.positions[start + needle.length - 1]
    if (from === undefined || lastPosition === undefined || from < 0 || lastPosition < 0) return null
    return { from, to: lastPosition + 1 }
  }
}
