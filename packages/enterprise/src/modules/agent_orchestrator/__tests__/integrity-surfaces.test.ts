import { diffStructures, deepEqual, STRUCTURAL_DIFF_MAX_CHANGES } from '../components/trace/structuralDiff'
import { heldIntegrityRuleIds, readGuardEvidence } from '../components/guardrailEvidence'
import { mapAgentDetail, mapIntegrityOutcome, mapProposal, mapRunDetail } from '../components/types'
import { listIntegrityRules } from '../lib/guardrails/integrity/ruleList'
import { integrityRulesSchema } from '../data/validators'

describe('diffStructures', () => {
  it('returns no changes for deep-equal values', () => {
    expect(diffStructures({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([])
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  })

  it('reports a repaired leaf as changed at its integrity path', () => {
    expect(
      diffStructures({ items: [{ quote: 'x', start: 1 }] }, { items: [{ quote: 'y', start: 1 }] }),
    ).toEqual([{ path: 'items[0].quote', change: 'changed', before: 'x', after: 'y' }])
  })

  it('aligns arrays of different length so a dropped item reads as removed', () => {
    const before = { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
    const after = { items: [{ id: 'a' }, { id: 'c' }] }
    expect(diffStructures(before, after)).toEqual([{ path: 'items[1]', change: 'removed', before: { id: 'b' } }])
  })

  it('reports added and removed keys and root-level replacements', () => {
    expect(diffStructures({ keep: 1, gone: 2 }, { keep: 1, fresh: 3 })).toEqual([
      { path: 'gone', change: 'removed', before: 2 },
      { path: 'fresh', change: 'added', after: 3 },
    ])
    expect(diffStructures('raw', 'final')).toEqual([{ path: '', change: 'changed', before: 'raw', after: 'final' }])
    expect(diffStructures([1], [1, 2])).toEqual([{ path: '[1]', change: 'added', after: 2 }])
  })

  it('caps the number of reported changes', () => {
    const before = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`k${index}`, index]))
    const after = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`k${index}`, index + 1]))
    expect(diffStructures(before, after)).toHaveLength(STRUCTURAL_DIFF_MAX_CHANGES)
  })
})

describe('readGuardEvidence / heldIntegrityRuleIds', () => {
  it('reads rule id, hold flag, counts and raw-output status from object or JSON-string evidence', () => {
    const evidence = { ruleId: 'quotes', holdsAutoApproval: true, dropped: 2, repaired: 1.7, rawOutput: { key: 'k', status: 'stored' } }
    expect(readGuardEvidence(evidence)).toEqual({
      ruleId: 'quotes',
      holdsAutoApproval: true,
      dropped: 2,
      repaired: 1,
      rawOutputStatus: 'stored',
    })
    expect(readGuardEvidence(JSON.stringify(evidence)).ruleId).toBe('quotes')
    expect(readGuardEvidence(null)).toEqual({ ruleId: null, holdsAutoApproval: false, dropped: 0, repaired: 0, rawOutputStatus: null })
    expect(readGuardEvidence('not json').ruleId).toBeNull()
  })

  it('collects unique rule ids of blocks and held warns, never legacy warns', () => {
    expect(
      heldIntegrityRuleIds([
        { result: 'warn', ruleId: 'quotes', holdsAutoApproval: true },
        { result: 'warn', ruleId: 'refs', holdsAutoApproval: false },
        { result: 'warn', ruleId: null, holdsAutoApproval: true },
        { result: 'block', ruleId: 'tools', holdsAutoApproval: false },
        { result: 'pass', ruleId: 'abstain', holdsAutoApproval: true },
        { result: 'warn', ruleId: 'quotes', holdsAutoApproval: true },
      ]),
    ).toEqual(['quotes', 'tools'])
  })
})

describe('client mappers', () => {
  it('maps the run detail integrity outcome and raw output key', () => {
    const detail = mapRunDetail({
      run: { id: 'run-1', agent_id: 'claims.triage', status: 'completed' },
      guardrailChecks: [
        { id: 'c1', kind: 'evidence_quote', result: 'warn', ruleId: 'quotes', evidence: { holdsAutoApproval: true, dropped: 1 } },
      ],
      integrity: { outcome: 'flagged', checks: [] },
      rawOutputKey: 'raw-1',
    })
    expect(detail?.integrityOutcome).toBe('flagged')
    expect(detail?.rawOutputKey).toBe('raw-1')
    expect(detail?.guardrailChecks[0]).toMatchObject({ ruleId: 'quotes', holdsAutoApproval: true, dropped: 1 })
    const bare = mapRunDetail({ run: { id: 'run-2', agent_id: 'a', status: 'completed' } })
    expect(bare?.integrityOutcome).toBeNull()
    expect(bare?.rawOutputKey).toBeNull()
    expect(mapIntegrityOutcome({ outcome: 'bogus' })).toBeNull()
  })

  it('carries rule id and hold flag on proposal guard results', () => {
    const proposal = mapProposal({
      id: 'p1',
      runId: 'run-1',
      agentId: 'claims.triage',
      guardResults: [{ kind: 'evidence_quote', result: 'warn', evidence: { ruleId: 'quotes', holdsAutoApproval: true } }],
    })
    expect(proposal?.guardResults).toEqual([
      { kind: 'evidence_quote', result: 'warn', ruleId: 'quotes', holdsAutoApproval: true },
    ])
  })

  it('maps the agent detail integrity rules', () => {
    const agent = mapAgentDetail({
      id: 'claims.triage',
      label: 'Claims triage',
      integrityRules: [{ id: 'quotes', kind: 'evidence_quote', onViolation: 'drop', reviewRoute: null }, { kind: 'bad' }],
      integritySetVersion: 'i1-abc',
    })
    expect(agent?.integrityRules).toEqual([{ id: 'quotes', kind: 'evidence_quote', onViolation: 'drop', reviewRoute: null }])
    expect(agent?.integritySetVersion).toBe('i1-abc')
    expect(mapAgentDetail({ id: 'x' })?.integrityRules).toEqual([])
  })
})

describe('listIntegrityRules', () => {
  it('lists id, kind and action in pipeline order without paths or config', () => {
    const rules = integrityRulesSchema.parse([
      { id: 'quotes', kind: 'evidence_quote', items: 'findings[*]', quote: 'quote', source: { input: 'text' } },
      { id: 'tools', kind: 'tool_consulted', cites: 'ids[*]', tools: ['search'], matchArgs: true },
      {
        id: 'abstain',
        kind: 'abstain_or_review',
        needsReview: { when: [{ signal: 'retrieval_empty' }], route: 'review' },
      },
    ])
    expect(listIntegrityRules(rules)).toEqual([
      { id: 'quotes', kind: 'evidence_quote', onViolation: 'drop', reviewRoute: null },
      { id: 'tools', kind: 'tool_consulted', onViolation: 'flag', reviewRoute: null },
      { id: 'abstain', kind: 'abstain_or_review', onViolation: null, reviewRoute: 'review' },
    ])
    expect(listIntegrityRules(undefined)).toEqual([])
  })
})
