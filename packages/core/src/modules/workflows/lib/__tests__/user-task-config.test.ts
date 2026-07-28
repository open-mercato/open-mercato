import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { Node, Edge } from '@xyflow/react'
import { definitionToGraph, graphToDefinition } from '../graph-utils'
import * as stepHandler from '../step-handler'
import { workflowStepSchema } from '../../data/validators'
import type { StepInstance, UserTask, WorkflowDefinition, WorkflowInstance } from '../../data/entities'

/**
 * Regression suite for A1: `userTaskConfigSchema` declared neither
 * `assignedToRoles`, `formKey` nor `allowedActions`, while the Studio wrote all
 * three and the engine read `assignedToRoles`. Zod strips unknown keys and the
 * definition PUT persists the PARSED value, so role assignment authored in the
 * Studio never reached the database — the save looked successful and the task
 * came out unassigned.
 *
 * Every test here parses through `workflowStepSchema` on purpose: that parse IS
 * the save, and it is what used to discard the fields.
 */

const authoredUserTaskNode: Node = {
  id: 'approve-invoice',
  type: 'userTask',
  position: { x: 0, y: 0 },
  data: {
    label: 'Approve Invoice',
    assignedToRoles: ['finance_approver', 'controller'],
    formKey: 'invoice-approval',
    allowedActions: ['complete', 'reject'],
  },
}

const endNode: Node = {
  id: 'end',
  type: 'end',
  position: { x: 200, y: 0 },
  data: { label: 'End' },
}

const authoredEdges: Edge[] = [
  { id: 't_approve_end', source: 'approve-invoice', target: 'end' },
]

function saveStep(step: unknown) {
  return workflowStepSchema.parse(step)
}

describe('user task config round trip (A1 regression)', () => {
  test('the save no longer strips authored role assignment, form key and allowed actions', () => {
    const definition = graphToDefinition([authoredUserTaskNode, endNode], authoredEdges)
    const authoredStep = definition.steps.find((step: any) => step.stepId === 'approve-invoice')

    const savedStep = saveStep(authoredStep)

    expect(savedStep.userTaskConfig?.assignedToRoles).toEqual(['finance_approver', 'controller'])
    expect(savedStep.userTaskConfig?.formKey).toBe('invoice-approval')
    expect(savedStep.userTaskConfig?.allowedActions).toEqual(['complete', 'reject'])
  })

  test('authored roles survive graphToDefinition → save → definitionToGraph', () => {
    const definition = graphToDefinition([authoredUserTaskNode, endNode], authoredEdges)
    const persisted = {
      ...definition,
      steps: definition.steps.map((step: any) => saveStep(step)),
    }

    const { nodes } = definitionToGraph(persisted as any)
    const reloaded = nodes.find((node) => node.id === 'approve-invoice')

    expect(reloaded?.data.assignedToRoles).toEqual(['finance_approver', 'controller'])
    expect(reloaded?.data.formKey).toBe('invoice-approval')
    expect(reloaded?.data.allowedActions).toEqual(['complete', 'reject'])
  })

  test('a second save of the reloaded graph is still lossless', () => {
    const first = graphToDefinition([authoredUserTaskNode, endNode], authoredEdges)
    const persisted = { ...first, steps: first.steps.map((step: any) => saveStep(step)) }
    const { nodes, edges } = definitionToGraph(persisted as any)
    const second = graphToDefinition(nodes, edges)
    const resaved = saveStep(second.steps.find((step: any) => step.stepId === 'approve-invoice'))

    expect(resaved.userTaskConfig?.assignedToRoles).toEqual(['finance_approver', 'controller'])
    expect(resaved.userTaskConfig?.formKey).toBe('invoice-approval')
    expect(resaved.userTaskConfig?.allowedActions).toEqual(['complete', 'reject'])
  })
})

describe('user task config reaches the engine after a save', () => {
  const testTenantId = '00000000-0000-4000-8000-000000000001'
  const testOrgId = '00000000-0000-4000-8000-000000000002'
  const testDefinitionId = '00000000-0000-4000-8000-000000000003'
  const testInstanceId = '00000000-0000-4000-8000-000000000004'

  let mockEm: jest.Mocked<EntityManager>

  beforeEach(() => {
    mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      persist: jest.fn(function persist(this: any) { return this }),
      flush: jest.fn(),
      nativeDelete: jest.fn(),
    } as any
  })

  test('handleUserTaskStep assigns the roles the author saved', async () => {
    const graphDefinition = graphToDefinition([authoredUserTaskNode, endNode], authoredEdges)
    const savedSteps = graphDefinition.steps.map((step: any) => saveStep(step))

    const definition: Partial<WorkflowDefinition> = {
      id: testDefinitionId,
      workflowId: 'invoice-approval',
      workflowName: 'Invoice Approval',
      version: 1,
      enabled: true,
      definition: { steps: savedSteps, transitions: [] } as any,
      tenantId: testTenantId,
      organizationId: testOrgId,
    }

    const instance: Partial<WorkflowInstance> = {
      id: testInstanceId,
      definitionId: testDefinitionId,
      workflowId: 'invoice-approval',
      version: 1,
      status: 'RUNNING',
      currentStepId: 'approve-invoice',
      context: {},
      tenantId: testTenantId,
      organizationId: testOrgId,
      startedAt: new Date(),
    }

    mockEm.findOne
      .mockResolvedValueOnce(definition as WorkflowDefinition)
      .mockResolvedValueOnce(definition as WorkflowDefinition)

    mockEm.create
      .mockReturnValueOnce({
        id: 'step-instance-1',
        workflowInstanceId: testInstanceId,
        stepId: 'approve-invoice',
        stepName: 'Approve Invoice',
        stepType: 'USER_TASK',
        status: 'ACTIVE',
        tenantId: testTenantId,
        organizationId: testOrgId,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as StepInstance)
      .mockReturnValueOnce({} as any)
      .mockReturnValueOnce({ id: 'user-task-1' } as UserTask)
      .mockReturnValueOnce({} as any)

    const result = await stepHandler.executeStep(
      mockEm,
      instance as WorkflowInstance,
      'approve-invoice',
      { workflowContext: {} }
    )

    expect(result.status).toBe('WAITING')
    const userTaskCall = (mockEm.create as jest.Mock).mock.calls[2] as [unknown, any]
    expect(userTaskCall[1].assignedToRoles).toEqual(['finance_approver', 'controller'])
    expect(userTaskCall[1].assignedTo).toBeNull()
  })
})
