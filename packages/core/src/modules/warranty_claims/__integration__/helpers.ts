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
  orderId: string | null
  sourceClaimId: string | null
  reasonCode: string | null
  rejectionReasonCode: string | null
  resolutionSummary: string | null
  notes: string | null
  currencyCode: string | null
  totalClaimedAmount: string | null
  totalApprovedAmount: string | null
  totalRecoveredAmount: string | null
  submittedAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type ClaimLineItem = {
  id: string | null
  claimId: string | null
  lineNo: number | null
  sku: string | null
  productName: string | null
  orderLineId: string | null
  serialNumber: string | null
  faultDescription: string | null
  qtyClaimed: string | null
  qtyApproved: string | null
  qtyReceived: string | null
  disposition: string | null
  lineStatus: string | null
  creditAmount: string | null
  restockingFee: string | null
  coreCreditAmount: string | null
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
  const response = await submitClaim(request, token, claim.id!, claim.updatedAt)
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
    await transitionClaim(request, token, { id: claimId, toStatus: 'cancelled' }, claim.updatedAt).catch(() => undefined)
  }
  await cleanupDraftClaimWithLines(request, token, claimId)
}
