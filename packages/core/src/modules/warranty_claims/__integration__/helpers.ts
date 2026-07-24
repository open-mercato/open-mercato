import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { expectId, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

export const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

export type ClaimItem = {
  id: string | null
  claimNumber: string | null
  claimType: string | null
  status: string | null
  channel: string | null
  priority: string | null
  customerId: string | null
  customerName: string | null
  vendorName?: string | null
  vendorRef?: string | null
  orderId: string | null
  salesReturnId?: string | null
  replacementOrderId?: string | null
  sourceClaimId: string | null
  advanceReplacement?: boolean
  advanceShippedAt?: string | null
  reasonCode: string | null
  rejectionReasonCode: string | null
  resolutionSummary: string | null
  notes: string | null
  currencyCode: string | null
  totalClaimedAmount: string | null
  totalApprovedAmount: string | null
  totalRecoveredAmount: string | null
  slaDueAt: string | null
  slaPausedAt: string | null
  submittedAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  entitlementSource?: string | null
  escalationLevel?: number | null
  escalatedAt?: string | null
  assigneeUserId: string | null
  assigneeName?: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type ClaimLineItem = {
  id: string | null
  claimId: string | null
  lineNo: number | null
  productId?: string | null
  variantId?: string | null
  sku: string | null
  productName: string | null
  orderLineId: string | null
  serialNumber: string | null
  lotNumber?: string | null
  purchaseDate?: string | null
  warrantyMonths?: number | null
  warrantyExpiresAt?: string | null
  warrantyStatus?: string | null
  faultCode?: string | null
  faultDescription: string | null
  qtyClaimed: string | null
  qtyApproved: string | null
  qtyReceived: string | null
  conditionOnReceipt?: string | null
  conditionGrade?: string | null
  quarantineStatus?: string | null
  inspectionNotes?: string | null
  assessmentPayload?: Record<string, unknown> | null
  disposition: string | null
  lineStatus: string | null
  creditAmount: string | null
  restockingFee: string | null
  coreChargeAmount?: string | null
  coreCreditAmount: string | null
  vendorName?: string | null
  vendorClaimLineId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type ClaimEventItem = {
  id: string
  claimId: string | null
  kind: string
  visibility: string
  body: string | null
  payload: Record<string, unknown> | null
  actorUserId?: string | null
  actorCustomerId?: string | null
  createdAt: string | null
}

export type PagedItems<T> = {
  items?: T[]
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

export type WarrantyClaimSettingsResult = {
  slaHours: number
  slaPauseOnInfoRequested: boolean
  slaAtRiskThresholdPct: number
  autoApproveEnabled: boolean
  autoApproveMaxAmount: number | null
  autoApproveCurrencyCode: string | null
  autoApproveRequireInWarranty: boolean
  defaultWarrantyMonths: number | null
  businessHours: Record<string, unknown> | null
  escalationTiers: unknown[] | null
  adjudicationUseRules: boolean
  quarantineGrades: string[] | null
  returnLabelProvider: string | null
  returnWindowDays: number | null
  updatedAt: string | null
}

export type WarrantyClaimStatsResult = {
  openByStatus: Record<string, number>
  overdue: number
  assignedToMe: number
  resolvedLast30d: number
  avgResolutionDays: number | null
  approvalRatePct: number | null
  recoveredLast30dByCurrency: Array<{ currencyCode: string | null; total: number }>
}

export type WarrantyClaimRiskSignal = {
  id: 'duplicate_serial' | 'duplicate_order_claim' | 'repeat_claimer' | 'value_velocity' | 'over_quantity_claim' | 'outside_return_window'
  level: 'low' | 'medium' | 'high'
  messageKey: string
  params?: Record<string, string | number>
  relatedClaimNumbers?: string[]
}

export type WarrantyClaimRiskResult = {
  level: 'none' | 'low' | 'medium' | 'high'
  signals: WarrantyClaimRiskSignal[]
}

export type WarrantyClaimRegistrationItem = {
  id: string | null
  serialNumber: string | null
  productId: string | null
  variantId: string | null
  sku: string | null
  productName: string | null
  customerId: string | null
  orderId: string | null
  purchaseDate: string | null
  warrantyMonths: number | null
  warrantyExpiresAt: string | null
  coverageType: string | null
  source: string | null
  proofAttachmentId: string | null
  notes: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type WarrantyVendorPolicyItem = {
  id: string | null
  vendorName: string | null
  vendorRef: string | null
  coverageMonths: number | null
  claimableReasonCodes: string[] | null
  recoveryRatePct: string | null
  contactEmail?: string | null
  autoGenerateRecovery: boolean
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
}

export type WarrantyEntitlementResult = {
  warrantyStatus: 'in_warranty' | 'out_of_warranty' | 'unknown'
  coverageType: string | null
  expiresAt: string | null
  source: string | null
  hasPriorClaims?: boolean
  priorClaimCount?: number
  priorRegistrationCount?: number
  relatedClaimNumbers?: string[]
}

export function uniqueSuffix(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

export function uniqueLabel(prefix: string): string {
  return `${prefix}-${Date.now()}-${uniqueSuffix()}`
}

export function authHeaders(
  token: string,
  updatedAt?: string | null,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(extra ?? {}),
  }
  if (updatedAt !== undefined && updatedAt !== null) {
    headers[OPTIMISTIC_LOCK_HEADER] = updatedAt
  }
  return headers
}

export async function requestJson(
  request: APIRequestContext,
  method: string,
  path: string,
  token: string,
  data?: unknown,
  updatedAt?: string | null,
): Promise<APIResponse> {
  return request.fetch(path, {
    method,
    headers: authHeaders(token, updatedAt),
    ...(data === undefined ? {} : { data }),
  })
}

export function apiKeyHeaders(secret: string, extra?: Record<string, string>): Record<string, string> {
  return {
    'X-Api-Key': secret,
    'Content-Type': 'application/json',
    ...(extra ?? {}),
  }
}

export async function createApiKeyFixture(
  request: APIRequestContext,
  adminToken: string,
  input: { name: string; roles: string[]; tenantId?: string | null; organizationId?: string | null },
): Promise<{ id: string; secret: string }> {
  const response = await apiRequest(request, 'POST', '/api/api_keys/keys', {
    token: adminToken,
    data: input,
  })
  const body = await readRequiredJson<{ id?: string | null; secret?: string | null }>(
    response,
    'api key create response should be JSON',
  )
  expect(response.status(), `POST /api/api_keys/keys should return 201: ${JSON.stringify(body)}`).toBe(201)
  const id = expectId(body.id, 'api key create response should include id')
  expect(typeof body.secret, 'api key create response should include one-time secret').toBe('string')
  expect((body.secret ?? '').length, 'api key secret should not be empty').toBeGreaterThan(0)
  return { id, secret: body.secret as string }
}

export async function deleteApiKeyIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined)
}

export async function externalRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  secret: string,
  data?: unknown,
): Promise<APIResponse> {
  return request.fetch(path, {
    method,
    headers: apiKeyHeaders(secret, { Cookie: '' }),
    ...(data === undefined ? {} : { data }),
  })
}

export async function readRequiredJson<T>(response: APIResponse, message: string): Promise<T> {
  const body = await readJsonSafe<T>(response)
  expect(body, message).toBeTruthy()
  return body as T
}

export async function listClaims(
  request: APIRequestContext,
  token: string,
  query = 'pageSize=100',
): Promise<ClaimItem[]> {
  const response = await apiRequest(request, 'GET', `/api/warranty_claims?${query}`, { token })
  expect(response.status(), `GET /api/warranty_claims?${query} should return 200`).toBe(200)
  const body = await readRequiredJson<PagedItems<ClaimItem>>(response, 'claims list response should be JSON')
  return Array.isArray(body.items) ? body.items : []
}

export async function readClaimMaybe(
  request: APIRequestContext,
  token: string,
  claimId: string,
): Promise<ClaimItem | null> {
  const items = await listClaims(request, token, `ids=${encodeURIComponent(claimId)}&pageSize=10`)
  return items.find((item) => item.id === claimId) ?? null
}

export async function readClaim(
  request: APIRequestContext,
  token: string,
  claimId: string,
): Promise<ClaimItem> {
  const item = await readClaimMaybe(request, token, claimId)
  expect(item, `claim ${claimId} should be readable`).toBeTruthy()
  return item as ClaimItem
}

export async function createClaimFixture(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<ClaimItem> {
  const response = await apiRequest(request, 'POST', '/api/warranty_claims', { token, data })
  const body = await readRequiredJson<{ id?: string | null }>(response, 'claim create response should be JSON')
  expect(response.status(), `POST /api/warranty_claims should return 201: ${JSON.stringify(body)}`).toBe(201)
  const claimId = expectId(body.id, 'claim create response should include id')
  return readClaim(request, token, claimId)
}

export async function updateClaim(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
  updatedAt?: string | null,
): Promise<APIResponse> {
  return requestJson(request, 'PUT', '/api/warranty_claims', token, data, updatedAt)
}

export async function deleteClaimIfExists(
  request: APIRequestContext,
  token: string | null,
  claimId: string | null,
): Promise<void> {
  if (!token || !claimId) return
  await apiRequest(request, 'DELETE', `/api/warranty_claims?id=${encodeURIComponent(claimId)}`, { token }).catch(() => undefined)
}

export async function listClaimLines(
  request: APIRequestContext,
  token: string,
  claimId: string,
): Promise<ClaimLineItem[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/warranty_claims/lines?claimId=${encodeURIComponent(claimId)}&pageSize=100`,
    { token },
  )
  expect(response.status(), 'GET /api/warranty_claims/lines should return 200').toBe(200)
  const body = await readRequiredJson<PagedItems<ClaimLineItem>>(response, 'claim lines response should be JSON')
  return Array.isArray(body.items) ? body.items : []
}

export async function readClaimLine(
  request: APIRequestContext,
  token: string,
  claimId: string,
  lineId: string,
): Promise<ClaimLineItem> {
  const lines = await listClaimLines(request, token, claimId)
  const line = lines.find((item) => item.id === lineId)
  expect(line, `claim line ${lineId} should be readable`).toBeTruthy()
  return line as ClaimLineItem
}

export async function updateClaimLine(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
  updatedAt?: string | null,
): Promise<APIResponse> {
  return requestJson(request, 'PUT', '/api/warranty_claims/lines', token, data, updatedAt)
}

export async function createClaimLine(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
  updatedAt?: string | null,
): Promise<APIResponse> {
  return requestJson(request, 'POST', '/api/warranty_claims/lines', token, data, updatedAt)
}

export async function deleteClaimLineIfExists(
  request: APIRequestContext,
  token: string | null,
  lineId: string | null,
): Promise<void> {
  if (!token || !lineId) return
  await apiRequest(request, 'DELETE', `/api/warranty_claims/lines?id=${encodeURIComponent(lineId)}`, { token }).catch(() => undefined)
}

export async function submitClaim(
  request: APIRequestContext,
  token: string,
  claimId: string,
  updatedAt?: string | null,
): Promise<APIResponse> {
  return requestJson(request, 'POST', '/api/warranty_claims/submit', token, { id: claimId }, updatedAt)
}

export async function transitionClaim(
  request: APIRequestContext,
  token: string,
  data: { id: string; toStatus: string; rejectionReasonCode?: string; resolutionSummary?: string },
  updatedAt?: string | null,
): Promise<APIResponse> {
  return requestJson(request, 'POST', '/api/warranty_claims/transition', token, data, updatedAt)
}

export async function assignClaim(
  request: APIRequestContext,
  token: string,
  data: { id: string; assigneeUserId: string | null },
  updatedAt?: string | null,
): Promise<APIResponse> {
  return requestJson(request, 'POST', '/api/warranty_claims/assign', token, data, updatedAt)
}

export async function createVendorRecovery(
  request: APIRequestContext,
  token: string,
  data: { claimId: string; lineIds: string[]; vendorName: string; vendorRef?: string | null },
  updatedAt?: string | null,
): Promise<APIResponse> {
  return requestJson(request, 'POST', '/api/warranty_claims/vendor-recovery', token, data, updatedAt)
}

export async function readClaimEvents(
  request: APIRequestContext,
  token: string,
  claimId: string,
): Promise<ClaimEventItem[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/warranty_claims/events?claimId=${encodeURIComponent(claimId)}`,
    { token },
  )
  expect(response.status(), 'GET /api/warranty_claims/events should return 200').toBe(200)
  const body = await readRequiredJson<PagedItems<ClaimEventItem>>(response, 'claim events response should be JSON')
  return Array.isArray(body.items) ? body.items : []
}

export async function postClaimEvent(
  request: APIRequestContext,
  token: string,
  data: { claimId: string; body: string; visibility: 'internal' | 'customer' },
): Promise<APIResponse> {
  return requestJson(request, 'POST', '/api/warranty_claims/events', token, data)
}

export async function readWarrantyClaimSettings(
  request: APIRequestContext,
  token: string,
): Promise<WarrantyClaimSettingsResult> {
  const response = await apiRequest(request, 'GET', '/api/warranty_claims/settings-general', { token })
  expect(response.status(), 'GET /api/warranty_claims/settings-general should return 200').toBe(200)
  const body = await readRequiredJson<{ result?: WarrantyClaimSettingsResult }>(response, 'settings response should be JSON')
  expect(body.result, 'settings response should include result').toBeTruthy()
  return body.result as WarrantyClaimSettingsResult
}

export async function putWarrantyClaimSettings(
  request: APIRequestContext,
  token: string,
  data: Partial<Omit<WarrantyClaimSettingsResult, 'updatedAt'>>,
  updatedAt?: string | null,
): Promise<APIResponse> {
  return requestJson(request, 'PUT', '/api/warranty_claims/settings-general', token, data, updatedAt)
}

export async function saveWarrantyClaimSettings(
  request: APIRequestContext,
  token: string,
  data: Partial<Omit<WarrantyClaimSettingsResult, 'updatedAt'>>,
  updatedAt?: string | null,
): Promise<WarrantyClaimSettingsResult> {
  const response = await putWarrantyClaimSettings(request, token, data, updatedAt)
  const body = await readRequiredJson<{ result?: WarrantyClaimSettingsResult }>(response, 'settings save response should be JSON')
  expect(response.status(), `PUT /api/warranty_claims/settings-general should return 200: ${JSON.stringify(body)}`).toBe(200)
  expect(body.result, 'settings save response should include result').toBeTruthy()
  return body.result as WarrantyClaimSettingsResult
}

export async function restoreWarrantyClaimSettings(
  request: APIRequestContext,
  token: string | null,
  snapshot: WarrantyClaimSettingsResult | null,
): Promise<void> {
  if (!token || !snapshot) return
  const current = await readWarrantyClaimSettings(request, token).catch(() => null)
  await saveWarrantyClaimSettings(
    request,
    token,
    {
      slaHours: snapshot.slaHours,
      slaPauseOnInfoRequested: snapshot.slaPauseOnInfoRequested,
      slaAtRiskThresholdPct: snapshot.slaAtRiskThresholdPct,
      autoApproveEnabled: snapshot.autoApproveEnabled,
      autoApproveMaxAmount: snapshot.autoApproveMaxAmount,
      autoApproveCurrencyCode: snapshot.autoApproveCurrencyCode,
      autoApproveRequireInWarranty: snapshot.autoApproveRequireInWarranty,
      defaultWarrantyMonths: snapshot.defaultWarrantyMonths,
      businessHours: snapshot.businessHours,
      escalationTiers: snapshot.escalationTiers,
      adjudicationUseRules: snapshot.adjudicationUseRules,
      quarantineGrades: snapshot.quarantineGrades,
      returnLabelProvider: snapshot.returnLabelProvider,
    },
    current?.updatedAt ?? undefined,
  ).catch(() => undefined)
}

export async function listWarrantyRegistrations(
  request: APIRequestContext,
  token: string,
  query = 'pageSize=100',
): Promise<WarrantyClaimRegistrationItem[]> {
  const response = await apiRequest(request, 'GET', `/api/warranty_claims/registrations?${query}`, { token })
  expect(response.status(), `GET /api/warranty_claims/registrations?${query} should return 200`).toBe(200)
  const body = await readRequiredJson<PagedItems<WarrantyClaimRegistrationItem>>(
    response,
    'registrations list response should be JSON',
  )
  return Array.isArray(body.items) ? body.items : []
}

export async function readWarrantyRegistration(
  request: APIRequestContext,
  token: string,
  registrationId: string,
): Promise<WarrantyClaimRegistrationItem> {
  const items = await listWarrantyRegistrations(request, token, `ids=${encodeURIComponent(registrationId)}&pageSize=10`)
  const item = items.find((registration) => registration.id === registrationId)
  expect(item, `registration ${registrationId} should be readable`).toBeTruthy()
  return item as WarrantyClaimRegistrationItem
}

export async function createWarrantyRegistrationFixture(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<WarrantyClaimRegistrationItem> {
  const response = await apiRequest(request, 'POST', '/api/warranty_claims/registrations', { token, data })
  const body = await readRequiredJson<{ id?: string | null }>(response, 'registration create response should be JSON')
  expect(response.status(), `POST /api/warranty_claims/registrations should return 201: ${JSON.stringify(body)}`).toBe(201)
  const registrationId = expectId(body.id, 'registration create response should include id')
  return readWarrantyRegistration(request, token, registrationId)
}

export async function updateWarrantyRegistration(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
  updatedAt?: string | null,
): Promise<APIResponse> {
  return requestJson(request, 'PUT', '/api/warranty_claims/registrations', token, data, updatedAt)
}

export async function deleteWarrantyRegistrationIfExists(
  request: APIRequestContext,
  token: string | null,
  registrationId: string | null,
): Promise<void> {
  if (!token || !registrationId) return
  await apiRequest(
    request,
    'DELETE',
    `/api/warranty_claims/registrations?id=${encodeURIComponent(registrationId)}`,
    { token },
  ).catch(() => undefined)
}

export async function readWarrantyEntitlement(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<WarrantyEntitlementResult> {
  const response = await apiRequest(request, 'GET', `/api/warranty_claims/entitlement?${query}`, { token })
  expect(response.status(), `GET /api/warranty_claims/entitlement?${query} should return 200`).toBe(200)
  return readRequiredJson<WarrantyEntitlementResult>(response, 'entitlement response should be JSON')
}

export async function listWarrantyVendorPolicies(
  request: APIRequestContext,
  token: string,
  query = 'pageSize=100',
): Promise<WarrantyVendorPolicyItem[]> {
  const response = await apiRequest(request, 'GET', `/api/warranty_claims/vendor-policies?${query}`, { token })
  expect(response.status(), `GET /api/warranty_claims/vendor-policies?${query} should return 200`).toBe(200)
  const body = await readRequiredJson<PagedItems<WarrantyVendorPolicyItem>>(
    response,
    'vendor policy list response should be JSON',
  )
  return Array.isArray(body.items) ? body.items : []
}

export async function readWarrantyVendorPolicy(
  request: APIRequestContext,
  token: string,
  policyId: string,
): Promise<WarrantyVendorPolicyItem> {
  const items = await listWarrantyVendorPolicies(request, token, `ids=${encodeURIComponent(policyId)}&pageSize=10`)
  const item = items.find((policy) => policy.id === policyId)
  expect(item, `vendor policy ${policyId} should be readable`).toBeTruthy()
  return item as WarrantyVendorPolicyItem
}

export async function createWarrantyVendorPolicyFixture(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<WarrantyVendorPolicyItem> {
  const response = await apiRequest(request, 'POST', '/api/warranty_claims/vendor-policies', { token, data })
  const body = await readRequiredJson<{ id?: string | null }>(response, 'vendor policy create response should be JSON')
  expect(response.status(), `POST /api/warranty_claims/vendor-policies should return 201: ${JSON.stringify(body)}`).toBe(201)
  const policyId = expectId(body.id, 'vendor policy create response should include id')
  return readWarrantyVendorPolicy(request, token, policyId)
}

export async function updateWarrantyVendorPolicy(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
  updatedAt?: string | null,
): Promise<APIResponse> {
  return requestJson(request, 'PUT', '/api/warranty_claims/vendor-policies', token, data, updatedAt)
}

export async function deleteWarrantyVendorPolicyIfExists(
  request: APIRequestContext,
  token: string | null,
  policyId: string | null,
): Promise<void> {
  if (!token || !policyId) return
  await apiRequest(
    request,
    'DELETE',
    `/api/warranty_claims/vendor-policies?id=${encodeURIComponent(policyId)}`,
    { token },
  ).catch(() => undefined)
}

export async function receiveClaimLine(
  request: APIRequestContext,
  token: string,
  data: { lineId: string; conditionGrade: 'A' | 'B' | 'C' | 'D'; inspectionNotes?: string; updatedAt?: string | null },
): Promise<APIResponse> {
  return requestJson(request, 'POST', '/api/warranty_claims/receiving', token, data)
}

export async function readWarrantyClaimStats(
  request: APIRequestContext,
  token: string,
): Promise<WarrantyClaimStatsResult> {
  const response = await apiRequest(request, 'GET', '/api/warranty_claims/stats', { token })
  expect(response.status(), 'GET /api/warranty_claims/stats should return 200').toBe(200)
  const body = await readRequiredJson<{ result?: WarrantyClaimStatsResult }>(response, 'stats response should be JSON')
  expect(body.result, 'stats response should include result').toBeTruthy()
  return body.result as WarrantyClaimStatsResult
}

export async function readWarrantyClaimRisk(
  request: APIRequestContext,
  token: string,
  claimId: string,
): Promise<WarrantyClaimRiskResult> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/warranty_claims/risk?claimId=${encodeURIComponent(claimId)}`,
    { token },
  )
  expect(response.status(), 'GET /api/warranty_claims/risk should return 200').toBe(200)
  const body = await readRequiredJson<{ result?: WarrantyClaimRiskResult }>(response, 'risk response should be JSON')
  expect(body.result, 'risk response should include result').toBeTruthy()
  return body.result as WarrantyClaimRiskResult
}

export async function expectClaimStatus(
  request: APIRequestContext,
  token: string,
  claimId: string,
  status: string,
): Promise<ClaimItem> {
  const claim = await readClaim(request, token, claimId)
  expect(claim.status, `claim ${claimId} status`).toBe(status)
  return claim
}

export async function transitionAndExpect(
  request: APIRequestContext,
  token: string,
  claim: ClaimItem,
  toStatus: string,
  extra: { rejectionReasonCode?: string; resolutionSummary?: string } = {},
): Promise<ClaimItem> {
  expect(claim.id, 'claim should have id').toBeTruthy()
  const beforeEvents = await readClaimEvents(request, token, claim.id!)
  const current = await readClaim(request, token, claim.id!)
  const response = await transitionClaim(
    request,
    token,
    { id: claim.id!, toStatus, ...extra },
    current.updatedAt,
  )
  expect(response.status(), `transition to ${toStatus} should return 200`).toBe(200)
  const after = await expectClaimStatus(request, token, claim.id!, toStatus)
  const afterEvents = await readClaimEvents(request, token, claim.id!)
  expect(afterEvents.length, `transition to ${toStatus} should append a timeline event`).toBeGreaterThan(beforeEvents.length)
  expect(
    afterEvents.some((event) => event.kind === 'status_changed' && event.payload?.to === toStatus),
    `timeline should include status_changed event to ${toStatus}`,
  ).toBe(true)
  return after
}

export async function submitAndExpect(
  request: APIRequestContext,
  token: string,
  claim: ClaimItem,
): Promise<ClaimItem> {
  expect(claim.id, 'claim should have id').toBeTruthy()
  const beforeEvents = await readClaimEvents(request, token, claim.id!)
  const current = await readClaim(request, token, claim.id!)
  const response = await submitClaim(request, token, claim.id!, current.updatedAt)
  expect(response.status(), 'submit should return 200').toBe(200)
  const after = await expectClaimStatus(request, token, claim.id!, 'submitted')
  const afterEvents = await readClaimEvents(request, token, claim.id!)
  expect(afterEvents.length, 'submit should append a timeline event').toBeGreaterThan(beforeEvents.length)
  expect(
    afterEvents.some((event) => event.kind === 'status_changed' && event.payload?.from === 'draft' && event.payload?.to === 'submitted'),
    'timeline should include draft -> submitted status_changed event',
  ).toBe(true)
  return after
}

export async function resolveLineThroughLifecycle(
  request: APIRequestContext,
  token: string,
  claimId: string,
  lineId: string,
  amounts: { qtyApproved?: number; qtyReceived?: number; creditAmount?: number } = {},
): Promise<ClaimLineItem> {
  let line = await readClaimLine(request, token, claimId, lineId)
  const approved = await updateClaimLine(
    request,
    token,
    {
      id: lineId,
      claimId,
      qtyApproved: amounts.qtyApproved ?? Number(line.qtyClaimed ?? 1),
      creditAmount: amounts.creditAmount ?? Number(line.creditAmount ?? 10),
      disposition: 'credit',
      lineStatus: 'approved',
    },
    line.updatedAt,
  )
  expect(approved.status(), 'line pending -> approved should return 200').toBe(200)

  line = await readClaimLine(request, token, claimId, lineId)
  const received = await updateClaimLine(
    request,
    token,
    {
      id: lineId,
      claimId,
      qtyReceived: amounts.qtyReceived ?? Number(line.qtyApproved ?? line.qtyClaimed ?? 1),
      lineStatus: 'received',
    },
    line.updatedAt,
  )
  expect(received.status(), 'line approved -> received should return 200').toBe(200)

  line = await readClaimLine(request, token, claimId, lineId)
  const inspected = await updateClaimLine(
    request,
    token,
    { id: lineId, claimId, inspectionNotes: uniqueLabel('inspected'), lineStatus: 'inspected' },
    line.updatedAt,
  )
  expect(inspected.status(), 'line received -> inspected should return 200').toBe(200)

  line = await readClaimLine(request, token, claimId, lineId)
  const resolved = await updateClaimLine(
    request,
    token,
    { id: lineId, claimId, lineStatus: 'resolved' },
    line.updatedAt,
  )
  expect(resolved.status(), 'line inspected -> resolved should return 200').toBe(200)
  return readClaimLine(request, token, claimId, lineId)
}

export function numeric(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export async function cleanupDraftClaimWithLines(
  request: APIRequestContext,
  token: string | null,
  claimId: string | null,
): Promise<void> {
  if (!token || !claimId) return
  const claim = await readClaimMaybe(request, token, claimId).catch(() => null)
  if (!claim) return
  if (claim.status === 'draft') {
    const lines = await listClaimLines(request, token, claimId).catch(() => [])
    for (const line of lines) {
      await deleteClaimLineIfExists(request, token, line.id)
    }
  }
  await deleteClaimIfExists(request, token, claimId)
}

export async function cancelThenDeleteClaimIfPossible(
  request: APIRequestContext,
  token: string | null,
  claimId: string | null,
): Promise<void> {
  if (!token || !claimId) return
  const claim = await readClaimMaybe(request, token, claimId).catch(() => null)
  if (!claim) return
  if (claim.status && ['draft', 'submitted', 'in_review', 'info_requested', 'approved', 'received', 'inspecting'].includes(claim.status)) {
    const lines = await listClaimLines(request, token, claimId).catch(() => [])
    for (const line of lines) {
      await deleteClaimLineIfExists(request, token, line.id)
    }
  }
  if (claim.status && ['submitted', 'in_review', 'info_requested', 'approved', 'awaiting_return'].includes(claim.status)) {
    const fresh = await readClaimMaybe(request, token, claimId).catch(() => null)
    await transitionClaim(request, token, { id: claimId, toStatus: 'cancelled' }, (fresh ?? claim).updatedAt).catch(() => undefined)
  }
  await cleanupDraftClaimWithLines(request, token, claimId)
}
