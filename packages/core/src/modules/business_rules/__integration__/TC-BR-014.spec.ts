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
type RuleLogListResponse = { items?: Array<{ ruleId?: string; executionResult?: string }> }

async function fetchOrderStatusId(
  request: APIRequestContext,
  token: string,
  value: 'confirmed' | 'canceled',
): Promise<string> {
  const response = await apiRequest(request, 'GET', '/api/sales/order-statuses?page=1&pageSize=100', { token })
  expect(response.ok(), `GET /api/sales/order-statuses failed: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<StatusListResponse>(response)
  const status = body?.items?.find((item) => item.value === value)
  expect(typeof status?.id, `order status "${value}" is missing`).toBe('string')
  return status!.id!
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

    try {
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
      const confirmedStatusId = await fetchOrderStatusId(request, token, 'confirmed')
      const canceledStatusId = await fetchOrderStatusId(request, token, 'canceled')

      const confirmResponse = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: orderId, statusEntryId: confirmedStatusId },
      })
      expect(confirmResponse.ok(), `PUT /api/sales/orders confirm failed: ${confirmResponse.status()}`).toBeTruthy()

      await expect
        .poll(() => countRuleLogs(request, token, confirmedRuleId!), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1)

      const cancelResponse = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: orderId, statusEntryId: canceledStatusId },
      })
      expect(cancelResponse.ok(), `PUT /api/sales/orders cancel failed: ${cancelResponse.status()}`).toBeTruthy()

      await expect
        .poll(() => countRuleLogs(request, token, cancelledRuleId!), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteBusinessRuleIfExists(request, token, confirmedRuleId)
      await deleteBusinessRuleIfExists(request, token, cancelledRuleId)
    }
  })
})
