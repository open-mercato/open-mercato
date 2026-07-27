/**
 * Workflow Function Registry Tests
 *
 * Step 4.5: descriptor-only registry for EXECUTE_FUNCTION function names.
 * Execution keeps resolving workflowFunction:<name> via DI — this registry
 * only feeds the function picker with authorable suggestions.
 */

import {
  clearWorkflowFunctionsForTests,
  getWorkflowFunction,
  listWorkflowFunctions,
  registerWorkflowFunctions,
} from '../workflow-function-registry'

describe('workflow-function-registry', () => {
  beforeEach(() => {
    clearWorkflowFunctionsForTests()
  })

  afterEach(() => {
    clearWorkflowFunctionsForTests()
  })

  it('registers descriptors and lists them in registration order', () => {
    registerWorkflowFunctions([
      { name: 'inventory.recalculateStock', labelKey: 'inventory.workflowFunctions.recalculateStock' },
      { name: 'sales.computeDiscount', description: 'Computes the applicable discount' },
    ])

    expect(listWorkflowFunctions()).toEqual([
      { name: 'inventory.recalculateStock', labelKey: 'inventory.workflowFunctions.recalculateStock' },
      { name: 'sales.computeDiscount', description: 'Computes the applicable discount' },
    ])
  })

  it('is idempotent per name — re-registering replaces the descriptor', () => {
    registerWorkflowFunctions([{ name: 'inventory.recalculateStock', description: 'First' }])
    registerWorkflowFunctions([{ name: 'inventory.recalculateStock', description: 'Second' }])

    expect(listWorkflowFunctions()).toEqual([
      { name: 'inventory.recalculateStock', description: 'Second' },
    ])
  })

  it('trims names and drops empty optional fields', () => {
    registerWorkflowFunctions([{ name: '  inventory.recalculateStock  ' }])

    expect(getWorkflowFunction('inventory.recalculateStock')).toEqual({ name: 'inventory.recalculateStock' })
  })

  it('returns null for unknown, empty, or non-string lookups', () => {
    registerWorkflowFunctions([{ name: 'inventory.recalculateStock' }])

    expect(getWorkflowFunction('unknown.function')).toBeNull()
    expect(getWorkflowFunction('')).toBeNull()
    expect(getWorkflowFunction('   ')).toBeNull()
    expect(getWorkflowFunction(42)).toBeNull()
    expect(getWorkflowFunction(null)).toBeNull()
  })

  it('rejects descriptors without a usable name', () => {
    expect(() => registerWorkflowFunctions([{ name: '   ' }])).toThrow()
    expect(() => registerWorkflowFunctions([{ name: undefined as unknown as string }])).toThrow()
  })
})
