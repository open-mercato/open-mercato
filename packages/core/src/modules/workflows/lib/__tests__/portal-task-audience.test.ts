import { describe, test, expect } from '@jest/globals'
import type { Node, Edge } from '@xyflow/react'
import { definitionToGraph, graphToDefinition } from '../graph-utils'
import { workflowStepSchema } from '../../data/validators'
import { nodeToFormValues, formValuesToNodeUpdates, type NodeFormValues } from '../nodeFormTransforms'
import { collectPortalTaskBindingWarnings } from '../flow-logic-warnings'
import {
  assignmentModesForAssigneeKind,
  coerceAssignmentModeToAssigneeKind,
  deriveTaskAssigneeKind,
  resolveTaskAssigneeKindPersistence,
} from '../task-inspector-config'

/**
 * `userTaskConfig.assigneeKind` is what addresses a USER_TASK to a PORTAL
 * principal (design §7.1), and until now it was authorable only through the Code
 * view — where a Studio save then silently dropped it, because
 * `graphToDefinition` rebuilds `userTaskConfig` from a fixed key list that did
 * not include it.
 *
 * Every assertion that concerns persistence parses through `workflowStepSchema`
 * on purpose, following `user-task-config.test.ts`: that parse IS the save.
 */

const endNode: Node = {
  id: 'end',
  type: 'end',
  position: { x: 200, y: 0 },
  data: { label: 'End' },
}

function portalNode(data: Record<string, unknown> = {}): Node {
  return {
    id: 'confirm-delivery',
    type: 'userTask',
    position: { x: 0, y: 0 },
    data: {
      label: 'Confirm delivery',
      assignedTo: '{{context.customer.userId}}',
      assigneeKind: 'customer',
      entityBindings: [{ entityType: 'customers:person', idPath: 'context.customer.personId' }],
      userTaskConfig: {
        assignedTo: '{{context.customer.userId}}',
        assigneeKind: 'customer',
        entityBindings: [{ entityType: 'customers:person', idPath: 'context.customer.personId' }],
      },
      ...data,
    },
  }
}

const portalEdges: Edge[] = [{ id: 't_done', source: 'confirm-delivery', target: 'end' }]

function saveStep(step: unknown) {
  return workflowStepSchema.parse(step)
}

describe('portal audience survives the editor round trip', () => {
  test('a customer-addressed task keeps its assigneeKind through save → reload → save', () => {
    const first = graphToDefinition([portalNode(), endNode], portalEdges)
    const savedFirst = saveStep(first.steps.find((step: any) => step.stepId === 'confirm-delivery'))
    expect(savedFirst.userTaskConfig?.assigneeKind).toBe('customer')

    const persisted = { ...first, steps: first.steps.map((step: any) => saveStep(step)) }
    const { nodes, edges } = definitionToGraph(persisted as any)
    const reloaded = nodes.find((node) => node.id === 'confirm-delivery')
    expect(reloaded?.data.assigneeKind).toBe('customer')

    const resaved = saveStep(
      graphToDefinition(nodes, edges).steps.find((step: any) => step.stepId === 'confirm-delivery'),
    )
    expect(resaved.userTaskConfig?.assigneeKind).toBe('customer')
  })

  test('the inspector transforms carry the audience from node data back to the save payload', () => {
    const node = portalNode()
    const loaded = nodeToFormValues(node)

    expect(loaded.taskAssigneeKind).toBe('customer')
    // A pill assignee with the customer audience opens on Dynamic, which the
    // customer audience does offer.
    expect(loaded.assignmentMode).toBe('dynamic')

    const updates = formValuesToNodeUpdates(loaded as NodeFormValues, node)
    expect((updates as any).userTaskConfig.assigneeKind).toBe('customer')
    expect((updates as any).assigneeKind).toBe('customer')
  })

  test('an author switching the audience to customer writes the key', () => {
    const node: Node = {
      id: 'approve',
      type: 'userTask',
      position: { x: 0, y: 0 },
      data: { label: 'Approve', assignedTo: '{{context.customer.userId}}' },
    }
    const values = { ...nodeToFormValues(node), taskAssigneeKind: 'customer' as const }

    const updates = formValuesToNodeUpdates(values as NodeFormValues, node)
    expect((updates as any).userTaskConfig.assigneeKind).toBe('customer')
  })
})

describe('a task that never declares an audience is untouched', () => {
  const backofficeNode: Node = {
    id: 'approve-invoice',
    type: 'userTask',
    position: { x: 0, y: 0 },
    data: {
      label: 'Approve Invoice',
      assignedToRoles: ['finance_approver'],
      formKey: 'invoice-approval',
      allowedActions: ['complete', 'cancel'],
    },
  }
  const backofficeEdges: Edge[] = [{ id: 't_end', source: 'approve-invoice', target: 'end' }]

  test('graphToDefinition emits exactly the keys it emitted before', () => {
    const definition = graphToDefinition([backofficeNode, endNode], backofficeEdges)
    const step = definition.steps.find((entry: any) => entry.stepId === 'approve-invoice')

    expect(step.userTaskConfig).toEqual({
      assignedTo: undefined,
      assignedToRoles: ['finance_approver'],
      formKey: 'invoice-approval',
      allowedActions: ['complete', 'cancel'],
    })
    expect(Object.keys(step.userTaskConfig)).not.toContain('assigneeKind')
  })

  test('an untouched load → save adds no assigneeKind, and an explicit "user" is preserved', () => {
    const untouched = formValuesToNodeUpdates(
      nodeToFormValues(backofficeNode) as NodeFormValues,
      backofficeNode,
    )
    expect((untouched as any).userTaskConfig).not.toHaveProperty('assigneeKind')
    expect((untouched as any).assigneeKind).toBeUndefined()

    const explicitNode: Node = {
      ...backofficeNode,
      data: { ...backofficeNode.data, assigneeKind: 'user', userTaskConfig: { assigneeKind: 'user' } },
    }
    const preserved = formValuesToNodeUpdates(
      nodeToFormValues(explicitNode) as NodeFormValues,
      explicitNode,
    )
    expect((preserved as any).userTaskConfig.assigneeKind).toBe('user')
  })

  test('the persistence rule writes only what the engine acts on', () => {
    expect(resolveTaskAssigneeKindPersistence(undefined, 'user')).toBeUndefined()
    expect(resolveTaskAssigneeKindPersistence(undefined, 'customer')).toBe('customer')
    expect(resolveTaskAssigneeKindPersistence('user', 'user')).toBe('user')
    expect(resolveTaskAssigneeKindPersistence('customer', 'user')).toBeUndefined()
  })
})

describe('the audience gates the assignment modes the engine can honour', () => {
  test('a portal task offers only the two modes that name an individual', () => {
    expect(assignmentModesForAssigneeKind('user')).toEqual(['role', 'user', 'dynamic', 'rule'])
    expect(assignmentModesForAssigneeKind('customer')).toEqual(['user', 'dynamic'])
  })

  test('a role-queue or rule assignment collapses to Dynamic under the customer audience', () => {
    expect(coerceAssignmentModeToAssigneeKind('role', 'customer')).toBe('dynamic')
    expect(coerceAssignmentModeToAssigneeKind('rule', 'customer')).toBe('dynamic')
    expect(coerceAssignmentModeToAssigneeKind('user', 'customer')).toBe('user')
    expect(coerceAssignmentModeToAssigneeKind('role', 'user')).toBe('role')
  })

  test('a stored role-queue portal task does not open on a tab the audience cannot execute', () => {
    const node: Node = {
      id: 'queued',
      type: 'userTask',
      position: { x: 0, y: 0 },
      data: {
        label: 'Queued',
        assignedToRoles: ['support'],
        assigneeKind: 'customer',
        userTaskConfig: { assignedToRoles: ['support'], assigneeKind: 'customer' },
      },
    }

    expect(nodeToFormValues(node).assignmentMode).toBe('dynamic')
  })

  test('an absent or unknown audience reads as the backoffice one', () => {
    expect(deriveTaskAssigneeKind({})).toBe('user')
    expect(deriveTaskAssigneeKind({ assigneeKind: 'user' })).toBe('user')
    expect(deriveTaskAssigneeKind({ assigneeKind: 'customer' })).toBe('customer')
  })
})

describe('an unbound portal task is a Problems-panel warning', () => {
  function definitionWith(userTaskConfig: Record<string, unknown>) {
    return {
      steps: [{ stepId: 'confirm', stepName: 'Confirm', stepType: 'USER_TASK', userTaskConfig }],
      transitions: [],
    }
  }

  test('a customer-addressed task about no record warns, and never blocks the save', () => {
    const warnings = collectPortalTaskBindingWarnings(
      definitionWith({ assignedTo: '{{context.customer.userId}}', assigneeKind: 'customer' }) as any,
    )

    expect(warnings).toEqual([
      {
        code: 'taskPortalWithoutBinding',
        path: ['steps', 0],
        params: { stepId: 'confirm' },
        severity: 'warning',
      },
    ])
  })

  test('a bound portal task and any backoffice task are silent', () => {
    expect(
      collectPortalTaskBindingWarnings(
        definitionWith({
          assignedTo: '{{context.customer.userId}}',
          assigneeKind: 'customer',
          entityBindings: [{ entityType: 'customers:person', idPath: 'context.customer.personId' }],
        }) as any,
      ),
    ).toEqual([])

    expect(
      collectPortalTaskBindingWarnings(definitionWith({ assignedToRoles: ['support'] }) as any),
    ).toEqual([])
  })
})
