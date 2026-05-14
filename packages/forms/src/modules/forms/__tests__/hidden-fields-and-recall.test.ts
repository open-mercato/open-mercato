import {
  SchemaHelperError,
  setHiddenFields,
  type FormSchema,
} from '../backend/forms/[id]/studio/schema-helpers'
import { evaluateFormLogic } from '../services/form-logic-evaluator'

describe('setHiddenFields', () => {
  const baseSchema: FormSchema = {
    type: 'object',
    properties: {
      patient_name: { type: 'string', 'x-om-type': 'text' } as never,
    },
  }

  it('writes the hidden fields and survives validation', () => {
    const next = setHiddenFields({
      schema: baseSchema,
      entries: [
        { name: 'patient_id', defaultValue: 'abc-123' },
        { name: 'utm_source' },
      ],
    })
    expect((next as Record<string, unknown>)['x-om-hidden-fields']).toEqual([
      { name: 'patient_id', defaultValue: 'abc-123' },
      { name: 'utm_source' },
    ])
  })

  it('clears the keyword when passing an empty array (R-9 minimalism)', () => {
    const withHidden = setHiddenFields({
      schema: baseSchema,
      entries: [{ name: 'patient_id' }],
    })
    expect((withHidden as Record<string, unknown>)['x-om-hidden-fields']).toBeDefined()
    const cleared = setHiddenFields({ schema: withHidden, entries: [] })
    expect((cleared as Record<string, unknown>)['x-om-hidden-fields']).toBeUndefined()
  })

  it('rejects names that collide with property keys (cross-keyword validator)', () => {
    expect(() =>
      setHiddenFields({
        schema: baseSchema,
        entries: [{ name: 'patient_name' }],
      }),
    ).toThrow(SchemaHelperError)
  })

  it('rejects malformed names', () => {
    expect(() => setHiddenFields({ schema: baseSchema, entries: [{ name: 'Bad-Name' }] })).toThrow()
  })
})

describe('Preview render with recall token over hidden values', () => {
  it('resolves hidden-namespace tokens via the evaluator', () => {
    const schema = {
      properties: {
        greeting: {
          type: 'string',
          'x-om-type': 'info_block',
          'x-om-label': { en: 'Welcome, @{hidden.patient_id}!' },
        },
      },
      'x-om-hidden-fields': [{ name: 'patient_id', defaultValue: 'guest' }],
    }
    const stateWithoutValue = evaluateFormLogic(schema, { answers: {}, hidden: {}, locale: 'en' })
    expect(stateWithoutValue.resolveRecall(schema.properties.greeting['x-om-label'], 'en')).toBe('Welcome, guest!')
    const stateWithValue = evaluateFormLogic(schema, {
      answers: {},
      hidden: { patient_id: 'abc-123' },
      locale: 'en',
    })
    expect(stateWithValue.resolveRecall(schema.properties.greeting['x-om-label'], 'en')).toBe('Welcome, abc-123!')
  })
})
