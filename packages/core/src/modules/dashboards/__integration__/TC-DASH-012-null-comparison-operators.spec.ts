import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  canManageSalesOrders,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-DASH-012 — production-boundary coverage for #5016.
 *
 * The `eq` and `neq` widget-data filter operators used to bind a null value as a parameter, and
 * MikroORM interpolates parameters into the SQL text rather than binding them, so the aggregation
 * reached PostgreSQL as `column = NULL` / `column != NULL`. Neither predicate is ever `TRUE` under
 * three-valued logic, so both filters selected zero rows and answered `200` with an empty
 * aggregation — a silent zero rather than a loud failure. Null equality is reachable straight from
 * the public request schema, whose scalar-operator branch types `value` as unknown and optional.
 *
 * The assertion is deliberately fixture-independent: `eq null` and `neq null` on the same field
 * partition the run's own orders, so the two counts must sum to the number created. Before the fix
 * both sides returned zero and the sum could not hold.
 *
 * Self-contained: every order it counts is created here and deleted in `finally`.
 */

const API = {
  orders: '/api/sales/orders',
  widgetData: '/api/dashboards/widgets/data',
}

const ORDER_COUNT = 3

type WidgetDataResponse = { value?: number | null }

type ScalarFilter = {
  field: string
  operator: 'eq' | 'neq' | 'in' | 'is_null' | 'is_not_null'
  value?: unknown
}

/**
 * Counts orders matching `filters`. Every request carries the run's own order ids, so the
 * two-minute widget-data cache can never serve one run's answer to the next.
 */
async function countOrders(
  request: APIRequestContext,
  token: string,
  filters: ScalarFilter[],
): Promise<number> {
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
    `widget data should execute ${filters.map((filter) => filter.operator).join(' + ')} against PostgreSQL, got ${JSON.stringify(body)}`,
  ).toBe(200)
  return Number(body?.value ?? 0)
}

test.describe('TC-DASH-012: null comparison in widget-data filter operators', () => {
  test('TC-DASH-012: eq and neq against null select rows instead of answering a silent zero', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    test.skip(
      !(await canManageSalesOrders(request, adminToken)),
      'Sales order writes are not permitted for this actor (role ACLs not synced).',
    )

    const orderIds: string[] = []

    try {
      for (let index = 0; index < ORDER_COUNT; index += 1) {
        orderIds.push(await createSalesOrderFixture(request, adminToken))
      }
      const ownRows: ScalarFilter = { field: 'id', operator: 'in', value: orderIds }

      expect(await countOrders(request, adminToken, [ownRows])).toBe(ORDER_COUNT)

      // The shapes that used to render `customer_entity_id = NULL` / `!= NULL` and match no row.
      const unsetCount = await countOrders(request, adminToken, [
        ownRows,
        { field: 'customerEntityId', operator: 'eq', value: null },
      ])
      const setCount = await countOrders(request, adminToken, [
        ownRows,
        { field: 'customerEntityId', operator: 'neq', value: null },
      ])

      expect(
        unsetCount + setCount,
        'eq null and neq null must partition the run: before #5016 both sides returned zero',
      ).toBe(ORDER_COUNT)

      // The dedicated null operators were already correct, so they are the reference answer the
      // equality operators now have to agree with.
      expect(
        await countOrders(request, adminToken, [ownRows, { field: 'customerEntityId', operator: 'is_null' }]),
      ).toBe(unsetCount)
      expect(
        await countOrders(request, adminToken, [ownRows, { field: 'customerEntityId', operator: 'is_not_null' }]),
      ).toBe(setCount)

      // A non-null comparison must still bind its value: an over-correction that sent every `eq`
      // down the keyword path would count the whole run here instead of the single order asked for.
      expect(
        await countOrders(request, adminToken, [
          ownRows,
          { field: 'id', operator: 'eq', value: orderIds[0] },
        ]),
      ).toBe(1)
      expect(
        await countOrders(request, adminToken, [
          ownRows,
          { field: 'id', operator: 'neq', value: orderIds[0] },
        ]),
      ).toBe(ORDER_COUNT - 1)
    } finally {
      for (const orderId of orderIds) {
        await deleteSalesEntityIfExists(request, adminToken, API.orders, orderId)
      }
    }
  })
})
