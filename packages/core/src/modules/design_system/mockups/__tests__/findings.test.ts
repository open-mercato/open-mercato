import {
  collectFindings,
  computeFindingsSummary,
  mockupDocument,
  stableContentString,
  type MockupDocument,
} from '../schema'
import {
  applyAnnotationsToDocument,
  computeContentHash,
  findRepoRoot,
  getMockupBySlug,
  loadCopyFileFor,
} from '../loader'
import { applyMechanicalFindings, findingIdFor, runMechanicalChecks } from '../heuristics'
import { collectTextProps, copyFileSchema, COPY_LOCALES, expectedCopyKeys } from '../copy'

/**
 * Findings schema + staleness (Phase 2), the deterministic mechanical
 * heuristic checks behind `om-ux-heuristics`, the findings-accepting
 * annotation write path, and `om-ux-copy` key determinism against the
 * committed golden copy file.
 */

function tableDocument(overrides?: { note?: string }): MockupDocument {
  return mockupDocument.parse({
    version: 1,
    slug: 'heuristics-fixture',
    title: 'Heuristics fixture',
    root: {
      type: 'stack',
      id: 'root',
      children: [
        { type: 'block', id: 'b-header', entry: 'section-header', props: { title: 'X' }, status: 'implemented' },
        {
          type: 'block',
          id: 'b-table',
          entry: 'table',
          variant: 'default',
          status: 'proposed',
          ...(overrides?.note ? { note: overrides.note } : {}),
        },
      ],
    },
  })
}

describe('design_system mockup findings schema', () => {
  it('accepts block findings and documentFindings', () => {
    const parsed = mockupDocument.safeParse({
      version: 1,
      slug: 'f-doc',
      title: 'F doc',
      documentFindings: [
        { id: 'f-doc-1', heuristicId: 'nielsen-03', severity: 'low', summary: 's', atHash: 'h' },
      ],
      root: {
        type: 'block',
        id: 'b1',
        entry: 'table',
        status: 'implemented',
        findings: [
          { id: 'f1', heuristicId: 'nielsen-01', severity: 'critical', summary: 's', suggestion: 'do x', atHash: 'h' },
        ],
      },
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts every evidence level and rejects unknown ones (evidence stays optional)', () => {
    for (const evidence of ['product', 'standard', 'platform', 'research', 'heuristic', 'assumption']) {
      const parsed = mockupDocument.safeParse({
        version: 1,
        slug: 'f-evidence',
        title: 'F evidence',
        root: {
          type: 'block',
          id: 'b1',
          entry: 'table',
          status: 'implemented',
          findings: [{ id: 'f1', heuristicId: 'nielsen-01', severity: 'low', summary: 's', atHash: 'h', evidence }],
        },
      })
      expect(parsed.success).toBe(true)
    }
    const bad = mockupDocument.safeParse({
      version: 1,
      slug: 'f-evidence',
      title: 'F evidence',
      root: {
        type: 'block',
        id: 'b1',
        entry: 'table',
        status: 'implemented',
        findings: [{ id: 'f1', heuristicId: 'nielsen-01', severity: 'low', summary: 's', atHash: 'h', evidence: 'dribbble' }],
      },
    })
    expect(bad.success).toBe(false)
  })

  it('rejects invalid severities and duplicate finding ids', () => {
    const bad = mockupDocument.safeParse({
      version: 1,
      slug: 'f-doc',
      title: 'F doc',
      root: {
        type: 'block',
        id: 'b1',
        entry: 'table',
        status: 'implemented',
        findings: [{ id: 'f1', heuristicId: 'x', severity: 'blocker', summary: 's', atHash: 'h' }],
      },
    })
    expect(bad.success).toBe(false)

    const duplicate = mockupDocument.safeParse({
      version: 1,
      slug: 'f-doc',
      title: 'F doc',
      documentFindings: [
        { id: 'f1', heuristicId: 'x', severity: 'low', summary: 's', atHash: 'h' },
      ],
      root: {
        type: 'block',
        id: 'b1',
        entry: 'table',
        status: 'implemented',
        findings: [{ id: 'f1', heuristicId: 'y', severity: 'low', summary: 's', atHash: 'h' }],
      },
    })
    expect(duplicate.success).toBe(false)
  })

  it('computes staleness against the CONTENT hash (findings never invalidate themselves)', () => {
    const doc = tableDocument()
    const hash = 'hash-of-content'
    const withFindings = mockupDocument.parse({
      ...JSON.parse(JSON.stringify(doc)),
      documentFindings: [
        { id: 'f-fresh', heuristicId: 'nielsen-01', severity: 'high', summary: 's', atHash: hash },
        { id: 'f-stale', heuristicId: 'nielsen-02', severity: 'low', summary: 's', atHash: 'older-hash' },
        {
          id: 'f-assumed',
          heuristicId: 'nielsen-06',
          severity: 'medium',
          summary: 's',
          atHash: hash,
          evidence: 'assumption',
        },
      ],
    })
    const summary = computeFindingsSummary(withFindings, hash)
    expect(summary).toEqual({
      total: 3,
      bySeverity: { low: 1, medium: 1, high: 1, critical: 0 },
      stale: 1,
      // Assumption-tagged findings are counted separately, like stale —
      // assumptions demand verification.
      assumptions: 1,
    })
    // The canonical content string strips findings — so writing findings does
    // not change the hash they are compared against.
    expect(stableContentString(withFindings)).toBe(stableContentString(doc))
  })
})

describe('design_system mechanical heuristic checks (om-ux-heuristics)', () => {
  it('flags a list block with no empty-state evidence (deterministic)', () => {
    const results = runMechanicalChecks(tableDocument())
    const emptyState = results.filter((result) => result.heuristicId === 'om-empty-state-next-action')
    expect(emptyState).toHaveLength(1)
    expect(emptyState[0].blockId).toBe('b-table')
    expect(emptyState[0].severity).toBe('high')
  })

  it('every mechanical check emits evidence: heuristic (the engine encodes heuristics, not research)', () => {
    for (const result of runMechanicalChecks(tableDocument())) {
      expect(result.evidence).toBe('heuristic')
    }
    const applied = applyMechanicalFindings(tableDocument(), 'h1')
    for (const ref of collectFindings(applied)) {
      expect(ref.finding.evidence).toBe('heuristic')
    }
  })

  it('flags a placeholder used as the only label (om-placeholder-only-label)', () => {
    const doc = mockupDocument.parse({
      version: 1,
      slug: 'placeholder-label',
      title: 'Placeholder label',
      root: {
        type: 'stack',
        id: 'root',
        children: [
          { type: 'block', id: 'b-header', entry: 'section-header', props: { title: 'X' }, status: 'implemented' },
          {
            type: 'block',
            id: 'b-search',
            entry: 'filter-bar',
            props: { search: { placeholder: 'Search people…' } },
            status: 'proposed',
          },
        ],
      },
    })
    const results = runMechanicalChecks(doc).filter(
      (result) => result.heuristicId === 'om-placeholder-only-label',
    )
    expect(results).toHaveLength(1)
    expect(results[0].blockId).toBe('b-search')
    expect(results[0].severity).toBe('high')
    // A label beside the placeholder clears the finding.
    const labeled = mockupDocument.parse(
      JSON.parse(
        JSON.stringify(doc).replace(
          '{"placeholder":"Search people…"}',
          '{"label":"Search","placeholder":"Search people…"}',
        ),
      ),
    )
    expect(
      runMechanicalChecks(labeled).filter((result) => result.heuristicId === 'om-placeholder-only-label'),
    ).toHaveLength(0)
  })

  it('flags a bare OK/Next/Send action label on an action block (om-vague-action-label)', () => {
    const doc = mockupDocument.parse({
      version: 1,
      slug: 'vague-label',
      title: 'Vague label',
      root: {
        type: 'stack',
        id: 'root',
        children: [
          { type: 'block', id: 'b-ok', entry: 'button', props: { label: 'OK' }, status: 'proposed' },
          { type: 'block', id: 'b-named', entry: 'button', props: { label: 'Save changes' }, status: 'proposed' },
          // Same vague value on a NON-action entry is not flagged.
          { type: 'block', id: 'b-kpi', entry: 'kpi-card', props: { title: 'Next' }, status: 'proposed' },
        ],
      },
    })
    const results = runMechanicalChecks(doc).filter(
      (result) => result.heuristicId === 'om-vague-action-label',
    )
    expect(results).toHaveLength(1)
    expect(results[0].blockId).toBe('b-ok')
    expect(results[0].severity).toBe('medium')
  })

  it('accepts empty-state evidence in the note or an empty-prop key', () => {
    const withNote = tableDocument({ note: 'Empty state shows an Add person call to action.' })
    expect(
      runMechanicalChecks(withNote).filter((result) => result.heuristicId === 'om-empty-state-next-action'),
    ).toHaveLength(0)
  })

  it('flags a screen with no action or navigation block as a dead end', () => {
    const deadEnd = mockupDocument.parse({
      version: 1,
      slug: 'dead-end',
      title: 'Dead end',
      root: { type: 'block', id: 'b1', entry: 'kpi-card', props: { title: 'A', value: 1 }, status: 'proposed' },
    })
    const results = runMechanicalChecks(deadEnd)
    expect(results.some((result) => result.heuristicId === 'om-no-dead-ends' && result.blockId === null)).toBe(true)
    // The table fixture has a section-header → no dead-end finding.
    expect(runMechanicalChecks(tableDocument()).some((result) => result.heuristicId === 'om-no-dead-ends')).toBe(false)
  })

  it('applyMechanicalFindings replaces its own findings deterministically and keeps foreign ones', () => {
    const hash = 'content-hash-1'
    const base = tableDocument()
    const withForeign = mockupDocument.parse({
      ...JSON.parse(JSON.stringify(base)),
      documentFindings: [
        { id: 'f-manual', heuristicId: 'nielsen-08', severity: 'low', summary: 'judgment call', atHash: 'x' },
      ],
    })
    const once = applyMechanicalFindings(withForeign, hash)
    const twice = applyMechanicalFindings(once, hash)
    // Idempotent: two runs on the same content yield byte-identical findings.
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
    // The mechanical finding landed on the block with a deterministic id.
    const refs = collectFindings(once)
    expect(
      refs.some(
        (ref) =>
          ref.blockId === 'b-table' &&
          ref.finding.id === findingIdFor('om-empty-state-next-action', 'b-table') &&
          ref.finding.atHash === hash,
      ),
    ).toBe(true)
    // The hand-written judgment finding survives untouched.
    expect(refs.some((ref) => ref.finding.id === 'f-manual')).toBe(true)
    // Fixing the document removes the finding on the next run.
    const fixed = applyMechanicalFindings(
      mockupDocument.parse({
        ...JSON.parse(JSON.stringify(once)),
        root: {
          ...JSON.parse(JSON.stringify(once.root)),
          children: (once.root as { children: unknown[] }).children.map((child) =>
            (child as { id: string }).id === 'b-table'
              ? { ...(child as object), note: 'Empty state offers an Add person action.' }
              : child,
          ),
        },
      }),
      'content-hash-2',
    )
    expect(
      collectFindings(fixed).some((ref) => ref.finding.heuristicId === 'om-empty-state-next-action'),
    ).toBe(false)
  })

  it('the committed golden mockup carries the mechanical finding with a fresh atHash', () => {
    const golden = getMockupBySlug('customers-people-list', findRepoRoot(__dirname))
    expect(golden?.document).toBeTruthy()
    const contentHash = computeContentHash(golden!.document!)
    const refs = collectFindings(golden!.document!)
    const mechanical = refs.find(
      (ref) => ref.finding.id === findingIdFor('om-empty-state-next-action', 'people-table'),
    )
    expect(mechanical).toBeTruthy()
    expect(mechanical!.finding.atHash).toBe(contentHash)
    expect(mechanical!.finding.evidence).toBe('heuristic')
    // Re-running the mechanical pass over the golden is a no-op (idempotence
    // against the committed fixture).
    const rerun = applyMechanicalFindings(golden!.document!, contentHash)
    expect(JSON.stringify(rerun)).toBe(JSON.stringify(golden!.document!))
    // And the fixture deliberately carries one stale judgment finding, tagged
    // as an assumption awaiting verification.
    expect(golden!.findings.stale).toBe(1)
    expect(golden!.findings.total).toBe(3)
    expect(golden!.findings.assumptions).toBe(1)
  })
})

describe('design_system annotation PUT accepts findings', () => {
  it('replaces block findings and documentFindings through the annotation write path', () => {
    const raw = JSON.parse(JSON.stringify({
      version: 1,
      slug: 'f-write',
      title: 'F write',
      root: {
        type: 'stack',
        id: 'root',
        children: [
          {
            type: 'block',
            id: 'b1',
            entry: 'table',
            status: 'proposed',
            findings: [{ id: 'f-old', heuristicId: 'x', severity: 'low', summary: 'old', atHash: 'h0' }],
          },
        ],
      },
    }))
    const { unknownIds } = applyAnnotationsToDocument(
      raw,
      [
        {
          id: 'b1',
          status: 'proposed',
          findings: [
            { id: 'f-new', heuristicId: 'nielsen-01', severity: 'high', summary: 'new', atHash: 'h1', evidence: 'research' },
          ],
        },
      ],
      [{ id: 'f-doc', heuristicId: 'om-no-dead-ends', severity: 'medium', summary: 'doc-level', atHash: 'h1' }],
    )
    expect(unknownIds).toEqual([])
    // The evidence tag round-trips through the annotation write path.
    expect(raw.root.children[0].findings).toEqual([
      { id: 'f-new', heuristicId: 'nielsen-01', severity: 'high', summary: 'new', atHash: 'h1', evidence: 'research' },
    ])
    expect(raw.documentFindings).toEqual([
      { id: 'f-doc', heuristicId: 'om-no-dead-ends', severity: 'medium', summary: 'doc-level', atHash: 'h1' },
    ])
    // The document still validates after the write.
    expect(mockupDocument.safeParse(raw).success).toBe(true)
    // Empty arrays clear the fields entirely.
    applyAnnotationsToDocument(raw, [{ id: 'b1', status: 'proposed', findings: [] }], [])
    expect(raw.root.children[0].findings).toBeUndefined()
    expect(raw.documentFindings).toBeUndefined()
  })
})

describe('design_system copy files (om-ux-copy)', () => {
  it('derives deterministic keys — two runs, identical keys', () => {
    const golden = getMockupBySlug('customers-people-list', findRepoRoot(__dirname))!
    const first = expectedCopyKeys(golden.document!)
    const second = expectedCopyKeys(golden.document!)
    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(0)
    for (const key of first) {
      expect(key.startsWith('mockup.customers-people-list.')).toBe(true)
    }
  })

  it('the committed golden copy file validates and covers every text-bearing prop in all four locales', () => {
    const golden = getMockupBySlug('customers-people-list', findRepoRoot(__dirname))!
    const copy = loadCopyFileFor(golden)
    expect(copy).not.toBeNull()
    const parsed = copyFileSchema.safeParse(copy)
    expect(parsed.success).toBe(true)
    const keys = new Set(Object.keys(copy!.keys))
    for (const ref of collectTextProps(golden.document!)) {
      expect(keys.has(ref.key)).toBe(true)
      for (const locale of COPY_LOCALES) {
        expect(typeof copy!.keys[ref.key][locale]).toBe('string')
        expect(copy!.keys[ref.key][locale].length).toBeGreaterThan(0)
      }
    }
  })
})
