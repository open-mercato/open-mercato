import {
  compilePredicate,
  parsePredicate,
} from '../backend/forms/[id]/studio/logic/condition-model'
import {
  setFieldVisibilityIf,
  setSectionVisibilityIf,
} from '../backend/forms/[id]/studio/schema-helpers'
import { evaluateFormLogic } from '../services/form-logic-evaluator'

describe('condition-model', () => {
  it('parses a single equality predicate into one row', () => {
    const model = parsePredicate({ '==': [{ var: 'smoker' }, 'yes'] })
    expect(model.rows).toHaveLength(1)
    expect(model.rows[0]).toMatchObject({ source: 'smoker', operator: 'eq', value: 'yes' })
    expect(model.raw).toBeNull()
  })

  it('parses AND of multiple comparisons', () => {
    const model = parsePredicate({
      and: [
        { '==': [{ var: 'smoker' }, 'yes'] },
        { '>=': [{ var: 'age' }, 18] },
      ],
    })
    expect(model.combine).toBe('and')
    expect(model.rows).toHaveLength(2)
    expect(model.rows[1]).toMatchObject({ operator: 'gte', value: 18 })
  })

  it('falls back to raw shape for unsupported expressions', () => {
    const model = parsePredicate({ '+': [1, 2] })
    expect(model.rows).toHaveLength(0)
    expect(model.raw).toEqual({ '+': [1, 2] })
  })

  it('compiles rows back into jsonlogic', () => {
    const expr = compilePredicate({
      rows: [
        { id: '1', source: 'smoker', operator: 'eq', value: 'yes' },
        { id: '2', source: 'age', operator: 'gte', value: 18 },
      ],
      combine: 'and',
      raw: null,
    })
    expect(expr).toEqual({
      and: [
        { '==': [{ var: 'smoker' }, 'yes'] },
        { '>=': [{ var: 'age' }, 18] },
      ],
    })
  })

  it('round-trips through the evaluator', () => {
    const predicate = compilePredicate({
      rows: [{ id: '1', source: 'smoker', operator: 'is_true', value: null }],
      combine: 'and',
      raw: null,
    })
    const schema = {
      properties: {
        smoker: { type: 'boolean', 'x-om-type': 'yes_no' },
        cigs: {
          type: 'number',
          'x-om-type': 'number',
          'x-om-visibility-if': predicate,
        },
      },
    }
    const stateTrue = evaluateFormLogic(schema, { answers: { smoker: true }, hidden: {}, locale: 'en' })
    expect(stateTrue.visibleFieldKeys.has('cigs')).toBe(true)
    const stateFalse = evaluateFormLogic(schema, { answers: { smoker: false }, hidden: {}, locale: 'en' })
    expect(stateFalse.visibleFieldKeys.has('cigs')).toBe(false)
  })
})

describe('setFieldVisibilityIf / setSectionVisibilityIf', () => {
  const baseSchema = {
    type: 'object' as const,
    properties: {
      smoker: { type: 'string' as const, 'x-om-type': 'text' },
      cigs: { type: 'number' as const, 'x-om-type': 'number' },
    },
    'x-om-sections': [
      { key: 'p1', kind: 'section', title: { en: 'P1' }, fieldKeys: ['smoker', 'cigs'] },
    ],
  }

  it('writes and clears x-om-visibility-if on a field', () => {
    const predicate = { '==': [{ var: 'smoker' }, 'yes'] }
    const next = setFieldVisibilityIf({ schema: baseSchema, fieldKey: 'cigs', predicate })
    expect(next.properties.cigs['x-om-visibility-if']).toEqual(predicate)
    const cleared = setFieldVisibilityIf({ schema: next, fieldKey: 'cigs', predicate: null })
    expect((cleared.properties.cigs as Record<string, unknown>)['x-om-visibility-if']).toBeUndefined()
  })

  it('writes and clears x-om-visibility-if on a section', () => {
    const predicate = { '==': [{ var: 'smoker' }, 'yes'] }
    const next = setSectionVisibilityIf({ schema: baseSchema, sectionKey: 'p1', predicate })
    const updated = (next['x-om-sections'] ?? []).find((entry) => entry.key === 'p1') as Record<string, unknown>
    expect(updated['x-om-visibility-if']).toEqual(predicate)
    const cleared = setSectionVisibilityIf({ schema: next, sectionKey: 'p1', predicate: null })
    const updatedCleared = (cleared['x-om-sections'] ?? []).find((entry) => entry.key === 'p1') as Record<string, unknown>
    expect(updatedCleared['x-om-visibility-if']).toBeUndefined()
  })

  it('throws on unknown field/section', () => {
    expect(() => setFieldVisibilityIf({ schema: baseSchema, fieldKey: 'ghost', predicate: true })).toThrow()
    expect(() => setSectionVisibilityIf({ schema: baseSchema, sectionKey: 'ghost', predicate: true })).toThrow()
  })
})
