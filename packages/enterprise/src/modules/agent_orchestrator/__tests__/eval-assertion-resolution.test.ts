import type { AgentEvalAssertion } from '../data/entities'
import { parseCaseAssertionRefs, resolveEffectiveAssertions } from '../lib/eval/assertionResolution'
import { listScorerDefinitions, runScorer } from '../lib/eval/registry'
import type { ScorerRunView } from '../lib/eval/types'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

function assertion(overrides: Partial<AgentEvalAssertion> & { id: string; key: string }): AgentEvalAssertion {
  return {
    ...SCOPE,
    scorerKey: overrides.key,
    title: overrides.key,
    appliesTo: '*',
    type: 'deterministic',
    severity: 'warn',
    config: null,
    version: 1,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as AgentEvalAssertion
}

describe('assertion resolution', () => {
  it('parses only well-formed case refs and ignores junk', () => {
    const refs = parseCaseAssertionRefs([
      { assertionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', disabled: true },
      { nope: 1 },
      null,
      'string',
    ])
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ assertionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', disabled: true })
  })

  it('lets an agent-specific assertion shadow the wildcard sharing its slug', () => {
    const wildcard = assertion({ id: 'a-star', key: 'no_pii', appliesTo: '*', severity: 'warn' })
    const specific = assertion({ id: 'a-agent', key: 'no_pii', appliesTo: 'deals.health_check', severity: 'gate' })

    const resolved = resolveEffectiveAssertions([wildcard, specific], [])
    expect(resolved).toHaveLength(1)
    // Running both the general and the tightened version would double-count it.
    expect(resolved[0].assertion.id).toBe('a-agent')
    expect(resolved[0].assertion.severity).toBe('gate')
  })

  it('is order-independent when shadowing', () => {
    const wildcard = assertion({ id: 'a-star', key: 'no_pii', appliesTo: '*' })
    const specific = assertion({ id: 'a-agent', key: 'no_pii', appliesTo: 'deals.health_check' })
    expect(resolveEffectiveAssertions([specific, wildcard], [])[0].assertion.id).toBe('a-agent')
  })

  it('drops an assertion the case disables', () => {
    const kept = assertion({ id: 'a-1', key: 'no_pii' })
    const dropped = assertion({ id: 'a-2', key: 'output_present' })
    const resolved = resolveEffectiveAssertions([kept, dropped], [{ assertionId: 'a-2', disabled: true }])
    expect(resolved.map((entry) => entry.assertion.id)).toEqual(['a-1'])
  })

  it('shallow-merges a case-level config override', () => {
    const base = assertion({
      id: 'a-1',
      key: 'confidence_threshold',
      scorerKey: 'confidence_threshold',
      config: { threshold: 0.5, direction: 'gte' },
    })
    const resolved = resolveEffectiveAssertions([base], [{ assertionId: 'a-1', configOverride: { threshold: 0.9 } }])
    expect(resolved[0].config).toEqual({ threshold: 0.9, direction: 'gte' })
    expect(resolved[0].configError).toBeUndefined()
  })

  it('re-validates the merged override instead of trusting it', () => {
    // Without this, a case-level override would reintroduce exactly the
    // malformed-config-silently-tolerated failure the typed registry removes.
    const base = assertion({ id: 'a-1', key: 'regex', scorerKey: 'regex', config: { pattern: 'ok' } })
    const resolved = resolveEffectiveAssertions([base], [{ assertionId: 'a-1', configOverride: { pattern: '' } }])
    expect(resolved[0].configError).toBeDefined()
  })

  it('does not validate when no override is supplied, so a legacy stored config still runs', () => {
    const base = assertion({ id: 'a-1', key: 'regex', scorerKey: 'regex', config: { pattern: '' } })
    const resolved = resolveEffectiveAssertions([base], [])
    expect(resolved[0].configError).toBeUndefined()
  })
})

describe('online/offline scorer parity', () => {
  const view: ScorerRunView = {
    input: { q: 'shoes' },
    output: { answer: 'ok', count: 2 },
    resultKind: 'informative',
    confidence: 0.8,
    status: 'ok',
    latencyMs: 900,
    costMinor: 5,
    inputTokens: 10,
    outputTokens: 20,
    toolCalls: [{ toolName: 'search', args: { q: 'shoes' }, status: 'ok', sequence: 0 }],
    stepCount: 1,
    disposition: 'auto_approved',
  }

  const configFor: Record<string, unknown> = {
    equals: { source: 'config', value: '{"answer":"ok","count":2}' },
    contains: { source: 'config', value: 'ok' },
    starts_with: { source: 'config', value: '{' },
    regex: { pattern: 'ok' },
    json_schema: { schema: '{"type":"object"}' },
    json_match: { source: 'config', value: '{"answer":"ok"}' },
    json_path_compare: { path: 'count', operator: 'gte', value: '1' },
    tool_used: { name: 'search' },
    tool_args_match: { name: 'search', args: '{"q":"shoes"}' },
    tool_sequence: { steps: ['search'] },
    tool_count: { min: 1 },
    latency: { threshold: 5000 },
    cost: { threshold: 100 },
    step_count: { threshold: 5 },
    confidence_threshold: { threshold: 0.5 },
    disposition_equals: { expected: 'auto_approved' },
    required_keys: { requiredKeys: ['answer'] },
  }

  /**
   * The shared-scorer premise: a scorer that does not read `expected` must produce
   * an IDENTICAL verdict online (no eval case attached, `expected === null`) and
   * offline (replaying a case). If the two planes could diverge, the gate would
   * stop predicting production behaviour.
   */
  it('produces identical verdicts on both planes for every scorer that ignores `expected`', () => {
    for (const definition of listScorerDefinitions()) {
      const config = configFor[definition.scorerKey] ?? {}
      if (definition.needsExpected(config as never)) continue

      const online = runScorer(definition.scorerKey, view, null, config)
      const offline = runScorer(definition.scorerKey, view, { answer: 'ok' }, config)

      expect({ key: definition.scorerKey, ...online }).toEqual({ key: definition.scorerKey, ...offline })
    }
  })

  it('covers the whole deterministic catalog in the parity fixture set', () => {
    const deterministic = listScorerDefinitions().filter((definition) => definition.kind === 'deterministic')
    const missing = deterministic
      .map((definition) => definition.scorerKey)
      .filter((key) => !(key in configFor) && !['output_present', 'json_valid', 'no_pii'].includes(key))
    // The three exclusions need no config at all; anything else must be fixtured,
    // or a new scorer could silently escape the parity guarantee.
    expect(missing).toEqual([])
  })
})

describe('review regression — shadowing must not drop a gate', () => {
  it('refuses to let an agent-specific warn assertion shadow a wildcard gate', () => {
    // `defaultAssertions` seeds `output_present` as a `'*'` GATE into every tenant,
    // and the unique index is per (org, appliesTo, key) — so an operator can
    // legally add an agent-scoped `warn` row with the same slug. Shadowing it away
    // would delete the gate tier from the replay plane with no error.
    const wildcardGate = assertion({ id: 'a-star', key: 'output_present', appliesTo: '*', severity: 'gate' })
    const specificWarn = assertion({
      id: 'a-agent',
      key: 'output_present',
      appliesTo: 'deals.health_check',
      severity: 'warn',
    })

    const resolved = resolveEffectiveAssertions([wildcardGate, specificWarn], [])
    expect(resolved).toHaveLength(1)
    expect(resolved[0].assertion.severity).toBe('gate')
    expect(resolved[0].assertion.id).toBe('a-star')
  })

  it('still lets an agent-specific assertion shadow when the gate tier is not weakened', () => {
    const wildcardGate = assertion({ id: 'a-star', key: 'no_pii', appliesTo: '*', severity: 'gate' })
    const specificGate = assertion({ id: 'a-agent', key: 'no_pii', appliesTo: 'agentX', severity: 'gate' })
    expect(resolveEffectiveAssertions([wildcardGate, specificGate], [])[0].assertion.id).toBe('a-agent')
  })
})
