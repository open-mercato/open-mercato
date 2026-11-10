/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
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

jest.mock('@open-mercato/core/modules/notifications/lib/routeHelpers', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/notifications/lib/routeHelpers')
  return {
    ...actual,
    resolveGuardedNotificationContext: async () => ({
      ok: true,
      ctx: { container },
      scope: {
        userId,
        tenantId,
        organizationId,
        organizationIds: [organizationId],
      },
    }),
  }
})

import { GET } from '../route'

describe('GET /api/notifications query validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    find.mockResolvedValue([])
    count.mockResolvedValue(0)
  })

  it.each([
    ['an unknown status', 'status=not-a-real-status', 'status'],
    ['a non-numeric page', 'page=abc', 'page'],
    ['a pageSize above the limit', 'pageSize=500', 'pageSize'],
    ['a non-uuid sourceEntityId', 'sourceEntityId=not-a-uuid', 'sourceEntityId'],
    ['a malformed since', 'since=yesterday', 'since'],
  ])('returns 400 for %s without querying', async (_label, query, field) => {
    const response = await GET(new Request(`https://example.test/api/notifications?${query}`))

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error?: string }
    expect(body.error).toContain(field)
    expect(find).not.toHaveBeenCalled()
    expect(count).not.toHaveBeenCalled()
  })

  it('still lists notifications for a valid query', async () => {
    const response = await GET(new Request('https://example.test/api/notifications?status=unread&page=2&pageSize=10'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { page: number; pageSize: number }
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(10)
    expect(find).toHaveBeenCalledTimes(1)
  })
})
