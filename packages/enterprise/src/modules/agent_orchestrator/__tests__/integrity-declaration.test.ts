import { z } from 'zod'
import { defineAgent, getAgentEntry } from '../lib/sdk/defineAgent'
import {
  INTEGRITY_RULE_CHECK_KIND,
  guardrailCheckSchema,
  guardrailKind,
  integrityEvidenceSchema,
  integrityRuleSchema,
  integrityRulesSchema,
  integritySummarySchema,
  type IntegrityRuleInput,
} from '../data/validators'

const resultSchema = z.object({
  kind: z.literal('research'),
  data: z.object({
    findings: z.array(
      z.object({
        ruleId: z.string(),
        rule: z.object({ key: z.string(), version: z.string().optional() }).optional(),
        evidence: z.array(
          z.object({
            quote: z.string(),
            start: z.number().int().optional(),
            end: z.number().int().optional(),
            field: z.string().optional(),
          }),
        ),
      }),
    ),
    overall: z.enum(['ok', 'not_applicable']).optional(),
    confidence: z.number().optional(),
    needsHumanReview: z.boolean().optional(),
    reviewReasons: z.array(z.string()).optional(),
  }),
})

const abstainRule: IntegrityRuleInput = {
  id: 'abstain',
  kind: 'abstain_or_review',
  notApplicable: { when: [{ signal: 'output_empty', path: 'data.findings' }], set: { 'data.overall': 'not_applicable' } },
  needsReview: {
    when: [
      { signal: 'confidence_below', path: 'data.confidence', threshold: 0.6 },
      { signal: 'violations_at_least', count: 1, rules: ['quotes'] },
      { signal: 'integrity_dropped_all', rule: 'quotes' },
      { signal: 'tool_returned_empty', tool: 'acme.retrieve_rules' },
      { signal: 'retrieval_empty' },
      { signal: 'output_flag', path: 'data.needsHumanReview' },
    ],
    set: { 'data.needsHumanReview': true },
    reasonsPath: 'data.reviewReasons',
  },
}

const quoteRule: IntegrityRuleInput = {
  id: 'quotes',
  kind: 'evidence_quote',
  items: 'data.findings[*].evidence[*]',
  quote: 'quote',
  offsets: { start: 'start', end: 'end' },
  source: { input: 'content' },
}

let agentSequence = 0
function register(integrity: IntegrityRuleInput[] | undefined, extra: { tools?: string[]; subAgents?: string[] } = {}) {
  agentSequence += 1
  const id = `test.integrity_agent_${agentSequence}`
  defineAgent({
    id,
    moduleId: 'agent_orchestrator',
    label: 'Integrity',
    description: 'Declares integrity rules.',
    instructions: 'BASE',
    result: { kind: 'research', schema: resultSchema },
    integrity,
    ...extra,
  })
  return id
}

describe('integrityRuleSchema', () => {
  it('applies per-kind defaults', () => {
    expect(integrityRuleSchema.parse(quoteRule)).toMatchObject({
      normalize: 'nfkc_ws',
      caseInsensitive: false,
      offsetUnit: 'utf16',
      repairQuote: true,
      minChars: 3,
      onViolation: 'drop',
    })
    expect(
      integrityRuleSchema.parse({ id: 'refs', kind: 'reference_exists', ids: 'data.findings[*].ruleId', resolver: 'acme.rule' }),
    ).toMatchObject({ versionSeparator: '@', onResolverMissing: 'block', onViolation: 'drop' })
    expect(
      integrityRuleSchema.parse({ id: 'read', kind: 'tool_consulted', cites: 'data.findings[*].ruleId', tools: ['acme.get_rule'], returned: ['id'] }),
    ).toMatchObject({ includeSubRuns: false, matchArgs: false, onViolation: 'flag' })
  })

  it('accepts repair only on evidence_quote', () => {
    expect(integrityRuleSchema.safeParse({ ...quoteRule, onViolation: 'repair' }).success).toBe(true)
    expect(
      integrityRuleSchema.safeParse({ id: 'refs', kind: 'reference_exists', ids: 'a[*]', resolver: 'r', onViolation: 'repair' }).success,
    ).toBe(false)
    expect(
      integrityRuleSchema.safeParse({ id: 'read', kind: 'tool_consulted', cites: 'a[*]', tools: ['t'], returned: ['id'], onViolation: 'repair' }).success,
    ).toBe(false)
    expect(integrityRuleSchema.safeParse({ id: 'c', kind: 'custom', checker: 'acme.check', onViolation: 'repair' }).success).toBe(false)
  })

  it('rejects malformed declarations', () => {
    expect(integrityRuleSchema.safeParse({ ...quoteRule, items: 'a[?(@.x)]' }).success).toBe(false)
    expect(integrityRuleSchema.safeParse({ ...quoteRule, source: { input: 'a', fromItem: 'b' } }).success).toBe(false)
    expect(integrityRuleSchema.safeParse({ ...quoteRule, id: 'bad id' }).success).toBe(false)
    expect(integrityRuleSchema.safeParse({ ...quoteRule, kind: 'abstain_or_review' }).success).toBe(false)
    expect(integrityRuleSchema.safeParse({ id: 'abstain', kind: 'abstain_or_review' }).success).toBe(false)
    expect(integrityRuleSchema.safeParse({ id: 'read', kind: 'tool_consulted', cites: 'a[*]', tools: ['t'] }).success).toBe(false)
    expect(
      integrityRuleSchema.safeParse({ id: 'read', kind: 'tool_consulted', cites: 'a[*]', tools: ['t'], matchArgs: true }).success,
    ).toBe(true)
    expect(integrityRuleSchema.safeParse({ id: 'c', kind: 'custom', checker: 'acme.check' }).success).toBe(false)
  })

  it('rejects duplicate rule ids', () => {
    expect(integrityRulesSchema.safeParse([quoteRule, quoteRule]).success).toBe(false)
  })
})

describe('integrity evidence, summary and check kinds', () => {
  it('extends guardrailKind additively', () => {
    expect(guardrailKind.options).toEqual(
      expect.arrayContaining([
        'prompt_injection',
        'evidence_quote',
        'reference_exists',
        'tool_consulted',
        'custom_integrity',
        'abstain_or_review',
      ]),
    )
    expect(INTEGRITY_RULE_CHECK_KIND.abstain_or_review).toBe('abstain_or_review')
    expect(guardrailCheckSchema.safeParse({ kind: 'abstain_or_review', result: 'warn', guardrailSetVersion: 'i1-x' }).success).toBe(true)
  })

  it('validates redacted evidence and caps violations', () => {
    const evidence = { ruleId: 'quotes', items: 3, violations: [{ itemPath: 'data.findings[0].evidence[1]', reason: 'not_found' }], dropped: 1 }
    expect(integrityEvidenceSchema.parse(evidence)).toMatchObject({ dropped: 1, repaired: 0, ambiguous: 0 })
    const tooMany = Array.from({ length: 21 }, (_, index) => ({ itemPath: `data.findings[${index}]`, reason: 'not_found' }))
    expect(integrityEvidenceSchema.safeParse({ ...evidence, violations: tooMany }).success).toBe(false)
    expect(
      guardrailCheckSchema.safeParse({ kind: 'evidence_quote', result: 'warn', guardrailSetVersion: 'i1-x', evidence }).success,
    ).toBe(true)
  })

  it('validates the run summary', () => {
    expect(
      integritySummarySchema.safeParse({
        outcome: 'repaired',
        checks: [{ ruleId: 'quotes', kind: 'evidence_quote', result: 'warn', items: 2, violations: 1, dropped: 0, repaired: 1 }],
      }).success,
    ).toBe(true)
    expect(integritySummarySchema.safeParse({ outcome: 'dirty', checks: [] }).success).toBe(false)
  })
})

describe('defineAgent integrity', () => {
  it('stores parsed rules with defaults on the registry entry', () => {
    const id = register([
      quoteRule,
      { id: 'refs', kind: 'reference_exists', ids: 'data.findings[*].rule', idPath: 'key', versionPath: 'version', resolver: 'acme.rule' },
      { id: 'read', kind: 'tool_consulted', cites: 'data.findings[*].ruleId', tools: ['acme.get_rule'], returned: ['id', 'items[*].id'] },
      { id: 'domain', kind: 'custom', checker: 'acme.check', onViolation: 'flag' },
    ])
    const integrity = getAgentEntry(id)?.integrity
    expect(integrity?.map((rule) => rule.id)).toEqual(['quotes', 'refs', 'read', 'domain'])
    expect(integrity?.[0]).toMatchObject({ kind: 'evidence_quote', onViolation: 'drop', minChars: 3 })
  })

  it('leaves integrity undefined when none is declared', () => {
    expect(getAgentEntry(register(undefined))?.integrity).toBeUndefined()
    expect(getAgentEntry(register([]))?.integrity).toBeUndefined()
  })

  it('accepts an item-relative source path', () => {
    const id = register([{ ...quoteRule, source: { fromItem: 'field' } }])
    expect(getAgentEntry(id)?.integrity).toHaveLength(1)
  })

  it.each<[string, IntegrityRuleInput, RegExp]>([
    ['items', { ...quoteRule, items: 'data.findings[*].proofs[*]' }, /rule "quotes": items path "data\.findings\[\*\]\.proofs\[\*\]" cannot exist in the result schema \(at "proofs"\)/],
    ['quote', { ...quoteRule, quote: 'text' }, /rule "quotes": quote path "text" cannot exist on the item schema/],
    ['offsets', { ...quoteRule, offsets: { start: 'start', end: 'stop' } }, /offsets\.end path "stop"/],
    ['fromItem', { ...quoteRule, source: { fromItem: 'origin' } }, /source\.fromItem path "origin"/],
    ['ids', { id: 'refs', kind: 'reference_exists', ids: 'data.rules[*]', resolver: 'r' }, /rule "refs": ids path/],
    ['idPath', { id: 'refs', kind: 'reference_exists', ids: 'data.findings[*].rule', idPath: 'code', resolver: 'r' }, /idPath path "code"/],
    ['cites', { id: 'read', kind: 'tool_consulted', cites: 'data.findings[*].nope', tools: ['t'], returned: ['id'] }, /rule "read": cites path/],
  ])('rejects an invalid %s path naming the agent and rule', (_label, rule, message) => {
    expect(() => register([rule])).toThrow(/^\[internal\] agent "test\.integrity_agent_\d+" integrity/)
    expect(() => register([rule])).toThrow(message)
  })

  it('rejects duplicate rule ids and repair on a non-quote rule', () => {
    expect(() => register([quoteRule, { ...quoteRule }])).toThrow(/rule "quotes": invalid declaration at "1\.id"/)
    expect(() =>
      register([{ id: 'refs', kind: 'reference_exists', ids: 'data.findings[*].ruleId', resolver: 'r', onViolation: 'repair' as 'drop' }]),
    ).toThrow(/rule "refs": invalid declaration at "0\.onViolation"/)
  })

  describe('tool_consulted enforced at prepare_step', () => {
    const enforcedRule: IntegrityRuleInput = {
      id: 'read',
      kind: 'tool_consulted',
      cites: 'data.findings[*].ruleId',
      tools: ['acme__get_rule'],
      returned: ['id'],
      enforce: 'prepare_step',
    }

    it('rejects a rule whose tools are not among the agent effective tools', () => {
      expect(() => register([enforcedRule], { tools: ['acme.other_tool'] })).toThrow(
        /^\[internal\] agent "test\.integrity_agent_\d+" integrity rule "read": enforce "prepare_step" requires at least one of tools \[acme__get_rule\]/,
      )
      expect(() => register([enforcedRule])).toThrow(/rule "read": enforce "prepare_step"/)
    })

    it('accepts the rule when a tool matches, treating a__b and a.b as the same tool', () => {
      expect(getAgentEntry(register([enforcedRule], { tools: ['acme.get_rule'] }))?.integrity).toHaveLength(1)
      expect(getAgentEntry(register([{ ...enforcedRule, tools: ['acme.get_rule'] }], { tools: ['acme__get_rule'] }))?.integrity).toHaveLength(1)
    })

    it('counts the delegate tool contributed by sub-agents as an effective tool', () => {
      const id = register([{ ...enforcedRule, tools: ['agent_orchestrator.delegate_agent'] }], { subAgents: ['other.agent'] })
      expect(getAgentEntry(id)?.integrity).toHaveLength(1)
    })

    it('does not require the tools to be reachable without prepare_step enforcement', () => {
      const unenforced: IntegrityRuleInput = {
        id: 'read',
        kind: 'tool_consulted',
        cites: 'data.findings[*].ruleId',
        tools: ['acme__get_rule'],
        returned: ['id'],
      }
      expect(getAgentEntry(register([unenforced]))?.integrity).toHaveLength(1)
    })
  })

  it('does not register an agent whose integrity declaration is invalid', () => {
    const nextId = `test.integrity_agent_${agentSequence + 1}`
    expect(() => register([{ ...quoteRule, quote: 'missing' }])).toThrow()
    expect(getAgentEntry(nextId)).toBeUndefined()
  })
})

describe('abstain_or_review declaration', () => {
  it('parses every signal and defaults route to flag', () => {
    const parsed = integrityRulesSchema.parse([quoteRule, abstainRule])
    expect(parsed[1]).toMatchObject({
      kind: 'abstain_or_review',
      needsReview: { route: 'flag', reasonsPath: 'data.reviewReasons' },
      notApplicable: { set: { 'data.overall': 'not_applicable' } },
    })
    expect(
      integrityRuleSchema.parse({ id: 'abstain', kind: 'abstain_or_review', needsReview: { when: [{ signal: 'retrieval_empty' }] } }),
    ).toMatchObject({ needsReview: { set: {}, route: 'flag' } })
  })

  it('rejects malformed outcomes and signals', () => {
    const base = { id: 'abstain', kind: 'abstain_or_review' }
    const review = (needsReview: Record<string, unknown>) => integrityRuleSchema.safeParse({ ...base, needsReview }).success
    expect(review({ when: [] })).toBe(false)
    expect(review({ when: [{ signal: 'unknown_signal' }] })).toBe(false)
    expect(review({ when: [{ signal: 'confidence_below', path: 'data.confidence' }] })).toBe(false)
    expect(review({ when: [{ signal: 'violations_at_least', count: 0 }] })).toBe(false)
    expect(review({ when: [{ signal: 'retrieval_empty' }], route: 'escalate' })).toBe(false)
    expect(review({ when: [{ signal: 'retrieval_empty' }], set: { 'data.findings[*].ruleId': 'x' } })).toBe(false)
    expect(review({ when: [{ signal: 'retrieval_empty' }], reasonsPath: 'data.items[*]' })).toBe(false)
    expect(review({ when: [{ signal: 'retrieval_empty', path: 'data' }] })).toBe(false)
    expect(review({ when: [{ signal: 'retrieval_empty' }], route: 'review' })).toBe(true)
  })

  it('requires abstain_or_review to be the last rule', () => {
    expect(integrityRulesSchema.safeParse([abstainRule, quoteRule]).success).toBe(false)
    expect(integrityRulesSchema.safeParse([quoteRule, abstainRule, { ...abstainRule, id: 'abstain-2' }]).success).toBe(false)
  })

  it('requires signal rule references to name an earlier rule', () => {
    const unknownRule = {
      id: 'abstain',
      kind: 'abstain_or_review',
      needsReview: { when: [{ signal: 'integrity_dropped_all', rule: 'missing' }] },
    }
    expect(integrityRulesSchema.safeParse([quoteRule, unknownRule]).success).toBe(false)
    const unknownInList = {
      id: 'abstain',
      kind: 'abstain_or_review',
      notApplicable: { when: [{ signal: 'violations_at_least', count: 2, rules: ['quotes', 'missing'] }] },
    }
    expect(integrityRulesSchema.safeParse([quoteRule, unknownInList]).success).toBe(false)
  })

  it('registers a valid rule on the agent', () => {
    const integrity = getAgentEntry(register([quoteRule, abstainRule]))?.integrity
    expect(integrity?.map((rule) => rule.kind)).toEqual(['evidence_quote', 'abstain_or_review'])
  })

  it('rejects a rule that is not last at registration', () => {
    expect(() => register([abstainRule, quoteRule])).toThrow(/rule "abstain": invalid declaration at "0\.kind": abstain_or_review must be the last/)
  })

  it.each<[string, Record<string, unknown>, RegExp]>([
    [
      'signal path',
      { needsReview: { when: [{ signal: 'output_flag', path: 'data.flagged' }] } },
      /needsReview\.when\.0\.path path "data\.flagged" cannot exist in the result schema/,
    ],
    [
      'set path',
      { notApplicable: { when: [{ signal: 'retrieval_empty' }], set: { 'data.verdict': 'n/a' } } },
      /notApplicable\.set path "data\.verdict" cannot exist/,
    ],
    [
      'set value',
      { notApplicable: { when: [{ signal: 'retrieval_empty' }], set: { 'data.overall': 'skipped' } } },
      /notApplicable\.set value for "data\.overall" does not satisfy the result schema/,
    ],
    [
      'set value type',
      { needsReview: { when: [{ signal: 'retrieval_empty' }], set: { 'data.needsHumanReview': 'yes' } } },
      /needsReview\.set value for "data\.needsHumanReview"/,
    ],
    [
      'reasonsPath',
      { needsReview: { when: [{ signal: 'retrieval_empty' }], reasonsPath: 'data.overall' } },
      /needsReview\.reasonsPath "data\.overall" must address an array/,
    ],
    [
      'missing reasonsPath',
      { needsReview: { when: [{ signal: 'retrieval_empty' }], reasonsPath: 'data.reasons' } },
      /needsReview\.reasonsPath path "data\.reasons" cannot exist/,
    ],
  ])('rejects an invalid %s naming the agent and rule', (_label, outcomes, message) => {
    const rule = { id: 'abstain', kind: 'abstain_or_review', ...outcomes } as IntegrityRuleInput
    expect(() => register([rule])).toThrow(/^\[internal\] agent "test\.integrity_agent_\d+" integrity rule "abstain"/)
    expect(() => register([rule])).toThrow(message)
  })
})
