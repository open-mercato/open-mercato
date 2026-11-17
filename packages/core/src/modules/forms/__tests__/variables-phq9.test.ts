import {
  setVariables,
  type FormSchema,
  type VariableEntry,
} from '../backend/forms/[id]/studio/schema-helpers'
import { evaluateFormLogic } from '../services/form-logic-evaluator'

describe('setVariables — round-trip + PHQ-9', () => {
  it('clears the keyword on empty list', () => {
    const schema: FormSchema = { type: 'object', properties: {} }
    const withVars = setVariables({
      schema,
      entries: [{ name: 'total', type: 'number', formula: { '+': [1, 2] } }],
    })
    expect((withVars as Record<string, unknown>)['x-om-variables']).toHaveLength(1)
    const cleared = setVariables({ schema: withVars, entries: [] })
    expect((cleared as Record<string, unknown>)['x-om-variables']).toBeUndefined()
  })

  it('rejects collisions with field keys', () => {
    const schema: FormSchema = {
      type: 'object',
      properties: { score: { type: 'number', 'x-om-type': 'number' } as never },
    }
    expect(() =>
      setVariables({
        schema,
        entries: [{ name: 'score', type: 'number', formula: { '+': [1, 1] } }],
      }),
    ).toThrow()
  })

  it('rejects formulas outside the jsonlogic grammar', () => {
    const schema: FormSchema = { type: 'object', properties: {} }
    expect(() =>
      setVariables({
        schema,
        entries: [
          {
            name: 'total',
            type: 'number',
            formula: { map: [[1, 2], { '+': [{ var: '' }, 1] }] },
          },
        ],
      }),
    ).toThrow()
  })

  it('round-trips a PHQ-9 fixture through the evaluator', () => {
    const properties: Record<string, unknown> = {}
    const phqFields: string[] = []
    for (let index = 1; index <= 9; index += 1) {
      const key = `phq_${index}`
      phqFields.push(key)
      properties[key] = { type: 'number', 'x-om-type': 'scale', 'x-om-min': 0, 'x-om-max': 3 }
    }
    const baseSchema: FormSchema = { type: 'object', properties: properties as never }
    const variables: VariableEntry[] = [
      {
        name: 'phq_total',
        type: 'number',
        formula: { '+': phqFields.map((field) => ({ var: field })) },
      },
      {
        name: 'qualifies',
        type: 'boolean',
        formula: { '>=': [{ var: 'var.phq_total' }, 10] },
      },
    ]
    const schema = setVariables({ schema: baseSchema, entries: variables })
    const answers: Record<string, number> = {}
    for (const field of phqFields) answers[field] = 2
    const state = evaluateFormLogic(schema, { answers, hidden: {}, locale: 'en' })
    expect(state.variables.phq_total).toBe(18)
    expect(state.variables.qualifies).toBe(true)

    const lowState = evaluateFormLogic(schema, {
      answers: Object.fromEntries(phqFields.map((field) => [field, 0])),
      hidden: {},
      locale: 'en',
    })
    expect(lowState.variables.phq_total).toBe(0)
    expect(lowState.variables.qualifies).toBe(false)
  })
})
