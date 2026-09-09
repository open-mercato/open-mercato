import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  canManageSalesOrders,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-DASH-010 — production-boundary coverage for #4669.
 *
 * The `in` and `not_in` widget-data filter operators used to render as `= ANY(?)` / `!= ALL(?)`
 * with the whole JavaScript array pushed as one parameter. MikroORM interpolates parameters into
 * the SQL text instead of binding them, so that produced `= ANY('a', 'b')` — rejected by
 * PostgreSQL for every shape of value. Both operators are reachable from the public request
 * schema, so this spec drives them through the real chain: widget-data route → aggregation SQL →
 * PostgreSQL, and pins the row counts each filter combination must return.
 *
 * Self-contained: every order it counts is created here and deleted in `finally`.
 */

const API = {
  orders: '/api/sales/orders',
  widgetData: '/api/dashboards/widgets/data',
}

type WidgetDataResponse = { value?: number | null }

type SetFilter = {
  field: string
  operator: 'in' | 'not_in'
  value: unknown
}

/**
 * Counts orders matching `filters`. Every request carries the run's own order ids, so the
 * two-minute widget-data cache can never serve one run's answer to the next.
 */
async function countOrders(
  request: APIRequestContext,
  token: string,
  filters: SetFilter[],
): Promise<number | null | undefined> {
  const response = await apiRequest(request, 'POST', API.widgetData, {
    token,
    data: {
      entityType: 'sales:orders',
      metric: { field: 'id', aggregate: 'count' },
      filters,
    },
  })
  const body = await readJsonSafe<WidgetDataResponse>(response)
  expect(
    response.status(),
    `widget data should execute ${filters.map((f) => f.operator).join(' + ')} against PostgreSQL, got ${JSON.stringify(body)}`,
  ).toBe(200)
  return body?.value
}

test.describe('TC-DASH-010: in and not_in widget-data filter operators', () => {
  test('TC-DASH-010: set filters execute against PostgreSQL and select the expected rows', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    test.skip(
      !(await canManageSalesOrders(request, adminToken)),
      'Sales order writes are not permitted for this actor (role ACLs not synced).',
    )

    const orderIds: string[] = []

    try {
      for (let index = 0; index < 3; index += 1) {
        orderIds.push(await createSalesOrderFixture(request, adminToken))
      }
      const [first, second, third] = orderIds

      // `in` over several members — the shape that used to raise `syntax error at or near ","`.
      expect(await countOrders(request, adminToken, [{ field: 'id', operator: 'in', value: orderIds }])).toBe(3)

      // `in` over a single member — the shape that used to raise `malformed array literal`.
      expect(await countOrders(request, adminToken, [{ field: 'id', operator: 'in', value: [first] }])).toBe(1)

      // `not_in` narrows the set the preceding `in` selected.
      expect(
        await countOrders(request, adminToken, [
          { field: 'id', operator: 'in', value: orderIds },
          { field: 'id', operator: 'not_in', value: [first] },
        ]),
      ).toBe(2)

      expect(
        await countOrders(request, adminToken, [
          { field: 'id', operator: 'in', value: orderIds },
          { field: 'id', operator: 'not_in', value: [second, third] },
        ]),
      ).toBe(1)

      // An empty set selects nothing for `in` and excludes nothing for `not_in`; neither may
      // reach PostgreSQL as empty parentheses.
      expect(
        await countOrders(request, adminToken, [
          { field: 'id', operator: 'in', value: [] },
          { field: 'id', operator: 'not_in', value: [first] },
        ]),
      ).toBe(0)

      expect(
        await countOrders(request, adminToken, [
          { field: 'id', operator: 'in', value: orderIds },
          { field: 'id', operator: 'not_in', value: [] },
        ]),
      ).toBe(3)

      // A null member never matches in SQL — `id IN (NULL)` is NULL for every row — so it would
      // answer with an empty aggregation and no error. The request schema refuses it instead.
      const nullMemberResponse = await apiRequest(request, 'POST', API.widgetData, {
        token: adminToken,
        data: {
          entityType: 'sales:orders',
          metric: { field: 'id', aggregate: 'count' },
          filters: [{ field: 'id', operator: 'in', value: null }],
        },
      })
      expect(
        nullMemberResponse.status(),
        'a null set filter member must be refused with 400, never answered with a silent zero',
      ).toBe(400)
    } finally {
      for (const orderId of orderIds) {
        await deleteSalesEntityIfExists(request, adminToken, API.orders, orderId)
      }
    }
  })
})
