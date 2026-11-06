import { z } from 'zod'
import {
  integrityEvidenceSchema,
  integrityRuleSchema,
  type AbstainOrReviewRule,
  type GuardrailCheck,
  type IntegrityRule,
  type IntegrityRuleInput,
} from '../data/validators'
import { GuardrailService } from '../lib/guardrails/guardrailService'
import {
  INTEGRITY_REPAIR_INVALID,
  INTEGRITY_RULE_EVALUATORS,
  runOutputPipeline,
  type OutputPipelineArgs,
} from '../lib/guardrails/integrity/pipeline'
import { evaluateAbstainOrReview } from '../lib/guardrails/integrity/rules/abstainOrReview'
import type { IntegrityRuleContext } from '../lib/guardrails/integrity/types'

const CONTENT = 'The supplier shall deliver within 30 days. Late delivery incurs a penalty of 2% per week.'

const schema = z.object({
  kind: z.literal('research'),
  data: z.object({
    findings: z.array(z.object({ id: z.string(), evidence: z.array(z.object({ quote: z.string() })) })),
    overall: z.enum(['ok', 'not_applicable']).optional(),
    confidence: z.number().optional(),
    needsHumanReview: z.boolean().optional(),
    reviewReasons: z.array(z.string()).optional(),
  }),
})

type Envelope = z.infer<typeof schema>

function envelope(quotes: string[], extra: Partial<Envelope['data']> = {}): Envelope {
  return {
    kind: 'research',
    data: { findings: quotes.length > 0 ? [{ id: 'finding-1', evidence: quotes.map((quote) => ({ quote })) }] : [], ...extra },
  }
}

function abstainRule(overrides: Partial<IntegrityRuleInput> = {}): AbstainOrReviewRule {
  const parsed = integrityRuleSchema.parse({
    id: 'abstain',
    kind: 'abstain_or_review',
    notApplicable: { when: [{ signal: 'output_empty', path: 'data.findings' }], set: { 'data.overall': 'not_applicable' } },
    needsReview: {
      when: [{ signal: 'confidence_below', path: 'data.confidence', threshold: 0.6 }],
      set: { 'data.needsHumanReview': true },
      reasonsPath: 'data.reviewReasons',
    },
    ...overrides,
  })
  if (parsed.kind !== 'abstain_or_review') throw new Error('[internal] expected abstain_or_review')
  return parsed
}

function reviewOnly(when: unknown[]): AbstainOrReviewRule {
  return abstainRule({ notApplicable: undefined, needsReview: { when, reasonsPath: 'data.reviewReasons' } } as Partial<IntegrityRuleInput>)
}

function priorCheck(ruleId: string, counts: { items: number; dropped: number; violations: number }): GuardrailCheck {
  return {
    kind: 'evidence_quote',
    result: 'warn',
    guardrailSetVersion: 'i1-test',
    evidence: {
      ruleId,
      items: counts.items,
      violations: Array.from({ length: counts.violations }, (_, index) => ({ itemPath: `data.findings[${index}]`, reason: 'not_found' })),
      dropped: counts.dropped,
    },
  }
}

function context(output: unknown, overrides: Partial<IntegrityRuleContext> = {}): IntegrityRuleContext {
  return { output, input: { content: CONTENT }, toolCalls: [], guardrailSetVersion: 'i1-test', ...overrides }
}

describe('evaluateAbstainOrReview', () => {
  it('passes with no outcome when no signal fires', () => {
    const output = envelope(['deliver within 30 days'], { confidence: 0.9 })
    const outcome = evaluateAbstainOrReview(context(output), abstainRule())
    expect(outcome.check.result).toBe('pass')
    expect(outcome.check.evidence).toMatchObject({ ruleId: 'abstain', outcome: 'none' })
    expect(outcome.changed).toBe(false)
    expect(outcome.output).toBe(output)
    expect(outcome.reviewRequest).toBeUndefined()
  })

  it('records not applicable as a pass and writes its set without mutating the input', () => {
    const output = Object.freeze(envelope([], { confidence: 0.9 }))
    const outcome = evaluateAbstainOrReview(context(output), abstainRule())
    expect(outcome.check.result).toBe('pass')
    expect(outcome.check.evidence).toMatchObject({ outcome: 'not_applicable', reasons: ['output_empty'] })
    expect(outcome.check.evidence?.holdsAutoApproval).toBeUndefined()
    expect(outcome.changed).toBe(true)
    expect((outcome.output as Envelope).data.overall).toBe('not_applicable')
    expect(output.data.overall).toBeUndefined()
    expect(outcome.reviewRequest).toBeUndefined()
    expect(integrityEvidenceSchema.safeParse(outcome.check.evidence).success).toBe(true)
  })

  it('records needs review as a warn that holds auto-approval and writes reason codes', () => {
    const output = envelope(['deliver within 30 days'], { confidence: 0.2 })
    const outcome = evaluateAbstainOrReview(context(output), abstainRule())
    expect(outcome.check.result).toBe('warn')
    expect(outcome.check.evidence).toMatchObject({
      outcome: 'needs_review',
      reasons: ['confidence_below'],
      route: 'flag',
      holdsAutoApproval: true,
    })
    expect((outcome.output as Envelope).data).toMatchObject({ needsHumanReview: true, reviewReasons: ['confidence_below'] })
    expect(outcome.reviewRequest).toEqual({ ruleId: 'abstain', route: 'flag', reasons: ['confidence_below'] })
    expect(integrityEvidenceSchema.safeParse(outcome.check.evidence).success).toBe(true)
  })

  it('prefers needs review over not applicable when both fire', () => {
    const outcome = evaluateAbstainOrReview(context(envelope([], { confidence: 0.1 })), abstainRule())
    expect(outcome.check.evidence?.outcome).toBe('needs_review')
    expect((outcome.output as Envelope).data.overall).toBeUndefined()
  })

  it('carries the review route', () => {
    const rule = abstainRule({
      notApplicable: undefined,
      needsReview: { when: [{ signal: 'retrieval_empty' }], route: 'review' },
    } as Partial<IntegrityRuleInput>)
    const outcome = evaluateAbstainOrReview(context(envelope(['x'])), rule)
    expect(outcome.reviewRequest).toEqual({ ruleId: 'abstain', route: 'review', reasons: ['retrieval_empty'] })
    expect(outcome.changed).toBe(false)
  })

  it('counts violations of earlier rules, optionally scoped to named rules', () => {
    const priorChecks = [priorCheck('quotes', { items: 3, dropped: 1, violations: 1 }), priorCheck('ids', { items: 2, dropped: 0, violations: 2 })]
    const output = envelope(['x'])
    const all = evaluateAbstainOrReview(context(output, { priorChecks }), reviewOnly([{ signal: 'violations_at_least', count: 3 }]))
    expect(all.check.evidence?.reasons).toEqual(['violations_at_least', 'quotes', 'ids'])
    const scoped = evaluateAbstainOrReview(
      context(output, { priorChecks }),
      reviewOnly([{ signal: 'violations_at_least', count: 2, rules: ['quotes'] }]),
    )
    expect(scoped.check.evidence?.outcome).toBe('none')
    const dropsBeyondList = evaluateAbstainOrReview(
      context(output, { priorChecks: [priorCheck('quotes', { items: 30, dropped: 25, violations: 20 })] }),
      reviewOnly([{ signal: 'violations_at_least', count: 25 }]),
    )
    expect(dropsBeyondList.check.evidence?.outcome).toBe('needs_review')
  })

  it('fires integrity_dropped_all only when the named rule dropped every item it examined', () => {
    const rule = reviewOnly([{ signal: 'integrity_dropped_all', rule: 'quotes' }])
    const output = envelope([])
    const droppedAll = evaluateAbstainOrReview(
      context(output, { priorChecks: [priorCheck('quotes', { items: 2, dropped: 2, violations: 2 })] }),
      rule,
    )
    expect(droppedAll.check.evidence?.reasons).toEqual(['integrity_dropped_all', 'quotes'])
    const partial = evaluateAbstainOrReview(context(output, { priorChecks: [priorCheck('quotes', { items: 2, dropped: 1, violations: 1 })] }), rule)
    expect(partial.check.evidence?.outcome).toBe('none')
    const nothingExamined = evaluateAbstainOrReview(context(output, { priorChecks: [priorCheck('quotes', { items: 0, dropped: 0, violations: 0 })] }), rule)
    expect(nothingExamined.check.evidence?.outcome).toBe('none')
  })

  it('fires tool_returned_empty when every call of the tool returned nothing', () => {
    const rule = reviewOnly([{ signal: 'tool_returned_empty', tool: 'acme.retrieve_rules' }])
    const output = envelope(['x'])
    const fired = (toolCalls: IntegrityRuleContext['toolCalls']) =>
      evaluateAbstainOrReview(context(output, { toolCalls }), rule).check.evidence?.outcome === 'needs_review'
    expect(fired([])).toBe(false)
    expect(fired([{ toolName: 'acme__retrieve_rules', args: {}, result: { items: [] } }])).toBe(true)
    expect(fired([{ toolName: 'acme.retrieve_rules', args: {}, result: '{"found":false}' }])).toBe(true)
    expect(fired([{ toolName: 'acme.retrieve_rules', args: {}, result: { items: [{ id: 'r1' }] }, error: undefined }])).toBe(false)
    expect(
      fired([
        { toolName: 'acme.retrieve_rules', args: {}, result: null, error: 'timeout' },
        { toolName: 'acme.retrieve_rules', args: {}, result: [] },
      ]),
    ).toBe(true)
    expect(fired([{ toolName: 'acme.other', args: {}, result: [] }])).toBe(false)
  })

  it('fires retrieval_empty only without citable sources', () => {
    const rule = reviewOnly([{ signal: 'retrieval_empty' }])
    const output = envelope(['x'])
    expect(evaluateAbstainOrReview(context(output), rule).check.evidence?.outcome).toBe('needs_review')
    const withSources = context(output, { citableSources: [{ sourceKind: 'retrieval', sourceRef: 'doc-1', locator: 'p1', score: 0.9 }] })
    expect(evaluateAbstainOrReview(withSources, rule).check.evidence?.outcome).toBe('none')
  })

  it('fires output_flag only on a literal true', () => {
    const rule = reviewOnly([{ signal: 'output_flag', path: 'data.needsHumanReview' }])
    expect(evaluateAbstainOrReview(context(envelope(['x'], { needsHumanReview: true })), rule).check.evidence?.outcome).toBe('needs_review')
    expect(evaluateAbstainOrReview(context(envelope(['x'], { needsHumanReview: false })), rule).check.evidence?.outcome).toBe('none')
  })

  it('blocks when a set path cannot be written', () => {
    const rule = abstainRule({ notApplicable: { when: [{ signal: 'retrieval_empty' }], set: { 'data.meta.flag': true } } } as Partial<IntegrityRuleInput>)
    const output = envelope(['x'], { confidence: 0.9 })
    const outcome = evaluateAbstainOrReview(context(output), rule)
    expect(outcome.blocked).toBe(true)
    expect(outcome.check.result).toBe('block')
    expect(outcome.check.evidence).toMatchObject({ outcome: 'not_applicable', detail: INTEGRITY_REPAIR_INVALID })
    expect(outcome.output).toBe(output)
  })
})

function quoteRule(): IntegrityRule {
  return integrityRuleSchema.parse({
    id: 'quotes',
    kind: 'evidence_quote',
    items: 'data.findings[*].evidence[*]',
    quote: 'quote',
    source: { input: 'content' },
  })
}

function droppedAllAbstain(): IntegrityRule {
  return integrityRuleSchema.parse({
    id: 'abstain',
    kind: 'abstain_or_review',
    needsReview: {
      when: [{ signal: 'integrity_dropped_all', rule: 'quotes' }],
      set: { 'data.needsHumanReview': true },
      reasonsPath: 'data.reviewReasons',
      route: 'review',
    },
  })
}

function buildArgs(overrides: Partial<OutputPipelineArgs> = {}): OutputPipelineArgs {
  return {
    entry: { schema, integrity: [quoteRule(), droppedAllAbstain()] },
    rawObject: envelope(['invented quote one', 'invented quote two']),
    input: { content: CONTENT },
    toolCalls: [],
    guardrailService: new GuardrailService({} as never),
    capability: 'test.agent',
    allowedTools: ['customers.get_deal'],
    attemptedTools: [],
    guardrailSetVersion: 'i1-test',
    ...overrides,
  }
}

describe('runOutputPipeline with abstain_or_review', () => {
  it('turns all-invented evidence into a structured needs_review after grounding', async () => {
    const result = await runOutputPipeline(buildArgs())
    expect(result.verdict.result).toBe('warn')
    expect(result.verdict.checks.map((entry) => entry.kind)).toEqual(['schema', 'evidence_quote', 'abstain_or_review', 'tool_scope'])
    expect(result.finalOutput).toEqual({
      kind: 'research',
      data: { findings: [{ id: 'finding-1', evidence: [] }], needsHumanReview: true, reviewReasons: ['integrity_dropped_all', 'quotes'] },
    })
    expect(result.changed).toBe(true)
    expect(result.changedCheckIndexes).toEqual([1, 2])
    expect(result.verdict.checks[2].evidence).toMatchObject({ outcome: 'needs_review', holdsAutoApproval: true, route: 'review' })
    expect(result.reviewRequest).toEqual({ ruleId: 'abstain', route: 'review', reasons: ['integrity_dropped_all', 'quotes'] })
  })

  it('hands every earlier check, grounding and tool scope included, to the rule', async () => {
    const seen: string[][] = []
    const result = await runOutputPipeline(
      buildArgs({
        rawObject: envelope(['deliver within 30 days']),
        evaluators: {
          ...INTEGRITY_RULE_EVALUATORS,
          abstain_or_review: (ctx, rule) => {
            seen.push((ctx.priorChecks ?? []).map((entry) => entry.kind))
            return evaluateAbstainOrReview(ctx, rule)
          },
        },
      }),
    )
    expect(seen).toEqual([['evidence_quote', 'tool_scope']])
    expect(result.verdict.result).toBe('pass')
    expect(result.changed).toBe(false)
    expect(result.reviewRequest).toBeUndefined()
  })

  it('blocks with integrity_repair_invalid when the written fields break the schema', async () => {
    const abstain = integrityRuleSchema.parse({
      id: 'abstain',
      kind: 'abstain_or_review',
      notApplicable: { when: [{ signal: 'retrieval_empty' }], set: { 'data.overall': 'skipped' } },
    })
    const rawObject = envelope(['deliver within 30 days'])
    const result = await runOutputPipeline(buildArgs({ rawObject, entry: { schema, integrity: [quoteRule(), abstain] } }))
    expect(result.verdict.result).toBe('block')
    expect(result.verdict.checks.at(-1)).toMatchObject({ kind: 'schema', result: 'block', evidence: { detail: INTEGRITY_REPAIR_INVALID } })
    expect(result.verdict.blockedReason).toEqual({ phase: 'output', kind: 'schema' })
    expect(result.reviewRequest).toBeUndefined()
  })

  it('skips the rule when grounding or tool scope already blocked the run', async () => {
    const result = await runOutputPipeline(buildArgs({ attemptedTools: [{ name: 'customers.delete_deal' }] }))
    expect(result.verdict.result).toBe('block')
    expect(result.verdict.checks.map((entry) => entry.kind)).toEqual(['schema', 'evidence_quote', 'tool_scope'])
    expect(result.reviewRequest).toBeUndefined()
  })

  it('records the outcome only under shadow mode', async () => {
    const rawObject = envelope(['invented quote one'])
    const result = await runOutputPipeline(buildArgs({ rawObject, shadow: true }))
    expect(result.finalOutput).toBe(rawObject)
    expect(result.changed).toBe(false)
    expect(result.reviewRequest).toBeUndefined()
    const abstainCheck = result.verdict.checks.find((entry) => entry.kind === 'abstain_or_review')
    expect(abstainCheck?.result).toBe('warn')
    expect(abstainCheck?.evidence).toMatchObject({ outcome: 'needs_review', shadow: true })
    expect(abstainCheck?.evidence?.holdsAutoApproval).toBeUndefined()
  })
})
