import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { EXPLAIN_PATH, type ApiResult, type ExplainFieldBody } from './explainApi'

export const EXPLAIN_ACCESS_PATH = '/api/insights/explain/access'
export const ORDER_RESOURCE_KIND = 'sales.order'
export const LINE_PRICE_FACT_PREFIX = 'sales.insights.linePrice.'
export const PRICE_KINDS_PATH = '/api/catalog/price-kinds'
export const PRICES_PATH = '/api/catalog/prices'
export const ORDER_LINES_PATH = '/api/sales/order-lines'

export type ExplainHint = {
  key: string
  params: Record<string, string | number | boolean | null>
  confidence?: 'proven' | 'inferred' | 'unknown'
  reference?: { kind: string; id: string; label: string | null; href: string | null } | null
}

export type AccessRoleGrant = {
  id: string
  name: string | null
  isSuperAdmin: boolean
  organizations: string[] | null
  appliesToOrganization: boolean
  grantedFeatures: string[]
}

export type AccessExplainBody = {
  decision: 'granted' | 'denied'
  required: Array<{ feature: string; granted: boolean }>
  reasons: string[]
  summary: { key: string; params: Record<string, string | number | boolean | null> }
  detail: {
    subject: { kind: 'user' | 'api_key'; id: string; isSelf: boolean }
    source: string
    organizationId: string | null
    organizationAllowed: boolean
    features: Array<{ feature: string; granted: boolean; reason: string | null }>
    userAcl: { isSuperAdmin: boolean; organizations: string[] | null; grantedFeatures: string[] } | null
    roles: AccessRoleGrant[]
    rolesThatWouldGrant: AccessRoleGrant[]
    grantedOrganizationIds: string[] | null
    organizationsRedacted: boolean
    recentChanges: Array<{ logId: string; at: string; kind: string; resourceId: string | null }> | null
    consistentWithFreshRead: boolean
  } | null
  confidence: 'proven' | 'inferred' | 'unknown'
}

async function readResult<TBody>(response: APIResponse): Promise<ApiResult<TBody>> {
  const text = await response.text()
  let body: TBody | null = null
  if (text) {
    try {
      body = JSON.parse(text) as TBody
    } catch {
      body = null
    }
  }
  return { status: response.status(), text, body }
}

export async function createPriceKindFixture(
  request: APIRequestContext,
  token: string,
  input: { code: string; title: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', PRICE_KINDS_PATH, {
    token,
    data: { code: input.code, title: input.title, displayMode: 'excluding-tax', currencyCode: 'USD' },
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), `POST ${PRICE_KINDS_PATH} should return 201`).toBe(201)
  return expectId(body?.id, 'price kind create response should include id')
}

export async function createProductPriceFixture(
  request: APIRequestContext,
  token: string,
  input: { productId: string; priceKindId: string; unitPriceNet: number },
): Promise<string> {
  const response = await apiRequest(request, 'POST', PRICES_PATH, {
    token,
    data: {
      productId: input.productId,
      priceKindId: input.priceKindId,
      currencyCode: 'USD',
      minQuantity: 1,
      unitPriceNet: input.unitPriceNet,
      taxRate: 0,
    },
  })
  const body = await readJsonSafe<{ id?: string; priceId?: string }>(response)
  expect(response.status(), `POST ${PRICES_PATH} should return 201`).toBe(201)
  return expectId(body?.id ?? body?.priceId, 'price create response should include id')
}

export async function updateOrderLinePrice(
  request: APIRequestContext,
  token: string,
  input: { orderId: string; lineId: string; unitPriceNet: number; unitPriceGross: number },
): Promise<void> {
  const response = await apiRequest(request, 'PUT', ORDER_LINES_PATH, {
    token,
    data: {
      id: input.lineId,
      orderId: input.orderId,
      currencyCode: 'USD',
      quantity: 1,
      unitPriceNet: input.unitPriceNet,
      unitPriceGross: input.unitPriceGross,
      taxRate: 0,
    },
  })
  const text = await response.text()
  expect(response.status(), `PUT ${ORDER_LINES_PATH} should return 200: ${text}`).toBe(200)
}

export async function explainOrderLineField(
  request: APIRequestContext,
  token: string,
  input: { orderId: string; lineId: string; field: string },
): Promise<ExplainFieldBody & { hints: ExplainHint[] }> {
  const search = new URLSearchParams({
    resourceKind: ORDER_RESOURCE_KIND,
    resourceId: input.orderId,
    field: input.field,
    itemId: input.lineId,
  })
  const result = await readResult<ExplainFieldBody & { hints: ExplainHint[] }>(
    await apiRequest(request, 'GET', `${EXPLAIN_PATH}?${search.toString()}`, { token }),
  )
  expect(result.status, `GET ${EXPLAIN_PATH} (${input.field}) should return 200: ${result.text}`).toBe(200)
  expect(result.body, 'explain response should be JSON').not.toBeNull()
  return result.body as ExplainFieldBody & { hints: ExplainHint[] }
}

export function findLinePriceHint(body: { hints: ExplainHint[] }): ExplainHint {
  const hints = body.hints.filter((hint) => hint.key.startsWith(LINE_PRICE_FACT_PREFIX))
  expect(hints, 'the line price provider should report exactly one fact').toHaveLength(1)
  return hints[0]
}

export async function explainAccess(
  request: APIRequestContext,
  token: string,
  input: { features: string[]; userId?: string; path?: string },
): Promise<ApiResult<AccessExplainBody>> {
  const search = new URLSearchParams({ features: input.features.join(',') })
  if (input.userId) search.set('userId', input.userId)
  if (input.path) search.set('path', input.path)
  return readResult<AccessExplainBody>(
    await apiRequest(request, 'GET', `${EXPLAIN_ACCESS_PATH}?${search.toString()}`, { token }),
  )
}

export async function explainAccessOk(
  request: APIRequestContext,
  token: string,
  input: { features: string[]; userId?: string; path?: string },
): Promise<AccessExplainBody> {
  const result = await explainAccess(request, token, input)
  expect(result.status, `GET ${EXPLAIN_ACCESS_PATH} should return 200: ${result.text}`).toBe(200)
  expect(result.body, 'access explanation should be JSON').not.toBeNull()
  return result.body as AccessExplainBody
}
