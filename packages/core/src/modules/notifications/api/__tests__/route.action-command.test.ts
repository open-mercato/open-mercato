/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '44444444-4444-4444-8444-444444444444'
const recipientUserId = '55555555-5555-4555-8555-555555555555'
const sourceEntityId = '66666666-6666-4666-8666-666666666666'

const service = {
  create: jest.fn(async () => ({ id: 'created-note' })),
  createBatch: jest.fn(async () => [{ id: 'created-note' }]),
  createForRole: jest.fn(async () => [{ id: 'created-note' }]),
  createForFeature: jest.fn(async () => [{ id: 'created-note' }]),
}

const container = {
  resolve: jest.fn((name: string) => {
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: jest.fn(async () => ({ ok: true, runAfterSuccess: async () => undefined })),
}))

jest.mock('@open-mercato/shared/lib/api/context', () => ({
  resolveRequestContext: async () => ({
    ctx: { container, auth: { sub: userId, tenantId, orgId: organizationId } },
  }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({
    tenantId,
    selectedId: organizationId,
    filterIds: [organizationId],
  }),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => service,
}))

import { NOTIFICATION_ACTION_COMMAND_NOT_ALLOWED_ERROR_CODE } from '@open-mercato/shared/modules/notifications/types'
import { POST as createSingle } from '../route'
import { POST as createBatch } from '../batch/route'
import { POST as createForRole } from '../role/route'
import { POST as createForFeature } from '../feature/route'

const commandAction = {
  id: 'run',
  label: 'Run',
  commandId: 'wms.locations.delete',
}

const linkAction = {
  id: 'view',
  label: 'View',
  href: '/backend/notifications',
}

const baseBody = {
  type: 'system.custom',
  title: 'Hello',
  sourceEntityId,
}

const postJson = (body: unknown) =>
  new Request('http://localhost/api/notifications', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const routes = [
  { name: 'POST /api/notifications', handler: createSingle, target: { recipientUserId }, method: 'create' as const },
  { name: 'POST /api/notifications/batch', handler: createBatch, target: { recipientUserIds: [recipientUserId] }, method: 'createBatch' as const },
  { name: 'POST /api/notifications/role', handler: createForRole, target: { roleId: recipientUserId }, method: 'createForRole' as const },
  { name: 'POST /api/notifications/feature', handler: createForFeature, target: { requiredFeature: 'wms.view' }, method: 'createForFeature' as const },
]

describe('notification create routes refuse caller-supplied action commands', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each(routes)('$name rejects an action carrying a commandId and creates nothing', async ({ handler, target, method }) => {
    const response = await handler(postJson({ ...baseBody, ...target, actions: [linkAction, commandAction] }))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe(NOTIFICATION_ACTION_COMMAND_NOT_ALLOWED_ERROR_CODE)
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
    expect(service[method]).not.toHaveBeenCalled()
  })

  it.each(routes)('$name still creates a notification whose actions only link', async ({ handler, target, method }) => {
    const response = await handler(postJson({ ...baseBody, ...target, actions: [linkAction] }))

    expect(response.status).toBe(201)
    expect(service[method]).toHaveBeenCalledTimes(1)
  })
})
