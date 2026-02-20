import { getDslReference } from '../dsl-reference'

describe('getDslReference', () => {
  it('returns operators topic', () => {
    const result = getDslReference('operators')
    expect(result.topic).toBe('operators')
    expect(result.comparisonOperators).toBeDefined()
    expect(result.comparisonOperators.length).toBeGreaterThan(0)
    expect(result.logicalOperators).toBeDefined()
    expect(result.conditionStructure).toBeDefined()
  })

  it('returns templates topic', () => {
    const result = getDslReference('templates')
    expect(result.topic).toBe('templates')
    expect(result.templateVariables).toBeDefined()
    expect(result.templateVariables.length).toBeGreaterThan(0)
    expect(result.interpolation).toBeDefined()
  })

  it('returns actions topic', () => {
    const result = getDslReference('actions')
    expect(result.topic).toBe('actions')
    expect(result.actionTypes).toBeDefined()
    expect(result.actionTypes.length).toBe(10)
    expect(result.notes).toBeDefined()
  })

  it('returns limits topic', () => {
    const result = getDslReference('limits')
    expect(result.topic).toBe('limits')
    expect(result.limits).toBeDefined()
    expect(result.limits.length).toBeGreaterThan(0)
    expect(result.fieldPathRules).toBeDefined()
  })

  it('returns examples topic', () => {
    const result = getDslReference('examples')
    expect(result.topic).toBe('examples')
    expect(result.examples).toBeDefined()
    expect(result.examples.length).toBeGreaterThan(0)
  })

  it('returns all topics when topic is "all"', () => {
    const result = getDslReference('all')
    expect(result.topic).toBe('all')
    expect(result.comparisonOperators).toBeDefined()
    expect(result.logicalOperators).toBeDefined()
    expect(result.conditionStructure).toBeDefined()
    expect(result.templateVariables).toBeDefined()
    expect(result.interpolation).toBeDefined()
    expect(result.actionTypes).toBeDefined()
    expect(result.limits).toBeDefined()
    expect(result.fieldPathRules).toBeDefined()
    expect(result.examples).toBeDefined()
  })

  it('defaults to "all" when no topic provided', () => {
    const result = getDslReference()
    expect(result.topic).toBe('all')
  })

  it('includes all 16 comparison operators', () => {
    const result = getDslReference('operators')
    expect(result.comparisonOperators.length).toBe(16)
    const ops = result.comparisonOperators.map(o => o.operator)
    expect(ops).toContain('=')
    expect(ops).toContain('!=')
    expect(ops).toContain('>')
    expect(ops).toContain('IN')
    expect(ops).toContain('NOT_IN')
    expect(ops).toContain('CONTAINS')
    expect(ops).toContain('MATCHES')
    expect(ops).toContain('IS_EMPTY')
    expect(ops).toContain('IS_NOT_EMPTY')
  })

  it('includes all 10 action types', () => {
    const result = getDslReference('actions')
    const types = result.actionTypes.map(a => a.type)
    expect(types).toEqual([
      'ALLOW_TRANSITION', 'BLOCK_TRANSITION', 'LOG', 'SHOW_ERROR',
      'SHOW_WARNING', 'SHOW_INFO', 'NOTIFY', 'SET_FIELD',
      'CALL_WEBHOOK', 'EMIT_EVENT',
    ])
  })

  it('each action type has required fields documented', () => {
    const result = getDslReference('actions')
    for (const action of result.actionTypes) {
      expect(action.type).toBeTruthy()
      expect(action.description).toBeTruthy()
      expect(Array.isArray(action.requiredConfig)).toBe(true)
      expect(Array.isArray(action.optionalConfig)).toBe(true)
      expect(action.example).toBeDefined()
      expect(action.example.type).toBe(action.type)
    }
  })

  it('each comparison operator has a complete example', () => {
    const result = getDslReference('operators')
    for (const op of result.comparisonOperators) {
      expect(op.operator).toBeTruthy()
      expect(op.description).toBeTruthy()
      expect(op.valueType).toBeTruthy()
      expect(op.example).toBeDefined()
      expect(op.example.field).toBeTruthy()
      expect(op.example.operator).toBe(op.operator)
    }
  })

  it('condition structure documents both simple and group conditions', () => {
    const result = getDslReference('operators')
    expect(result.conditionStructure.simpleCondition).toBeDefined()
    expect(result.conditionStructure.groupCondition).toBeDefined()
    expect(result.conditionStructure.ruleTypes).toBeDefined()
    expect(result.conditionStructure.ruleTypes.GUARD).toBeTruthy()
    expect(result.conditionStructure.ruleTypes.VALIDATION).toBeTruthy()
    expect(result.conditionStructure.ruleTypes.CALCULATION).toBeTruthy()
    expect(result.conditionStructure.ruleTypes.ACTION).toBeTruthy()
    expect(result.conditionStructure.ruleTypes.ASSIGNMENT).toBeTruthy()
  })
})
