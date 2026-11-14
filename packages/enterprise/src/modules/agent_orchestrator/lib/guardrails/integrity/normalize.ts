import type { IntegrityNormalizeMode } from '../../../data/validators'

/**
 * Quote normalization for the `evidence_quote` integrity rule (spec
 * `2026-10-21-output-integrity-guardrails` → Rule kinds → `evidence_quote`).
 *
 * The source is processed one grapheme cluster at a time: every cluster is
 * normalized on its own and each emitted character remembers the UTF-16 span
 * of the cluster it came from. NFKC expansions/contractions, case mappings that
 * change length and dropped characters therefore never shift the mapping, and a
 * match in normalized space maps back to a span that starts and ends on cluster
 * boundaries of the ORIGINAL string.
 */
export type QuoteNormalizeOptions = {
  normalize?: IntegrityNormalizeMode
  caseInsensitive?: boolean
  locale?: string
}

export type QuoteOffsetUnit = 'utf16' | 'codepoint'

export type FindQuoteOptions = QuoteNormalizeOptions & {
  offsetUnit?: QuoteOffsetUnit
  hintStart?: number
}

export type NormalizedText = {
  normalized: string
  map: number[]
  ends: number[]
}

export type FindQuoteResult =
  | { found: false }
  | { found: true; start: number; end: number; ambiguous: boolean }

const ALWAYS_DROPPED = new Set([0x00ad, 0x200b, 0x2060, 0xfeff])
const JOINERS = new Set([0x200c, 0x200d])
const SINGLE_QUOTES = new Set([0x2018, 0x2019, 0x201a, 0x201b, 0x2032])
const DOUBLE_QUOTES = new Set([0x201c, 0x201d, 0x201e, 0x201f, 0x2033])
const WHITESPACE_PATTERN = /\s/u

function resolveLocale(locale: string | undefined): string | undefined {
  if (!locale) return undefined
  try {
    const [canonical] = Intl.getCanonicalLocales(locale)
    return canonical
  } catch {
    return undefined
  }
}

function graphemeSegmenter(locale: string | undefined): Intl.Segmenter {
  return new Intl.Segmenter(resolveLocale(locale), { granularity: 'grapheme' })
}

function isDash(codePoint: number): boolean {
  return (codePoint >= 0x2010 && codePoint <= 0x2015) || codePoint === 0x2212
}

function foldCodePoint(char: string): string {
  const codePoint = char.codePointAt(0) ?? 0
  if (SINGLE_QUOTES.has(codePoint)) return "'"
  if (DOUBLE_QUOTES.has(codePoint)) return '"'
  if (isDash(codePoint)) return '-'
  if (codePoint === 0x2026) return '...'
  return char
}

function stripInvisible(cluster: string): string {
  const codePoints = Array.from(cluster)
  return codePoints
    .filter((char, position) => {
      const codePoint = char.codePointAt(0) ?? 0
      if (ALWAYS_DROPPED.has(codePoint)) return false
      if (JOINERS.has(codePoint)) {
        const interior = position > 0 && position < codePoints.length - 1
        return interior
      }
      return true
    })
    .join('')
}

function lowerCase(text: string, locale: string | undefined): string {
  const resolved = resolveLocale(locale)
  if (!resolved) return text.toLowerCase()
  try {
    return text.toLocaleLowerCase(resolved)
  } catch {
    return text.toLowerCase()
  }
}

function normalizeCluster(cluster: string, options: QuoteNormalizeOptions): string {
  const mode = options.normalize ?? 'nfkc_ws'
  let piece = cluster
  if (mode === 'nfkc_ws') {
    piece = stripInvisible(piece)
    piece = Array.from(piece.normalize('NFKC')).map(foldCodePoint).join('')
  }
  if (options.caseInsensitive) {
    piece = lowerCase(piece, options.locale)
    if (mode === 'nfkc_ws') piece = piece.normalize('NFKC')
  }
  if (mode !== 'exact') {
    piece = Array.from(piece)
      .map((char) => (WHITESPACE_PATTERN.test(char) ? ' ' : char))
      .join('')
  }
  return piece
}

export function normalizeWithMap(text: string, options: QuoteNormalizeOptions = {}): NormalizedText {
  const collapse = (options.normalize ?? 'nfkc_ws') !== 'exact'
  const characters: string[] = []
  const map: number[] = []
  const ends: number[] = []
  for (const { segment, index } of graphemeSegmenter(options.locale).segment(text)) {
    const clusterEnd = index + segment.length
    const piece = normalizeCluster(segment, options)
    for (let offset = 0; offset < piece.length; offset += 1) {
      const char = piece[offset]
      if (collapse && char === ' ') {
        const previous = characters.length - 1
        if (previous < 0) continue
        if (characters[previous] === ' ') {
          ends[previous] = clusterEnd
          continue
        }
      }
      characters.push(char)
      map.push(index)
      ends.push(clusterEnd)
    }
  }
  if (collapse) {
    while (characters.length > 0 && characters[characters.length - 1] === ' ') {
      characters.pop()
      map.pop()
      ends.pop()
    }
  }
  map.push(text.length)
  return { normalized: characters.join(''), map, ends }
}

export function normalizeQuote(text: string, options: QuoteNormalizeOptions = {}): string {
  return normalizeWithMap(text, options).normalized
}

export function graphemeLength(text: string, locale?: string): number {
  return Array.from(graphemeSegmenter(locale).segment(text)).length
}

export function snapToGraphemes(
  text: string,
  start: number,
  end: number,
  locale?: string,
): { start: number; end: number } {
  const clampedStart = Math.max(0, Math.min(start, text.length))
  const clampedEnd = Math.max(clampedStart, Math.min(end, text.length))
  let snappedStart = clampedStart
  let snappedEnd = clampedEnd
  for (const { segment, index } of graphemeSegmenter(locale).segment(text)) {
    const segmentEnd = index + segment.length
    if (index < clampedStart && clampedStart < segmentEnd) snappedStart = index
    if (index < clampedEnd && clampedEnd < segmentEnd) snappedEnd = segmentEnd
    if (index >= clampedEnd) break
  }
  return { start: snappedStart, end: snappedEnd }
}

export function utf16ToCodepointOffset(text: string, utf16Offset: number): number {
  const bounded = Math.max(0, Math.min(utf16Offset, text.length))
  return Array.from(text.slice(0, bounded)).length
}

export function codepointToUtf16Offset(text: string, codepointOffset: number): number {
  if (codepointOffset <= 0) return 0
  let utf16Offset = 0
  let seen = 0
  for (const char of text) {
    if (seen >= codepointOffset) break
    utf16Offset += char.length
    seen += 1
  }
  return utf16Offset
}

function graphemeBoundaries(text: string, locale?: string): number[] {
  const boundaries: number[] = []
  for (const { index } of graphemeSegmenter(locale).segment(text)) boundaries.push(index)
  boundaries.push(text.length)
  return boundaries
}

function lastBoundaryAtOrBefore(boundaries: number[], offset: number): number {
  let low = 0
  let high = boundaries.length - 1
  let found = boundaries[0]
  while (low <= high) {
    const middle = (low + high) >> 1
    if (boundaries[middle] <= offset) {
      found = boundaries[middle]
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

function firstBoundaryAtOrAfter(boundaries: number[], offset: number): number {
  let low = 0
  let high = boundaries.length - 1
  let found = boundaries[boundaries.length - 1]
  while (low <= high) {
    const middle = (low + high) >> 1
    if (boundaries[middle] >= offset) {
      found = boundaries[middle]
      high = middle - 1
    } else {
      low = middle + 1
    }
  }
  return found
}

export function findQuote(source: string, quote: string, options: FindQuoteOptions = {}): FindQuoteResult {
  const needle = normalizeQuote(quote, options)
  if (needle.length === 0) return { found: false }
  const haystack = normalizeWithMap(source, options)
  const hintStart =
    typeof options.hintStart === 'number' && Number.isFinite(options.hintStart) ? options.hintStart : null
  const spans = new Map<string, { start: number; end: number }>()
  let boundaries: number[] | null = null
  let position = haystack.normalized.indexOf(needle)
  while (position !== -1) {
    boundaries ??= graphemeBoundaries(source, options.locale)
    const start = lastBoundaryAtOrBefore(boundaries, haystack.map[position])
    const end = firstBoundaryAtOrAfter(boundaries, Math.max(start, haystack.ends[position + needle.length - 1]))
    spans.set(`${start}:${end}`, { start, end })
    if (hintStart === null && spans.size > 1) break
    position = haystack.normalized.indexOf(needle, position + 1)
  }
  const candidates = Array.from(spans.values())
  if (candidates.length === 0) return { found: false }
  const unit = options.offsetUnit ?? 'utf16'
  const hint =
    hintStart === null ? null : unit === 'codepoint' ? codepointToUtf16Offset(source, hintStart) : hintStart
  const chosen =
    hint === null
      ? candidates[0]
      : candidates.reduce((best, candidate) =>
          Math.abs(candidate.start - hint) < Math.abs(best.start - hint) ? candidate : best,
        )
  const ambiguous = candidates.length > 1
  if (unit === 'codepoint') {
    return {
      found: true,
      start: utf16ToCodepointOffset(source, chosen.start),
      end: utf16ToCodepointOffset(source, chosen.end),
      ambiguous,
    }
  }
  return { found: true, start: chosen.start, end: chosen.end, ambiguous }
}
