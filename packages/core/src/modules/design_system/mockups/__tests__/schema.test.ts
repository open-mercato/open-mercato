import {
  collectUserStories,
  computeCounts,
  mockupDocument,
  stableContentString,
} from '../schema'
import { findRepoRoot, getMockupBySlug } from '../loader'

function validDocument(): Record<string, unknown> {
  return {
    version: 1,
    slug: 'schema-test-screen',
    title: 'Schema test screen',
    routeHint: '/backend/example',
    width: 'desktop',
    root: {
      type: 'stack',
      id: 'root',
      gap: 6,
      children: [
        {
          type: 'block',
          id: 'b-header',
          entry: 'section-header',
          props: { title: 'Example', count: 3 },
          status: 'implemented',
          userStory: 'US-1',
        },
        {
          type: 'columns',
          id: 'c-kpis',
          weights: [1, 1],
          children: [
            { type: 'block', id: 'b-kpi-1', entry: 'kpi-card', props: { title: 'A', value: 1 }, status: 'proposed' },
            { type: 'block', id: 'b-kpi-2', entry: 'kpi-card', props: { title: 'B', value: 2 }, status: 'om-default' },
          ],
        },
        { type: 'placeholder', id: 'p-panel', label: 'Side panel', status: 'proposed', note: 'Not built yet' },
      ],
    },
  }
}

describe('design_system mockup document schema', () => {
  it('parses a valid document', () => {
    const parsed = mockupDocument.safeParse(validDocument())
    expect(parsed.success).toBe(true)
  })

  it('defaults width to desktop', () => {
    const doc = validDocument()
    delete doc.width
    const parsed = mockupDocument.parse(doc)
    expect(parsed.width).toBe('desktop')
  })

  it('BC pin: a schema-v1-core document (no optional fields) always validates', () => {
    // The minimum Phase-1 document. Later phases may only add strictly
    // optional fields — this exact shape must keep validating forever.
    const core = {
      version: 1,
      slug: 'core-doc',
      title: 'Core document',
      root: { type: 'block', id: 'b1', entry: 'button', status: 'implemented' },
    }
    expect(mockupDocument.safeParse(core).success).toBe(true)
  })

  it('rejects forbidden prop keys', () => {
    for (const key of ['className', 'style', 'dangerouslySetInnerHTML']) {
      const doc = validDocument()
      const root = doc.root as { children: Array<Record<string, unknown>> }
      ;(root.children[0].props as Record<string, unknown>)[key] = 'x'
      const parsed = mockupDocument.safeParse(doc)
      expect(parsed.success).toBe(false)
    }
  })

  it('rejects a block without status', () => {
    const doc = validDocument()
    const root = doc.root as { children: Array<Record<string, unknown>> }
    delete root.children[0].status
    expect(mockupDocument.safeParse(doc).success).toBe(false)
  })

  it('rejects a malformed userStory tag', () => {
    const doc = validDocument()
    const root = doc.root as { children: Array<Record<string, unknown>> }
    root.children[0].userStory = 'story 123'
    expect(mockupDocument.safeParse(doc).success).toBe(false)
  })

  it('rejects a malformed slug', () => {
    const doc = validDocument()
    doc.slug = 'Not A Slug'
    expect(mockupDocument.safeParse(doc).success).toBe(false)
  })

  it('rejects duplicate node ids', () => {
    const doc = validDocument()
    const root = doc.root as { children: Array<Record<string, unknown>> }
    root.children[2].id = 'b-header'
    const parsed = mockupDocument.safeParse(doc)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes('b-header'))).toBe(true)
    }
  })

  it('rejects an unknown node type', () => {
    const doc = validDocument()
    ;(doc.root as Record<string, unknown>).type = 'grid'
    expect(mockupDocument.safeParse(doc).success).toBe(false)
  })

  it('counts placeholders separately from their annotation status', () => {
    const parsed = mockupDocument.parse(validDocument())
    expect(computeCounts(parsed)).toEqual({
      implemented: 1,
      proposed: 1, // b-kpi-1 only — p-panel is a placeholder, not a proposed block
      omDefault: 1,
      placeholder: 1,
    })
  })

  it('collects distinct user stories in first-seen order', () => {
    const parsed = mockupDocument.parse(validDocument())
    expect(collectUserStories(parsed)).toEqual(['US-1'])
  })

  it('accepts the Phase 3 fields (draft, entity, module) as strictly optional', () => {
    const doc = { ...validDocument(), draft: true, entity: 'person', module: 'customers' }
    const parsed = mockupDocument.parse(doc)
    expect(parsed.draft).toBe(true)
    expect(parsed.entity).toBe('person')
    expect(parsed.module).toBe('customers')
    // Absent means final — no default injection that would rewrite old files.
    expect(mockupDocument.parse(validDocument()).draft).toBeUndefined()
  })

  it('excludes the root draft flag from the content hash (finalizing must not stale findings)', () => {
    const final = mockupDocument.parse(validDocument())
    const draft = mockupDocument.parse({ ...validDocument(), draft: true })
    expect(stableContentString(draft)).toBe(stableContentString(final))
    // Only the DOCUMENT-level key is review state: a block prop named "draft"
    // is ordinary content and must change the hash.
    const withDraftProp = validDocument()
    const root = withDraftProp.root as { children: Array<Record<string, unknown>> }
    ;(root.children[0].props as Record<string, unknown>).draft = true
    expect(stableContentString(mockupDocument.parse(withDraftProp))).not.toBe(
      stableContentString(final),
    )
  })
})

describe('design_system golden mockup ledger counts', () => {
  it('computes the documented per-status totals for the golden mockup', () => {
    const repoRoot = findRepoRoot(__dirname)
    expect(repoRoot).not.toBeNull()
    const golden = getMockupBySlug('customers-people-list', repoRoot)
    expect(golden).not.toBeNull()
    expect(golden!.issues).toBeNull()
    expect(golden!.counts).toEqual({
      implemented: 5,
      proposed: 1,
      omDefault: 1,
      placeholder: 1,
    })
    expect(golden!.userStories).toEqual(['US-CRM-101', 'US-CRM-201', 'US-CRM-102'])
  })
})
