import {
  codepointToUtf16Offset,
  findQuote,
  graphemeLength,
  normalizeQuote,
  normalizeWithMap,
  snapToGraphemes,
  utf16ToCodepointOffset,
  type FindQuoteOptions,
} from '../lib/guardrails/integrity/normalize'

type Fixture = {
  name: string
  source: string
  quote: string
  options?: FindQuoteOptions
  expectedSlice?: string
}

const roundTripFixtures: Fixture[] = [
  { name: 'plain ascii', source: 'The quick brown fox jumps.', quote: 'brown fox' },
  { name: 'collapsed spaces', source: 'alpha   beta\n\tgamma', quote: 'beta gamma', expectedSlice: 'beta\n\tgamma' },
  { name: 'nbsp', source: 'pay within 30 days', quote: 'pay within 30 days' },
  { name: 'ideographic space', source: '条款　第一条', quote: '条款 第一条' },
  { name: 'quote with surrounding whitespace', source: 'one two three', quote: '  two  ', expectedSlice: 'two' },
  { name: 'fi ligature in source', source: 'the ﬁnal offer', quote: 'final offer', expectedSlice: 'ﬁnal offer' },
  { name: 'fi ligature in quote', source: 'the final offer', quote: 'ﬁnal' },
  { name: 'full-width letters', source: 'model ＡＢＣ approved', quote: 'ABC approved' },
  { name: 'circled digit', source: 'see clause ① below', quote: 'clause 1' },
  { name: 'curly double quotes', source: 'he said “no refunds” today', quote: '"no refunds"' },
  { name: 'curly apostrophe', source: 'the buyer’s duty', quote: "buyer's duty" },
  { name: 'em dash', source: 'goods—including parts—ship', quote: 'goods-including parts' },
  { name: 'en dash and minus', source: 'range 5–9, delta −2', quote: '5-9, delta -2' },
  { name: 'ellipsis', source: 'and so on… forever', quote: 'on... forever' },
  { name: 'soft hyphen', source: 'non­refundable deposit', quote: 'nonrefundable deposit' },
  { name: 'zero width space', source: 'zero​width here', quote: 'zerowidth here' },
  { name: 'trailing zwj', source: 'ab‍cd efg', quote: 'abcd efg' },
  { name: 'word joiner and bom', source: 'x⁠y﻿z tail', quote: 'xyz tail' },
  { name: 'arabic rtl', source: 'النص: هذا عقد ملزم للطرفين.', quote: 'عقد ملزم' },
  { name: 'hebrew rtl', source: 'זהו חוזה מחייב בין הצדדים', quote: 'חוזה מחייב' },
  { name: 'cjk without spaces', source: '本契約は双方を拘束するものとする。', quote: '双方を拘束' },
  { name: 'greek', source: 'Η σύμβαση είναι δεσμευτική.', quote: 'είναι δεσμευτική' },
  { name: 'emoji zwj family', source: 'team 👨‍👩‍👧 rocks', quote: '👨‍👩‍👧 rocks' },
  { name: 'flags', source: 'ship to 🇵🇱🇩🇪 only', quote: '🇵🇱🇩🇪' },
  { name: 'combining accent vs precomposed', source: 'café au lait', quote: 'café au', expectedSlice: 'café au' },
  { name: 'surrogate pair math letter', source: 'value 𝐀𝐁 end', quote: 'AB end', expectedSlice: '𝐀𝐁 end' },
]

describe('normalizeWithMap', () => {
  it('keeps a sentinel end entry and one map entry per normalized char', () => {
    const result = normalizeWithMap('  a  bﬁ ')
    expect(result.normalized).toBe('a bfi')
    expect(result.map).toHaveLength(result.normalized.length + 1)
    expect(result.map[result.map.length - 1]).toBe('  a  bﬁ '.length)
    expect(result.map[3]).toBe(result.map[4])
  })

  it('maps a whitespace run to its first char and trims both ends', () => {
    const source = '\t one 　\n two '
    const result = normalizeWithMap(source)
    expect(result.normalized).toBe('one two')
    expect(source[result.map[3]]).toBe(' ')
    expect(result.map[0]).toBe(2)
  })

  it('exact mode leaves text untouched with an identity map', () => {
    const source = '  A “B”  '
    const result = normalizeWithMap(source, { normalize: 'exact' })
    expect(result.normalized).toBe(source)
    expect(result.map).toEqual([...Array.from({ length: source.length }, (_unused, position) => position), source.length])
  })

  it('ws mode collapses whitespace but does not fold typography or NFKC', () => {
    expect(normalizeQuote(' “ﬁ”  x ', { normalize: 'ws' })).toBe('“ﬁ” x')
  })

  it('never folds case by default', () => {
    expect(normalizeQuote('ABC')).toBe('ABC')
  })

  it('keeps the map aligned when lowercasing changes length', () => {
    const source = 'İSTANBUL x'
    const result = normalizeWithMap(source, { caseInsensitive: true })
    expect(result.normalized).toBe('i̇stanbul x')
    expect(result.map[0]).toBe(0)
    expect(result.map[1]).toBe(0)
    expect(result.map[2]).toBe(1)
  })
})

describe('findQuote round trip', () => {
  it.each(roundTripFixtures)('$name', ({ source, quote, options, expectedSlice }) => {
    const result = findQuote(source, quote, options)
    expect(result.found).toBe(true)
    if (!result.found) return
    const slice = source.slice(result.start, result.end)
    expect(normalizeQuote(slice, options)).toBe(normalizeQuote(quote, options))
    if (expectedSlice !== undefined) expect(slice).toBe(expectedSlice)
    const snapped = snapToGraphemes(source, result.start, result.end)
    expect(snapped).toEqual({ start: result.start, end: result.end })
  })
})

describe('findQuote grapheme snapping', () => {
  it('does not split an emoji zwj sequence when quoting one member', () => {
    const source = 'team 👨‍👩‍👧 rocks'
    const result = findQuote(source, '👨‍👩‍👧')
    expect(result).toMatchObject({ found: true })
    if (!result.found) return
    expect(source.slice(result.start, result.end)).toBe('👨‍👩‍👧')
    const partial = findQuote(source, 'team 👨')
    expect(partial).toMatchObject({ found: true })
    if (!partial.found) return
    expect(source.slice(partial.start, partial.end)).toBe('team 👨‍👩‍👧')
  })

  it('does not split a flag sequence', () => {
    const source = 'flags 🇵🇱🇩🇪'
    const result = findQuote(source, '🇩🇪', { normalize: 'exact' })
    expect(result).toMatchObject({ found: true })
    if (!result.found) return
    expect(source.slice(result.start, result.end)).toBe('🇩🇪')
  })

  it('does not split a combining sequence in exact mode', () => {
    const source = 'resumé here'
    expect(findQuote(source, 'resume here', { normalize: 'exact' })).toEqual({ found: false })
    const result = findQuote(source, 'resumé', { normalize: 'exact' })
    expect(result).toEqual({ found: true, start: 0, end: 7, ambiguous: false })
  })

  it('snaps arbitrary offsets outward', () => {
    const source = 'a😀b éc'
    expect(snapToGraphemes(source, 2, 2)).toEqual({ start: 1, end: 3 })
    expect(snapToGraphemes(source, 1, 2)).toEqual({ start: 1, end: 3 })
    expect(snapToGraphemes(source, 6, 7)).toEqual({ start: 5, end: 7 })
    expect(snapToGraphemes(source, -4, 99)).toEqual({ start: 0, end: source.length })
  })
})

describe('findQuote matching rules', () => {
  it('exact mode requires a verbatim substring', () => {
    expect(findQuote('a  b', 'a b', { normalize: 'exact' })).toEqual({ found: false })
    expect(findQuote('a  b', 'a  b', { normalize: 'exact' })).toEqual({ found: true, start: 0, end: 4, ambiguous: false })
  })

  it('is case-sensitive unless opted in', () => {
    expect(findQuote('Payment Terms', 'payment terms')).toEqual({ found: false })
    expect(findQuote('Payment Terms', 'payment terms', { caseInsensitive: true })).toMatchObject({ found: true, start: 0, end: 13 })
  })

  it('folds Turkish dotted and dotless i with the tr locale', () => {
    const source = 'KIRMIZI ve İSTANBUL'
    expect(findQuote(source, 'kırmızı', { caseInsensitive: true, locale: 'tr' })).toMatchObject({ found: true, start: 0, end: 7 })
    expect(findQuote(source, 'istanbul', { caseInsensitive: true, locale: 'tr' })).toMatchObject({ found: true, start: 11, end: 19 })
    expect(findQuote(source, 'kırmızı', { caseInsensitive: true })).toEqual({ found: false })
    expect(findQuote(source, 'kirmizi', { caseInsensitive: true })).toMatchObject({ found: true, start: 0, end: 7 })
  })

  it('falls back to root casing for an unusable locale', () => {
    expect(findQuote('ABC', 'abc', { caseInsensitive: true, locale: '%%' })).toMatchObject({ found: true })
  })

  it('reports not found', () => {
    expect(findQuote('the contract', 'agreement')).toEqual({ found: false })
  })

  it('treats empty and whitespace-only quotes as not found', () => {
    expect(findQuote('anything', '')).toEqual({ found: false })
    expect(findQuote('a b', '  　 ')).toEqual({ found: false })
    expect(findQuote('a­b', '­​')).toEqual({ found: false })
  })

  it('picks the first match and flags ambiguity without a hint', () => {
    const source = 'net 30 days; later net 30 days again'
    expect(findQuote(source, 'net 30 days')).toEqual({ found: true, start: 0, end: 11, ambiguous: true })
  })

  it('flags ambiguity across many occurrences and keeps the first or nearest match', () => {
    const source = Array.from({ length: 500 }, (_unused, index) => `clause ${index}: net 30 days.`).join(' ')
    const first = source.indexOf('net 30 days')
    expect(findQuote(source, 'net 30 days')).toEqual({ found: true, start: first, end: first + 11, ambiguous: true })
    const last = source.lastIndexOf('net 30 days')
    expect(findQuote(source, 'net 30 days', { hintStart: last + 1 })).toEqual({
      found: true,
      start: last,
      end: last + 11,
      ambiguous: true,
    })
  })

  it('picks the match nearest to the hint', () => {
    const source = 'net 30 days; later net 30 days again'
    expect(findQuote(source, 'net 30 days', { hintStart: 25 })).toEqual({ found: true, start: 19, end: 30, ambiguous: true })
    expect(findQuote(source, 'net 30 days', { hintStart: 2 })).toEqual({ found: true, start: 0, end: 11, ambiguous: true })
  })

  it('reports codepoint offsets and reads the hint in codepoints', () => {
    const source = '😀😀 note; 😀 note'
    const utf16 = findQuote(source, 'note', { hintStart: 13 })
    expect(utf16).toEqual({ found: true, start: 14, end: 18, ambiguous: true })
    const codepoint = findQuote(source, 'note', { offsetUnit: 'codepoint', hintStart: 11 })
    expect(codepoint).toEqual({ found: true, start: 11, end: 15, ambiguous: true })
    expect(Array.from(source).slice(11, 15).join('')).toBe('note')
  })
})

describe('offset helpers', () => {
  it('converts between utf16 and codepoint offsets', () => {
    const source = 'a😀b𝐀c'
    expect(utf16ToCodepointOffset(source, 0)).toBe(0)
    expect(utf16ToCodepointOffset(source, 3)).toBe(2)
    expect(utf16ToCodepointOffset(source, source.length)).toBe(5)
    expect(codepointToUtf16Offset(source, 2)).toBe(3)
    expect(codepointToUtf16Offset(source, 4)).toBe(6)
    expect(codepointToUtf16Offset(source, 99)).toBe(source.length)
    expect(codepointToUtf16Offset(source, -1)).toBe(0)
  })

  it('counts graphemes for minChars', () => {
    expect(graphemeLength('abc')).toBe(3)
    expect(graphemeLength('👨‍👩‍👧🇵🇱')).toBe(2)
    expect(graphemeLength('éx')).toBe(2)
    expect(graphemeLength('')).toBe(0)
  })
})
