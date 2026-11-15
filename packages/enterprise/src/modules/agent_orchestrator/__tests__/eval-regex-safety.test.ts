import { spawnSync } from 'node:child_process'
import path from 'node:path'
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
  it.each(['regex', 'glob'])('bounds adversarial %s matching in a disposable process', (matcher) => {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, 'helpers/evalRegexWorker.cjs'),
      JSON.stringify({
        matcher,
        compiler: require.resolve('typescript-js'),
        zod: require.resolve('zod'),
        re2js: require.resolve('re2js'),
        linear: require.resolve('@open-mercato/shared/lib/regex/linear'),
        text: require.resolve('../lib/eval/registry/text'),
        shared: require.resolve('../lib/eval/registry/shared'),
      }),
    ], {
      encoding: 'utf8',
      timeout: 10_000,
      killSignal: 'SIGKILL',
      windowsHide: true,
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('false')
  })

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

  it.each(['[', '(a)\\1', '(?=a)a', '^\\u0061$'])('skips invalid or unsupported pattern %s', (pattern) => {
    expect(runScorer('regex', runView('aa'), null, { pattern })).toMatchObject({
      passed: null,
      score: null,
      evidence: { reason: 'invalid_config' },
    })
  })

  it.each([
    { pattern: '^\\s+$', output: '\u00a0', caseInsensitive: false, passed: false },
    { pattern: '^a.$', output: 'a\r', caseInsensitive: false, passed: true },
    { pattern: '^\\w+$', output: '\u212a', caseInsensitive: true, passed: true },
    { pattern: '^[ \\t\\r\\n\\f\\v\\x{00A0}]+$', output: '\u00a0', caseInsensitive: false, passed: true },
    { pattern: '^a[^\\r\\n\\x{2028}\\x{2029}]$', output: 'a\r', caseInsensitive: false, passed: false },
    { pattern: '^[A-Za-z0-9_]+$', output: '\u212a', caseInsensitive: false, passed: false },
  ])('uses RE2 semantics for $pattern and $output', ({ pattern, output, caseInsensitive, passed }) => {
    expect(runScorer('regex', runView(output), null, { pattern, caseInsensitive }).passed).toBe(passed)
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
