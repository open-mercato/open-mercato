import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBusinessRuleFixture,
  deleteBusinessRuleIfExists,
} from '@open-mercato/core/helpers/integration/businessRulesFixtures'
import {
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'

type StatusListResponse = { items?: Array<{ id?: string; value?: string }> }
type CreatedResponse = { id?: string }
type RuleLogListResponse = { items?: Array<{ ruleId?: string; executionResult?: string }> }
type OrderStatusFixture = { id: string; created: boolean }

const ORDER_STATUSES_PATH = '/api/sales/order-statuses'

/**
 * The lifecycle events fire on the status value (`confirmed`, `canceled`), and status values are
 * unique per organization, so the test reuses an existing entry with that value or creates one
 * (removed in teardown) when the tenant has none.
 */
async function ensureOrderStatus(
  request: APIRequestContext,
  token: string,
  value: 'confirmed' | 'canceled',
): Promise<OrderStatusFixture> {
  const listResponse = await apiRequest(request, 'GET', `${ORDER_STATUSES_PATH}?page=1&pageSize=100`, { token })
  expect(listResponse.ok(), `GET ${ORDER_STATUSES_PATH} failed: ${listResponse.status()}`).toBeTruthy()
  const list = await readJsonSafe<StatusListResponse>(listResponse)
  const existing = list?.items?.find((item) => item.value?.trim().toLowerCase() === value)
  if (typeof existing?.id === 'string') return { id: existing.id, created: false }

  const createResponse = await apiRequest(request, 'POST', ORDER_STATUSES_PATH, {
    token,
    data: { value, label: `QA TC-BR-014 ${value}` },
  })
  expect(createResponse.status(), `POST ${ORDER_STATUSES_PATH} (${value}) failed`).toBe(201)
  const created = await readJsonSafe<CreatedResponse>(createResponse)
  expect(typeof created?.id, `order status "${value}" was not created`).toBe('string')
  return { id: created!.id!, created: true }
}

async function countRuleLogs(request: APIRequestContext, token: string, ruleId: string): Promise<number> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/business_rules/logs?ruleId=${encodeURIComponent(ruleId)}&pageSize=10`,
    { token },
  )
  if (!response.ok()) return -1
  const body = await readJsonSafe<RuleLogListResponse>(response)
  return (body?.items ?? []).filter((item) => item.ruleId === ruleId).length
}

/**
 * TC-BR-014: business rules react to sales order lifecycle events.
 *
 * `sales.order.confirmed` / `sales.order.cancelled` must reach scope-aware
 * subscribers (the CRUD rule trigger reads tenant and organization from the
 * trusted emit options, not from the payload).
 */
test.describe('TC-BR-014: rules on sales order confirmed/cancelled events', () => {
  test('executes rules when an order is confirmed and then cancelled', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    const suffix = Date.now()
    let confirmedRuleId: string | null = null
    let cancelledRuleId: string | null = null
    let orderId: string | null = null
    const createdStatusIds: string[] = []

    try {
      const confirmedStatus = await ensureOrderStatus(request, token, 'confirmed')
      if (confirmedStatus.created) createdStatusIds.push(confirmedStatus.id)
      const canceledStatus = await ensureOrderStatus(request, token, 'canceled')
      if (canceledStatus.created) createdStatusIds.push(canceledStatus.id)

      confirmedRuleId = await createBusinessRuleFixture(request, token, {
        ruleId: `QA_SO_CONFIRMED_${suffix}`,
        ruleName: 'QA sales order confirmed',
        ruleType: 'GUARD',
        entityType: 'sales.order',
        eventType: 'confirmed',
        conditionExpression: { field: 'status', operator: '=', value: 'confirmed' },
        successActions: null,
        failureActions: null,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      cancelledRuleId = await createBusinessRuleFixture(request, token, {
        ruleId: `QA_SO_CANCELLED_${suffix}`,
        ruleName: 'QA sales order cancelled',
        ruleType: 'GUARD',
        entityType: 'sales.order',
        eventType: 'cancelled',
        conditionExpression: { field: 'previousStatus', operator: '=', value: 'confirmed' },
        successActions: null,
        failureActions: null,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      orderId = await createSalesOrderFixture(request, token)

      const confirmResponse = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: orderId, statusEntryId: confirmedStatus.id },
      })
      expect(confirmResponse.ok(), `PUT /api/sales/orders confirm failed: ${confirmResponse.status()}`).toBeTruthy()

      await expect
        .poll(() => countRuleLogs(request, token, confirmedRuleId!), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1)

      const cancelResponse = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: orderId, statusEntryId: canceledStatus.id },
      })
      expect(cancelResponse.ok(), `PUT /api/sales/orders cancel failed: ${cancelResponse.status()}`).toBeTruthy()

      await expect
        .poll(() => countRuleLogs(request, token, cancelledRuleId!), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteBusinessRuleIfExists(request, token, confirmedRuleId)
      await deleteBusinessRuleIfExists(request, token, cancelledRuleId)
      for (const statusId of createdStatusIds) {
        await deleteSalesEntityIfExists(request, token, ORDER_STATUSES_PATH, statusId)
      }
    }
  })
})
