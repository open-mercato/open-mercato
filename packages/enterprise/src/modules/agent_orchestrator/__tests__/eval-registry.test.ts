import {
  DEPRECATED_SCORER_ALIASES,
  describeScorers,
  getScorerDefinition,
  listScorerDefinitions,
  parseScorerConfig,
  resolveScorerKey,
  runScorer,
} from '../lib/eval/registry'
import { scorers as legacyScorers } from '../lib/eval/scorers'
import type { ScorerRunView } from '../lib/eval/types'

function runView(overrides: Partial<ScorerRunView> = {}): ScorerRunView {
  return {
    input: null,
    output: { answer: 'ok' },
    resultKind: 'informative',
    confidence: 0.9,
    status: 'completed',
    latencyMs: 1000,
    costMinor: 10,
    inputTokens: 100,
    outputTokens: 50,
    toolCalls: [],
    stepCount: 0,
    disposition: null,
    ...overrides,
  }
}

describe('scorer registry — catalog', () => {
  it('registers 21 definitions: 20 deterministic + 1 judge', () => {
    const definitions = listScorerDefinitions()
    expect(definitions).toHaveLength(21)
    expect(definitions.filter((definition) => definition.kind === 'deterministic')).toHaveLength(20)
    expect(definitions.filter((definition) => definition.kind === 'llm_judge')).toHaveLength(1)
  })

  it('exposes unique scorer keys and a fields array on every definition', () => {
    const definitions = listScorerDefinitions()
    const keys = definitions.map((definition) => definition.scorerKey)
    expect(new Set(keys).size).toBe(keys.length)
    for (const definition of definitions) {
      expect(Array.isArray(definition.fields)).toBe(true)
      expect(typeof definition.needsExpected).toBe('function')
    }
  })

  it('projects a serializable descriptor set including deprecated aliases', () => {
    const described = describeScorers()
    // Descriptors cross the network to the browser: no functions, no zod schemas.
    expect(JSON.parse(JSON.stringify(described))).toEqual(described)
    const alias = described.find((entry) => entry.scorerKey === 'min_confidence')
    expect(alias).toMatchObject({ deprecated: true, deprecatedInFavourOf: 'confidence_threshold' })
  })

  it('resolves llm_judge as a first-class member so the form can render it', () => {
    const judge = getScorerDefinition('llm_judge')
    expect(judge?.group).toBe('judge')
    expect(judge?.fields.map((field) => field.name)).toContain('promptTemplate')
  })
})

describe('scorer registry — key resolution (backward compatibility)', () => {
  it('prefers the scorer_key column', () => {
    expect(resolveScorerKey({ scorerKey: 'no_pii', key: 'anything', config: { scorer: 'output_present' } })).toBe('no_pii')
  })

  // MANDATED FIXTURE (c): rows written before the column relied on this indirection.
  it('falls back to config.scorer when the column is absent', () => {
    expect(resolveScorerKey({ key: 'my-slug', config: { scorer: 'no_pii' } })).toBe('no_pii')
  })

  it('falls back to the assertion key last', () => {
    expect(resolveScorerKey({ key: 'output_present', config: null })).toBe('output_present')
  })

  it('resolves the deprecated min_confidence alias to confidence_threshold', () => {
    expect(DEPRECATED_SCORER_ALIASES.min_confidence).toBe('confidence_threshold')
    expect(getScorerDefinition('min_confidence')?.scorerKey).toBe('confidence_threshold')
  })

  it('strips the deprecated config.scorer key rather than rejecting the config', () => {
    expect(parseScorerConfig('no_pii', { scorer: 'no_pii' })).toEqual({ ok: true, config: {} })
  })
})

describe('scorer registry — skipped verdicts never fail a gate', () => {
  it('skips instead of failing on an unknown scorer', () => {
    const verdict = runScorer('does_not_exist', runView(), null, {})
    expect(verdict.passed).toBeNull()
    expect(verdict.score).toBeNull()
    expect(verdict.evidence).toMatchObject({ reason: 'unknown_scorer' })
  })

  // Only for scorers with no pre-registry behaviour to preserve. A scorer that
  // USED to evaluate a given config must keep evaluating it — see the
  // gate-fails-open regression below.
  it('skips instead of failing on an unusable config for a new scorer', () => {
    const verdict = runScorer('regex', runView(), null, {})
    expect(verdict.passed).toBeNull()
    expect(verdict.evidence).toMatchObject({ reason: 'invalid_config' })
  })

  it('skips a comparison scorer when the case has no expected value', () => {
    const verdict = runScorer('json_match', runView(), null, { source: 'expected' })
    expect(verdict.passed).toBeNull()
    expect(verdict.evidence).toMatchObject({ reason: 'no_expected' })
  })

  it('holds the invariant score === null ⟺ passed === null across every scorer', () => {
    for (const definition of listScorerDefinitions()) {
      const verdict = runScorer(definition.scorerKey, runView(), null, {})
      expect(verdict.score === null).toBe(verdict.passed === null)
    }
  })
})

describe('registry regression — Phase 1 must not move an online verdict', () => {
  // MANDATED FIXTURE (b): shipped min_confidence returned {passed:false, score:0}
  // when the run had no confidence. Skipping instead would have removed an
  // existing failure from the aggregate and could flip AgentRun.evalPassed.
  it('confidence_threshold FAILS (does not skip) when the run has no confidence', () => {
    const verdict = runScorer('confidence_threshold', runView({ confidence: null }), null, { threshold: 0.5 })
    expect(verdict.passed).toBe(false)
    expect(verdict.score).toBe(0)
  })

  // MANDATED FIXTURE (a): required_keys is not folded into json_match precisely
  // because the online plane has no expected value at all.
  it('required_keys still scores with no expected value present', () => {
    const verdict = runScorer('required_keys', runView({ output: { a: 1 } }), null, { requiredKeys: ['a', 'b'] })
    expect(verdict.passed).toBe(false)
    expect(verdict.score).toBe(0.5)
    expect(verdict.evidence).toMatchObject({ missing: ['b'] })
  })

  it.each([
    ['output_present', { output: {} }, false],
    ['output_present', { output: { a: 1 } }, true],
    ['no_pii', { output: { note: 'reach me at a@b.co' } }, false],
    ['no_pii', { output: { note: 'nothing personal' } }, true],
  ] as const)('%s reproduces its pre-registry verdict', (scorerKey, overrides, expected) => {
    expect(runScorer(scorerKey, runView(overrides), null, {}).passed).toBe(expected)
  })

  // The gate-fails-open case. A stored `threshold: 85` (percent-vs-fraction) made
  // the OLD scorer fail every run. If the registry rejected it as out of range,
  // the assertion would skip, drop out of the gate AND, and `evalPassed` would
  // flip from false to true — a deployment gate that was blocking would start
  // passing. Range is therefore a WRITE-time constraint only.
  it('evaluates an out-of-range stored threshold instead of skipping it', () => {
    const verdict = runScorer('confidence_threshold', runView({ confidence: 0.9 }), null, { threshold: 85 })
    expect(verdict.passed).toBe(false)
    expect(verdict.score).toBe(0.9)
  })

  it('falls back to 0.5 for a non-numeric stored threshold, as the old scorer did', () => {
    expect(runScorer('confidence_threshold', runView({ confidence: 0.9 }), null, { threshold: '0.7' }).passed).toBe(true)
    expect(runScorer('confidence_threshold', runView({ confidence: 0.4 }), null, { threshold: '0.7' }).passed).toBe(false)
  })

  it('still rejects an out-of-range threshold at the write boundary', () => {
    expect(parseScorerConfig('confidence_threshold', { threshold: 85 }, 'write').ok).toBe(false)
    expect(parseScorerConfig('confidence_threshold', { threshold: 85 }, 'read').ok).toBe(true)
  })

  it('tolerates a malformed requiredKeys instead of skipping', () => {
    const verdict = runScorer('required_keys', runView({ output: { a: 1 } }), null, { requiredKeys: 'not-an-array' })
    expect(verdict.passed).toBe(true)
    expect(verdict.score).toBe(1)
  })

  it('keeps the legacy callable surface working unchanged', () => {
    // The deprecated `lib/eval/scorers` export is publicly reachable through the
    // package's wildcard subpath exports, so its old call shape must still work.
    expect(legacyScorers.min_confidence({ output: {}, run: { confidence: 0.9 }, config: { threshold: 0.5 } }).passed).toBe(true)
    expect(legacyScorers.min_confidence({ output: {}, run: { confidence: null }, config: {} }).passed).toBe(false)
    expect(legacyScorers.output_present({ output: { a: 1 }, run: {}, config: {} }).passed).toBe(true)
  })
})

describe('scorer registry — new catalog behaviour', () => {
  it('negate flips a verdict centrally', () => {
    const plain = runScorer('output_present', runView({ output: { a: 1 } }), null, {})
    const negated = runScorer('output_present', runView({ output: { a: 1 } }), null, { negate: true })
    expect(plain.passed).toBe(true)
    expect(negated.passed).toBe(false)
    expect(negated.score).toBe(1 - (plain.score as number))
  })

  it('never flips a skipped verdict', () => {
    const verdict = runScorer('json_match', runView(), null, { source: 'expected', negate: true })
    expect(verdict.passed).toBeNull()
  })

  it('scores a diverging subtree by its leaves, not as a single mismatch', () => {
    const verdict = runScorer('json_match', runView({ output: { a: 5 } }), { a: { x: 1, y: 2, z: 3 } }, {})
    expect(verdict.passed).toBe(false)
    expect(verdict.score).toBe(0)
  })

  it('does not traverse the prototype chain from a config path', () => {
    const verdict = runScorer('json_path_compare', runView({ output: { a: 1 } }), null, {
      path: '__proto__.constructor',
      operator: 'eq',
      value: 'x',
    })
    expect(verdict.passed).toBe(false)
  })

  it('never lets a blank sequence step match every tool', () => {
    const view = runView({ toolCalls: [{ toolName: 'search', args: null, status: 'ok', sequence: 0 }], stepCount: 1 })
    // Rejected by the schema before it can reach the matcher; the matcher itself
    // also returns false for an empty pattern, so neither layer can pass it.
    expect(runScorer('tool_sequence', view, null, { steps: [''] }).passed).toBeNull()
    expect(runScorer('tool_sequence', view, null, { steps: ['search', ''] }).passed).toBeNull()
  })

  it('json_match defaults to subset so extra output fields are tolerated', () => {
    const verdict = runScorer('json_match', runView({ output: { a: 1, extra: true } }), { a: 1 }, {})
    expect(verdict.passed).toBe(true)
  })

  it('json_match exact mode rejects extra fields', () => {
    const verdict = runScorer('json_match', runView({ output: { a: 1, extra: true } }), { a: 1 }, { mode: 'exact' })
    expect(verdict.passed).toBe(false)
  })

  it('compares against a fixed config value on the online plane', () => {
    const verdict = runScorer('contains', runView({ output: 'hello world' }), null, {
      source: 'config',
      value: 'world',
    })
    expect(verdict.passed).toBe(true)
  })

  it('latency uses an explicit direction rather than an implied maximum', () => {
    expect(runScorer('latency', runView({ latencyMs: 500 }), null, { threshold: 1000 }).passed).toBe(true)
    expect(runScorer('latency', runView({ latencyMs: 5000 }), null, { threshold: 1000 }).passed).toBe(false)
    expect(runScorer('latency', runView({ latencyMs: 5000 }), null, { threshold: 1000, direction: 'gte' }).passed).toBe(true)
  })

  it('scores tool trajectories', () => {
    const view = runView({
      toolCalls: [
        { toolName: 'search_products', args: { q: 'shoes' }, status: 'ok', sequence: 0 },
        { toolName: 'get_product', args: { id: '1' }, status: 'ok', sequence: 1 },
      ],
      stepCount: 2,
    })
    expect(runScorer('tool_used', view, null, { name: 'get_product' }).passed).toBe(true)
    expect(runScorer('tool_used', view, null, { pattern: 'search*' }).passed).toBe(true)
    expect(runScorer('tool_used', view, null, { name: 'delete_product' }).passed).toBe(false)
    expect(runScorer('tool_sequence', view, null, { steps: ['search_products', 'get_product'] }).passed).toBe(true)
    expect(runScorer('tool_sequence', view, null, { steps: ['get_product', 'search_products'] }).passed).toBe(false)
    expect(runScorer('tool_args_match', view, null, { name: 'search_products', args: '{"q":"shoes"}' }).passed).toBe(true)
  })

  it('asserts escalation to a human, and skips when there is no proposal', () => {
    const escalated = runView({ disposition: 'user_task' })
    expect(runScorer('disposition_equals', escalated, null, { expected: 'user_task' }).passed).toBe(true)
    expect(runScorer('disposition_equals', escalated, null, { expected: 'auto_approved' }).passed).toBe(false)
    expect(runScorer('disposition_equals', runView(), null, { expected: 'user_task' }).passed).toBeNull()
  })
})

describe('review regressions — fail-open and scoring accuracy', () => {
  // required_keys' schema was `z.array(z.string()).catch([])`. One non-string
  // element failed the WHOLE array, `.catch` substituted an empty list, and an
  // empty list passes vacuously — so a stored gate silently flipped fail → pass.
  it('keeps a stored gate FAILING when requiredKeys holds a non-string element', () => {
    const verdict = runScorer('required_keys', runView({ output: { status: 'ok' } }), null, {
      requiredKeys: ['status', 1],
    })
    expect(verdict.passed).toBe(false)
    expect(verdict.evidence).toMatchObject({ missing: ['1'] })
  })

  // The denominator was the TARGET's leaf count while the numerator counted
  // comparisons, and `walk` treats an array as one unit — so a total mismatch of a
  // 10-element array scored 0.9.
  it('scores a totally mismatched array as 0, not near-perfect', () => {
    const verdict = runScorer(
      'json_match',
      runView({ output: { items: [] } }),
      { items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      {},
    )
    expect(verdict.passed).toBe(false)
    expect(verdict.score).toBe(0)
  })

  it('excludes ignored paths from the score denominator', () => {
    const verdict = runScorer('json_match', runView({ output: { a: 9, b: 2 } }), { a: 1, b: 2 }, { ignore: ['b'] })
    // Only `a` was compared, and it mismatched.
    expect(verdict.score).toBe(0)
  })

  // The read union ends in an all-optional object that accepts anything, so using
  // it for writes made the promised 422 unreachable.
  it('rejects a structurally broken judge rubric at the WRITE boundary', () => {
    const broken = { promptTemplate: '', scoring: { kind: 'choice', choices: [] } }
    expect(parseScorerConfig('llm_judge', broken, 'write').ok).toBe(false)
    // The legacy free-text form still saves.
    expect(parseScorerConfig('llm_judge', { rubric: 'Rate helpfulness.' }, 'write').ok).toBe(true)
  })
})
