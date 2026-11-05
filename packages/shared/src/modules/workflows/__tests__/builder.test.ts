import { describe, test, expect } from '@jest/globals'
import { defineWorkflow } from '../builder'
import { createWorkflowsModuleConfig } from '../factory'

const minimalSteps = [
  { stepId: 'start', stepName: 'Start', stepType: 'START' as const },
  { stepId: 'end', stepName: 'End', stepType: 'END' as const },
] as const

const minimalTransitions = [
  { transitionId: 'to-end', fromStepId: 'start', toStepId: 'end', trigger: 'auto' as const },
]

describe('defineWorkflow()', () => {
  test('returns a CodeWorkflowDefinition with correct top-level structure', () => {
    const workflow = defineWorkflow({
      workflowId: 'sales.order-approval',
      workflowName: 'Order Approval',
      steps: minimalSteps,
      transitions: minimalTransitions,
    })

    expect(workflow.workflowId).toBe('sales.order-approval')
    expect(workflow.workflowName).toBe('Order Approval')
    expect(workflow).toHaveProperty('definition')
    expect(workflow).not.toHaveProperty('steps')
    expect(workflow.definition.steps).toBeDefined()
    expect(workflow.definition.transitions).toBeDefined()
  })

  test('maps steps with correct stepType, stepName, stepId', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      steps: [
        { stepId: 'start', stepName: 'Start Step', stepType: 'START' as const },
        { stepId: 'review', stepName: 'Review Step', stepType: 'USER_TASK' as const },
        { stepId: 'end', stepName: 'End Step', stepType: 'END' as const },
      ] as const,
      transitions: [
        { transitionId: 't1', fromStepId: 'start', toStepId: 'review', trigger: 'auto' as const },
        { transitionId: 't2', fromStepId: 'review', toStepId: 'end', trigger: 'manual' as const },
      ],
    })

    expect(workflow.definition.steps).toHaveLength(3)
    expect(workflow.definition.steps[0]).toMatchObject({ stepId: 'start', stepName: 'Start Step', stepType: 'START' })
    expect(workflow.definition.steps[1]).toMatchObject({ stepId: 'review', stepName: 'Review Step', stepType: 'USER_TASK' })
    expect(workflow.definition.steps[2]).toMatchObject({ stepId: 'end', stepName: 'End Step', stepType: 'END' })
  })

  test('maps transitions with correct fromStepId and toStepId', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      steps: minimalSteps,
      transitions: [
        {
          transitionId: 'start-to-end',
          fromStepId: 'start',
          toStepId: 'end',
          trigger: 'auto' as const,
          transitionName: 'Auto Complete',
          priority: 1,
        },
      ],
    })

    expect(workflow.definition.transitions).toHaveLength(1)
    expect(workflow.definition.transitions[0]).toMatchObject({
      transitionId: 'start-to-end',
      fromStepId: 'start',
      toStepId: 'end',
      trigger: 'auto',
      transitionName: 'Auto Complete',
      priority: 1,
    })
  })

  test('sets moduleId to empty string', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      steps: minimalSteps,
      transitions: minimalTransitions,
    })

    expect(workflow.moduleId).toBe('')
  })

  test('defaults enabled to true when not specified', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      steps: minimalSteps,
      transitions: minimalTransitions,
    })

    expect(workflow.enabled).toBe(true)
  })

  test('respects explicit enabled: false', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      enabled: false,
      steps: minimalSteps,
      transitions: minimalTransitions,
    })

    expect(workflow.enabled).toBe(false)
  })

  test('defaults version to 1 when not specified', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      steps: minimalSteps,
      transitions: minimalTransitions,
    })

    expect(workflow.version).toBe(1)
  })

  test('sets version correctly when specified', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      version: 3,
      steps: minimalSteps,
      transitions: minimalTransitions,
    })

    expect(workflow.version).toBe(3)
  })

  test('defaults description to null when not specified', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      steps: minimalSteps,
      transitions: minimalTransitions,
    })

    expect(workflow.description).toBeNull()
  })

  test('sets description when specified', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      description: 'Handles order approvals',
      steps: minimalSteps,
      transitions: minimalTransitions,
    })

    expect(workflow.description).toBe('Handles order approvals')
  })

  test('defaults metadata to null when not specified', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      steps: minimalSteps,
      transitions: minimalTransitions,
    })

    expect(workflow.metadata).toBeNull()
  })

  test('sets metadata when specified', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      metadata: { tags: ['sales', 'approval'], category: 'sales', icon: 'check' },
      steps: minimalSteps,
      transitions: minimalTransitions,
    })

    expect(workflow.metadata).toEqual({ tags: ['sales', 'approval'], category: 'sales', icon: 'check' })
  })

  test('omits triggers from definition when not specified', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      steps: minimalSteps,
      transitions: minimalTransitions,
    })

    expect(workflow.definition.triggers).toBeUndefined()
  })

  test('includes triggers in definition when specified', () => {
    const trigger = {
      triggerId: 'on-order-created',
      name: 'Order Created',
      eventPattern: 'sales.order.created',
      enabled: true,
      priority: 0,
    }

    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      steps: minimalSteps,
      transitions: minimalTransitions,
      triggers: [trigger],
    })

    expect(workflow.definition.triggers).toHaveLength(1)
    expect(workflow.definition.triggers![0]).toMatchObject(trigger)
  })

  test('does not include optional step fields when not provided', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      steps: [{ stepId: 'start', stepName: 'Start', stepType: 'START' as const }] as const,
      transitions: [],
    })

    const step = workflow.definition.steps[0]
    expect(step).not.toHaveProperty('description')
    expect(step).not.toHaveProperty('config')
    expect(step).not.toHaveProperty('userTaskConfig')
    expect(step).not.toHaveProperty('activities')
    expect(step).not.toHaveProperty('timeout')
    expect(step).not.toHaveProperty('retryPolicy')
  })

  test('includes optional step fields when provided', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      steps: [
        {
          stepId: 'review',
          stepName: 'Review',
          stepType: 'USER_TASK' as const,
          description: 'Manager reviews the order',
          timeout: 'P1D',
          retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
          userTaskConfig: { assignedTo: 'manager', slaDuration: 'P1D' },
        },
      ] as const,
      transitions: [],
    })

    const step = workflow.definition.steps[0]
    expect(step.description).toBe('Manager reviews the order')
    expect(step.timeout).toBe('P1D')
    expect(step.retryPolicy).toEqual({ maxAttempts: 3, backoffMs: 1000 })
    expect(step.userTaskConfig).toMatchObject({ assignedTo: 'manager', slaDuration: 'P1D' })
  })

  test('does not include optional transition fields when not provided', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      steps: minimalSteps,
      transitions: [{ transitionId: 't1', fromStepId: 'start', toStepId: 'end', trigger: 'auto' as const }],
    })

    const transition = workflow.definition.transitions[0]
    expect(transition).not.toHaveProperty('transitionName')
    expect(transition).not.toHaveProperty('preConditions')
    expect(transition).not.toHaveProperty('postConditions')
    expect(transition).not.toHaveProperty('activities')
    expect(transition).not.toHaveProperty('continueOnActivityFailure')
    expect(transition).not.toHaveProperty('priority')
  })

  test('works correctly with as const steps (key type safety feature)', () => {
    // TypeScript should infer literal step IDs from `as const`.
    // This test ensures the runtime behavior is correct when the pattern is used.
    const workflow = defineWorkflow({
      workflowId: 'sales.order-approval',
      workflowName: 'Order Approval',
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' as const },
        { stepId: 'review', stepName: 'Review', stepType: 'USER_TASK' as const },
        { stepId: 'end', stepName: 'End', stepType: 'END' as const },
      ] as const,
      transitions: [
        { transitionId: 'to-review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' as const },
        { transitionId: 'to-end', fromStepId: 'review', toStepId: 'end', trigger: 'manual' as const },
      ],
    })

    expect(workflow.definition.steps.map((s) => s.stepId)).toEqual(['start', 'review', 'end'])
    expect(workflow.definition.transitions.map((t) => t.fromStepId)).toEqual(['start', 'review'])
    expect(workflow.definition.transitions.map((t) => t.toStepId)).toEqual(['review', 'end'])
  })
})

describe('createWorkflowsModuleConfig()', () => {
  const workflowA = defineWorkflow({
    workflowId: 'test.workflow-a',
    workflowName: 'Workflow A',
    steps: minimalSteps,
    transitions: minimalTransitions,
  })

  const workflowB = defineWorkflow({
    workflowId: 'test.workflow-b',
    workflowName: 'Workflow B',
    steps: minimalSteps,
    transitions: minimalTransitions,
  })

  test('returns WorkflowsModuleConfig with correct structure', () => {
    const config = createWorkflowsModuleConfig({
      moduleId: 'sales',
      workflows: [workflowA],
    })

    expect(config).toHaveProperty('moduleId')
    expect(config).toHaveProperty('workflows')
    expect(Array.isArray(config.workflows)).toBe(true)
  })

  test('sets moduleId on the config', () => {
    const config = createWorkflowsModuleConfig({
      moduleId: 'sales',
      workflows: [workflowA],
    })

    expect(config.moduleId).toBe('sales')
  })

  test('sets moduleId on all workflows', () => {
    const config = createWorkflowsModuleConfig({
      moduleId: 'sales',
      workflows: [workflowA, workflowB],
    })

    expect(config.workflows[0].moduleId).toBe('sales')
    expect(config.workflows[1].moduleId).toBe('sales')
  })

  test('preserves workflow properties after moduleId assignment', () => {
    const workflow = defineWorkflow({
      workflowId: 'sales.order-approval',
      workflowName: 'Order Approval',
      description: 'Approves orders',
      version: 2,
      enabled: false,
      metadata: { tags: ['sales'], category: 'approvals' },
      steps: minimalSteps,
      transitions: minimalTransitions,
    })

    const config = createWorkflowsModuleConfig({
      moduleId: 'sales',
      workflows: [workflow],
    })

    const result = config.workflows[0]
    expect(result.workflowId).toBe('sales.order-approval')
    expect(result.workflowName).toBe('Order Approval')
    expect(result.description).toBe('Approves orders')
    expect(result.version).toBe(2)
    expect(result.enabled).toBe(false)
    expect(result.metadata).toEqual({ tags: ['sales'], category: 'approvals' })
    expect(result.definition.steps).toHaveLength(2)
    expect(result.definition.transitions).toHaveLength(1)
  })

  test('does not mutate the original workflow objects', () => {
    const workflow = defineWorkflow({
      workflowId: 'test.workflow',
      workflowName: 'Test',
      steps: minimalSteps,
      transitions: minimalTransitions,
    })

    expect(workflow.moduleId).toBe('')

    createWorkflowsModuleConfig({ moduleId: 'sales', workflows: [workflow] })

    expect(workflow.moduleId).toBe('')
  })

  test('handles empty workflows array', () => {
    const config = createWorkflowsModuleConfig({
      moduleId: 'sales',
      workflows: [],
    })

    expect(config.moduleId).toBe('sales')
    expect(config.workflows).toHaveLength(0)
  })
})
