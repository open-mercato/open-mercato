/**
 * Phase A unit tests for the pure field-validation service
 * (`.ai/specs/2026-05-14-forms-tier-2-question-palette.md`).
 *
 * Covers:
 * - Every Phase-A rule (pattern, minLength, maxLength, minValue, maxValue)
 *   happy + sad paths.
 * - The ReDoS wall-clock guard fires on a pathological regex (R-1
 *   mitigation, 50ms cap).
 * - Locale message fallback chain: `messages[locale][rule]` →
 *   `messages.en[rule]` → `rule.message` → generic English default.
 * - `null` / `undefined` value short-circuits every rule.
 * - `compileFieldValidationRules` reads x-om-pattern / x-om-min-length /
 *   x-om-max-length / x-om-min / x-om-max from a field node.
 */

import {
  compileFieldValidationRules,
  validateFieldValue,
  __resetFieldValidationServiceCacheForTests,
  type ValidationRules,
} from '../services/field-validation-service'
import type { FieldNode } from '../backend/forms/[id]/studio/schema-helpers'

beforeEach(() => {
  __resetFieldValidationServiceCacheForTests()
})

function buildNode(overrides: Partial<Record<string, unknown>> = {}): FieldNode {
  return {
    type: 'string',
    'x-om-type': 'text',
    ...overrides,
  } as FieldNode
}

describe('compileFieldValidationRules', () => {
  it('emits a pattern rule when x-om-pattern is set', () => {
    const rules = compileFieldValidationRules(buildNode({ 'x-om-pattern': '^a$' }), 'text')
    expect(rules).toEqual([{ type: 'pattern', pattern: '^a$' }])
  })

  it('emits min/max length rules when x-om-min-length / x-om-max-length are set', () => {
    const rules = compileFieldValidationRules(
      buildNode({ 'x-om-min-length': 3, 'x-om-max-length': 10 }),
      'text',
    )
    expect(rules).toEqual([
      { type: 'minLength', value: 3 },
      { type: 'maxLength', value: 10 },
    ])
  })

  it('emits min/max value rules when x-om-min / x-om-max are set', () => {
    const rules = compileFieldValidationRules(
      buildNode({ type: 'number', 'x-om-min': 0, 'x-om-max': 100 }),
      'number',
    )
    expect(rules).toEqual([
      { type: 'minValue', value: 0 },
      { type: 'maxValue', value: 100 },
    ])
  })

  it('ignores non-integer / negative lengths', () => {
    const rules = compileFieldValidationRules(
      buildNode({ 'x-om-min-length': -1, 'x-om-max-length': 1.5 }),
      'text',
    )
    expect(rules).toEqual([])
  })

  it('returns an empty list when no validation keywords are present', () => {
    expect(compileFieldValidationRules(buildNode(), 'text')).toEqual([])
  })

  it('emits a format rule for the email field type', () => {
    const rules = compileFieldValidationRules(buildNode({ 'x-om-type': 'email' }), 'email')
    expect(rules).toEqual([{ type: 'format', format: 'email' }])
  })

  it('emits a format rule for the phone field type', () => {
    const rules = compileFieldValidationRules(buildNode({ 'x-om-type': 'phone' }), 'phone')
    expect(rules).toEqual([{ type: 'format', format: 'phone' }])
  })

  it('emits a format rule for the website field type', () => {
    const rules = compileFieldValidationRules(buildNode({ 'x-om-type': 'website' }), 'website')
    expect(rules).toEqual([{ type: 'format', format: 'website' }])
  })

  it('emits min/max value rules for an nps field even without x-om-min/max', () => {
    const rules = compileFieldValidationRules(buildNode({ 'x-om-type': 'nps', type: 'integer' }), 'nps')
    expect(rules).toEqual([
      { type: 'minValue', value: 0 },
      { type: 'maxValue', value: 10 },
    ])
  })

  it('emits min/max value rules for an opinion_scale field with default 1..5 bounds', () => {
    const rules = compileFieldValidationRules(
      buildNode({ 'x-om-type': 'opinion_scale', type: 'integer' }),
      'opinion_scale',
    )
    expect(rules).toEqual([
      { type: 'minValue', value: 1 },
      { type: 'maxValue', value: 5 },
    ])
  })

  it('honours explicit x-om-min/max on opinion_scale instead of the defaults', () => {
    const rules = compileFieldValidationRules(
      buildNode({
        'x-om-type': 'opinion_scale',
        type: 'integer',
        'x-om-min': 1,
        'x-om-max': 7,
      }),
      'opinion_scale',
    )
    expect(rules).toEqual([
      { type: 'minValue', value: 1 },
      { type: 'maxValue', value: 7 },
    ])
  })

  it('emits a rankingExhaustive rule with the configured optionCount', () => {
    const rules = compileFieldValidationRules(
      buildNode({
        'x-om-type': 'ranking',
        type: 'array',
        'x-om-ranking-exhaustive': true,
        'x-om-options': [
          { value: 'a', label: { en: 'A' } },
          { value: 'b', label: { en: 'B' } },
          { value: 'c', label: { en: 'C' } },
        ],
      }),
      'ranking',
    )
    expect(rules).toEqual([{ type: 'rankingExhaustive', optionCount: 3 }])
  })

  it('does not emit a rankingExhaustive rule when the keyword is absent or false', () => {
    expect(
      compileFieldValidationRules(
        buildNode({ 'x-om-type': 'ranking', type: 'array' }),
        'ranking',
      ),
    ).toEqual([])
    expect(
      compileFieldValidationRules(
        buildNode({
          'x-om-type': 'ranking',
          type: 'array',
          'x-om-ranking-exhaustive': false,
        }),
        'ranking',
      ),
    ).toEqual([])
  })

  it('combines x-om-pattern with the implicit format rule for format-typed fields', () => {
    const rules = compileFieldValidationRules(
      buildNode({ 'x-om-type': 'email', 'x-om-pattern': '^a@example\\.com$' }),
      'email',
    )
    expect(rules).toEqual([
      { type: 'pattern', pattern: '^a@example\\.com$' },
      { type: 'format', format: 'email' },
    ])
  })

  it('emits a matrixRowsRequired rule whose rowKeys list the required rows (Phase F)', () => {
    const rules = compileFieldValidationRules(
      buildNode({
        'x-om-type': 'matrix',
        'x-om-matrix-rows': [
          { key: 'communication', label: { en: 'Communication' } },
          { key: 'wait_time', label: { en: 'Wait time' }, required: true },
          { key: 'diagnosis_quality', label: { en: 'Diagnosis' }, required: true },
        ],
      }),
      'matrix',
    )
    expect(rules).toEqual([
      { type: 'matrixRowsRequired', rowKeys: ['wait_time', 'diagnosis_quality'] },
    ])
  })

  it('does not emit matrixRowsRequired when no row is required', () => {
    const rules = compileFieldValidationRules(
      buildNode({
        'x-om-type': 'matrix',
        'x-om-matrix-rows': [
          { key: 'communication', label: { en: 'Communication' } },
        ],
      }),
      'matrix',
    )
    expect(rules).toEqual([])
  })
})

describe('validateFieldValue', () => {
  it('short-circuits null / undefined for every rule', () => {
    const rules: ValidationRules = [
      { type: 'pattern', pattern: '^a$' },
      { type: 'minLength', value: 1 },
      { type: 'maxLength', value: 1 },
      { type: 'minValue', value: 0 },
      { type: 'maxValue', value: 1 },
    ]
    expect(validateFieldValue(null, rules, 'en')).toEqual({ valid: true })
    expect(validateFieldValue(undefined, rules, 'en')).toEqual({ valid: true })
  })

  describe('pattern', () => {
    it('passes when the value matches the regex', () => {
      expect(
        validateFieldValue('abc', [{ type: 'pattern', pattern: '^abc$' }], 'en'),
      ).toEqual({ valid: true })
    })

    it('fails with the default message when the value does not match', () => {
      expect(
        validateFieldValue('xyz', [{ type: 'pattern', pattern: '^abc$' }], 'en'),
      ).toEqual({
        valid: false,
        rule: 'pattern',
        message: 'Value does not match the expected format.',
      })
    })

    it('skips when the value is not a string', () => {
      expect(
        validateFieldValue(42, [{ type: 'pattern', pattern: '^abc$' }], 'en'),
      ).toEqual({ valid: true })
    })

    it('reports a regex-timeout failure on a pathological regex', () => {
      const pattern = '^(a+)+$'
      const input = 'a'.repeat(35) + 'b'
      const result = validateFieldValue(input, [{ type: 'pattern', pattern }], 'en')
      expect(result.valid === false && result.rule === 'pattern').toBe(true)
    })
  })

  describe('minLength / maxLength', () => {
    it('minLength passes / fails correctly', () => {
      expect(validateFieldValue('abc', [{ type: 'minLength', value: 3 }], 'en')).toEqual({
        valid: true,
      })
      const failed = validateFieldValue('ab', [{ type: 'minLength', value: 3 }], 'en')
      expect(failed).toEqual({
        valid: false,
        rule: 'minLength',
        message: 'Please enter at least 3 characters.',
      })
    })

    it('maxLength passes / fails correctly', () => {
      expect(validateFieldValue('abc', [{ type: 'maxLength', value: 3 }], 'en')).toEqual({
        valid: true,
      })
      const failed = validateFieldValue('abcd', [{ type: 'maxLength', value: 3 }], 'en')
      expect(failed).toEqual({
        valid: false,
        rule: 'maxLength',
        message: 'Please enter at most 3 characters.',
      })
    })
  })

  describe('minValue / maxValue', () => {
    it('minValue passes / fails correctly', () => {
      expect(validateFieldValue(5, [{ type: 'minValue', value: 5 }], 'en')).toEqual({
        valid: true,
      })
      const failed = validateFieldValue(4, [{ type: 'minValue', value: 5 }], 'en')
      expect(failed).toEqual({
        valid: false,
        rule: 'minValue',
        message: 'Please enter at least 5.',
      })
    })

    it('maxValue passes / fails correctly', () => {
      expect(validateFieldValue(5, [{ type: 'maxValue', value: 5 }], 'en')).toEqual({
        valid: true,
      })
      const failed = validateFieldValue(6, [{ type: 'maxValue', value: 5 }], 'en')
      expect(failed).toEqual({
        valid: false,
        rule: 'maxValue',
        message: 'Please enter at most 5.',
      })
    })

    it('skips numeric rules when the value is not a number', () => {
      expect(validateFieldValue('5', [{ type: 'minValue', value: 5 }], 'en')).toEqual({
        valid: true,
      })
    })
  })

  describe('locale message fallback chain', () => {
    const failingRules: ValidationRules = [{ type: 'pattern', pattern: '^a$' }]

    it('prefers messages[locale][rule] over every other source', () => {
      const result = validateFieldValue('x', failingRules, 'es', {
        es: { pattern: 'Patrón inválido.' },
        en: { pattern: 'Bad pattern.' },
      })
      expect(result).toEqual({ valid: false, rule: 'pattern', message: 'Patrón inválido.' })
    })

    it('falls back to messages.en when the requested locale is missing', () => {
      const result = validateFieldValue('x', failingRules, 'de', {
        en: { pattern: 'Bad pattern.' },
      })
      expect(result).toEqual({ valid: false, rule: 'pattern', message: 'Bad pattern.' })
    })

    it('falls back to rule.message when neither locale matches', () => {
      const result = validateFieldValue(
        'x',
        [{ type: 'pattern', pattern: '^a$', message: 'rule-level message' }],
        'fr',
      )
      expect(result).toEqual({
        valid: false,
        rule: 'pattern',
        message: 'rule-level message',
      })
    })

    it('falls back to the generic English default when nothing else is provided', () => {
      const result = validateFieldValue('x', failingRules, 'fr')
      expect(result).toEqual({
        valid: false,
        rule: 'pattern',
        message: 'Value does not match the expected format.',
      })
    })
  })

  describe('format rule (Tier-2 Phase B)', () => {
    it('passes for well-formed email values', () => {
      const result = validateFieldValue(
        'alice@example.com',
        [{ type: 'format', format: 'email' }],
        'en',
      )
      expect(result).toEqual({ valid: true })
    })

    it('fails for malformed email values with the default English message', () => {
      const result = validateFieldValue('xyz', [{ type: 'format', format: 'email' }], 'en')
      expect(result).toEqual({
        valid: false,
        rule: 'format',
        message: 'Please enter a valid email address.',
      })
    })

    it('fails for malformed phone values', () => {
      const result = validateFieldValue('abc', [{ type: 'format', format: 'phone' }], 'en')
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.rule).toBe('format')
        expect(result.message).toBe('Please enter a valid phone number.')
      }
    })

    it('fails for malformed website values', () => {
      const result = validateFieldValue('example', [{ type: 'format', format: 'website' }], 'en')
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.rule).toBe('format')
        expect(result.message).toBe('Please enter a valid URL.')
      }
    })

    it('treats empty string as valid (required-ness enforced elsewhere)', () => {
      expect(
        validateFieldValue('', [{ type: 'format', format: 'email' }], 'en'),
      ).toEqual({ valid: true })
    })

    it('honours x-om-pattern overrides via fieldNode', () => {
      const node = { 'x-om-type': 'email', 'x-om-pattern': '^a@example\\.com$' } as FieldNode
      const result = validateFieldValue(
        'b@example.com',
        [{ type: 'format', format: 'email' }],
        'en',
        undefined,
        node,
      )
      expect(result.valid).toBe(false)
      const ok = validateFieldValue(
        'a@example.com',
        [{ type: 'format', format: 'email' }],
        'en',
        undefined,
        node,
      )
      expect(ok).toEqual({ valid: true })
    })

    it('prefers messages[locale][format] over the default English message', () => {
      const result = validateFieldValue(
        'bad',
        [{ type: 'format', format: 'email' }],
        'pl',
        { pl: { format: 'Nieprawidłowy adres e-mail.' } },
      )
      expect(result).toEqual({
        valid: false,
        rule: 'format',
        message: 'Nieprawidłowy adres e-mail.',
      })
    })
  })

  describe('rankingExhaustive rule (Tier-2 Phase E)', () => {
    it('passes when the array length matches optionCount', () => {
      const result = validateFieldValue(
        ['a', 'b', 'c'],
        [{ type: 'rankingExhaustive', optionCount: 3 }],
        'en',
      )
      expect(result).toEqual({ valid: true })
    })

    it('fails with the default English message when the array is too short', () => {
      const result = validateFieldValue(
        ['a', 'b'],
        [{ type: 'rankingExhaustive', optionCount: 3 }],
        'en',
      )
      expect(result).toEqual({
        valid: false,
        rule: 'rankingExhaustive',
        message: 'Please rank every option.',
      })
    })

    it('fails when the value is not an array', () => {
      const result = validateFieldValue(
        'oops' as unknown,
        [{ type: 'rankingExhaustive', optionCount: 3 }],
        'en',
      )
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.rule).toBe('rankingExhaustive')
    })

    it('honours locale message overrides for rankingExhaustive', () => {
      const result = validateFieldValue(
        ['a'],
        [{ type: 'rankingExhaustive', optionCount: 3 }],
        'pl',
        { pl: { rankingExhaustive: 'Wybierz wszystkie.' } },
      )
      expect(result).toEqual({
        valid: false,
        rule: 'rankingExhaustive',
        message: 'Wybierz wszystkie.',
      })
    })
  })

  describe('matrixRowsRequired rule (Tier-2 Phase F)', () => {
    const rules: ValidationRules = [
      { type: 'matrixRowsRequired', rowKeys: ['wait_time', 'diagnosis_quality'] },
    ]

    it('passes when every required row has a non-empty value', () => {
      expect(
        validateFieldValue(
          { wait_time: 'agree', diagnosis_quality: 'strongly_agree', extra: 'agree' },
          rules,
          'en',
        ),
      ).toEqual({ valid: true })
    })

    it('accepts arrays for multi-select rows', () => {
      expect(
        validateFieldValue(
          { wait_time: 'agree', diagnosis_quality: ['agree', 'neutral'] },
          rules,
          'en',
        ),
      ).toEqual({ valid: true })
    })

    it('fails when a required row is missing', () => {
      const result = validateFieldValue(
        { wait_time: 'agree' },
        rules,
        'en',
      )
      expect(result).toEqual({
        valid: false,
        rule: 'matrixRowsRequired',
        message: 'Please answer every required row.',
      })
    })

    it('fails when a required row holds an empty array', () => {
      const result = validateFieldValue(
        { wait_time: 'agree', diagnosis_quality: [] },
        rules,
        'en',
      )
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.rule).toBe('matrixRowsRequired')
    })

    it('fails when a required row holds an empty string', () => {
      const result = validateFieldValue(
        { wait_time: 'agree', diagnosis_quality: '' },
        rules,
        'en',
      )
      expect(result.valid).toBe(false)
    })

    it('fails when the value is not an object', () => {
      const result = validateFieldValue('nope' as unknown, rules, 'en')
      expect(result.valid).toBe(false)
    })

    it('honours locale message overrides', () => {
      const result = validateFieldValue(
        {},
        rules,
        'pl',
        { pl: { matrixRowsRequired: 'Wypełnij wszystkie wiersze.' } },
      )
      expect(result).toEqual({
        valid: false,
        rule: 'matrixRowsRequired',
        message: 'Wypełnij wszystkie wiersze.',
      })
    })
  })

  describe('multiple rules', () => {
    it('returns the first failure', () => {
      const rules: ValidationRules = [
        { type: 'minLength', value: 5 },
        { type: 'pattern', pattern: '^[a-z]+$' },
      ]
      const result = validateFieldValue('AB', rules, 'en')
      expect(result.valid === false && result.rule === 'minLength').toBe(true)
    })

    it('passes when every rule is satisfied', () => {
      const rules: ValidationRules = [
        { type: 'minLength', value: 2 },
        { type: 'pattern', pattern: '^[a-z]+$' },
      ]
      expect(validateFieldValue('abc', rules, 'en')).toEqual({ valid: true })
    })
  })
})
