import {
  JsonLogicEvaluationError,
  evaluateJsonLogic,
  evaluateJsonLogicStrict,
} from '../services/jsonlogic-evaluator'
import { resolveVisibleFieldKeys } from '../services/visibility-resolver'
import type { CompiledFormVersion } from '../services/form-version-compiler'

describe('evaluateJsonLogic', () => {
  it('treats unknown ops as falsy (conservative — hidden when in doubt)', () => {
    expect(evaluateJsonLogic({ map: [[1, 2, 3], { '+': [{ var: '' }, 1] }] }, {})).toBe(false)
  })

  it('evaluates equality and conjunction', () => {
    expect(evaluateJsonLogic({ '==': [{ var: 'a' }, 'yes'] }, { a: 'yes' })).toBe(true)
    expect(evaluateJsonLogic({ '==': [{ var: 'a' }, 'yes'] }, { a: 'no' })).toBe(false)
    expect(
      evaluateJsonLogic(
        { and: [{ '==': [{ var: 'a' }, 'yes'] }, { '>': [{ var: 'b' }, 5] }] },
        { a: 'yes', b: 7 },
      ),
    ).toBe(true)
  })

  it('handles in and string includes', () => {
    expect(evaluateJsonLogic({ in: ['x', ['x', 'y']] }, {})).toBe(true)
    expect(evaluateJsonLogic({ in: ['hello', 'hello world'] }, {})).toBe(true)
    expect(evaluateJsonLogic({ in: ['z', ['x', 'y']] }, {})).toBe(false)
  })

  it('respects depth limits to mitigate DoS (R-2c-1)', () => {
    let expr: unknown = { '==': [1, 1] }
    for (let i = 0; i < 100; i += 1) {
      expr = { and: [expr, { '==': [1, 1] }] }
    }
    expect(() => evaluateJsonLogicStrict(expr, {}, { maxDepth: 8 })).toThrow(JsonLogicEvaluationError)
  })

  it('respects node-count limits to mitigate DoS', () => {
    const expr = { and: Array.from({ length: 1000 }, () => ({ '==': [1, 1] })) }
    expect(() => evaluateJsonLogicStrict(expr, {}, { maxNodes: 100 })).toThrow(JsonLogicEvaluationError)
  })

  it('var supports dotted paths', () => {
    expect(evaluateJsonLogic({ '==': [{ var: 'profile.role' }, 'admin'] }, { profile: { role: 'admin' } })).toBe(true)
  })
})

describe('resolveVisibleFieldKeys', () => {
  const compiled: CompiledFormVersion = {
    schemaHash: 'h',
    ajv: (() => true) as never,
    zod: undefined as never,
    fieldIndex: {
      patient_allergies: {
        key: 'patient_allergies',
        type: 'boolean',
        sectionKey: null,
        sensitive: false,
        editableBy: ['patient'],
        visibleTo: ['patient', 'admin'],
        required: false,
      },
      allergy_details: {
        key: 'allergy_details',
        type: 'textarea',
        sectionKey: null,
        sensitive: false,
        editableBy: ['patient'],
        visibleTo: ['patient', 'admin'],
        required: false,
      },
    },
    rolePolicyLookup: () => ({ canRead: true, canWrite: true }),
    registryVersion: 'test',
  } as unknown as CompiledFormVersion

  const schema = {
    properties: {
      patient_allergies: {},
      allergy_details: {
        'x-om-visibility-if': { '==': [{ var: 'patient_allergies' }, true] },
      },
    },
  }

  it('hides conditional fields when the predicate is false', () => {
    const visible = resolveVisibleFieldKeys({
      compiled,
      schema,
      role: 'patient',
      data: { patient_allergies: false },
    })
    expect(visible.has('patient_allergies')).toBe(true)
    expect(visible.has('allergy_details')).toBe(false)
  })

  it('shows conditional fields when the predicate is true', () => {
    const visible = resolveVisibleFieldKeys({
      compiled,
      schema,
      role: 'patient',
      data: { patient_allergies: true },
    })
    expect(visible.has('allergy_details')).toBe(true)
  })
})
