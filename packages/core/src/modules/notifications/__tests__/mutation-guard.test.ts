const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const notificationId = '44444444-4444-4444-8444-444444444444'
const recipientUserId = '55555555-5555-4555-8555-555555555555'

const container = { resolve: jest.fn() }

const ctx = {
  container,
  auth: { tenantId, sub: userId, orgId: organizationId },
}

const runRouteMutationGuardsMock = jest.fn()
const runAfterSuccessMock = jest.fn()

const serviceMock = {
  create: jest.fn(),
  createBatch: jest.fn(),
  createForRole: jest.fn(),
  createForFeature: jest.fn(),
  markAsRead: jest.fn(),
  dismiss: jest.fn(),
  restoreDismissed: jest.fn(),
  executeAction: jest.fn(),
  markAllAsRead: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

jest.mock('@open-mercato/shared/lib/api/context', () => ({
  resolveRequestContext: jest.fn(async () => ({ ctx })),
}))

// The notification routes derive the organization the same way every org-scoped
// write does — the selected-org cookie via resolveOrganizationScopeForRequest,
// then the caller's own auth.orgId. Here no org is explicitly selected, so the
// guard scope falls back to auth.orgId (see routeHelpers-org-scoping.test.ts).
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: null,
    filterIds: null,
    allowedIds: null,
    tenantId,
  })),
}))

jest.mock('../lib/notificationService', () => ({
  resolveNotificationService: jest.fn(() => serviceMock),
}))

const saveNotificationDeliveryConfigMock = jest.fn()
const resolveNotificationDeliveryConfigMock = jest.fn()

jest.mock('../lib/deliveryConfig', () => ({
  DEFAULT_NOTIFICATION_DELIVERY_CONFIG: { strategies: {} },
  saveNotificationDeliveryConfig: (...args: unknown[]) => saveNotificationDeliveryConfigMock(...args),
  resolveNotificationDeliveryConfig: (...args: unknown[]) => resolveNotificationDeliveryConfigMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: userId, tenantId, orgId: organizationId })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    t: (_key: string, fallback?: string) => fallback ?? 'x',
    translate: (_key: string, fallback?: string) => fallback ?? 'x',
  })),
}))

import { POST as createNotification } from '../api/route'
import { POST as createBatchNotifications } from '../api/batch/route'
import { PUT as markNotificationRead } from '../api/[id]/read/route'
import { PUT as restoreNotification } from '../api/[id]/restore/route'
import { POST as executeNotificationAction } from '../api/[id]/action/route'
import { PUT as markAllNotificationsRead } from '../api/mark-all-read/route'
import { POST as updateNotificationSettings } from '../api/settings/route'

const jsonRequest = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const guardCall = (input: Record<string, unknown>) =>
  expect.objectContaining({
    container,
    auth: expect.objectContaining({ tenantId, organizationId, userId }),
    input: expect.objectContaining(input),
  })

describe('notification write routes run the mutation guard registry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    runAfterSuccessMock.mockResolvedValue(undefined)
    runRouteMutationGuardsMock.mockResolvedValue({ ok: true, runAfterSuccess: runAfterSuccessMock })
    serviceMock.create.mockResolvedValue({ id: notificationId })
    serviceMock.createBatch.mockResolvedValue([{ id: notificationId }])
    serviceMock.markAsRead.mockResolvedValue(undefined)
    serviceMock.restoreDismissed.mockResolvedValue(undefined)
    serviceMock.executeAction.mockResolvedValue({
      notification: { actionData: { actions: [{ id: 'do', href: '/go/{sourceEntityId}' }] }, sourceEntityId: 'src' },
      result: { ok: true },
    })
    serviceMock.markAllAsRead.mockResolvedValue(3)
    saveNotificationDeliveryConfigMock.mockResolvedValue(undefined)
    resolveNotificationDeliveryConfigMock.mockResolvedValue({ strategies: {} })
  })

  it('guards create (POST /api/notifications)', async () => {
    const response = await createNotification(
      jsonRequest('http://localhost/api/notifications', 'POST', { type: 'test', title: 'Hi', recipientUserId }),
    )

    expect(response.status).toBe(201)
    expect(serviceMock.create).toHaveBeenCalled()
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      guardCall({ resourceKind: 'notifications.notification', operation: 'create' }),
    )
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('guards bulk create (POST /api/notifications/batch)', async () => {
    const response = await createBatchNotifications(
      jsonRequest('http://localhost/api/notifications/batch', 'POST', {
        type: 'test',
        title: 'Hi',
        recipientUserIds: [recipientUserId],
      }),
    )

    expect(response.status).toBe(201)
    expect(serviceMock.createBatch).toHaveBeenCalled()
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      guardCall({ resourceKind: 'notifications.notification', operation: 'create' }),
    )
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('guards single-action update (PUT /api/notifications/[id]/read)', async () => {
    const response = await markNotificationRead(
      jsonRequest(`http://localhost/api/notifications/${notificationId}/read`, 'PUT'),
      { params: Promise.resolve({ id: notificationId }) },
    )

    expect(response.status).toBe(200)
    expect(serviceMock.markAsRead).toHaveBeenCalledWith(notificationId, expect.anything())
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      guardCall({ resourceKind: 'notifications.notification', resourceId: notificationId, operation: 'update' }),
    )
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('guards restore (PUT /api/notifications/[id]/restore)', async () => {
    const response = await restoreNotification(
      jsonRequest(`http://localhost/api/notifications/${notificationId}/restore`, 'PUT', { status: 'unread' }),
      { params: Promise.resolve({ id: notificationId }) },
    )

    expect(response.status).toBe(200)
    expect(serviceMock.restoreDismissed).toHaveBeenCalled()
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      guardCall({ resourceKind: 'notifications.notification', resourceId: notificationId, operation: 'update' }),
    )
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('returns 400 for an invalid restore status', async () => {
    const response = await restoreNotification(
      jsonRequest(`http://localhost/api/notifications/${notificationId}/restore`, 'PUT', { status: 'dismissed' }),
      { params: Promise.resolve({ id: notificationId }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining('Invalid request body'),
    })
    expect(serviceMock.restoreDismissed).not.toHaveBeenCalled()
    expect(runRouteMutationGuardsMock).not.toHaveBeenCalled()
  })

  it('guards execute action (POST /api/notifications/[id]/action)', async () => {
    const response = await executeNotificationAction(
      jsonRequest(`http://localhost/api/notifications/${notificationId}/action`, 'POST', { actionId: 'do' }),
      { params: Promise.resolve({ id: notificationId }) },
    )

    expect(response.status).toBe(200)
    expect(serviceMock.executeAction).toHaveBeenCalled()
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      guardCall({ resourceKind: 'notifications.notification', resourceId: notificationId, operation: 'custom' }),
    )
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('guards mark-all-read (PUT /api/notifications/mark-all-read)', async () => {
    const response = await markAllNotificationsRead(
      jsonRequest('http://localhost/api/notifications/mark-all-read', 'PUT'),
    )

    expect(response.status).toBe(200)
    expect(serviceMock.markAllAsRead).toHaveBeenCalled()
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      guardCall({ resourceKind: 'notifications.notification', operation: 'update' }),
    )
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('guards settings update (POST /api/notifications/settings)', async () => {
    const response = await updateNotificationSettings(
      jsonRequest('http://localhost/api/notifications/settings', 'POST', {
        strategies: { database: { enabled: true } },
      }),
    )

    expect(response.status).toBe(200)
    expect(saveNotificationDeliveryConfigMock).toHaveBeenCalled()
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      guardCall({ resourceKind: 'notifications.settings', operation: 'update' }),
    )
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('blocks the write and skips after-success hooks when the guard rejects', async () => {
    runRouteMutationGuardsMock.mockResolvedValueOnce({
      ok: false,
      errorStatus: 409,
      errorBody: { error: 'conflict' },
      response: Response.json({ error: 'conflict' }, { status: 409 }),
    })

    const response = await markAllNotificationsRead(
      jsonRequest('http://localhost/api/notifications/mark-all-read', 'PUT'),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'conflict' })
    expect(serviceMock.markAllAsRead).not.toHaveBeenCalled()
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
  })
})
