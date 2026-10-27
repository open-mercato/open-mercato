import { z } from 'zod'
import { integrityRuleSchema, type GuardrailCheck, type IntegrityRule } from '../data/validators'
import { GuardrailService, GUARDRAIL_SET_VERSION, type CheckOutputArgs } from '../lib/guardrails/guardrailService'
import {
  INTEGRITY_REPAIR_INVALID,
  INTEGRITY_RULE_UNSUPPORTED,
  normalizeToolName,
  runOutputPipeline,
  type IntegrityRuleEvaluators,
  type OutputPipelineArgs,
} from '../lib/guardrails/integrity/pipeline'
import type { IntegrityRuleContext, IntegrityRuleOutcome } from '../lib/guardrails/integrity/types'

const CONTENT = 'The supplier shall deliver within 30 days. Late delivery incurs a penalty of 2% per week.'

const schema = z.object({
  kind: z.literal('research'),
  data: z.object({
    findings: z.array(z.object({ id: z.string(), evidence: z.array(z.object({ quote: z.string() })) })),
  }),
})

function quoteRule(id: string, overrides: Record<string, unknown> = {}): IntegrityRule {
  return integrityRuleSchema.parse({
    id,
    kind: 'evidence_quote',
    items: 'data.findings[*].evidence[*]',
    quote: 'quote',
    source: { input: 'content' },
    ...overrides,
  })
}

function envelope(quotes: string[]): z.infer<typeof schema> {
  return { kind: 'research', data: { findings: [{ id: 'finding-1', evidence: quotes.map((quote) => ({ quote })) }] } }
}

function check(kind: GuardrailCheck['kind'], result: GuardrailCheck['result'], ruleId: string): GuardrailCheck {
  return { kind, result, guardrailSetVersion: 'i1-test', evidence: { ruleId } }
}

function buildArgs(overrides: Partial<OutputPipelineArgs> = {}): OutputPipelineArgs {
  return {
    entry: { schema, integrity: [quoteRule('quotes')] },
    rawObject: envelope(['deliver within 30 days']),
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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((child) => deepFreeze(child))
    Object.freeze(value)
  }
  return value
}

describe('runOutputPipeline', () => {
  it('passes a clean output through unchanged with schema, integrity and tool_scope checks', async () => {
    const rawObject = envelope(['deliver within 30 days'])
    const result = await runOutputPipeline(buildArgs({ rawObject }))
    expect(result.verdict.result).toBe('pass')
    expect(result.verdict.checks.map((entry) => entry.kind)).toEqual(['schema', 'evidence_quote', 'tool_scope'])
    expect(result.changed).toBe(false)
    expect(result.finalOutput).toBe(rawObject)
    expect(result.rawOutput).toBe(rawObject)
  })

  it('returns the dropped output as the final output and keeps the raw output intact', async () => {
    const rawObject = deepFreeze(envelope(['deliver within 30 days', 'free shipping forever']))
    const result = await runOutputPipeline(buildArgs({ rawObject }))
    expect(result.changed).toBe(true)
    expect(result.rawOutput).toBe(rawObject)
    expect(result.finalOutput).toEqual(envelope(['deliver within 30 days']))
    expect(rawObject.data.findings[0].evidence).toHaveLength(2)
    const integrityCheck = result.verdict.checks.find((entry) => entry.kind === 'evidence_quote')
    expect(integrityCheck?.guardrailSetVersion).toBe('i1-test')
    expect(result.verdict.result).toBe('warn')
  })

  it('runs rules in declaration order, each on the previous output, without mutating it', async () => {
    const seen: string[] = []
    const outputs: unknown[] = []
    const receivedIds: string[] = []
    const evaluators: IntegrityRuleEvaluators = {
      evidence_quote: (ctx: IntegrityRuleContext, rule): IntegrityRuleOutcome => {
        seen.push(rule.id)
        outputs.push(ctx.output)
        const next = ctx.output as z.infer<typeof schema>
        receivedIds.push(next.data.findings[0].id)
        next.data.findings[0].id = `${next.data.findings[0].id}+${rule.id}`
        return { output: next, check: check('evidence_quote', 'pass', rule.id), changed: true, blocked: false }
      },
    }
    const rawObject = deepFreeze(envelope(['deliver within 30 days']))
    const result = await runOutputPipeline(
      buildArgs({ rawObject, entry: { schema, integrity: [quoteRule('first'), quoteRule('second')] }, evaluators }),
    )
    expect(seen).toEqual(['first', 'second'])
    expect(outputs[0]).not.toBe(rawObject)
    expect(receivedIds).toEqual(['finding-1', 'finding-1+first'])
    expect(outputs[1]).not.toBe(outputs[0])
    expect((result.finalOutput as z.infer<typeof schema>).data.findings[0].id).toBe('finding-1+first+second')
    expect(rawObject.data.findings[0].id).toBe('finding-1')
  })

  it('blocks on a schema-invalid raw object before any integrity rule runs', async () => {
    const evaluate = jest.fn()
    const result = await runOutputPipeline(
      buildArgs({ rawObject: { kind: 'research' }, evaluators: { evidence_quote: evaluate } }),
    )
    expect(evaluate).not.toHaveBeenCalled()
    expect(result.verdict.result).toBe('block')
    expect(result.verdict.blockedReason).toEqual({ phase: 'output', kind: 'schema' })
    expect(result.verdict.checks.map((entry) => entry.kind)).toEqual(['schema'])
  })

  it('stops at a blocking rule and skips later rules, grounding and tool_scope', async () => {
    const service = new GuardrailService({} as never)
    const checkOutput = jest.spyOn(service, 'checkOutput')
    const evaluated: string[] = []
    const evaluators: IntegrityRuleEvaluators = {
      evidence_quote: (ctx: IntegrityRuleContext, rule): IntegrityRuleOutcome => {
        evaluated.push(rule.id)
        return { output: ctx.output, check: check('evidence_quote', 'block', rule.id), changed: false, blocked: true }
      },
    }
    const rawObject = envelope(['deliver within 30 days'])
    const result = await runOutputPipeline(
      buildArgs({
        rawObject,
        guardrailService: service,
        entry: { schema, integrity: [quoteRule('first'), quoteRule('second')] },
        evaluators,
      }),
    )
    expect(evaluated).toEqual(['first'])
    expect(checkOutput).toHaveBeenCalledTimes(1)
    expect(result.verdict.result).toBe('block')
    expect(result.verdict.blockedReason).toEqual({ phase: 'output', kind: 'evidence_quote' })
    expect(result.verdict.checks.map((entry) => entry.kind)).toEqual(['schema', 'evidence_quote'])
    expect(result.finalOutput).toBe(rawObject)
  })

  it('blocks a repair that breaks the schema with integrity_repair_invalid', async () => {
    const evaluators: IntegrityRuleEvaluators = {
      evidence_quote: (ctx: IntegrityRuleContext, rule): IntegrityRuleOutcome => ({
        output: { kind: 'research', data: { findings: 'broken' } },
        check: check('evidence_quote', 'warn', rule.id),
        changed: true,
        blocked: false,
      }),
    }
    const result = await runOutputPipeline(buildArgs({ evaluators }))
    expect(result.verdict.result).toBe('block')
    expect(result.verdict.blockedReason).toEqual({ phase: 'output', kind: 'schema' })
    const repairCheck = result.verdict.checks[result.verdict.checks.length - 1]
    expect(repairCheck).toEqual({
      kind: 'schema',
      result: 'block',
      guardrailSetVersion: GUARDRAIL_SET_VERSION,
      evidence: { detail: INTEGRITY_REPAIR_INVALID },
    })
    expect(result.verdict.checks.some((entry) => entry.kind === 'tool_scope')).toBe(false)
  })

  it('fails closed on a rule kind without an evaluator', async () => {
    const rule = integrityRuleSchema.parse({ id: 'custom-1', kind: 'custom', checker: 'missing', onViolation: 'flag' })
    const result = await runOutputPipeline(buildArgs({ entry: { schema, integrity: [rule] } }))
    expect(result.verdict.blockedReason).toEqual({ phase: 'output', kind: 'custom_integrity' })
    expect(result.verdict.checks[1].evidence).toEqual({ ruleId: 'custom-1', detail: INTEGRITY_RULE_UNSUPPORTED })
  })

  it('runs tool_scope and grounding on the final output with the attempted tools', async () => {
    const service = new GuardrailService({} as never)
    const checkOutput = jest.spyOn(service, 'checkOutput')
    const rawObject = envelope(['deliver within 30 days', 'free shipping forever'])
    const result = await runOutputPipeline(
      buildArgs({
        rawObject,
        guardrailService: service,
        attemptedTools: [{ name: 'customers.update_deal', isMutation: true }],
      }),
    )
    expect(checkOutput).toHaveBeenCalledTimes(2)
    const finalCall = checkOutput.mock.calls[1][0] as CheckOutputArgs
    expect(finalCall.output).toEqual(result.finalOutput)
    expect(finalCall.attemptedTools).toEqual([{ name: 'customers.update_deal', isMutation: true }])
    expect(finalCall.allowedTools).toEqual(['customers.get_deal'])
    expect(result.verdict.result).toBe('block')
    expect(result.verdict.blockedReason).toEqual({ phase: 'output', kind: 'tool_scope' })
    expect(result.verdict.checks.map((entry) => entry.kind)).toEqual(['schema', 'evidence_quote', 'tool_scope'])
  })

  it('combines the checks so the worst result wins', async () => {
    const evaluators: IntegrityRuleEvaluators = {
      evidence_quote: (ctx: IntegrityRuleContext, rule): IntegrityRuleOutcome => ({
        output: ctx.output,
        check: check('evidence_quote', rule.id === 'flagging' ? 'warn' : 'pass', rule.id),
        changed: false,
        blocked: false,
      }),
    }
    const result = await runOutputPipeline(
      buildArgs({ entry: { schema, integrity: [quoteRule('clean'), quoteRule('flagging')] }, evaluators }),
    )
    expect(result.verdict.result).toBe('warn')
    expect(result.verdict.blockedReason).toBeUndefined()
  })

  it('normalizes model-safe tool names back to registry ids', () => {
    expect(normalizeToolName('customers__get_deal')).toBe('customers.get_deal')
    expect(normalizeToolName('customers.get_deal')).toBe('customers.get_deal')
  })
})
