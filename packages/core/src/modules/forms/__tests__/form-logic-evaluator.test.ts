import {
  LogicEvaluatorError,
  evaluateFormLogic,
  evaluateExpression,
} from '../services/form-logic-evaluator'

describe('evaluateFormLogic — visibility', () => {
  it('shows a field when the predicate is true and hides when false', () => {
    const schema = {
      properties: {
        smoker: { type: 'boolean', 'x-om-type': 'yes_no' },
        cigarettes: {
          type: 'number',
          'x-om-type': 'number',
          'x-om-visibility-if': { '==': [{ var: 'smoker' }, true] },
        },
      },
    }
    const visibleTrue = evaluateFormLogic(schema, {
      answers: { smoker: true },
      hidden: {},
      locale: 'en',
    })
    expect(visibleTrue.visibleFieldKeys.has('cigarettes')).toBe(true)

    const visibleFalse = evaluateFormLogic(schema, {
      answers: { smoker: false },
      hidden: {},
      locale: 'en',
    })
    expect(visibleFalse.visibleFieldKeys.has('cigarettes')).toBe(false)
  })

  it('cascades section visibility — hidden section hides its fields', () => {
    const schema = {
      properties: {
        gate: { type: 'boolean', 'x-om-type': 'yes_no' },
        prenatal_q1: { type: 'string', 'x-om-type': 'text' },
      },
      'x-om-sections': [
        {
          key: 'prenatal',
          title: { en: 'Prenatal' },
          fieldKeys: ['prenatal_q1'],
          'x-om-visibility-if': { '==': [{ var: 'gate' }, true] },
        },
      ],
    }
    const hidden = evaluateFormLogic(schema, { answers: { gate: false }, hidden: {}, locale: 'en' })
    expect(hidden.visibleSectionKeys.has('prenatal')).toBe(false)
    expect(hidden.visibleFieldKeys.has('prenatal_q1')).toBe(false)

    const shown = evaluateFormLogic(schema, { answers: { gate: true }, hidden: {}, locale: 'en' })
    expect(shown.visibleSectionKeys.has('prenatal')).toBe(true)
    expect(shown.visibleFieldKeys.has('prenatal_q1')).toBe(true)
  })

  it('fields inside an ending section are never naturally visible', () => {
    const schema = {
      properties: {
        thanks: { type: 'string', 'x-om-type': 'info_block' },
      },
      'x-om-sections': [
        { key: 'thanks', kind: 'ending', title: { en: 'Thanks' }, fieldKeys: ['thanks'] },
      ],
    }
    const state = evaluateFormLogic(schema, { answers: {}, hidden: {}, locale: 'en' })
    expect(state.visibleFieldKeys.has('thanks')).toBe(false)
  })
})

describe('evaluateFormLogic — variables', () => {
  it('computes a simple sum and a boolean derivation', () => {
    const schema = {
      properties: {
        a: { type: 'number', 'x-om-type': 'number' },
        b: { type: 'number', 'x-om-type': 'number' },
      },
      'x-om-variables': [
        { name: 'total', type: 'number', formula: { '+': [{ var: 'a' }, { var: 'b' }] } },
        { name: 'qualifies', type: 'boolean', formula: { '>=': [{ var: 'var.total' }, 10] } },
      ],
    }
    const state = evaluateFormLogic(schema, { answers: { a: 4, b: 7 }, hidden: {}, locale: 'en' })
    expect(state.variables.total).toBe(11)
    expect(state.variables.qualifies).toBe(true)
  })

  it('topological sort allows a variable to reference an earlier variable regardless of declaration order', () => {
    const schema = {
      'x-om-variables': [
        { name: 'doubled', type: 'number', formula: { '*': [{ var: 'var.base' }, 2] } },
        { name: 'base', type: 'number', formula: { '+': [{ var: 'a' }, 1] } },
      ],
      properties: { a: { type: 'number', 'x-om-type': 'number' } },
    }
    const state = evaluateFormLogic(schema, { answers: { a: 5 }, hidden: {}, locale: 'en' })
    expect(state.variables.base).toBe(6)
    expect(state.variables.doubled).toBe(12)
  })

  it('detects cycles via topological sort', () => {
    const schema = {
      'x-om-variables': [
        { name: 'a', type: 'number', formula: { '+': [{ var: 'var.b' }, 1] } },
        { name: 'b', type: 'number', formula: { '+': [{ var: 'var.a' }, 1] } },
      ],
      properties: {},
    }
    expect(() => evaluateFormLogic(schema, { answers: {}, hidden: {}, locale: 'en' })).toThrow(LogicEvaluatorError)
  })

  it('coerces variable values to the declared type', () => {
    const schema = {
      'x-om-variables': [
        { name: 'flag', type: 'boolean', formula: { var: 'a' } },
      ],
      properties: { a: { type: 'string', 'x-om-type': 'text' } },
    }
    const truth = evaluateFormLogic(schema, { answers: { a: 'yes' }, hidden: {}, locale: 'en' })
    expect(truth.variables.flag).toBe(true)
    const empty = evaluateFormLogic(schema, { answers: { a: '' }, hidden: {}, locale: 'en' })
    expect(empty.variables.flag).toBe(false)
  })
})

describe('evaluateFormLogic — jumps', () => {
  const schema = {
    properties: {
      age: { type: 'number', 'x-om-type': 'number' },
      info: { type: 'string', 'x-om-type': 'info_block' },
    },
    'x-om-sections': [
      { key: 'page_1', kind: 'page', title: { en: 'P1' }, fieldKeys: ['age'] },
      { key: 'page_2', kind: 'page', title: { en: 'P2' }, fieldKeys: [] },
      { key: 'disclaimer', kind: 'ending', title: { en: 'Disclaimer' }, fieldKeys: ['info'] },
    ],
    'x-om-jumps': [
      {
        from: { type: 'page', pageKey: 'page_1' },
        rules: [
          { if: { '<': [{ var: 'age' }, 18] }, goto: { type: 'ending', endingKey: 'disclaimer' } },
        ],
        otherwise: { type: 'page', pageKey: 'page_2' },
      },
    ],
  }

  it('routes to the matching rule target', () => {
    const minor = evaluateFormLogic(schema, { answers: { age: 14 }, hidden: {}, locale: 'en' })
    expect(minor.nextTarget('page_1')).toEqual({ type: 'ending', endingKey: 'disclaimer' })
  })

  it('falls back to otherwise when no rule matches', () => {
    const adult = evaluateFormLogic(schema, { answers: { age: 30 }, hidden: {}, locale: 'en' })
    expect(adult.nextTarget('page_1')).toEqual({ type: 'page', pageKey: 'page_2' })
  })

  it('returns next when no jump rule exists for the source page', () => {
    const state = evaluateFormLogic(schema, { answers: { age: 30 }, hidden: {}, locale: 'en' })
    expect(state.nextTarget('page_2')).toEqual({ type: 'next' })
  })

  it('rejects dangling targets defensively at runtime', () => {
    const danglingSchema = {
      ...schema,
      'x-om-jumps': [
        {
          from: { type: 'page', pageKey: 'page_1' },
          rules: [],
          otherwise: { type: 'page', pageKey: 'ghost' },
        },
      ],
    }
    const state = evaluateFormLogic(danglingSchema, { answers: { age: 30 }, hidden: {}, locale: 'en' })
    expect(state.nextTarget('page_1')).toEqual({ type: 'next' })
  })
})

describe('evaluateFormLogic — recall', () => {
  it('resolves bare, hidden, and var tokens, applies number formatting, and escapes @@{', () => {
    const schema = {
      properties: { name: { type: 'string', 'x-om-type': 'text' } },
      'x-om-hidden-fields': [{ name: 'patient_id' }],
      'x-om-variables': [{ name: 'total', type: 'number', formula: { '+': [{ var: 'score' }, 1] } }],
    }
    const augmented = { ...schema, properties: { ...schema.properties, score: { type: 'number', 'x-om-type': 'number' } } }
    const state = evaluateFormLogic(augmented, {
      answers: { name: 'Pat', score: 1234 },
      hidden: { patient_id: 'abc-123' },
      locale: 'en-US',
    })
    expect(state.resolveRecall('Welcome, @{name}', 'en-US')).toBe('Welcome, Pat')
    expect(state.resolveRecall('id @{hidden.patient_id}', 'en-US')).toBe('id abc-123')
    expect(state.resolveRecall('Total: @{var.total}', 'en-US')).toBe('Total: 1,235')
    expect(state.resolveRecall('Literal @@{name}', 'en-US')).toBe('Literal @{name}')
  })

  it('redacts sensitive field tokens', () => {
    const schema = {
      properties: { ssn: { type: 'string', 'x-om-type': 'text', 'x-om-sensitive': true } },
    }
    const state = evaluateFormLogic(schema, {
      answers: { ssn: '123-45-6789' },
      hidden: {},
      locale: 'en',
    })
    expect(state.resolveRecall('You entered @{ssn}.', 'en')).toBe('You entered .')
  })

  it('picks LocalizedText by locale with fallback to en', () => {
    const schema = { properties: { name: { type: 'string', 'x-om-type': 'text' } } }
    const state = evaluateFormLogic(schema, { answers: { name: 'Pat' }, hidden: {}, locale: 'de' })
    expect(state.resolveRecall({ en: 'Hi @{name}', de: 'Hallo @{name}' }, 'de')).toBe('Hallo Pat')
    expect(state.resolveRecall({ en: 'Hi @{name}' }, 'de')).toBe('Hi Pat')
  })
})

describe('evaluateExpression — operator coverage', () => {
  const context = { answers: { a: 4, b: 2 }, hidden: {}, variables: {} }

  it('handles arithmetic and conditionals', () => {
    expect(evaluateExpression({ '+': [{ var: 'a' }, { var: 'b' }] }, context)).toBe(6)
    expect(evaluateExpression({ '-': [{ var: 'a' }, { var: 'b' }] }, context)).toBe(2)
    expect(evaluateExpression({ '*': [{ var: 'a' }, { var: 'b' }] }, context)).toBe(8)
    expect(evaluateExpression({ '/': [{ var: 'a' }, { var: 'b' }] }, context)).toBe(2)
    expect(evaluateExpression({ '%': [{ var: 'a' }, { var: 'b' }] }, context)).toBe(0)
    expect(evaluateExpression({ if: [{ '>': [{ var: 'a' }, 1] }, 'big', 'small'] }, context)).toBe('big')
  })

  it('throws on unsupported operators', () => {
    expect(() => evaluateExpression({ map: [[], { '+': [1, 1] }] }, context)).toThrow(LogicEvaluatorError)
  })

  it('returns false for `in` when haystack is neither array nor string', () => {
    expect(evaluateExpression({ in: [1, 5] }, context)).toBe(false)
  })
})
