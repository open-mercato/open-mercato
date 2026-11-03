import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'

/**
 * TC-SALES-5198: multi-value sales-channel filtering on the documents list.
 *
 * Covers `GET /api/sales/orders` for the `channelIds` / `channelIdsEmpty` query
 * params, proving the query engine turns the filter objects built by
 * `buildFilters` into the rows a merchant expects — the half the unit tests in
 * `api/__tests__/documents.factory.test.ts` cannot reach.
 *
 * Every assertion narrows by `ids=` to this spec's own fixtures, so a tenant
 * that already holds unassigned orders cannot make the run flaky. A broken
 * channel filter still fails the spec: it would let a fixture through that the
 * channel params should have excluded.
 */

type OrderIds = { onChannelA: string; onChannelB: string; unassigned: string }

async function createChannel(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/sales/channels', {
    token,
    data: { name, code: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), isActive: true },
  })
  expect(response.ok(), `Failed to create channel ${name}: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { id?: string }
  expect(body.id, `No id returned when creating channel ${name}`).toBeTruthy()
  return body.id as string
}

async function createOrder(
  request: APIRequestContext,
  token: string,
  channelId: string | null,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/sales/orders', {
    token,
    data: {
      currencyCode: 'USD',
      ...(channelId ? { channelId } : {}),
      lines: [
        {
          currencyCode: 'USD',
          quantity: 1,
          name: `TC-SALES-5198 seed line ${Date.now()}`,
          unitPriceNet: 0,
          unitPriceGross: 0,
        },
      ],
    },
  })
  expect(response.ok(), `Failed to create order: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { id?: string; orderId?: string }
  const id = body.id ?? body.orderId
  expect(id, 'No id returned when creating order').toBeTruthy()
  return id as string
}

async function listOrderIds(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<string[]> {
  const response = await apiRequest(request, 'GET', `/api/sales/orders?${query}`, { token })
  expect(response.status(), `GET /api/sales/orders?${query} should return 200`).toBe(200)
  const body = (await response.json()) as { items?: Array<{ id?: string }> }
  return (body.items ?? []).map((item) => item.id).filter((id): id is string => typeof id === 'string')
}

test.describe('TC-SALES-5198: sales-channel filtering on the documents list', () => {
  let token: string
  let channelA: string
  let channelB: string
  let orders: OrderIds

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    channelA = await createChannel(request, token, `TC5198 Channel A ${Date.now()}`)
    channelB = await createChannel(request, token, `TC5198 Channel B ${Date.now()}`)
    orders = {
      onChannelA: await createOrder(request, token, channelA),
      onChannelB: await createOrder(request, token, channelB),
      unassigned: await createOrder(request, token, null),
    }
  })

  test.afterAll(async ({ request }) => {
    for (const id of [orders?.onChannelA, orders?.onChannelB, orders?.unassigned]) {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', id ?? null)
    }
    for (const id of [channelA, channelB]) {
      await deleteSalesEntityIfExists(request, token, '/api/sales/channels', id ?? null)
    }
  })

  test('channelIds matches documents on any of the supplied channels', async ({ request }) => {
    const ids = [orders.onChannelA, orders.onChannelB, orders.unassigned].join(',')
    const found = await listOrderIds(request, token, `ids=${ids}&channelIds=${channelA},${channelB}`)

    expect(found).toHaveLength(2)
    expect(found).toEqual(expect.arrayContaining([orders.onChannelA, orders.onChannelB]))
    expect(found).not.toContain(orders.unassigned)
  })

  test('channelIdsEmpty matches only documents with no channel', async ({ request }) => {
    const ids = [orders.onChannelA, orders.onChannelB, orders.unassigned].join(',')
    const found = await listOrderIds(request, token, `ids=${ids}&channelIdsEmpty=true`)

    expect(found).toEqual([orders.unassigned])
  })

  test('channelIds combines with channelIdsEmpty instead of one dropping the other', async ({ request }) => {
    const ids = [orders.onChannelA, orders.onChannelB, orders.unassigned].join(',')
    const found = await listOrderIds(request, token, `ids=${ids}&channelIds=${channelA}&channelIdsEmpty=true`)

    expect(found).toHaveLength(2)
    expect(found).toEqual(expect.arrayContaining([orders.onChannelA, orders.unassigned]))
    expect(found).not.toContain(orders.onChannelB)
  })

  test('the singular channelId keeps its existing single-channel behaviour', async ({ request }) => {
    const ids = [orders.onChannelA, orders.onChannelB, orders.unassigned].join(',')
    const found = await listOrderIds(request, token, `ids=${ids}&channelId=${channelA}`)

    expect(found).toEqual([orders.onChannelA])
  })
})
