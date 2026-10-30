import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-045: the order payment due date (`dueAt`) is writable on update,
 * served by the documents API, and sortable/filterable.
 *
 * Covers `PUT /api/sales/orders`, `GET /api/sales/orders` (list, `?id=` detail,
 * `sortField=dueAt`, `dueFrom`/`dueTo`) and `PUT /api/sales/quotes`. The sort
 * and range assertions run through the query engine against real rows, which
 * the unit tests in `api/__tests__/documents.factory.test.ts` cannot reach —
 * in particular that a range excludes an order with no due date.
 *
 * Every list call narrows by `ids=` to this spec's own fixtures, so orders
 * already in the tenant cannot make the run flaky.
 */

type JsonRecord = Record<string, unknown>
type Fixtures = { dueEarly: string; dueLate: string; noDueDate: string }

const EARLY = '2031-01-10'
const LATE = '2031-01-20'

async function createOrder(
  request: APIRequestContext,
  token: string,
  dueAt: string | null,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/sales/orders', {
    token,
    data: {
      currencyCode: 'USD',
      ...(dueAt ? { dueAt } : {}),
      lines: [
        {
          currencyCode: 'USD',
          quantity: 1,
          name: `TC-SALES-045 seed line ${Date.now()}`,
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

async function listOrders(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<JsonRecord[]> {
  const response = await apiRequest(request, 'GET', `/api/sales/orders?${query}`, { token })
  expect(response.status(), `GET /api/sales/orders?${query} should return 200`).toBe(200)
  const body = (await response.json()) as { items?: JsonRecord[] }
  return body.items ?? []
}

async function readDueAt(request: APIRequestContext, token: string, orderId: string): Promise<unknown> {
  const [order] = await listOrders(request, token, `id=${orderId}`)
  expect(order, `Order ${orderId} should be readable`).toBeTruthy()
  return order.dueAt
}

function dayOf(value: unknown): string | null {
  return typeof value === 'string' ? value.slice(0, 10) : null
}

test.describe('TC-SALES-045: order due date', () => {
  let token: string
  let fixtures: Fixtures

  const fixtureIds = () => [fixtures.dueEarly, fixtures.dueLate, fixtures.noDueDate].join(',')

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    fixtures = {
      dueEarly: await createOrder(request, token, EARLY),
      dueLate: await createOrder(request, token, LATE),
      noDueDate: await createOrder(request, token, null),
    }
  })

  test.afterAll(async ({ request }) => {
    for (const id of [fixtures?.dueEarly, fixtures?.dueLate, fixtures?.noDueDate]) {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', id ?? null)
    }
  })

  test('list and detail serve the due date set on create', async ({ request }) => {
    const items = await listOrders(request, token, `ids=${fixtureIds()}`)
    const dueById = new Map(items.map((item) => [item.id, item.dueAt]))

    expect(dayOf(dueById.get(fixtures.dueEarly))).toBe(EARLY)
    expect(dayOf(dueById.get(fixtures.dueLate))).toBe(LATE)
    expect(dueById.get(fixtures.noDueDate)).toBeNull()
    expect(dayOf(await readDueAt(request, token, fixtures.dueEarly))).toBe(EARLY)
  })

  test('update sets, moves and clears the due date', async ({ request }) => {
    let orderId: string | null = null
    try {
      orderId = await createOrder(request, token, null)

      const set = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: orderId, dueAt: '2031-02-01' },
      })
      expect(set.status(), 'PUT with dueAt should return 200').toBe(200)
      expect(dayOf(((await set.json()) as JsonRecord).dueAt)).toBe('2031-02-01')
      expect(dayOf(await readDueAt(request, token, orderId))).toBe('2031-02-01')

      const moved = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: orderId, dueAt: '2031-03-15' },
      })
      expect(moved.status()).toBe(200)
      expect(dayOf(await readDueAt(request, token, orderId))).toBe('2031-03-15')

      const untouched = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: orderId, customerReference: `TC-SALES-045-${Date.now()}` },
      })
      expect(untouched.status()).toBe(200)
      expect(dayOf(await readDueAt(request, token, orderId))).toBe('2031-03-15')

      const cleared = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: orderId, dueAt: null },
      })
      expect(cleared.status()).toBe(200)
      expect(((await cleared.json()) as JsonRecord).dueAt).toBeNull()
      expect(await readDueAt(request, token, orderId)).toBeNull()
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('sortField=dueAt orders by the due date in both directions', async ({ request }) => {
    const datedIds = (items: JsonRecord[]) =>
      items.map((item) => item.id).filter((id) => id === fixtures.dueEarly || id === fixtures.dueLate)

    const ascending = await listOrders(request, token, `ids=${fixtureIds()}&sortField=dueAt&sortDir=asc`)
    const descending = await listOrders(request, token, `ids=${fixtureIds()}&sortField=dueAt&sortDir=desc`)

    expect(datedIds(ascending)).toEqual([fixtures.dueEarly, fixtures.dueLate])
    expect(datedIds(descending)).toEqual([fixtures.dueLate, fixtures.dueEarly])
  })

  test('dueFrom and dueTo bound the due date inclusively and exclude orders without one', async ({ request }) => {
    const ids = async (query: string) =>
      (await listOrders(request, token, `ids=${fixtureIds()}&${query}`)).map((item) => item.id)

    expect(await ids('dueFrom=2031-01-15')).toEqual([fixtures.dueLate])
    expect(await ids('dueTo=2031-01-15')).toEqual([fixtures.dueEarly])

    const bothBounds = await ids(`dueFrom=${EARLY}&dueTo=${LATE}`)
    expect(bothBounds).toHaveLength(2)
    expect(bothBounds).toEqual(expect.arrayContaining([fixtures.dueEarly, fixtures.dueLate]))
    expect(bothBounds).not.toContain(fixtures.noDueDate)
  })

  // Create accepts a full timestamp, so a due date can fall later in the day
  // than the midnight a date-only dueTo parses to.
  test('a date-only dueTo includes an order due later that same day', async ({ request }) => {
    let orderId: string | null = null
    try {
      orderId = await createOrder(request, token, '2031-01-25T15:00:00.000Z')
      const ids = async (query: string) =>
        (await listOrders(request, token, `ids=${orderId}&${query}`)).map((item) => item.id)

      expect(await ids('dueTo=2031-01-25')).toEqual([orderId])
      expect(await ids('dueFrom=2031-01-25&dueTo=2031-01-25')).toEqual([orderId])
      expect(await ids('dueTo=2031-01-24')).toEqual([])
      expect(await ids('dueTo=2031-01-25T14:59:59.000Z')).toEqual([])
      expect(await ids('dueTo=2031-01-25T15:00:00.000Z')).toEqual([orderId])
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('a quote update carrying dueAt is rejected', async ({ request }) => {
    let quoteId: string | null = null
    try {
      const created = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: { currencyCode: 'USD' },
      })
      expect(created.ok(), `Failed to create quote: ${created.status()}`).toBeTruthy()
      const body = (await created.json()) as { id?: string; quoteId?: string }
      quoteId = body.id ?? body.quoteId ?? null
      expect(quoteId).toBeTruthy()

      const response = await apiRequest(request, 'PUT', '/api/sales/quotes', {
        token,
        data: { id: quoteId, dueAt: '2031-02-01' },
      })
      expect(response.status()).toBe(400)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })
})
