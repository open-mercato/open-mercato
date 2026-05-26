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

import { GET, metadata } from '../route'

function makeReq(url = 'http://localhost/api/events'): Request {
  return new Request(url)
}

describe('GET /api/events (core events module route)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('declares requireAuth: true and explicit path so the dispatcher denies anonymous callers', () => {
    expect(metadata.path).toBe('/events')
    expect(metadata.GET?.requireAuth).toBe(true)
  })

  it('returns the full registry by default (excludeTriggerExcluded=true)', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ id: string }>; total: number }
    expect(body.total).toBe(2)
    expect(body.data.map((e) => e.id)).toEqual(['customers.person.created', 'sales.order.placed'])
  })

  it('respects excludeTriggerExcluded=false and returns trigger-excluded events too', async () => {
    const res = await GET(makeReq('http://localhost/api/events?excludeTriggerExcluded=false'))
    const body = (await res.json()) as { total: number }
    expect(body.total).toBe(3)
  })

  it('filters by category', async () => {
    const res = await GET(makeReq('http://localhost/api/events?category=crud'))
    const body = (await res.json()) as { total: number; data: Array<{ category: string }> }
    expect(body.total).toBe(2)
    expect(body.data.every((e) => e.category === 'crud')).toBe(true)
  })

  it('filters by module', async () => {
    const res = await GET(makeReq('http://localhost/api/events?module=customers'))
    const body = (await res.json()) as { total: number; data: Array<{ module: string }> }
    expect(body.total).toBe(1)
    expect(body.data[0].module).toBe('customers')
  })
})
