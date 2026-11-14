import { describe, it, expect } from '@jest/globals'
import { getScorerDefinition, parseScorerConfig, runScorer } from '../lib/eval/registry'
import { projectRunView } from '../lib/eval/projectRunView'
import type { ScorerGuardrailCheckView, ScorerRunView } from '../lib/eval/types'
import type { AgentGuardrailCheck, AgentRun } from '../data/entities'

function runView(guardrailChecks: ScorerGuardrailCheckView[]): ScorerRunView {
  return {
    input: null,
    output: { answer: 'ok' },
    resultKind: 'research',
    agentType: 'researcher',
    confidence: 0.9,
    status: 'completed',
    latencyMs: null,
    costMinor: null,
    inputTokens: null,
    outputTokens: null,
    toolCalls: [],
    stepCount: 0,
    disposition: null,
    guardrailChecks,
  }
}

function check(overrides: Partial<ScorerGuardrailCheckView> = {}): ScorerGuardrailCheckView {
  return { kind: 'evidence_quote', phase: 'output', result: 'pass', ruleId: 'quotes', outcome: null, ...overrides }
}

describe('guardrail_check scorer', () => {
  it('is a deterministic agent-group scorer with kind, ruleId and expect fields', () => {
    const definition = getScorerDefinition('guardrail_check')
    expect(definition?.kind).toBe('deterministic')
    expect(definition?.group).toBe('agent')
    expect(definition?.fields.map((field) => field.name)).toEqual(['kind', 'ruleId', 'expect'])
  })

  it('treats a run view without guardrailChecks as having no checks', () => {
    const { guardrailChecks: _omitted, ...legacyView } = runView([])
    const verdict = runScorer('guardrail_check', legacyView, null, { ruleId: 'quotes', expect: 'pass' })
    expect(verdict).toMatchObject({ passed: false })
  })

  it('passes when the target check result matches the expectation', () => {
    const verdict = runScorer('guardrail_check', runView([check()]), null, { ruleId: 'quotes', expect: 'pass' })
    expect(verdict).toMatchObject({ passed: true, score: 1 })
  })

  it('fails when the target check result differs', () => {
    const verdict = runScorer('guardrail_check', runView([check({ result: 'warn' })]), null, {
      kind: 'evidence_quote',
      expect: 'pass',
    })
    expect(verdict.passed).toBe(false)
    expect(verdict.score).toBe(0)
    expect(verdict.evidence).toMatchObject({ matched: 1, failing: [{ result: 'warn', ruleId: 'quotes' }] })
  })

  it('treats not_block as anything short of a block', () => {
    const view = runView([check({ result: 'warn' })])
    expect(runScorer('guardrail_check', view, null, { ruleId: 'quotes', expect: 'not_block' }).passed).toBe(true)
    const blocked = runView([check({ result: 'block' })])
    expect(runScorer('guardrail_check', blocked, null, { ruleId: 'quotes', expect: 'not_block' }).passed).toBe(false)
    expect(runScorer('guardrail_check', blocked, null, { ruleId: 'quotes', expect: 'block' }).passed).toBe(true)
  })

  it('matches the abstain_or_review outcome with outcome:<value>', () => {
    const view = runView([check({ kind: 'abstain_or_review', ruleId: 'abstain', outcome: 'not_applicable' })])
    expect(runScorer('guardrail_check', view, null, { kind: 'abstain_or_review', expect: 'outcome:not_applicable' }).passed).toBe(true)
    expect(runScorer('guardrail_check', view, null, { ruleId: 'abstain', expect: 'outcome:needs_review' }).passed).toBe(false)
  })

  it('narrows by kind and ruleId together', () => {
    const view = runView([
      check({ ruleId: 'quotes', result: 'pass' }),
      check({ kind: 'reference_exists', ruleId: 'quotes', result: 'block' }),
    ])
    expect(runScorer('guardrail_check', view, null, { kind: 'evidence_quote', ruleId: 'quotes', expect: 'pass' }).passed).toBe(true)
  })

  it('requires every matching check to meet the expectation and scores the fraction', () => {
    const view = runView([check({ ruleId: 'first' }), check({ ruleId: 'second', result: 'block' })])
    const verdict = runScorer('guardrail_check', view, null, { kind: 'evidence_quote', expect: 'pass' })
    expect(verdict).toMatchObject({ passed: false, score: 0.5 })
  })

  it('fails with a clear reason when the target check is missing', () => {
    const verdict = runScorer('guardrail_check', runView([check()]), null, { ruleId: 'other', expect: 'pass' })
    expect(verdict.passed).toBe(false)
    expect(verdict.score).toBe(0)
    expect(verdict.evidence).toMatchObject({ reason: 'target guardrail check not found', target: { ruleId: 'other' } })
  })

  it('skips as an invalid config when neither kind nor ruleId is set', () => {
    const verdict = runScorer('guardrail_check', runView([check()]), null, { expect: 'pass' })
    expect(verdict.passed).toBeNull()
    expect(verdict.evidence).toMatchObject({ reason: 'invalid_config' })
  })

  it('applies negate centrally', () => {
    const verdict = runScorer('guardrail_check', runView([check({ result: 'block' })]), null, {
      ruleId: 'quotes',
      expect: 'pass',
      negate: true,
    })
    expect(verdict.passed).toBe(true)
  })

  it('rejects writes without a target, with an unknown kind or with a malformed expectation', () => {
    expect(parseScorerConfig('guardrail_check', { expect: 'pass' }, 'write').ok).toBe(false)
    expect(parseScorerConfig('guardrail_check', { kind: 'nope', expect: 'pass' }, 'write').ok).toBe(false)
    expect(parseScorerConfig('guardrail_check', { ruleId: 'quotes', expect: 'maybe' }, 'write').ok).toBe(false)
    expect(parseScorerConfig('guardrail_check', { ruleId: 'quotes', expect: 'outcome:needs_review' }, 'write').ok).toBe(true)
    expect(parseScorerConfig('guardrail_check', { kind: 'pii', expect: 'not_block' }, 'write').ok).toBe(true)
  })
})

describe('projectRunView guardrail checks', () => {
  it('projects check rows with rule id and outcome from evidence and nothing else', () => {
    const run = { input: null, output: null, status: 'completed' } as unknown as AgentRun
    const rows = [
      { kind: 'abstain_or_review', phase: 'output', result: 'warn', evidence: { ruleId: 'abstain', outcome: 'needs_review', reasons: ['x'] } },
      { kind: 'pii', phase: 'input', result: 'pass', evidence: null },
    ] as unknown as AgentGuardrailCheck[]
    const view = projectRunView({ run, guardrailChecks: rows })
    expect(view.guardrailChecks).toEqual([
      { kind: 'abstain_or_review', phase: 'output', result: 'warn', ruleId: 'abstain', outcome: 'needs_review' },
      { kind: 'pii', phase: 'input', result: 'pass', ruleId: null, outcome: null },
    ])
  })

  it('defaults to no checks', () => {
    const run = { input: null, output: null, status: 'completed' } as unknown as AgentRun
    expect(projectRunView({ run }).guardrailChecks).toEqual([])
  })
})
