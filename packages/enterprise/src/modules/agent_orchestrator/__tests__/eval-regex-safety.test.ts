import { parseScorerConfig, runScorer } from '../lib/eval/registry'
import { matchesNameOrPattern } from '../lib/eval/registry/shared'
import { regex } from '../lib/eval/registry/text'
import type { ScorerRunView } from '../lib/eval/types'

function runView(output: ScorerRunView['output']): ScorerRunView {
  return {
    input: null,
    output,
    resultKind: 'research',
    agentType: null,
    confidence: null,
    status: 'completed',
    latencyMs: null,
    costMinor: null,
    inputTokens: null,
    outputTokens: null,
    toolCalls: [],
    stepCount: 0,
    disposition: null,
  }
}

describe('regex scorer safety', () => {
  it('accepts the pattern length boundary and rejects oversized patterns on save', () => {
    expect(parseScorerConfig('regex', { pattern: 'a'.repeat(500) }, 'write').ok).toBe(true)
    expect(parseScorerConfig('regex', { pattern: 'a'.repeat(501) }, 'write').ok).toBe(false)
  })

  it('skips an oversized stored pattern', () => {
    expect(runScorer('regex', runView('a'), null, { pattern: 'a'.repeat(501) })).toMatchObject({
      passed: null,
      score: null,
      evidence: { reason: 'invalid_config' },
    })
  })

  it('bounds patterns even when the scorer is called without registry validation', () => {
    expect(regex.score(runView('a'), null, { pattern: 'a'.repeat(501), caseInsensitive: false })).toMatchObject({
      passed: null,
      score: null,
      evidence: { reason: 'invalid_config', detail: { reason: 'pattern_too_long' } },
    })
  })

  it.each(['[', '(a)\\1', '(?=a)a'])('skips invalid or unsupported pattern %s', (pattern) => {
    expect(runScorer('regex', runView('aa'), null, { pattern })).toMatchObject({
      passed: null,
      score: null,
      evidence: { reason: 'invalid_config' },
    })
  })

  it('evaluates ambiguous alternation without backtracking', () => {
    expect(runScorer('regex', runView('a'.repeat(18)), null, { pattern: '^(.|.)*\\x00$' })).toMatchObject({
      passed: false,
      score: 0,
    })
  })

  it('accepts the input boundary and skips oversized input even when negated', () => {
    expect(runScorer('regex', runView('a'.repeat(10_000)), null, { pattern: '^a+$' }).passed).toBe(true)
    expect(runScorer('regex', runView('a'.repeat(10_001)), null, { pattern: '^a+$', negate: true })).toMatchObject({
      passed: null,
      score: null,
      evidence: { reason: 'invalid_config', detail: { reason: 'input_too_long' } },
    })
  })

  it('preserves case sensitivity, case-insensitive matching, and negation', () => {
    expect(runScorer('regex', runView('OK'), null, { pattern: '^ok$' }).passed).toBe(false)
    expect(runScorer('regex', runView('OK'), null, { pattern: '^ok$', caseInsensitive: true }).passed).toBe(true)
    expect(runScorer('regex', runView('OK'), null, { pattern: '^ok$', caseInsensitive: true, negate: true }).passed).toBe(false)
  })

  it('keeps the full raw pattern budget when adding case-insensitive mode', () => {
    expect(runScorer('regex', runView('A'.repeat(500)), null, {
      pattern: 'a'.repeat(500),
      caseInsensitive: true,
    }).passed).toBe(true)
  })

  it('matches serialized output and selected output paths', () => {
    const view = runView({ answer: 'ok' })
    expect(runScorer('regex', view, null, { pattern: '"answer":"ok"' }).passed).toBe(true)
    expect(runScorer('regex', view, null, { pattern: '^ok$', path: 'answer' }).passed).toBe(true)
  })
})

describe('tool-name glob safety', () => {
  it('preserves exact-name precedence and empty-selector behavior', () => {
    expect(matchesNameOrPattern('search', 'search', '*missing')).toBe(true)
    expect(matchesNameOrPattern('search', 'other', '*')).toBe(false)
    expect(matchesNameOrPattern('search')).toBe(false)
  })

  it('anchors globs and treats regex metacharacters literally', () => {
    expect(matchesNameOrPattern('search_products', undefined, 'search*')).toBe(true)
    expect(matchesNameOrPattern('research_products', undefined, 'search*')).toBe(false)
    expect(matchesNameOrPattern('tool.(v1)+?[x]$^|{}\\', undefined, 'tool.(v1)+?[x]$^|{}\\')).toBe(true)
    expect(matchesNameOrPattern('toolXv1', undefined, 'tool.(v1)')).toBe(false)
  })

  it('handles repeated wildcards without backtracking', () => {
    expect(matchesNameOrPattern('a'.repeat(18), undefined, `${'*a'.repeat(6)}b`)).toBe(false)
  })

  it('does not match an oversized compiled glob or candidate', () => {
    expect(matchesNameOrPattern('a', undefined, '*'.repeat(501))).toBe(false)
    expect(matchesNameOrPattern('a'.repeat(10_001), undefined, '*')).toBe(false)
  })
})
