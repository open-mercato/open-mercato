import { EntityMetadata, MetadataStorage } from '@mikro-orm/core'
import { Notification } from '@open-mercato/core/modules/notifications/data/entities'
import { GET as listNotifications } from '../notifications'
import { PUT as dismissNotification } from '../notifications/[id]/dismiss'
import { PUT as markNotificationRead } from '../notifications/[id]/read'
import { PUT as markAllNotificationsRead } from '../notifications/mark-all-read'
import { GET as getUnreadCount } from '../notifications/unread-count'

const tenantId = '11111111-1111-4111-8111-111111111111'
const recipientUserId = '22222222-2222-4222-8222-222222222222'
const notificationId = '33333333-3333-4333-8333-333333333333'
const notificationScope = { tenantId, recipientUserId }

const mockGetCustomerAuth = jest.fn()
const mockDatabaseOperations = {
  find: jest.fn(),
  findOne: jest.fn(),
  count: jest.fn(),
  nativeUpdate: jest.fn(),
  flush: jest.fn(),
}
const mockEm = {
  ...mockDatabaseOperations,
  getMetadata: jest.fn(),
}
const mockCreateRequestContainer = jest.fn(async () => ({
  resolve: (key: string) => key === 'em' ? mockEm : undefined,
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (req: Request) => mockGetCustomerAuth(req),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => mockCreateRequestContainer(),
}))

const routes = [
  {
    method: 'GET',
    suffix: '?page=3&pageSize=500',
    handle: listNotifications,
    status: 200,
    body: { ok: true, items: [], total: 0, page: 3, pageSize: 100 },
  },
  {
    method: 'GET',
    suffix: '/unread-count',
    handle: getUnreadCount,
    status: 200,
    body: { ok: true, unreadCount: 0 },
  },
  {
    method: 'PUT',
    suffix: '/mark-all-read',
    handle: markAllNotificationsRead,
    status: 200,
    body: { ok: true, count: 0 },
  },
  {
    method: 'PUT',
    suffix: '/' + notificationId + '/read',
    handle: markNotificationRead,
    status: 404,
    body: { ok: false, error: 'Notification not found' },
  },
  {
    method: 'PUT',
    suffix: '/' + notificationId + '/dismiss',
    handle: dismissNotification,
    status: 404,
    body: { ok: false, error: 'Notification not found' },
  },
]

function request(method: string, suffix: string) {
  return new Request('http://localhost/api/customer_accounts/portal/notifications' + suffix, { method })
}

const context = { params: { id: notificationId } }

describe('portal notification routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCustomerAuth.mockResolvedValue({ sub: recipientUserId, tenantId })
    mockEm.getMetadata.mockReturnValue(new MetadataStorage())
  })

  it.each(routes)('$method /notifications$suffix returns the fallback when notifications is disabled', async ({ method, suffix, handle, status, body }) => {
    const response = await handle(request(method, suffix), context)

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual(body)
    for (const operation of Object.values(mockDatabaseOperations)) {
      expect(operation).not.toHaveBeenCalled()
    }
  })

  it.each(routes)('$method /notifications$suffix still requires a portal session when notifications is disabled', async ({ method, suffix, handle }) => {
    mockGetCustomerAuth.mockResolvedValue(null)

    const response = await handle(request(method, suffix), context)

    expect(response.status).toBe(401)
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
  })

  it.each([
    { configuration: 'the package entity', registeredEntity: Notification },
    {
      configuration: 'an app entity override',
      registeredEntity: class Notification {
        static entityName = 'notifications.Notification'
      },
    },
  ])('counts unread notifications for the authenticated recipient and tenant with $configuration', async ({ registeredEntity }) => {
    const metadata = new MetadataStorage()
    metadata.set(registeredEntity, new EntityMetadata({ class: registeredEntity, className: registeredEntity.name }))
    mockEm.getMetadata.mockReturnValue(metadata)
    mockDatabaseOperations.count.mockResolvedValueOnce(2)

    const response = await getUnreadCount(request('GET', '/unread-count'))

    expect(mockDatabaseOperations.count).toHaveBeenCalledWith(Notification, {
      ...notificationScope,
      status: 'unread',
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, unreadCount: 2 })
  })

  it('returns zero unread notifications when only an unrelated same-name entity is registered', async () => {
    const unrelatedEntity = class Notification {
      static entityName = 'other.Notification'
    }
    const metadata = new MetadataStorage()
    metadata.set(unrelatedEntity, new EntityMetadata({ class: unrelatedEntity, className: unrelatedEntity.name }))
    mockEm.getMetadata.mockReturnValue(metadata)

    const response = await getUnreadCount(request('GET', '/unread-count'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, unreadCount: 0 })
    expect(mockDatabaseOperations.count).not.toHaveBeenCalled()
  })
})
