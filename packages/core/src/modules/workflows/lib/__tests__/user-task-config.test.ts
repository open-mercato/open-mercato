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

/**
 * Task inspector vocabulary (spec §6.1). Every assertion goes through
 * `workflowStepSchema.parse` for the same reason the A1 suite above does: that
 * parse IS the save, and an undeclared key is discarded there silently.
 */
const inspectorNode: Node = {
  id: 'approve-refund',
  type: 'userTask',
  position: { x: 0, y: 0 },
  data: {
    label: 'Approve Refund',
    instructions: { en: 'Check {{context.order.total}} against policy.', pl: 'Sprawdź kwotę.' },
    entityBindings: [
      { entityType: 'customers:person', idPath: 'context.customerId', label: 'Customer' },
      { entityType: 'sales:order', idPath: 'context.order.id' },
    ],
    priority: 'high',
    deadline: { duration: 'PT4H' },
    reminders: [{ offset: 'PT1H' }, { offset: 'PT15M' }],
    onBreach: { action: 'route', transitionId: 't_breach_escalate' },
    decisions: [
      { id: 'approve', label: 'Approve', transitionId: 't_approve', style: 'primary' },
      { id: 'reject', label: { en: 'Reject' }, transitionId: 't_reject', style: 'destructive' },
    ],
    editablePrefilled: ['refundAmount'],
  },
}

const inspectorEdges: Edge[] = [
  { id: 't_approve', source: 'approve-refund', target: 'end' },
]

describe('task inspector vocabulary round trip (spec §6.1)', () => {
  test('the save keeps every authored inspector field', () => {
    const definition = graphToDefinition([inspectorNode, endNode], inspectorEdges)
    const saved = saveStep(definition.steps.find((step: any) => step.stepId === 'approve-refund'))
    const config = saved.userTaskConfig

    expect(config?.instructions).toEqual({
      en: 'Check {{context.order.total}} against policy.',
      pl: 'Sprawdź kwotę.',
    })
    expect(config?.entityBindings).toEqual([
      { entityType: 'customers:person', idPath: 'context.customerId', label: 'Customer' },
      { entityType: 'sales:order', idPath: 'context.order.id' },
    ])
    expect(config?.priority).toBe('high')
    expect(config?.deadline).toEqual({ duration: 'PT4H' })
    expect(config?.reminders).toEqual([{ offset: 'PT1H' }, { offset: 'PT15M' }])
    expect(config?.onBreach).toEqual({ action: 'route', transitionId: 't_breach_escalate' })
    expect(config?.decisions).toEqual([
      { id: 'approve', label: 'Approve', transitionId: 't_approve', style: 'primary' },
      { id: 'reject', label: { en: 'Reject' }, transitionId: 't_reject', style: 'destructive' },
    ])
    expect(config?.editablePrefilled).toEqual(['refundAmount'])
  })

  test('inspector fields survive graphToDefinition → save → definitionToGraph → save', () => {
    const first = graphToDefinition([inspectorNode, endNode], inspectorEdges)
    const persisted = { ...first, steps: first.steps.map((step: any) => saveStep(step)) }
    const { nodes, edges } = definitionToGraph(persisted as any)

    const reloaded = nodes.find((node) => node.id === 'approve-refund')
    expect(reloaded?.data.priority).toBe('high')
    expect(reloaded?.data.decisions).toEqual(inspectorNode.data.decisions)
    expect(reloaded?.data.entityBindings).toEqual(inspectorNode.data.entityBindings)
    expect(edges.find((edge) => edge.id === 't_approve')?.sourceHandle).toBe('t_approve')

    const resaved = saveStep(
      graphToDefinition(nodes, edges).steps.find((step: any) => step.stepId === 'approve-refund')
    )
    expect(resaved.userTaskConfig?.instructions).toEqual(inspectorNode.data.instructions)
    expect(resaved.userTaskConfig?.deadline).toEqual({ duration: 'PT4H' })
    expect(resaved.userTaskConfig?.reminders).toEqual([{ offset: 'PT1H' }, { offset: 'PT15M' }])
    expect(resaved.userTaskConfig?.onBreach).toEqual({ action: 'route', transitionId: 't_breach_escalate' })
    expect(resaved.userTaskConfig?.editablePrefilled).toEqual(['refundAmount'])
  })

  test('a plain-string instruction and a legacy transition id are both accepted', () => {
    const saved = saveStep({
      stepId: 'legacy',
      stepName: 'Legacy',
      stepType: 'USER_TASK',
      userTaskConfig: {
        instructions: 'Approve the refund.',
        decisions: [{ id: 'approve', label: 'Approve', transitionId: 'e_legacy_end' }],
      },
    })

    expect(saved.userTaskConfig?.instructions).toBe('Approve the refund.')
    expect(saved.userTaskConfig?.decisions?.[0]?.transitionId).toBe('e_legacy_end')
  })

  test('a config declaring none of the new fields parses byte-identically', () => {
    const legacyConfig = {
      assignedTo: 'manager@example.com',
      slaDuration: 'P1D',
      escalationRules: [{ trigger: 'sla_breach', action: 'notify' }],
    }

    const saved = saveStep({
      stepId: 'legacy',
      stepName: 'Legacy',
      stepType: 'USER_TASK',
      userTaskConfig: legacyConfig,
    })

    expect(saved.userTaskConfig).toEqual(legacyConfig)
    expect(Object.keys(saved.userTaskConfig ?? {})).toEqual(Object.keys(legacyConfig))
  })

  test('a graph authoring none of the new fields serializes byte-identically', () => {
    const definition = graphToDefinition([authoredUserTaskNode, endNode], authoredEdges)
    const step = definition.steps.find((entry: any) => entry.stepId === 'approve-invoice')

    expect(step.userTaskConfig).toEqual({
      assignedTo: undefined,
      assignedToRoles: ['finance_approver', 'controller'],
      formKey: 'invoice-approval',
      allowedActions: ['complete', 'reject'],
    })
  })

  test('an invalid priority or decision is rejected rather than silently dropped', () => {
    expect(() =>
      saveStep({
        stepId: 'bad',
        stepName: 'Bad',
        stepType: 'USER_TASK',
        userTaskConfig: { priority: 'urgent' },
      })
    ).toThrow()

    expect(() =>
      saveStep({
        stepId: 'bad',
        stepName: 'Bad',
        stepType: 'USER_TASK',
        userTaskConfig: { decisions: [{ id: 'approve', label: 'Approve' }] },
      })
    ).toThrow()
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

/**
 * Task creation resolves what the author wrote (spec §6.1).
 *
 * `handleUserTaskStep` used to do NO interpolation at all: a title, an assignee
 * or a binding written as a ledger pill reached the database verbatim. These
 * drive the real `executeStep` so the assertions are about the row the engine
 * would actually insert.
 */
describe('task creation resolves the authored task', () => {
  const testTenantId = '00000000-0000-4000-8000-000000000001'
  const testOrgId = '00000000-0000-4000-8000-000000000002'
  const testDefinitionId = '00000000-0000-4000-8000-000000000003'
  const testInstanceId = '00000000-0000-4000-8000-000000000004'

  type CreatedTask = Record<string, any>

  async function createTaskFor(
    step: Record<string, unknown>,
    workflowContext: Record<string, unknown>
  ): Promise<{ task: CreatedTask; events: CreatedTask[] }> {
    const mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      persist: jest.fn(function persist(this: any) { return this }),
      flush: jest.fn(),
      nativeDelete: jest.fn(),
    } as any

    const savedStep = saveStep({ stepType: 'USER_TASK', ...step })
    const definition: Partial<WorkflowDefinition> = {
      id: testDefinitionId,
      workflowId: 'refunds',
      workflowName: 'Refunds',
      version: 1,
      enabled: true,
      definition: { steps: [savedStep], transitions: [] } as any,
      tenantId: testTenantId,
      organizationId: testOrgId,
    }

    const instance: Partial<WorkflowInstance> = {
      id: testInstanceId,
      definitionId: testDefinitionId,
      workflowId: 'refunds',
      version: 1,
      status: 'RUNNING',
      currentStepId: savedStep.stepId,
      context: workflowContext,
      tenantId: testTenantId,
      organizationId: testOrgId,
      startedAt: new Date(),
    }

    mockEm.findOne
      .mockResolvedValueOnce(definition as WorkflowDefinition)
      .mockResolvedValueOnce(definition as WorkflowDefinition)

    mockEm.create.mockImplementation((_entity: unknown, payload: CreatedTask) => ({
      id: 'created-1',
      ...payload,
    }))

    await stepHandler.executeStep(mockEm, instance as WorkflowInstance, savedStep.stepId, {
      workflowContext,
    })

    const calls = (mockEm.create as jest.Mock).mock.calls as Array<[unknown, CreatedTask]>
    const task = calls.find(([, payload]) => 'taskName' in payload)?.[1] as CreatedTask
    const events = calls
      .filter(([, payload]) => payload?.eventType === 'USER_TASK_CREATED')
      .map(([, payload]) => payload)

    return { task, events }
  }

  test('interpolates the task title and the authored instructions', async () => {
    const { task } = await createTaskFor(
      {
        stepId: 'approve-refund',
        stepName: 'Approve refund for {{context.customerName}}',
        userTaskConfig: {
          instructions: { en: 'Refund {{context.order.total}} on order {{context.order.id}}.' },
        },
      },
      { customerName: 'Acme', order: { id: 'order-9', total: 250 } }
    )

    expect(task.taskName).toBe('Approve refund for Acme')
    expect(task.description).toBe('Refund 250 on order order-9.')
  })

  test('resolves a dynamic assignee from a ledger pill', async () => {
    const { task } = await createTaskFor(
      {
        stepId: 'approve-refund',
        stepName: 'Approve refund',
        userTaskConfig: {
          assignedTo: '{{context.deal.ownerId}}',
          assignedToRoles: ['approver'],
        },
      },
      { deal: { ownerId: 'user-42' } }
    )

    expect(task.assignedTo).toBe('user-42')
    expect(task.assignedToRoles).toEqual(['approver'])
  })

  test('falls back to the role queue when the dynamic assignee misses', async () => {
    const { task, events } = await createTaskFor(
      {
        stepId: 'approve-refund',
        stepName: 'Approve refund',
        userTaskConfig: {
          assignedTo: '{{context.deal.ownerId}}',
          assignedToRoles: ['approver'],
        },
      },
      { deal: {} }
    )

    expect(task.assignedTo).toBeNull()
    expect(task.assignedToRoles).toEqual(['approver'])
    expect(events[0]?.eventData?.assignmentFallback).toBe('roles')
  })

  test('writes the resolved entity bindings to the column and skips a missing id', async () => {
    const { task, events } = await createTaskFor(
      {
        stepId: 'approve-refund',
        stepName: 'Approve refund',
        userTaskConfig: {
          priority: 'high',
          entityBindings: [
            { entityType: 'customers:person', idPath: 'context.customerId', label: 'Customer' },
            { entityType: 'sales:invoice', idPath: 'context.invoiceId' },
          ],
        },
      },
      { customerId: 'customer-7' }
    )

    expect(task.entityBindings).toEqual([
      { entityType: 'customers:person', entityId: 'customer-7', label: 'Customer' },
    ])
    expect(task.priority).toBe('high')
    expect(events[0]?.eventData?.entityBindings).toEqual(task.entityBindings)
    expect(events[0]?.eventData?.priority).toBe('high')
  })

  /**
   * The §6.4 entity gate filters on `user_tasks.entity_types` in SQL, so the
   * column must be written from the SAME resolved bindings the row carries — a
   * denormalization that can drift is a task that goes invisible without a
   * trace.
   */
  test('denormalizes the distinct authored entity types beside the bindings', async () => {
    const { task } = await createTaskFor(
      {
        stepId: 'approve-refund',
        stepName: 'Approve refund',
        userTaskConfig: {
          entityBindings: [
            { entityType: 'customers:person', idPath: 'context.customerId' },
            { entityType: 'sales:sales_order', idPath: 'context.orderId' },
            { entityType: 'customers:person', idPath: 'context.approverId' },
            { entityType: 'sales:invoice', idPath: 'context.missingId' },
          ],
        },
      },
      { customerId: 'customer-7', orderId: 'order-9', approverId: 'person-3' }
    )

    // Verbatim, deduped, and derived only from bindings that actually resolved:
    // a dropped binding must not leave a type the caller is gated on.
    expect(task.entityTypes).toEqual(['customers:person', 'sales:sales_order'])
    expect(new Set(task.entityBindings.map((binding: any) => binding.entityType))).toEqual(
      new Set(task.entityTypes)
    )
  })

  /**
   * NULL is "no bindings", which the predicate passes vacuously for a backoffice
   * principal. Storing `[]` instead would read the same today but invites a
   * future `entity_types = '{}'` filter to treat it as a distinct case, and it
   * would make new rows differ from the entire pre-Phase-4 corpus, which is NULL.
   */
  test('a task about nothing stores null entity types, not an empty array', async () => {
    const { task } = await createTaskFor(
      { stepId: 'approve-refund', stepName: 'Approve refund', userTaskConfig: {} },
      {}
    )
    expect(task.entityBindings).toBeNull()
    expect(task.entityTypes).toBeNull()
  })

  test('a binding whose id does not resolve contributes no entity type', async () => {
    const { task } = await createTaskFor(
      {
        stepId: 'approve-refund',
        stepName: 'Approve refund',
        userTaskConfig: {
          entityBindings: [{ entityType: 'sales:invoice', idPath: 'context.invoiceId' }],
        },
      },
      {}
    )
    expect(task.entityBindings).toBeNull()
    expect(task.entityTypes).toBeNull()
  })

  /**
   * Design §7.1: a workflow-authored assignee is always a backoffice user id.
   * A portal principal only ever becomes an assignee through the Phase 4b portal
   * surface, and `assignedToRoles` is never combined with `'customer'` — portal
   * roles are a different namespace and portal principals cannot claim a queue.
   */
  test('workflow-created tasks always carry the backoffice assignee kind', async () => {
    const assigned = await createTaskFor(
      {
        stepId: 'approve-refund',
        stepName: 'Approve refund',
        userTaskConfig: { assignedTo: 'manager@example.com' },
      },
      {}
    )
    const queued = await createTaskFor(
      {
        stepId: 'approve-refund',
        stepName: 'Approve refund',
        userTaskConfig: { assignedToRoles: ['approver'] },
      },
      {}
    )

    expect(assigned.task.assigneeKind).toBe('user')
    expect(queued.task.assigneeKind).toBe('user')
    expect(queued.task.assignedToRoles).toEqual(['approver'])
  })

  test('logs the resolved decisions on USER_TASK_CREATED', async () => {
    const { events } = await createTaskFor(
      {
        stepId: 'approve-refund',
        stepName: 'Approve refund',
        userTaskConfig: {
          decisions: [
            { id: 'approve', label: 'Approve {{context.order.id}}', transitionId: 't_approve' },
          ],
        },
      },
      { order: { id: 'order-9' } }
    )

    expect(events[0]?.eventData?.decisions).toEqual([
      { id: 'approve', label: 'Approve order-9', transitionId: 't_approve' },
    ])
  })

  test('the deadline supersedes slaDuration, which keeps working on its own', async () => {
    const withDeadline = await createTaskFor(
      {
        stepId: 'approve-refund',
        stepName: 'Approve refund',
        userTaskConfig: { deadline: { duration: 'PT4H' }, slaDuration: 'P30D' },
      },
      {}
    )
    const legacy = await createTaskFor(
      {
        stepId: 'approve-refund',
        stepName: 'Approve refund',
        userTaskConfig: { slaDuration: 'PT4H' },
      },
      {}
    )

    const hoursAhead = (due: Date) => Math.round((due.getTime() - Date.now()) / 3_600_000)
    expect(hoursAhead(withDeadline.task.dueDate)).toBe(4)
    expect(hoursAhead(legacy.task.dueDate)).toBe(4)
  })

  test('a config using none of the new fields produces a byte-identical task row', async () => {
    const { task, events } = await createTaskFor(
      {
        stepId: 'approve-refund',
        stepName: 'Approve refund',
        description: 'Check the paperwork',
        userTaskConfig: { assignedTo: 'manager@example.com', slaDuration: 'P1D' },
      },
      { order: { id: 'order-9' } }
    )

    expect(task.taskName).toBe('Approve refund')
    expect(task.description).toBe('Check the paperwork')
    expect(task.assignedTo).toBe('manager@example.com')
    expect(task.assignedToRoles).toBeNull()
    expect(task.entityBindings).toBeNull()
    expect(task.priority).toBeNull()
    expect(task.formData).toBeNull()
    expect(task.status).toBe('PENDING')
    expect(Object.keys(events[0]?.eventData ?? {})).toEqual([
      'userTaskId',
      'taskName',
      'assignedTo',
      'assignedToRoles',
    ])
  })
})
