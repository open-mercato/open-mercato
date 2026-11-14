import {
  DOCUMENT_CITATION_REF_MAX_LENGTH,
  buildAnchorKey,
  buildCitation,
  buildCitationRef,
  formatSectionLocator,
  parseCitationRef,
  parseSectionLocator,
  resolveSectionReference,
} from '../locator'
import { documentEngineResultSchema, documentSectionNodeSchema } from '../types'

const ATTACHMENT_ID = '7d0c1d9e-3f8a-4c55-9a51-2b8e6f7a1c42'

describe('formatSectionLocator / parseSectionLocator', () => {
  it('formats the full locator shape from the spec', () => {
    expect(
      formatSectionLocator({ pageStart: 41, pageEnd: 41, section: '§8.12', charStart: 160233, charEnd: 161020 }),
    ).toBe('page:41;sec=§8.12;chars=160233-161020')
  })

  it('formats page ranges', () => {
    expect(formatSectionLocator({ pageStart: 40, pageEnd: 47, section: '8' })).toBe('page:40-47;sec=8')
  })

  it('round-trips every supported shape', () => {
    const samples = [
      { pageStart: 41, pageEnd: 41, region: null, section: '§8.12', charStart: 160233, charEnd: 161020 },
      { pageStart: 40, pageEnd: 47, region: null, section: 'Article 5(1)(a)', charStart: null, charEnd: null },
      { pageStart: null, pageEnd: null, region: null, section: 'Intro›Scope; terms = 100%', charStart: 0, charEnd: 12 },
      { pageStart: null, pageEnd: null, region: null, section: null, charStart: 5, charEnd: 5 },
      { pageStart: 3, pageEnd: 3, region: [10, 20, 30.5, 40] as [number, number, number, number], section: null, charStart: null, charEnd: null },
    ]
    for (const sample of samples) {
      const formatted = formatSectionLocator(sample)
      expect(parseSectionLocator(formatted)).toEqual(sample)
      expect(formatSectionLocator(parseSectionLocator(formatted) ?? {})).toBe(formatted)
    }
  })

  it('escapes separators inside the section reference', () => {
    const formatted = formatSectionLocator({ section: 'a;b\nc%d' })
    expect(formatted).toBe('sec=a%3Bb%0Ac%25d')
    expect(formatted.split(';')).toHaveLength(1)
  })

  it('stays compatible with the AO formatDocumentLocator page format', () => {
    expect(formatSectionLocator({ pageStart: 14 })).toBe('page:14')
    expect(formatSectionLocator({ pageStart: 14, region: [0.1, 0.2, 0.5, 0.9] })).toBe('page:14#0.1,0.2,0.5,0.9')
    expect(parseSectionLocator('page:14')).toEqual({
      pageStart: 14, pageEnd: 14, region: null, section: null, charStart: null, charEnd: null,
    })
    expect(parseSectionLocator('page:14#0.1,0.2,0.5,0.9')).toMatchObject({ pageStart: 14, region: [0.1, 0.2, 0.5, 0.9] })
    expect(formatSectionLocator({ pageStart: 41, section: '§8.12', charStart: 1, charEnd: 2 }).startsWith('page:41')).toBe(true)
  })

  it('rejects invalid input', () => {
    const invalid = [
      '',
      'page:0',
      'page:5-3',
      'page:x',
      'chars=10-5',
      'sec=',
      'sec=%ZZ',
      'unknown=1',
      'page:1;page:2',
      'chars=1-2;page:1',
      'sec=a;sec=b',
      'page:1-2#1,2,3,4',
      'page:1;',
    ]
    for (const value of invalid) expect(parseSectionLocator(value)).toBeNull()
    expect(() => formatSectionLocator({})).toThrow()
    expect(() => formatSectionLocator({ pageStart: 0 })).toThrow()
    expect(() => formatSectionLocator({ pageStart: 5, pageEnd: 3 })).toThrow()
    expect(() => formatSectionLocator({ charStart: 9, charEnd: 2 })).toThrow()
    expect(() => formatSectionLocator({ charStart: 9 })).toThrow()
    expect(() => formatSectionLocator({ section: '' })).toThrow()
  })
})

describe('resolveSectionReference', () => {
  it('prefers the number label and falls back to the heading path', () => {
    expect(resolveSectionReference(' §8.12 ', ['8 Financial promotions'])).toBe('§8.12')
    expect(resolveSectionReference(null, ['Intro', ' Scope '])).toBe('Intro›Scope')
    expect(resolveSectionReference(null, [])).toBeNull()
  })
})

describe('buildAnchorKey', () => {
  const base = { numberLabel: '§8.12', headingPath: ['8 Financial promotions', '8.12 Past performance'] }

  it('is deterministic and 32 hex chars', () => {
    const first = buildAnchorKey(base)
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(buildAnchorKey({ ...base, headingPath: [...base.headingPath] })).toBe(first)
    expect(buildAnchorKey({ ...base, numberLabel: ' §8.12', headingPath: ['8  Financial promotions', '8.12 Past performance '] })).toBe(first)
    expect(buildAnchorKey({ ...base, duplicateOrdinal: 0 })).toBe(first)
  })

  it('changes with the label, path or duplicate ordinal', () => {
    const first = buildAnchorKey(base)
    expect(buildAnchorKey({ ...base, numberLabel: '§8.13' })).not.toBe(first)
    expect(buildAnchorKey({ ...base, headingPath: ['8 Financial promotions'] })).not.toBe(first)
    expect(buildAnchorKey({ ...base, duplicateOrdinal: 1 })).not.toBe(first)
  })

  it('rejects invalid duplicate ordinals', () => {
    expect(() => buildAnchorKey({ ...base, duplicateOrdinal: -1 })).toThrow()
    expect(() => buildAnchorKey({ ...base, duplicateOrdinal: 1.5 })).toThrow()
  })
})

describe('buildCitationRef / parseCitationRef', () => {
  const anchorKey = buildAnchorKey({ numberLabel: '§8.12', headingPath: [] })

  it('round-trips and stays under the length cap', () => {
    const ref = buildCitationRef({ attachmentId: ATTACHMENT_ID, anchorKey })
    expect(ref).toBe(`${ATTACHMENT_ID}#${anchorKey}`)
    expect(ref.length).toBeLessThanOrEqual(DOCUMENT_CITATION_REF_MAX_LENGTH)
    expect(parseCitationRef(ref)).toEqual({ attachmentId: ATTACHMENT_ID, anchorKey })
  })

  it('rejects invalid refs', () => {
    expect(() => buildCitationRef({ attachmentId: 'not-a-uuid', anchorKey })).toThrow()
    expect(() => buildCitationRef({ attachmentId: ATTACHMENT_ID, anchorKey: 'short' })).toThrow()
    expect(parseCitationRef(`${ATTACHMENT_ID}`)).toBeNull()
    expect(parseCitationRef(`#${anchorKey}`)).toBeNull()
    expect(parseCitationRef(`${ATTACHMENT_ID}#${anchorKey}#x`)).toBeNull()
    expect(parseCitationRef(`${ATTACHMENT_ID}#${anchorKey.toUpperCase()}`)).toBeNull()
    expect(parseCitationRef(`${ATTACHMENT_ID}#${'a'.repeat(DOCUMENT_CITATION_REF_MAX_LENGTH)}`)).toBeNull()
  })
})

describe('buildCitation', () => {
  it('renders label, heading and pages', () => {
    expect(buildCitation({ numberLabel: '§8.12', heading: 'Past performance', pageStart: 41, pageEnd: 41 })).toBe(
      '§8.12 Past performance (p. 41)',
    )
    expect(buildCitation({ numberLabel: '8', heading: 'Financial promotions', pageStart: 40, pageEnd: 47 })).toBe(
      '8 Financial promotions (pp. 40–47)',
    )
    expect(buildCitation({ numberLabel: null, heading: 'Scope', pageStart: null, pageEnd: null })).toBe('Scope')
    expect(buildCitation({ numberLabel: null, heading: null, pageStart: 3, pageEnd: null })).toBe('p. 3')
  })
})

describe('document structure schemas', () => {
  it('validates section nodes and engine results', () => {
    const node = {
      ordinal: 0,
      depth: 0,
      parentOrdinal: null,
      kind: 'document',
      numberLabel: null,
      heading: null,
      headingPath: [],
      text: 'Body',
      pageStart: 1,
      pageEnd: 2,
      charStart: 0,
      charEnd: 4,
      anchorKey: buildAnchorKey({ numberLabel: null, headingPath: [] }),
      source: 'text_layer',
    }
    expect(documentSectionNodeSchema.safeParse(node).success).toBe(true)
    expect(documentSectionNodeSchema.safeParse({ ...node, charEnd: -1 }).success).toBe(false)
    expect(documentSectionNodeSchema.safeParse({ ...node, charStart: 5, charEnd: 4 }).success).toBe(false)
    expect(documentSectionNodeSchema.safeParse({ ...node, kind: 'chapterette' }).success).toBe(false)
    const result = documentEngineResultSchema.parse({ blocks: [], pageCount: 0, pageCharCounts: [], outline: [] })
    expect(result.ocrPageCount).toBe(0)
    expect(result.unreadablePages).toEqual([])
  })
})
