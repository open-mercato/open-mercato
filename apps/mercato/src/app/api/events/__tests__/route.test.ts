import type { NextRequest } from 'next/server'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: jest.fn(),
}))

jest.mock('@open-mercato/shared/modules/events', () => ({
  getDeclaredEvents: jest.fn(() => [
    {
      id: 'customers.person.created',
      module: 'customers',
      entity: 'person',
      label: 'Person Created',
      category: 'crud',
    },
    {
      id: 'sales.order.placed',
      module: 'sales',
      entity: 'order',
      label: 'Order Placed',
      category: 'crud',
    },
    {
      id: 'webhooks.delivery.lifecycle',
      module: 'webhooks',
      entity: 'delivery',
      label: 'Delivery Lifecycle',
      category: 'lifecycle',
      excludeFromTriggers: true,
    },
  ]),
}))

import { GET } from '../route'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'

const mockedGetAuth = getAuthFromCookies as jest.MockedFunction<typeof getAuthFromCookies>

function makeReq(url = 'http://localhost/api/events'): NextRequest {
  return new Request(url) as unknown as NextRequest
}

describe('GET /api/events (native route)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 for anonymous callers (no cookie)', async () => {
    mockedGetAuth.mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('returns 200 with the declared event registry for authenticated callers', async () => {
    mockedGetAuth.mockResolvedValue({
      userId: 'u-1',
      tenantId: 't-1',
      organizationId: 'o-1',
    } as never)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[]; total: number }
    expect(body.total).toBeGreaterThan(0)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBe(body.total)
  })

  it('respects the excludeTriggerExcluded filter for authenticated callers', async () => {
    mockedGetAuth.mockResolvedValue({
      userId: 'u-1',
      tenantId: 't-1',
      organizationId: 'o-1',
    } as never)

    const allRes = await GET(makeReq('http://localhost/api/events?excludeTriggerExcluded=false'))
    const triggerableRes = await GET(makeReq('http://localhost/api/events'))

    const allBody = (await allRes.json()) as { total: number }
    const triggerableBody = (await triggerableRes.json()) as { total: number }
    expect(allBody.total).toBe(3)
    expect(triggerableBody.total).toBe(2)
  })

  it('does not call getDeclaredEvents when caller is anonymous', async () => {
    const eventsModule = jest.requireMock('@open-mercato/shared/modules/events') as {
      getDeclaredEvents: jest.Mock
    }
    mockedGetAuth.mockResolvedValue(null)
    await GET(makeReq())
    expect(eventsModule.getDeclaredEvents).not.toHaveBeenCalled()
  })
})
