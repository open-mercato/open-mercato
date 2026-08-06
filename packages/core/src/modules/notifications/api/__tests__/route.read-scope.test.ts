/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const childOrganizationId = '33333333-3333-4333-8333-333333333333'
const userId = '44444444-4444-4444-8444-444444444444'

const find = jest.fn().mockResolvedValue([])
const count = jest.fn().mockResolvedValue(0)
const em = { find, count }
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const resolveNotificationContextMock = jest.fn(async () => ({
  ctx: { container },
  scope: {
    userId,
    tenantId,
    organizationId,
    organizationIds: [organizationId, childOrganizationId],
  },
}))

jest.mock('@open-mercato/core/modules/notifications/lib/routeHelpers', () => ({
  ...jest.requireActual('@open-mercato/core/modules/notifications/lib/routeHelpers'),
  resolveNotificationContext: (...args: unknown[]) => resolveNotificationContextMock(...args),
}))

import { GET } from '../route'

describe('GET /api/notifications organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    find.mockResolvedValue([])
    count.mockResolvedValue(0)
    resolveNotificationContextMock.mockResolvedValue({
      ctx: { container },
      scope: {
        userId,
        tenantId,
        organizationId,
        organizationIds: [organizationId, childOrganizationId],
      },
    })
  })

  it('lists the selected organization tree plus tenant-wide notifications', async () => {
    const response = await GET(new Request('https://example.test/api/notifications?pageSize=25'))

    expect(response.status).toBe(200)
    const expectedFilter = {
      recipientUserId: userId,
      tenantId,
      status: { $ne: 'dismissed' },
      $or: [
        { organizationId: { $in: [organizationId, childOrganizationId] } },
        { organizationId: null },
      ],
    }
    expect(find).toHaveBeenCalledWith(expect.anything(), expectedFilter, {
      orderBy: { createdAt: 'desc' },
      limit: 25,
      offset: 0,
    })
    expect(count).toHaveBeenCalledWith(expect.anything(), expectedFilter)
  })

  it('lists all tenant notifications for unrestricted all-organizations scope', async () => {
    resolveNotificationContextMock.mockResolvedValue({
      ctx: { container },
      scope: { userId, tenantId, organizationId: null, organizationIds: null },
    })

    const response = await GET(new Request('https://example.test/api/notifications?pageSize=25'))

    expect(response.status).toBe(200)
    const expectedFilter = {
      recipientUserId: userId,
      tenantId,
      status: { $ne: 'dismissed' },
    }
    expect(find).toHaveBeenCalledWith(expect.anything(), expectedFilter, expect.anything())
    expect(count).toHaveBeenCalledWith(expect.anything(), expectedFilter)
  })

  // `tenantId` is a NOT NULL uuid column, so an unresolved tenant reaching the filter fails in the
  // driver rather than returning an empty page. Fail closed instead of dropping the predicate:
  // querying without it would leave `recipientUserId` as the only thing keeping the read inside
  // one tenant.
  it.each([
    ['explicit null', null],
    ['omitted', undefined],
    ['empty string', ''],
  ])('rejects an unresolved tenant (%s) without querying', async (_label, unresolvedTenantId) => {
    resolveNotificationContextMock.mockResolvedValue({
      ctx: { container },
      scope: {
        userId,
        ...(unresolvedTenantId === undefined ? {} : { tenantId: unresolvedTenantId }),
        organizationId,
        organizationIds: [organizationId],
      },
    } as never)

    const response = await GET(new Request('https://example.test/api/notifications?pageSize=25'))

    expect(response.status).toBe(403)
    expect(find).not.toHaveBeenCalled()
    expect(count).not.toHaveBeenCalled()
  })
})
