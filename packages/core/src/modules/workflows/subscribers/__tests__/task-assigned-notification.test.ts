const mockCreate = jest.fn()
const mockCreateForRole = jest.fn()

jest.mock('../../../notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({
    create: mockCreate,
    createForRole: mockCreateForRole,
  }),
}))

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('../../../auth/data/entities', () => ({
  Role: class Role {},
}))

import handler, { metadata } from '../task-assigned-notification'
import { notificationTypes } from '../../notifications'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const TASK_ID = 'task-1'

function makeCtx() {
  const em = { fork: () => em }
  return {
    resolve: <T>(name: string): T => {
      if (name === 'em') return em as unknown as T
      return null as unknown as T
    },
  }
}

const basePayload = {
  taskId: TASK_ID,
  taskName: 'Approve Invoice',
  workflowName: 'Invoice Approval',
  dueDate: '2026-07-30T09:00:00.000Z',
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
}

beforeEach(() => {
  mockCreate.mockReset()
  mockCreateForRole.mockReset()
  mockFindWithDecryption.mockReset()
})

describe('task-assigned-notification metadata', () => {
  it('subscribes to the declared task assignment event with a stable id', () => {
    expect(metadata.event).toBe('workflows.task.assigned')
    expect(metadata.persistent).toBe(true)
    expect(metadata.id).toBe('workflows:task-assigned-notification')
  })
})

describe('task-assigned-notification recipients', () => {
  it('notifies the individual assignee', async () => {
    await handler({ ...basePayload, assignedUserId: 'user-1' }, makeCtx())

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const [input, scope] = mockCreate.mock.calls[0] as [any, any]
    expect(input.recipientUserId).toBe('user-1')
    expect(input.bodyVariables).toEqual({
      taskName: 'Approve Invoice',
      workflowName: 'Invoice Approval',
      dueDate: '2026-07-30T09:00:00.000Z',
    })
    expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(mockCreateForRole).not.toHaveBeenCalled()
  })

  it('notifies every resolved role when the task is assigned to roles only', async () => {
    mockFindWithDecryption.mockResolvedValue([{ id: 'role-a' }, { id: 'role-b' }])

    await handler({ ...basePayload, assignedToRoles: ['Approver', 'Controller'] }, makeCtx())

    expect(mockCreateForRole).toHaveBeenCalledTimes(2)
    expect((mockCreateForRole.mock.calls[0] as [any, any])[0].roleId).toBe('role-a')
    expect((mockCreateForRole.mock.calls[1] as [any, any])[0].roleId).toBe('role-b')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('resolves role names against the payload tenant only', async () => {
    mockFindWithDecryption.mockResolvedValue([{ id: 'role-a' }])

    await handler({ ...basePayload, assignedToRoles: ['Approver'] }, makeCtx())

    const where = (mockFindWithDecryption.mock.calls[0] as unknown[])[2] as Record<string, unknown>
    expect(where).toEqual({ name: { $in: ['Approver'] }, tenantId: TENANT_ID, deletedAt: null })
  })

  it('prefers the individual assignee over the role queue', async () => {
    await handler(
      { ...basePayload, assignedUserId: 'user-1', assignedToRoles: ['Approver'] },
      makeCtx()
    )

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreateForRole).not.toHaveBeenCalled()
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('no-ops when the task has neither an assignee nor roles', async () => {
    await handler({ ...basePayload, assignedToRoles: [] }, makeCtx())

    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockCreateForRole).not.toHaveBeenCalled()
  })

  it('no-ops when the roles resolve to nothing in this tenant', async () => {
    mockFindWithDecryption.mockResolvedValue([])

    await handler({ ...basePayload, assignedToRoles: ['Ghost Role'] }, makeCtx())

    expect(mockCreateForRole).not.toHaveBeenCalled()
  })

  it('no-ops without a task id or tenant', async () => {
    await handler({ ...basePayload, taskId: '', assignedUserId: 'user-1' }, makeCtx())
    await handler({ ...basePayload, tenantId: '', assignedUserId: 'user-1' }, makeCtx())

    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('swallows notification failures so workflow delivery is never broken', async () => {
    mockCreate.mockRejectedValue(new Error('boom'))

    await expect(
      handler({ ...basePayload, assignedUserId: 'user-1' }, makeCtx())
    ).resolves.toBeUndefined()
  })
})

describe('task-assigned-notification deep links', () => {
  it('links the individual notification at the real task route', async () => {
    await handler({ ...basePayload, assignedUserId: 'user-1' }, makeCtx())

    const [input] = mockCreate.mock.calls[0] as [any, any]
    expect(input.linkHref).toBe(`/backend/tasks/${TASK_ID}`)
    expect(input.linkHref).not.toContain('/backend/workflows/tasks/')
  })

  it('links role notifications at the real task route and dedupes by task', async () => {
    mockFindWithDecryption.mockResolvedValue([{ id: 'role-a' }])

    await handler({ ...basePayload, assignedToRoles: ['Approver'] }, makeCtx())

    const [input] = mockCreateForRole.mock.calls[0] as [any, any]
    expect(input.linkHref).toBe(`/backend/tasks/${TASK_ID}`)
    expect(input.groupKey).toBe(`workflows:user_task:${TASK_ID}`)
  })
})

describe('workflows notification types', () => {
  const typeDef = notificationTypes.find((type) => type.type === 'workflows.task.assigned')

  it('declares the task assignment type with i18n keys and a source-entity link', () => {
    expect(typeDef).toBeDefined()
    expect(typeDef?.module).toBe('workflows')
    expect(typeDef?.titleKey).toBe('workflows.notifications.task.assigned.title')
    expect(typeDef?.bodyKey).toBe('workflows.notifications.task.assigned.body')
  })

  it('points every href at /backend/tasks, the route that actually exists', () => {
    expect(typeDef?.linkHref).toBe('/backend/tasks/{sourceEntityId}')
    for (const action of typeDef?.actions ?? []) {
      expect(action.href).toBe('/backend/tasks/{sourceEntityId}')
    }
  })
})

describe('task-assigned-notification quick actions', () => {
  it('offers a command-backed completion action for a one-click task', async () => {
    await handler(
      {
        ...basePayload,
        assignedUserId: 'user-1',
        quickAction: { decisions: [{ id: 'approve' }], formSchema: null },
      },
      makeCtx()
    )

    const [input] = mockCreate.mock.calls[0] as [any, any]
    expect(input.actions).toEqual([
      expect.objectContaining({ id: 'view', href: '/backend/tasks/{sourceEntityId}' }),
      expect.objectContaining({ id: 'complete', commandId: 'workflows.tasks.complete' }),
    ])
    expect(input.primaryActionId).toBe('complete')
  })

  it('offers only the deep link for a task that needs input', async () => {
    await handler(
      {
        ...basePayload,
        assignedUserId: 'user-1',
        quickAction: {
          decisions: [{ id: 'approve' }],
          formSchema: { properties: { reason: { type: 'string' } } },
        },
      },
      makeCtx()
    )

    const [input] = mockCreate.mock.calls[0] as [any, any]
    expect(input.actions).toHaveLength(1)
    expect(input.actions[0].id).toBe('view')
    expect(input.primaryActionId).toBe('view')
  })

  it('falls back to the declared type actions when the emitter said nothing about the shape', async () => {
    await handler({ ...basePayload, assignedUserId: 'user-1' }, makeCtx())

    const [input] = mockCreate.mock.calls[0] as [any, any]
    expect(input.actions).toEqual([
      expect.objectContaining({ id: 'view', href: '/backend/tasks/{sourceEntityId}' }),
    ])
  })
})
