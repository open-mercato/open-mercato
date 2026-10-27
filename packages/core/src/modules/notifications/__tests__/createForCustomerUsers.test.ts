import { createNotificationService } from '../lib/notificationService'
import { NOTIFICATION_EVENTS, NOTIFICATION_SSE_EVENTS } from '../lib/events'
import type { Notification } from '../data/entities'
import { getScopedCustomerUserRecipientIds } from '../lib/notificationRecipients'
import { getNotificationDeliveryStrategies } from '../lib/deliveryStrategies'

jest.mock('../lib/notificationRecipients', () => ({
  getRecipientUserIdsForRole: jest.fn(),
  getRecipientUserIdsForFeature: jest.fn(),
  getScopedNotificationRecipientUserIds: jest.fn(),
  getScopedCustomerUserRecipientIds: jest.fn(),
}))

jest.mock('../lib/deliveryStrategies', () => ({
  getNotificationDeliveryStrategies: jest.fn(() => []),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn().mockResolvedValue(undefined),
}))

const tenantId = '7f4c85ef-f8f7-4e53-9df1-42e95bd8d48e'
const organizationId = '4a2f3c1e-6b7d-4e8f-9a0b-1c2d3e4f5a6b'
const customerUserId = '9d1e2f3a-4b5c-4d6e-8f70-112233445566'
const otherOrgCustomerUserId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const deletedCustomerUserId = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e'
const staffUserId = 'c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f'

type CustomerUserRow = { id: string; tenantId: string; organizationId: string; deleted: boolean; active: boolean }

const customerUsers: CustomerUserRow[] = [
  { id: customerUserId, tenantId, organizationId, deleted: false, active: true },
  { id: otherOrgCustomerUserId, tenantId, organizationId: 'd4e5f6a7-b8c9-4d0e-9f1a-3b4c5d6e7f80', deleted: false, active: true },
  { id: deletedCustomerUserId, tenantId, organizationId, deleted: true, active: true },
]

const ctx = { tenantId, organizationId, userId: null }

const baseInput = {
  type: 'property_management.booking.confirmed',
  titleKey: 'property_management.notifications.booking.confirmed.title',
  sourceModule: 'property_management',
}

const buildEm = () => {
  const em = {
    fork: jest.fn(),
    transactional: jest.fn(),
    create: jest.fn(),
    flush: jest.fn(),
    findOne: jest.fn(),
    getKysely: jest.fn(() => ({})),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (cb: (tx: typeof em) => Promise<unknown>) => cb(em))
  em.create.mockImplementation((_entity: unknown, data: Notification) => ({ id: `note-${data.recipientUserId}`, ...data }))
  return em
}

describe('notificationService.createForCustomerUsers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getScopedCustomerUserRecipientIds as jest.Mock).mockImplementation(
      async (_db: unknown, scopeTenantId: string, scopeOrganizationId: string, ids: string[]) =>
        customerUsers
          .filter((row) => ids.includes(row.id))
          .filter((row) => row.tenantId === scopeTenantId && row.organizationId === scopeOrganizationId)
          .filter((row) => !row.deleted && row.active)
          .map((row) => row.id),
    )
  })

  it('creates an in-app row for a customer user of the tenant and organization', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const service = createNotificationService({ em: em as never, eventBus })

    const notifications = await service.createForCustomerUsers!(
      { ...baseInput, recipientCustomerUserIds: [customerUserId, customerUserId], linkHref: '/portal/bookings' },
      ctx,
    )

    expect(notifications).toHaveLength(1)
    expect(getScopedCustomerUserRecipientIds).toHaveBeenCalledWith(expect.anything(), tenantId, organizationId, [customerUserId])
    expect(em.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        recipientUserId: customerUserId,
        type: baseInput.type,
        titleKey: baseInput.titleKey,
        title: baseInput.titleKey,
        severity: 'info',
        linkHref: '/portal/bookings',
        sourceModule: 'property_management',
        channels: ['in_app'],
        tenantId,
        organizationId,
      }),
    )
    expect(em.flush).toHaveBeenCalled()
    expect(eventBus.emit).toHaveBeenCalledWith(
      NOTIFICATION_SSE_EVENTS.BATCH_CREATED,
      expect.objectContaining({ tenantId, organizationId, recipientUserIds: [customerUserId], count: 1 }),
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      NOTIFICATION_SSE_EVENTS.CREATED,
      expect.objectContaining({ recipientUserId: customerUserId }),
    )
  })

  it('does not attempt channel delivery', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const service = createNotificationService({ em: em as never, eventBus })

    await service.createForCustomerUsers!({ ...baseInput, recipientCustomerUserIds: [customerUserId] }, ctx)

    const emittedEvents = eventBus.emit.mock.calls.map(([eventId]) => eventId)
    expect(emittedEvents).not.toContain(NOTIFICATION_EVENTS.CREATED)
    expect(getNotificationDeliveryStrategies).not.toHaveBeenCalled()
  })

  it.each([
    ['a staff user id', staffUserId],
    ['a customer user of another organization', otherOrgCustomerUserId],
    ['a deleted customer user', deletedCustomerUserId],
  ])('rejects %s', async (_label, recipientId) => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const service = createNotificationService({ em: em as never, eventBus })

    await expect(
      service.createForCustomerUsers!({ ...baseInput, recipientCustomerUserIds: [customerUserId, recipientId] }, ctx),
    ).rejects.toMatchObject({ status: 404 })

    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('rejects when the context has no organization scope', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const service = createNotificationService({ em: em as never, eventBus })

    await expect(
      service.createForCustomerUsers!(
        { ...baseInput, recipientCustomerUserIds: [customerUserId] },
        { tenantId, organizationId: null },
      ),
    ).rejects.toMatchObject({ status: 404 })
    expect(getScopedCustomerUserRecipientIds).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
  })

  it('rejects an empty recipient list', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const service = createNotificationService({ em: em as never, eventBus })

    await expect(
      service.createForCustomerUsers!({ ...baseInput, recipientCustomerUserIds: [] }, ctx),
    ).rejects.toThrow()
    expect(em.create).not.toHaveBeenCalled()
  })
})
