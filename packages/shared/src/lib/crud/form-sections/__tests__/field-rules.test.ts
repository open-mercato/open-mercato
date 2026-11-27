import { evaluateCrudFormFieldRules, normalizeCrudFormFieldRules } from '../field-rules'

test('uses one ordered evaluator for client and explicitly enforced server rules', () => {
  const rules = normalizeCrudFormFieldRules([
    { required: true, pattern: '^[a-z]+$', messageKey: 'form.lowercase' },
    { minLength: 2, maxLength: 5, messageKey: 'form.length', enforce: 'client-and-server' },
  ])
  expect(rules.map(({ kind }) => kind)).toEqual(['required', 'pattern', 'minLength', 'maxLength'])
  expect(evaluateCrudFormFieldRules('ABC', rules, 'client')).toBe('form.lowercase')
  expect(evaluateCrudFormFieldRules('ABC', rules, 'server')).toBeNull()
  expect(evaluateCrudFormFieldRules('a', rules, 'server')).toBe('form.length')
  expect(evaluateCrudFormFieldRules('abcdef', rules, 'client')).toBe('form.length')
  expect(evaluateCrudFormFieldRules(undefined, rules, 'server')).toBeNull()
})

test('required treats false and zero as present and bounds require finite numbers', () => {
  const rules = normalizeCrudFormFieldRules([
    { required: true, enforce: 'client-and-server', messageKey: 'form.required' },
    { min: 0, max: 10, enforce: 'client-and-server', messageKey: 'form.bounds' },
  ])
  expect(evaluateCrudFormFieldRules(' ', rules, 'server')).toBe('form.required')
  expect(evaluateCrudFormFieldRules(false, rules.slice(0, 1), 'server')).toBeNull()
  expect(evaluateCrudFormFieldRules(0, rules, 'server')).toBeNull()
  expect(evaluateCrudFormFieldRules(-1, rules, 'server')).toBe('form.bounds')
  expect(evaluateCrudFormFieldRules(11, rules, 'server')).toBe('form.bounds')
  expect(evaluateCrudFormFieldRules(Infinity, rules, 'server')).toBe('form.bounds')
  expect(() => normalizeCrudFormFieldRules([{ minLength: -1, messageKey: 'form.length' }])).toThrow(/minLength/)
  expect(() => normalizeCrudFormFieldRules([{ pattern: '[', messageKey: 'form.pattern' }])).toThrow()
})
