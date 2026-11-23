import { z } from 'zod'
import { integrityRuleSchema, toolConsultedRuleSchema, type ToolConsultedRule } from '../data/validators'
import { GuardrailService } from '../lib/guardrails/guardrailService'
import { runOutputPipeline } from '../lib/guardrails/integrity/pipeline'
import {
  buildToolConsultedPrepareStep,
  collectEnforcedToolSets,
  evaluateToolConsulted,
} from '../lib/guardrails/integrity/rules/toolConsulted'
import type { IntegrityRuleContext, IntegrityToolCall } from '../lib/guardrails/integrity/types'

function buildRule(overrides: Record<string, unknown> = {}): ToolConsultedRule {
  return toolConsultedRuleSchema.parse({
    id: 'rules-read',
    kind: 'tool_consulted',
    cites: 'findings[*].ruleId',
    tools: ['acme.get_rule'],
    returned: ['id'],
    ...overrides,
  })
}

function buildContext(
  output: unknown,
  toolCalls: IntegrityToolCall[],
  subRunToolCalls?: IntegrityToolCall[],
): IntegrityRuleContext {
  return {
    output,
    input: {},
    toolCalls,
    ...(subRunToolCalls ? { subRunToolCalls } : {}),
    guardrailSetVersion: 'i1-test',
  }
}

function findings(ruleIds: unknown[]): { findings: Array<{ title: string; ruleId: unknown }> } {
  return { findings: ruleIds.map((ruleId, index) => ({ title: `finding-${index}`, ruleId })) }
}

function getRule(id: string, result: unknown = { id }): IntegrityToolCall {
  return { toolName: 'acme.get_rule', args: { id }, result }
}

describe('tool_consulted rule', () => {
  it('passes when a successful call returned the cited value at a returned path', () => {
    const outcome = evaluateToolConsulted(buildContext(findings(['R1']), [getRule('R1')]), buildRule())
    expect(outcome.check).toMatchObject({ kind: 'tool_consulted', result: 'pass', guardrailSetVersion: 'i1-test' })
    expect(outcome.check.evidence).toMatchObject({ ruleId: 'rules-read', items: 1, violations: [], dropped: 0 })
    expect(outcome.changed).toBe(false)
  })

  it('reads wildcard returned paths inside the tool result', () => {
    const rule = buildRule({ returned: ['items[*].id'] })
    const call: IntegrityToolCall = {
      toolName: 'acme.get_rule',
      args: {},
      result: { items: [{ id: 'R1' }, { id: 'R2' }] },
    }
    const outcome = evaluateToolConsulted(buildContext(findings(['R1', 'R2']), [call]), rule)
    expect(outcome.check.result).toBe('pass')
  })

  it('accepts a JSON-string tool result', () => {
    const call: IntegrityToolCall = { toolName: 'acme.get_rule', args: {}, result: JSON.stringify({ id: 'R1' }) }
    const outcome = evaluateToolConsulted(buildContext(findings(['R1']), [call]), buildRule())
    expect(outcome.check.result).toBe('pass')
  })

  it('a value the tool did not return is flagged', () => {
    const outcome = evaluateToolConsulted(buildContext(findings(['R1', 'R9']), [getRule('R1')]), buildRule())
    expect(outcome.check.result).toBe('warn')
    expect(outcome.check.evidence).toMatchObject({
      violations: [{ itemPath: 'findings[1].ruleId', reason: 'not_consulted' }],
      holdsAutoApproval: true,
    })
    expect(outcome.output).toEqual(findings(['R1', 'R9']))
  })

  it('with matchArgs a call whose arguments named the value and returned something counts', () => {
    const rule = buildRule({ returned: [], matchArgs: true })
    const call: IntegrityToolCall = { toolName: 'acme.get_rule', args: { filter: { ids: ['R1'] } }, result: { title: 'Rule' } }
    const outcome = evaluateToolConsulted(buildContext(findings(['R1']), [call]), rule)
    expect(outcome.check.result).toBe('pass')
  })

  it('with matchArgs an empty result never counts', () => {
    const rule = buildRule({ returned: [], matchArgs: true })
    const emptyResults: unknown[] = [null, {}, [], '']
    for (const result of emptyResults) {
      const call: IntegrityToolCall = { toolName: 'acme.get_rule', args: { id: 'R1' }, result }
      expect(evaluateToolConsulted(buildContext(findings(['R1']), [call]), rule).check.result).toBe('warn')
    }
  })

  it('ignores failed calls even when their result carried the value', () => {
    const failed: IntegrityToolCall = { ...getRule('R1'), error: 'tool_failed' }
    const outcome = evaluateToolConsulted(buildContext(findings(['R1']), [failed]), buildRule({ matchArgs: true }))
    expect(outcome.check.result).toBe('warn')
  })

  it('ignores { found: false } results on both the returned and the args path', () => {
    const notFound = getRule('R1', { id: 'R1', found: false })
    const outcome = evaluateToolConsulted(buildContext(findings(['R1']), [notFound]), buildRule({ matchArgs: true }))
    expect(outcome.check.result).toBe('warn')
  })

  it('normalises model-safe tool names (a__b ≡ a.b) on both sides', () => {
    const modelSafeCall: IntegrityToolCall = { ...getRule('R1'), toolName: 'acme__get_rule' }
    expect(evaluateToolConsulted(buildContext(findings(['R1']), [modelSafeCall]), buildRule()).check.result).toBe('pass')
    const modelSafeRule = buildRule({ tools: ['acme__get_rule'] })
    expect(evaluateToolConsulted(buildContext(findings(['R1']), [getRule('R1')]), modelSafeRule).check.result).toBe('pass')
  })

  it('ignores calls to tools outside the rule', () => {
    const other: IntegrityToolCall = { ...getRule('R1'), toolName: 'acme.search' }
    expect(evaluateToolConsulted(buildContext(findings(['R1']), [other]), buildRule()).check.result).toBe('warn')
  })

  it('compares numbers and strings as strings', () => {
    const numericCall = getRule('42', { id: 42 })
    expect(evaluateToolConsulted(buildContext(findings(['42']), [numericCall]), buildRule()).check.result).toBe('pass')
    expect(evaluateToolConsulted(buildContext(findings([42]), [getRule('42')]), buildRule()).check.result).toBe('pass')
  })

  it('flattens cited arrays and reports each element path', () => {
    const rule = buildRule({ cites: 'findings[*].ruleIds' })
    const output = { findings: [{ ruleIds: ['R1', 'R2'] }] }
    const outcome = evaluateToolConsulted(buildContext(output, [getRule('R1')]), rule)
    expect(outcome.check.evidence).toMatchObject({
      items: 2,
      violations: [{ itemPath: 'findings[0].ruleIds[1]', reason: 'not_consulted' }],
    })
  })

  it('drop removes the nearest enclosing array item', () => {
    const outcome = evaluateToolConsulted(
      buildContext(findings(['R1', 'R9', 'R2']), [getRule('R1'), getRule('R2')]),
      buildRule({ onViolation: 'drop' }),
    )
    expect(outcome.changed).toBe(true)
    expect(outcome.output).toEqual({
      findings: [
        { title: 'finding-0', ruleId: 'R1' },
        { title: 'finding-2', ruleId: 'R2' },
      ],
    })
    expect(outcome.check.result).toBe('warn')
    expect(outcome.check.evidence).toMatchObject({ dropped: 1 })
    expect(outcome.check.evidence).not.toHaveProperty('holdsAutoApproval')
  })

  it('block stops the run and keeps the output', () => {
    const output = findings(['R9'])
    const outcome = evaluateToolConsulted(buildContext(output, []), buildRule({ onViolation: 'block' }))
    expect(outcome.blocked).toBe(true)
    expect(outcome.check.result).toBe('block')
    expect(outcome.output).toBe(output)
  })

  it('redacts evidence: no cited values, capped violations', () => {
    const cited = Array.from({ length: 30 }, (_, index) => `secret-${index}`)
    const outcome = evaluateToolConsulted(buildContext(findings(cited), []), buildRule())
    const serialized = JSON.stringify(outcome.check.evidence)
    expect(serialized).not.toContain('secret-')
    expect((outcome.check.evidence as { violations: unknown[] }).violations).toHaveLength(20)
    expect(outcome.check.evidence).toMatchObject({ items: 30 })
  })

  it('counts sub-run tool calls only with includeSubRuns', () => {
    const context = buildContext(findings(['R1']), [], [getRule('R1')])
    expect(evaluateToolConsulted(context, buildRule()).check.result).toBe('warn')
    expect(evaluateToolConsulted(context, buildRule({ includeSubRuns: true })).check.result).toBe('pass')
  })

  it('treats missing sub-run calls as absent when includeSubRuns is set', () => {
    const outcome = evaluateToolConsulted(buildContext(findings(['R1']), []), buildRule({ includeSubRuns: true }))
    expect(outcome.check.result).toBe('warn')
  })

  it('runs through the output pipeline as a registered kind', async () => {
    const schema = z.object({ findings: z.array(z.object({ title: z.string(), ruleId: z.string() })) })
    const guardrailService = new GuardrailService({ resolve: () => undefined } as never)
    const outcome = await runOutputPipeline({
      entry: { schema, integrity: [buildRule({ onViolation: 'drop' })] },
      rawObject: findings(['R1', 'R9']),
      input: {},
      toolCalls: [getRule('R1')],
      guardrailService,
      capability: 'acme.agent',
      attemptedTools: [],
      guardrailSetVersion: 'i1-test',
    })
    const check = outcome.verdict.checks.find((entry) => entry.kind === 'tool_consulted')
    expect(check?.result).toBe('warn')
    expect(check?.evidence).not.toHaveProperty('detail', 'integrity_rule_unsupported')
    expect(outcome.finalOutput).toEqual({ findings: [{ title: 'finding-0', ruleId: 'R1' }] })
  })
})

describe('tool_consulted prepare-step enforcement', () => {
  it('collects only the tool sets of rules that declare enforce: prepare_step', () => {
    const rules = [
      integrityRuleSchema.parse({ id: 'a', kind: 'tool_consulted', cites: 'x', tools: ['acme__get_rule'], returned: ['id'], enforce: 'prepare_step' }),
      integrityRuleSchema.parse({ id: 'b', kind: 'tool_consulted', cites: 'x', tools: ['acme.other'], returned: ['id'] }),
    ]
    expect(collectEnforcedToolSets(rules)).toEqual([new Set(['acme.get_rule'])])
  })

  it('forces toolChoice required until a matching call succeeded, then releases', () => {
    const toolCalls: IntegrityToolCall[] = []
    const prepareStep = buildToolConsultedPrepareStep([new Set(['acme.get_rule'])], () => toolCalls)
    expect(prepareStep()).toEqual({ toolChoice: 'required' })
    toolCalls.push({ toolName: 'acme.search', args: {}, result: { hits: [] } })
    expect(prepareStep()).toEqual({ toolChoice: 'required' })
    toolCalls.push({ toolName: 'acme__get_rule', args: {}, result: null, error: 'tool_failed' })
    expect(prepareStep()).toEqual({ toolChoice: 'required' })
    toolCalls.push({ toolName: 'acme__get_rule', args: { id: 'R1' }, result: { id: 'R1' } })
    expect(prepareStep()).toBeUndefined()
  })

  it('keeps forcing while any enforcing rule is unsatisfied', () => {
    const toolCalls: IntegrityToolCall[] = [{ toolName: 'acme.get_rule', args: {}, result: { id: 'R1' } }]
    const prepareStep = buildToolConsultedPrepareStep(
      [new Set(['acme.get_rule']), new Set(['acme.get_policy'])],
      () => toolCalls,
    )
    expect(prepareStep()).toEqual({ toolChoice: 'required' })
    toolCalls.push({ toolName: 'acme.get_policy', args: {}, result: { id: 'P1' } })
    expect(prepareStep()).toBeUndefined()
  })
})
