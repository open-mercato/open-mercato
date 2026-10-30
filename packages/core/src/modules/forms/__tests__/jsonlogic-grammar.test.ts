import {
  ALLOWED_JSONLOGIC_OPS,
  classifyVarPath,
  validateJsonLogicGrammar,
} from '../schema/jsonlogic-grammar'

describe('jsonlogic grammar', () => {
  it('classifies var paths into field / hidden / variable namespaces', () => {
    expect(classifyVarPath('age')).toEqual({ namespace: 'field', name: 'age' })
    expect(classifyVarPath('hidden.patient_id')).toEqual({ namespace: 'hidden', name: 'patient_id' })
    expect(classifyVarPath('var.phq_total')).toEqual({ namespace: 'variable', name: 'phq_total' })
  })

  it('accepts every operator in the allowlist', () => {
    for (const op of ALLOWED_JSONLOGIC_OPS) {
      const expr = { [op]: [1, 2] }
      expect(validateJsonLogicGrammar(expr)).toBeNull()
    }
  })

  it('rejects unknown operators', () => {
    expect(validateJsonLogicGrammar({ map: [[1, 2], { '+': [1, 1] }] })).toMatch(/not allowed/)
    expect(validateJsonLogicGrammar({ reduce: [] })).toMatch(/not allowed/)
  })

  it('rejects multi-key nodes', () => {
    expect(validateJsonLogicGrammar({ '==': [1, 1], or: [1, 1] })).toMatch(/exactly one/)
  })

  it('walks nested expressions', () => {
    const valid = { and: [{ '==': [{ var: 'a' }, 1] }, { '>': [{ var: 'b' }, 0] }] }
    expect(validateJsonLogicGrammar(valid)).toBeNull()
    const invalid = { and: [{ '==': [{ var: 'a' }, 1] }, { exploit: [] }] }
    expect(validateJsonLogicGrammar(invalid)).toMatch(/exploit/)
  })
})
