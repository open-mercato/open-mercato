/** @jest-environment node */
import {
  buildIntegritySummary,
  findRawOutputKey,
  loadRunIntegritySummary,
  readCheckRuleId,
  readRawOutputKey,
} from '../lib/guardrails/integrity/summary'

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn(() => ({ GET: jest.fn() })),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '33333333-3333-4333-8333-333333333333'

function integrityRow(kind: string, result: string, evidence: Record<string, unknown>) {
  return {
    phase: 'output',
    kind,
    result,
    evidence: { items: 1, violations: [], dropped: 0, repaired: 0, ambiguous: 0, ...evidence },
  }
}

describe('buildIntegritySummary', () => {
  it('returns null when the run recorded no integrity rule check', () => {
    expect(buildIntegritySummary([])).toBeNull()
    expect(
      buildIntegritySummary([
        { phase: 'output', kind: 'grounding', result: 'warn', evidence: { reason: 'uncited_claim' } },
        { phase: 'input', kind: 'prompt_injection', result: 'warn', evidence: { label: 'notes' } },
        { phase: 'output', kind: 'evidence_quote', result: 'pass', evidence: null },
      ]),
    ).toBeNull()
  })

  it('reports clean when every integrity rule passed untouched', () => {
    expect(
      buildIntegritySummary([
        integrityRow('evidence_quote', 'pass', { ruleId: 'quotes' }),
        integrityRow('abstain_or_review', 'pass', { ruleId: 'abstain', outcome: 'none' }),
      ]),
    ).toEqual({
      outcome: 'clean',
      checks: [
        { ruleId: 'quotes', kind: 'evidence_quote', result: 'pass', dropped: 0, repaired: 0 },
        { ruleId: 'abstain', kind: 'abstain_or_review', result: 'pass', dropped: 0, repaired: 0 },
      ],
    })
  })

  it('reports repaired for quiet drops and repairs', () => {
    const summary = buildIntegritySummary([integrityRow('evidence_quote', 'warn', { ruleId: 'quotes', dropped: 2 })])
    expect(summary?.outcome).toBe('repaired')
    expect(summary?.checks[0]).toMatchObject({ dropped: 2, repaired: 0 })
  })

  it('reports not_applicable when an abstain rule abstained', () => {
    const summary = buildIntegritySummary([
      integrityRow('evidence_quote', 'warn', { ruleId: 'quotes', repaired: 1 }),
      integrityRow('abstain_or_review', 'pass', { ruleId: 'abstain', outcome: 'not_applicable' }),
    ])
    expect(summary?.outcome).toBe('not_applicable')
  })

  it('reports flagged for a held warn or a block', () => {
    expect(
      buildIntegritySummary([integrityRow('reference_exists', 'warn', { ruleId: 'refs', holdsAutoApproval: true })])
        ?.outcome,
    ).toBe('flagged')
    expect(buildIntegritySummary([integrityRow('tool_consulted', 'block', { ruleId: 'rules-read' })])?.outcome).toBe(
      'flagged',
    )
  })

  it('lets needs_review win over every other outcome', () => {
    const summary = buildIntegritySummary([
      integrityRow('evidence_quote', 'block', { ruleId: 'quotes' }),
      integrityRow('abstain_or_review', 'warn', {
        ruleId: 'abstain',
        outcome: 'needs_review',
        reasons: ['integrity_dropped_all'],
        route: 'review',
        holdsAutoApproval: true,
      }),
    ])
    expect(summary?.outcome).toBe('needs_review')
    expect(summary?.checks).toHaveLength(2)
  })

  it('maps custom integrity checks and tolerates JSON-string evidence', () => {
    const summary = buildIntegritySummary([
      { phase: 'output', kind: 'custom_integrity', result: 'pass', evidence: JSON.stringify({ ruleId: 'custom' }) },
    ])
    expect(summary?.checks).toEqual([
      { ruleId: 'custom', kind: 'custom_integrity', result: 'pass', dropped: 0, repaired: 0 },
    ])
  })
})

describe('evidence readers', () => {
  it('reads the rule id and the raw output key defensively', () => {
    expect(readCheckRuleId({ ruleId: 'quotes' })).toBe('quotes')
    expect(readCheckRuleId({ ruleId: '' })).toBeNull()
    expect(readCheckRuleId(null)).toBeNull()
    expect(readCheckRuleId(['quotes'])).toBeNull()
    expect(readRawOutputKey({ rawOutput: { key: 'k1', status: 'stored' } })).toBe('k1')
    expect(readRawOutputKey({ rawOutput: { status: 'storage_unavailable' } })).toBeNull()
    expect(readRawOutputKey({})).toBeNull()
  })

  it('finds the first raw output key referenced by any check', () => {
    expect(findRawOutputKey([])).toBeNull()
    expect(
      findRawOutputKey([
        { evidence: { ruleId: 'quotes' } },
        { evidence: { ruleId: 'refs', rawOutput: { key: 'k2', status: 'stored' } } },
      ]),
    ).toBe('k2')
  })
})

describe('loadRunIntegritySummary', () => {
  it('reads only the run\'s tenant- and organization-scoped check rows', async () => {
    const find = jest.fn(async () => [integrityRow('evidence_quote', 'pass', { ruleId: 'quotes' })])
    const em = { find } as unknown as Parameters<typeof loadRunIntegritySummary>[0]
    const summary = await loadRunIntegritySummary(em, RUN_ID, { tenantId: TENANT, organizationId: ORG })
    expect(summary?.outcome).toBe('clean')
    const [entity, where] = find.mock.calls[0] as unknown as [{ name: string }, Record<string, unknown>]
    expect(entity.name).toBe('AgentGuardrailCheck')
    expect(where).toEqual({ agentRunId: RUN_ID, tenantId: TENANT, organizationId: ORG })
  })
})

describe('GET /guardrail-checks list items', () => {
  it('carry the evidence ruleId (null for non-integrity checks)', async () => {
    const { makeCrudRoute } = await import('@open-mercato/shared/lib/crud/factory')
    await import('../api/guardrail-checks/route')
    const options = (makeCrudRoute as jest.Mock).mock.calls[0][0] as {
      list: { transformItem: (item: Record<string, unknown>) => Record<string, unknown> }
    }
    expect(options.list.transformItem({ id: 'a', kind: 'evidence_quote', evidence: { ruleId: 'quotes' } })).toEqual({
      id: 'a',
      kind: 'evidence_quote',
      evidence: { ruleId: 'quotes' },
      ruleId: 'quotes',
    })
    expect(options.list.transformItem({ id: 'b', kind: 'grounding', evidence: null }).ruleId).toBeNull()
  })
})
