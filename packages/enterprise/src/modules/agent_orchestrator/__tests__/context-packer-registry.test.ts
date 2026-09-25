import {
  resolveContextModule,
  listContextCapabilities,
  type ContextSourceHit,
} from '../lib/context/registry'
import { packCandidates, estimateTokens, type PackCandidate } from '../lib/context/packer'
import {
  contextBundleSourcesSchema,
  contextBundlePrunedSourcesSchema,
} from '../data/validators'

/**
 * Registry-skew guard + budget-packer unit coverage (GAP-10 acceptance). The
 * assembler/scoping/fail-closed E2E lives in context-assembly.test.ts; this file
 * covers the two pieces that test omits: that every SHIPPED capability resolves a
 * ContextModule (no skew), and the packer's mandatory-first / prune-with-reason
 * contract in isolation.
 */

describe('context registry (shipped capabilities)', () => {
  it('resolves the shipped deals.health_check capability to a mandatory entity floor', () => {
    const module = resolveContextModule('deals.health_check')
    expect(module).not.toBeNull()
    expect(module?.capability).toBe('deals.health_check')
    const mandatory = (module?.sources ?? []).filter((source) => source.tier === 'mandatory')
    expect(mandatory.length).toBeGreaterThanOrEqual(1)
    expect(mandatory[0].kind).toBe('entity')
    expect(mandatory[0].entityType).toBe('customers:deal')
  })

  it('every registered capability resolves a ContextModule (fails-closed guard, no skew)', () => {
    const capabilities = listContextCapabilities()
    expect(capabilities).toContain('deals.health_check')
    for (const capability of capabilities) {
      expect(resolveContextModule(capability)).not.toBeNull()
    }
  })

  it('returns null for an unknown capability so the assembler can fail closed', () => {
    expect(resolveContextModule('definitely.not_a_capability')).toBeNull()
  })
})

describe('budget packer', () => {
  function hit(ref: string, record: Record<string, unknown>, score?: number): ContextSourceHit {
    return { ref, record, ...(score !== undefined ? { score } : {}) }
  }
  function candidate(
    tier: 'mandatory' | 'optional',
    ref: string,
    record: Record<string, unknown>,
    score?: number,
  ): PackCandidate {
    const kind = tier === 'mandatory' ? 'entity' : 'retrieval'
    return {
      kind,
      tier,
      hit: hit(ref, record, score),
      tokens: estimateTokens(record),
      provenance: { factId: ref, sourceKind: kind, sourceRef: ref },
    }
  }

  it('routes the mandatory floor, fills optional by descending score, prunes the over-budget rest', () => {
    const mandatory = candidate('mandatory', 'm1', { a: 'x'.repeat(40) })
    const highScore = candidate('optional', 'o-high', { b: 'y'.repeat(40) }, 0.9)
    const lowScore = candidate('optional', 'o-low', { c: 'z'.repeat(40) }, 0.1)

    // Budget fits the mandatory + exactly one optional, not both.
    const budget = mandatory.tokens + highScore.tokens
    const result = packCandidates([lowScore, mandatory, highScore], budget)

    const routedRefs = result.routedSources.map((source) => source.ref)
    expect(routedRefs).toContain('m1')
    expect(routedRefs).toContain('o-high') // higher score fills first
    expect(routedRefs).not.toContain('o-low')

    expect(result.prunedSources).toHaveLength(1)
    expect(result.prunedSources[0]).toMatchObject({ ref: 'o-low', reason: 'over_budget' })
    expect(result.tokensUsed).toBeLessThanOrEqual(budget)

    // Provenance recorded for every routed source; shapes validate at the Zod boundary.
    contextBundleSourcesSchema.parse(result.sources)
    contextBundlePrunedSourcesSchema.parse(result.prunedSources)
    expect(result.sources.map((source) => source.sourceRef).sort()).toEqual(['m1', 'o-high'])
  })

  it('never prunes a mandatory source even when it alone exceeds the budget', () => {
    const mandatory = candidate('mandatory', 'm1', { a: 'x'.repeat(400) })
    const result = packCandidates([mandatory], 1)
    expect(result.routedSources.map((source) => source.ref)).toEqual(['m1'])
    expect(result.prunedSources).toHaveLength(0)
    expect(result.tokensUsed).toBeGreaterThan(1)
  })

  it('estimateTokens is positive and conservative (rounds up small records to >=1)', () => {
    expect(estimateTokens({})).toBeGreaterThanOrEqual(1)
    expect(estimateTokens({ a: 'x'.repeat(100) })).toBeGreaterThan(estimateTokens({ a: 'x' }))
  })
})
