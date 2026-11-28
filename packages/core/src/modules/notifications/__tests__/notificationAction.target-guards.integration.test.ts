import { asValue, createContainer } from 'awilix'
import type { Notification } from '../data/entities'
import { createNotificationService } from '../lib/notificationService'
import { registerNotificationTypes } from '../lib/notification-type-registry'
import { POST } from '../api/[id]/action/route'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard, MutationGuardInput, MutationGuardResult } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { notificationTypes as staffNotificationTypes } from '@open-mercato/core/modules/staff/notifications'
import { notificationTypes as workflowNotificationTypes } from '@open-mercato/core/modules/workflows/notifications'

jest.mock('@open-mercato/shared/lib/api/context', () => ({ resolveRequestContext: jest.fn() }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn().mockResolvedValue(undefined),
}))

const scope = { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }
const notificationId = '9dd23508-2bc2-4bc9-94dd-978d0b2326de'
const sourceEntityId = 'c857d4df-ebcb-454a-bb68-5ccf7be44c36'

const staffActionTarget = {
  type: 'staff.leave_request.pending',
  sourceType: 'staff:leave_request',
  resourceKind: 'staff.leave_request',
  actionId: 'approve',
  commandId: 'staff.leave-requests.accept',
}

const workflowActionTarget = {
  type: 'workflows.task.assigned',
  sourceType: 'workflows:user_task',
  resourceKind: 'workflows.user_task',
  actionId: 'complete',
  commandId: 'workflows.tasks.complete',
}

function fixture(actionTarget = staffActionTarget) {
  const calls: string[] = []
  const notification = {
    id: notificationId, type: actionTarget.type, status: 'unread',
    recipientUserId: scope.userId, tenantId: scope.tenantId, organizationId: scope.organizationId,
    sourceEntityType: actionTarget.sourceType, sourceEntityId,
    actionData: { actions: [{ id: actionTarget.actionId, label: 'Action', commandId: actionTarget.commandId }] },
    readAt: null, actionedAt: null, actionTaken: null,
  } as Notification
  const target = { status: 'pending' }
  let claimed = false
  const updates: Array<Record<string, unknown>> = []
  const em = {
    fork: jest.fn(), flush: jest.fn(async () => { calls.push('notification.flush') }),
    getKysely: () => ({
      updateTable: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values)
          const chain = {
            where: () => chain,
            executeTakeFirst: async () => {
              if (values.status === 'actioned') {
                if (claimed) return { numUpdatedRows: BigInt(0) }
                claimed = true
                calls.push('notification.claim')
              } else {
                claimed = false
                calls.push('notification.release')
              }
              return { numUpdatedRows: BigInt(1) }
            },
          }
          return chain
        },
      }),
    }),
  }
  em.fork.mockReturnValue(em)
  const eventBus = { emit: jest.fn(async () => { calls.push('notification.event') }) }
  const commandBus = {
    execute: jest.fn(async () => {
      calls.push('command')
      target.status = 'approved'
      return { result: { requestId: sourceEntityId } }
    }),
  }
  const rbac = {
    userHasAllFeatures: jest.fn().mockResolvedValue(true),
    getGrantedFeatures: jest.fn().mockResolvedValue(['tests.lock.*']),
  }
  const container = createContainer()
  container.register({ em: asValue(em), eventBus: asValue(eventBus), commandBus: asValue(commandBus), rbacService: asValue(rbac) })
  const notificationValidate = jest.fn(async (): Promise<MutationGuardResult> => {
    calls.push('notification.validate')
    return { ok: true, shouldRunAfterSuccess: true }
  })
  const targetValidate = jest.fn(async (_input: MutationGuardInput): Promise<MutationGuardResult> => {
    calls.push('target.validate')
    return { ok: true, shouldRunAfterSuccess: true }
  })
  const notificationAfter = jest.fn(async () => { calls.push('notification.after') })
  const targetAfter = jest.fn(async () => { calls.push('target.after') })
  const guards: MutationGuard[] = [
    { id: 'tests.notification', targetEntity: 'notifications.notification', operations: ['update'], validate: notificationValidate, afterSuccess: notificationAfter },
    { id: 'tests.target', targetEntity: actionTarget.resourceKind, operations: ['update'], features: ['tests.lock.enforce'], validate: targetValidate, afterSuccess: targetAfter },
  ]
  registerMutationGuards([{ moduleId: 'tests', guards }])
  registerNotificationTypes([...staffNotificationTypes, ...workflowNotificationTypes], { replace: true })
  jest.mocked(resolveRequestContext).mockResolvedValue({ ctx: {
    container, auth: { sub: scope.userId, tenantId: scope.tenantId, orgId: scope.organizationId },
  } } as Awaited<ReturnType<typeof resolveRequestContext>>)
  jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue({
    tenantId: scope.tenantId, selectedId: scope.organizationId, filterIds: [scope.organizationId],
  } as Awaited<ReturnType<typeof resolveOrganizationScopeForRequest>>)
  jest.mocked(findOneWithDecryption).mockResolvedValue(notification)
  const request = () => new Request(`http://localhost/api/notifications/${notification.id}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-om-record-lock-token': 'original-lock-token' },
    body: JSON.stringify({ actionId: actionTarget.actionId, payload: { id: 'untrusted-id', decisionComment: 'Approved' } }),
  })
  const run = () => POST(request(), { params: Promise.resolve({ id: notification.id }) })
  const service = createNotificationService({ em: em as never, eventBus, commandBus, container })
  return { run, request, notification, target, calls, updates, commandBus, eventBus, rbac, em,
    notificationValidate, targetValidate, notificationAfter, targetAfter, guards, container, service }
}

afterEach(() => {
  registerMutationGuards([])
  registerNotificationTypes([], { replace: true })
  jest.clearAllMocks()
})

describe('notification action route → service → target mutation guard integration (#7674)', () => {
  it.each([403, 409, 423])('preserves a target guard %i rejection and leaves both records pending', async (status) => {
    const state = fixture()
    const body = { error: 'Target is locked', code: 'target_guard_denied', details: { retry: true } }
    state.targetValidate.mockResolvedValueOnce({ ok: false, status, body })

    const response = await state.run()

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual(body)
    expect(state.calls).toEqual(['notification.validate'])
    expect(state.targetValidate).toHaveBeenCalledTimes(1)
    expect(state.commandBus.execute).not.toHaveBeenCalled()
    expect(state.updates).toHaveLength(0)
    expect(state.notification.status).toBe('unread')
    expect(state.notification.actionedAt).toBeNull()
    expect(state.target.status).toBe('pending')
    expect(state.em.flush).not.toHaveBeenCalled()
    expect(state.eventBus.emit).not.toHaveBeenCalled()
    expect(state.targetAfter).not.toHaveBeenCalled()
    expect(state.notificationAfter).not.toHaveBeenCalled()
  })

  it('runs the target guard for a declared workflow quick action with the workflow grant', async () => {
    const state = fixture(workflowActionTarget)
    state.targetValidate.mockResolvedValueOnce({ ok: false, status: 423, body: { code: 'target_locked' } })

    expect((await state.run()).status).toBe(423)
    expect(state.rbac.userHasAllFeatures).toHaveBeenCalledWith(scope.userId, ['workflows.tasks.complete'], {
      tenantId: scope.tenantId, organizationId: scope.organizationId,
    })
    expect(state.targetValidate).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: workflowActionTarget.resourceKind, resourceId: sourceEntityId, operation: 'update',
    }))
    expect(state.commandBus.execute).not.toHaveBeenCalled()
    expect(state.updates).toHaveLength(0)
  })

  it('runs authorized target actions in order with trusted scope, original headers and guarded input', async () => {
    const state = fixture()
    state.targetValidate.mockImplementationOnce(async () => {
      state.calls.push('target.validate')
      return { ok: true, shouldRunAfterSuccess: true, modifiedPayload: { decisionComment: 'Guard approved', id: 'guard-retarget' } }
    })

    const response = await state.run()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, result: { requestId: sourceEntityId } })
    expect(state.targetValidate).toHaveBeenCalledWith(expect.objectContaining({
      ...scope, resourceKind: 'staff.leave_request', resourceId: sourceEntityId, operation: 'update',
      requestMethod: 'POST', mutationPayload: { id: sourceEntityId, decisionComment: 'Approved' },
    }))
    expect(state.targetValidate.mock.calls[0][0].requestHeaders.get('x-om-record-lock-token')).toBe('original-lock-token')
    expect(state.rbac.getGrantedFeatures).toHaveBeenCalledWith(scope.userId, {
      tenantId: scope.tenantId, organizationId: scope.organizationId,
    })
    expect(state.commandBus.execute).toHaveBeenCalledWith('staff.leave-requests.accept', expect.objectContaining({
      input: { id: sourceEntityId, decisionComment: 'Guard approved' },
      ctx: expect.objectContaining({
        auth: { sub: scope.userId, tenantId: scope.tenantId, orgId: scope.organizationId },
        selectedOrganizationId: scope.organizationId, request: expect.any(Request),
      }),
    }))
    expect(state.calls).toEqual([
      'notification.validate', 'target.validate', 'notification.claim', 'command', 'target.after',
      'notification.flush', 'notification.event', 'notification.after',
    ])
    expect(state.notification.status).toBe('actioned')
    expect(state.target.status).toBe('approved')
    expect(state.targetAfter).toHaveBeenCalledTimes(1)
    expect((await state.run()).status).toBe(409)
    expect(state.commandBus.execute).toHaveBeenCalledTimes(1)
    expect(state.targetAfter).toHaveBeenCalledTimes(1)
  })

  it('keeps the notification guard first and never reaches the target when it denies', async () => {
    const state = fixture()
    state.notificationValidate.mockResolvedValueOnce({ ok: false, status: 403, body: { code: 'notification_denied' } })
    expect((await state.run()).status).toBe(403)
    expect(state.targetValidate).not.toHaveBeenCalled()
    expect(state.commandBus.execute).not.toHaveBeenCalled()
    expect(state.updates).toHaveLength(0)
  })

  it('releases the action claim on command failure, skips callbacks, and permits a retry', async () => {
    const state = fixture()
    state.commandBus.execute.mockRejectedValueOnce(new Error('[internal] target failed'))
    expect((await state.run()).status).toBe(400)
    expect(state.calls).toContain('notification.release')
    expect(state.notification.status).toBe('unread')
    expect(state.targetAfter).not.toHaveBeenCalled()
    expect(state.notificationAfter).not.toHaveBeenCalled()
    expect((await state.run()).status).toBe(200)
    expect(state.commandBus.execute).toHaveBeenCalledTimes(2)
    expect(state.targetAfter).toHaveBeenCalledTimes(1)
  })

  it('does not run target callbacks for a losing concurrent action claim', async () => {
    const state = fixture()
    const results = await Promise.all([state.run(), state.run()])
    expect(results.map((response) => response.status).sort()).toEqual([200, 409])
    expect(state.commandBus.execute).toHaveBeenCalledTimes(1)
    expect(state.targetAfter).toHaveBeenCalledTimes(1)
    expect(state.notificationAfter).toHaveBeenCalledTimes(1)
  })

  it('stops an out-of-scope notification lookup before invoking target guards', async () => {
    const state = fixture()
    jest.mocked(findOneWithDecryption).mockResolvedValueOnce(null)
    expect((await state.run()).status).toBe(404)
    expect(findOneWithDecryption).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      id: notificationId, recipientUserId: scope.userId, tenantId: scope.tenantId,
    }, undefined, { tenantId: scope.tenantId, organizationId: scope.organizationId })
    expect(state.targetValidate).not.toHaveBeenCalled()
    expect(state.commandBus.execute).not.toHaveBeenCalled()
  })

  it('runs the bridged legacy target guard as well as registry guards', async () => {
    const state = fixture()
    const validateMutation = jest.fn(async (input: { resourceKind: string }) => input.resourceKind === 'staff.leave_request'
      ? { ok: false, status: 423, body: { code: 'legacy_target_denied' } }
      : { ok: true })
    state.container.register({ crudMutationGuardService: asValue({
      validateMutation, afterMutationSuccess: jest.fn(),
    }) })
    const response = await state.run()
    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toEqual({ code: 'legacy_target_denied' })
    expect(state.commandBus.execute).not.toHaveBeenCalled()
    expect(state.notification.status).toBe('unread')
  })
})
