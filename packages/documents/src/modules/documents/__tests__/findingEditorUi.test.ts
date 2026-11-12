/** @jest-environment jsdom */

import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import {
  createFindingDecorationSet,
  createFindingDecorationsPlugin,
  FINDING_DECORATION_STYLES,
  FINDING_DECORATIONS_PLUGIN_KEY,
  findingDecorationClass,
  isFindingDecorationTransaction,
  mapFindingDecorationRanges,
  readFindingDecorationRanges,
} from '../backend/documents/[id]/findingDecorations'
import {
  canApplyFinding,
  countDistinctSections,
  countFindingsByHeading,
  groupFindings,
  normalizeFinding,
  normalizeFindingList,
  normalizeFindingSummary,
  openFindingTotal,
  locateFindingRange,
  resolveFindingRanges,
  severityDots,
  type DocumentFindingItem,
  type FindingDecorationRange,
} from '../backend/documents/[id]/findingModel'
import { normalizeFindingText as anchorNormalizer } from '../lib/findingAnchors'
import { createFindingQuoteLocator } from '../lib/findingQuoteLocator'
import { findingTextMatches, normalizeFindingText } from '../lib/findingTextNormalization'
import { extractPositionedReviewBlocks } from '../lib/reviewBlocks'

const ANCHOR = { version: 2 as const, relativeFrom: 'AQID', relativeTo: 'BAUG' }

function finding(overrides: Partial<DocumentFindingItem> = {}): DocumentFindingItem {
  return {
    id: 'finding-1',
    reviewId: 'review-1',
    source: 'ai',
    sourceWorkflowInstanceId: null,
    sourceAgentRunId: null,
    ruleCode: 'NDA-3.1',
    severity: 'blocking',
    title: 'Term too long',
    explanation: 'Exceeds the standard position.',
    sectionLabel: '2. Obligations',
    quote: 'five years',
    occurrence: 1,
    suggestedText: 'two years',
    anchor: ANCHOR,
    anchorStatus: 'located',
    status: 'open',
    appliedText: null,
    decisionNote: null,
    decidedAt: null,
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: '2026-11-12T10:00:00.000Z',
    ...overrides,
  }
}

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block', toDOM: () => ['p', 0] },
    heading: { content: 'text*', group: 'block', attrs: { level: { default: 1 } }, toDOM: () => ['h2', 0] },
    text: { group: 'inline' },
  },
})

function agreementDoc() {
  return schema.node('doc', null, [
    schema.node('heading', { level: 2 }, [schema.text('1. Definitions')]),
    schema.node('paragraph', null, [schema.text('Information is kept secret for five years.')]),
    schema.node('heading', { level: 2 }, [schema.text('2. Obligations')]),
    schema.node('paragraph', null, [schema.text('The Recipient keeps it secret for “five”  years.')]),
    schema.node('paragraph', null, [schema.text('Again secret for five years.')]),
  ])
}

function paragraphDoc(text: string) {
  return schema.node('doc', null, [schema.node('paragraph', null, [schema.text(text)])])
}

describe('finding text normalization', () => {
  it('is shared by the server anchorer and the client quote check', () => {
    expect(anchorNormalizer).toBe(normalizeFindingText)
    expect(normalizeFindingText('  “Secret”  for   ‘five’ years ')).toBe('"Secret" for \'five\' years')
  })

  it('matches current text against the quote with the same normalization', () => {
    expect(findingTextMatches('secret  for\nfive years', 'secret for five years')).toBe(true)
    expect(findingTextMatches('secret for six years', 'secret for five years')).toBe(false)
    expect(findingTextMatches('', '   ')).toBe(false)
  })
})

describe('finding model', () => {
  it('normalizes API payloads and drops malformed items', () => {
    const raw = { ...finding(), tenantId: 'ignored', extra: true }
    expect(normalizeFinding(raw)?.id).toBe('finding-1')
    expect(normalizeFinding({ id: 'x' })).toBeNull()
    expect(normalizeFindingList({ items: [raw, { id: 'broken' }], reviewId: 'review-1' })).toHaveLength(1)
    expect(normalizeFindingList(null)).toEqual([])
  })

  it('normalizes the summary and totals open findings', () => {
    const summary = normalizeFindingSummary({
      reviewId: 'review-1',
      reviewedAt: '2026-11-12T10:00:00.000Z',
      open: { blocking: 1, warning: 2, info: 3 },
      decided: { applied: 0, kept: 1 },
      unlocated: 0,
    })
    expect(openFindingTotal(summary)).toBe(6)
    expect(openFindingTotal(null)).toBe(0)
    expect(normalizeFindingSummary({ open: {} })).toBeNull()
  })

  it('groups open findings by severity, decided ones separately and hides superseded ones', () => {
    const groups = groupFindings([
      finding({ id: 'a', severity: 'blocking' }),
      finding({ id: 'b', severity: 'warning' }),
      finding({ id: 'c', severity: 'info', status: 'kept' }),
      finding({ id: 'd', severity: 'info', status: 'superseded' }),
      finding({ id: 'e', severity: 'info' }),
    ])
    expect(groups.blocking.map((item) => item.id)).toEqual(['a'])
    expect(groups.warning.map((item) => item.id)).toEqual(['b'])
    expect(groups.info.map((item) => item.id)).toEqual(['e'])
    expect(groups.decided.map((item) => item.id)).toEqual(['c'])
  })

  it('counts distinct section labels case-insensitively', () => {
    expect(countDistinctSections([
      finding({ sectionLabel: '2. Obligations' }),
      finding({ sectionLabel: '2. obligations ' }),
      finding({ sectionLabel: null }),
      finding({ sectionLabel: '3. Governing Law' }),
    ])).toBe(2)
  })
})

describe('finding range resolution', () => {
  const text = 'The Recipient keeps it secret for five years.'
  const readText = (range: { from: number; to: number }) => text.slice(range.from, range.to)

  it('builds sorted decoration ranges only for open, located findings whose anchor resolves', () => {
    const result = resolveFindingRanges(
      [
        finding({ id: 'late', severity: 'warning' }),
        finding({ id: 'early', severity: 'info', quote: 'Recipient' }),
        finding({ id: 'decided', status: 'applied' }),
        finding({ id: 'unlocated', anchor: null, anchorStatus: 'unlocated' }),
        finding({ id: 'missing' }),
        finding({ id: 'gone', status: 'superseded' }),
      ],
      () => null,
      readText,
    )
    expect(result.ranges).toEqual([])
    expect(result.resolutions.unlocated).toEqual({ kind: 'unlocated' })
    expect(result.resolutions.missing).toEqual({ kind: 'missing' })
    expect(result.resolutions.gone).toBeUndefined()

    const ranges: Record<string, { from: number; to: number }> = {
      late: { from: 34, to: 44 },
      early: { from: 4, to: 13 },
      decided: { from: 34, to: 44 },
    }
    const findings = [
      finding({ id: 'late', severity: 'warning', anchor: { ...ANCHOR, relativeFrom: 'late' } }),
      finding({ id: 'early', severity: 'info', quote: 'Recipient', anchor: { ...ANCHOR, relativeFrom: 'early' } }),
      finding({ id: 'decided', status: 'applied', anchor: { ...ANCHOR, relativeFrom: 'decided' } }),
    ]
    const located = resolveFindingRanges(findings, (item) => (item.anchor ? ranges[item.anchor.relativeFrom] ?? null : null), readText)
    expect(located.ranges).toEqual([
      { id: 'early', severity: 'info', from: 4, to: 13 },
      { id: 'late', severity: 'warning', from: 34, to: 44 },
    ])
    expect(located.resolutions.late).toEqual({ kind: 'located', from: 34, to: 44, matches: true })
    expect(located.resolutions.decided).toEqual({ kind: 'located', from: 34, to: 44, matches: true })
  })

  it('reports changed text and only allows Apply when the current passage still matches', () => {
    const changed = resolveFindingRanges([finding()], () => ({ from: 34, to: 43 }), () => 'six years')
    expect(changed.resolutions['finding-1']).toEqual({ kind: 'located', from: 34, to: 43, matches: false })
    expect(canApplyFinding(finding(), changed.resolutions['finding-1'])).toBe(false)
    const matching = resolveFindingRanges([finding()], () => ({ from: 34, to: 44 }), readText)
    expect(canApplyFinding(finding(), matching.resolutions['finding-1'])).toBe(true)
    expect(canApplyFinding(finding({ suggestedText: null }), matching.resolutions['finding-1'])).toBe(false)
    expect(canApplyFinding(finding({ status: 'kept' }), matching.resolutions['finding-1'])).toBe(false)
    expect(canApplyFinding(finding(), { kind: 'unlocated' })).toBe(false)
  })
})

describe('outline finding counts', () => {
  it('assigns each range to the closest preceding heading and ignores text before the first heading', () => {
    const counts = countFindingsByHeading([40, 0, 90], [
      { from: 2, severity: 'blocking' },
      { from: 10, severity: 'warning' },
      { from: 45, severity: 'info' },
      { from: 95, severity: 'blocking' },
      { from: 96, severity: 'blocking' },
    ])
    expect(counts.get(0)).toEqual({ blocking: 1, warning: 1, info: 0 })
    expect(counts.get(40)).toEqual({ blocking: 0, warning: 0, info: 1 })
    expect(counts.get(90)).toEqual({ blocking: 2, warning: 0, info: 0 })
    expect(countFindingsByHeading([50], [{ from: 10, severity: 'info' }]).size).toBe(0)
  })

  it('renders at most two severity dots in priority order', () => {
    expect(severityDots({ blocking: 1, warning: 3, info: 2 })).toEqual(['blocking', 'warning'])
    expect(severityDots({ blocking: 0, warning: 0, info: 2 })).toEqual(['info'])
    expect(severityDots(undefined)).toEqual([])
  })
})

describe('finding decorations plugin', () => {
  const ranges: FindingDecorationRange[] = [
    { id: 'a', severity: 'blocking', from: 1, to: 5 },
    { id: 'b', severity: 'info', from: 7, to: 40 },
  ]

  it('uses status tokens for every severity and an active ring', () => {
    expect(FINDING_DECORATION_STYLES).toContain('var(--status-error-bg)')
    expect(FINDING_DECORATION_STYLES).toMatch(/om-doc-finding--warning \{[^}]*wavy[^}]*var\(--status-warning-icon\)/)
    expect(FINDING_DECORATION_STYLES).toMatch(/om-doc-finding--info \{[^}]*dotted[^}]*var\(--status-info-icon\)/)
    expect(FINDING_DECORATION_STYLES).toMatch(/om-doc-finding--active \{[^}]*var\(--primary\)/)
    expect(FINDING_DECORATION_STYLES).not.toMatch(/#[0-9a-f]{3,6}\b/i)
    expect(findingDecorationClass(ranges[0], 'a')).toBe('om-doc-finding om-doc-finding--blocking om-doc-finding--active')
    expect(findingDecorationClass(ranges[0], null)).toBe('om-doc-finding om-doc-finding--blocking')
  })

  it('creates inline decorations only for ranges inside the document', () => {
    const doc = paragraphDoc('Hello world')
    const set = createFindingDecorationSet(doc, ranges, null)
    const found = set.find()
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ from: 1, to: 5 })
  })

  it('stores ranges from meta transactions and maps them through document edits', () => {
    const plugin = createFindingDecorationsPlugin()
    let state = EditorState.create({ doc: paragraphDoc('Hello world'), plugins: [plugin] })
    const metaTransaction = state.tr.setMeta(FINDING_DECORATIONS_PLUGIN_KEY, { ranges: [ranges[0]], activeId: 'a' })
    expect(isFindingDecorationTransaction(metaTransaction)).toBe(true)
    state = state.apply(metaTransaction)
    expect(readFindingDecorationRanges(state)).toEqual([ranges[0]])
    const edit = state.tr.insertText('Oh ', 1)
    expect(isFindingDecorationTransaction(edit)).toBe(false)
    state = state.apply(edit)
    expect(readFindingDecorationRanges(state)).toEqual([{ ...ranges[0], from: 4, to: 8 }])
    expect(FINDING_DECORATIONS_PLUGIN_KEY.getState(state)?.decorations.find()).toHaveLength(1)
  })

  it('drops ranges that collapse after mapping', () => {
    expect(mapFindingDecorationRanges(ranges, (position) => (position < 6 ? 3 : position))).toEqual([ranges[1]])
  })
})

describe('finding quote locator without the realtime binding', () => {
  const doc = agreementDoc()
  const locate = createFindingQuoteLocator(extractPositionedReviewBlocks(doc))
  const textOf = (range: { from: number; to: number } | null) => (range ? doc.textBetween(range.from, range.to, ' ', ' ') : null)

  it('finds the occurrence-th match with the shared normalization', () => {
    expect(textOf(locate({ quote: 'secret for five years', occurrence: 1 }))).toBe('secret for five years')
    expect(textOf(locate({ quote: 'secret for "five" years', occurrence: 1 }))).toBe('secret for \u201cfive\u201d  years')
    expect(textOf(locate({ quote: 'secret for five years', occurrence: 2 }))).toBe('secret for five years')
    const second = locate({ quote: 'secret for five years', occurrence: 2 })
    const first = locate({ quote: 'secret for five years', occurrence: 1 })
    expect(second && first && second.from > first.from).toBe(true)
    expect(locate({ quote: 'secret for five years', occurrence: 3 })).toBeNull()
    expect(locate({ quote: 'not in the agreement' })).toBeNull()
  })

  it('searches the named section first and falls back to the whole document', () => {
    const inSection = locate({ quote: 'secret for five years', sectionLabel: '2. Obligations' })
    const anywhere = locate({ quote: 'secret for five years' })
    expect(inSection && anywhere && inSection.from > anywhere.from).toBe(true)
    expect(textOf(locate({ quote: 'Information is kept', sectionLabel: '2. Obligations' }))).toBe('Information is kept')
  })

  it('prefers the relative anchor when the binding exists and uses the quote otherwise', () => {
    const resolveAnchor = jest.fn(() => ({ from: 1, to: 3 }))
    const locateQuote = jest.fn(() => ({ from: 5, to: 9 }))
    expect(locateFindingRange(finding(), { resolveAnchor, locateQuote })).toEqual({ from: 1, to: 3 })
    expect(locateQuote).not.toHaveBeenCalled()
    expect(locateFindingRange(finding({ sectionLabel: '2. Obligations', occurrence: 2 }), { resolveAnchor: null, locateQuote }))
      .toEqual({ from: 5, to: 9 })
    expect(locateQuote).toHaveBeenCalledWith({ quote: 'five years', occurrence: 2, sectionLabel: '2. Obligations' })
    expect(locateFindingRange(finding({ anchor: null }), { resolveAnchor, locateQuote })).toEqual({ from: 5, to: 9 })
  })

  it('falls back to the quote when the relative anchor no longer resolves to the reviewed text', () => {
    const locateQuote = jest.fn(() => ({ from: 5, to: 15 }))
    const readText = (range: { from: number; to: number }) => (range.from === 5 ? 'five years' : 'six years')
    expect(locateFindingRange(finding(), { resolveAnchor: () => null, locateQuote }, readText)).toEqual({ from: 5, to: 15 })
    expect(locateFindingRange(finding(), { resolveAnchor: () => ({ from: 3, to: 3 }), locateQuote }, readText)).toEqual({ from: 5, to: 15 })
    expect(locateFindingRange(finding(), { resolveAnchor: () => ({ from: 30, to: 39 }), locateQuote }, readText)).toEqual({ from: 5, to: 15 })
    expect(locateFindingRange(finding(), { resolveAnchor: () => ({ from: 5, to: 15 }), locateQuote: () => null }, readText)).toEqual({ from: 5, to: 15 })
  })

  it('keeps the anchored range so an edited passage still reads as changed', () => {
    const readText = () => 'six years'
    const range = locateFindingRange(finding(), { resolveAnchor: () => ({ from: 30, to: 39 }), locateQuote: () => null }, readText)
    expect(range).toEqual({ from: 30, to: 39 })
    const result = resolveFindingRanges([finding()], () => range, readText)
    expect(result.resolutions['finding-1']).toMatchObject({ kind: 'located', matches: false })
  })

  it('resolves findings and decoration ranges from the quote in fallback mode', () => {
    const result = resolveFindingRanges(
      [finding({ quote: 'secret for five years', sectionLabel: '2. Obligations' })],
      (item) => locateFindingRange(item, { resolveAnchor: null, locateQuote: locate }),
      (range) => doc.textBetween(range.from, range.to, ' ', ' '),
    )
    expect(result.resolutions['finding-1']).toMatchObject({ kind: 'located', matches: true })
    expect(result.ranges).toHaveLength(1)
  })
})
