import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['incidents'],
}

const INCIDENTS_API = '/api/incidents'
const SEVERITIES_API = '/api/incidents/severities'
const BASE_URL = process.env.BASE_URL?.trim() || ''

type Scope = {
  organizationId: string
  tenantId: string
}

type ListResponse<T> = {
  items?: T[]
}

type IncidentRecord = {
  id: string
  updated_at?: string | null
  revenue_at_risk_minor?: string | null
  revenue_at_risk_currency?: string | null
}

type SeverityRecord = {
  id: string
}

type ImpactRecord = {
  id: string
  target_type?: string | null
  target_id?: string | null
  impact_status?: string | null
  revenue_amount_minor?: string | null
}

type ImpactCommandResponse = {
  ok?: boolean
  impactId?: unknown
  revenueAtRiskMinor?: unknown
  revenueAtRiskCurrency?: unknown
  code?: unknown
  error?: unknown
}

type RecomputeResponse = {
  revenueAtRiskMinor?: unknown
  revenueAtRiskCurrency?: unknown
  error?: unknown
  code?: unknown
}

type ByTargetRecord = {
  id: string
  impactStatus?: string | null
}

type ErrorBody = {
  error?: unknown
  code?: unknown
}

let token = ''
let scope: Scope
const createdIncidentIds = new Set<string>()

function resolveApiUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function authHeaders(lockValue?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (lockValue) headers[OPTIMISTIC_LOCK_HEADER_NAME] = lockValue
  return headers
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function uniqueTitle(prefix: string): string {
  return `${prefix} ${uniqueSuffix()}`
}

function randomUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16)
    const nibble = char === 'x' ? value : (value & 0x3) | 0x8
    return nibble.toString(16)
  })
}

function itemsFrom<T>(body: ListResponse<T> | null): T[] {
  return Array.isArray(body?.items) ? body.items : []
}

function errorText(body: ErrorBody | null): string {
  const parts = [body?.error, body?.code].filter((value): value is string => typeof value === 'string')
  return parts.join(' ')
}

function isOptimisticLockConflict(body: ErrorBody | null): boolean {
  return body?.code === OPTIMISTIC_LOCK_CONFLICT_CODE
}

async function fetchSeededSeverityId(request: APIRequestContext): Promise<string> {
  const response = await apiRequest(request, 'GET', `${SEVERITIES_API}?isActive=true&pageSize=100`, { token })
  expect(response.status(), 'seeded severities should be readable').toBe(200)
  const body = await readJsonSafe<ListResponse<SeverityRecord>>(response)
  const severity = itemsFrom(body).find((item) => typeof item.id === 'string' && item.id.length > 0)
  expect(severity, 'at least one seeded incident severity should exist').toBeTruthy()
  return severity!.id
}

async function createIncident(request: APIRequestContext): Promise<string> {
  const response = await apiRequest(request, 'POST', INCIDENTS_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title: uniqueTitle('INC impact test'),
      description: 'Playwright impact integration fixture',
      severityId: await fetchSeededSeverityId(request),
    },
  })
  expect(response.status(), 'POST /api/incidents should create an incident').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  const id = expectId(body?.id, 'created incident should return an id')
  createdIncidentIds.add(id)
  return id
}

async function readIncident(request: APIRequestContext, id: string): Promise<IncidentRecord> {
  const response = await apiRequest(request, 'GET', `${INCIDENTS_API}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), 'GET /api/incidents?id=... should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<IncidentRecord>>(response)
  const item = itemsFrom(body).find((record) => record.id === id)
  expect(item, `incident ${id} should be returned by detail GET`).toBeTruthy()
  return item!
}

async function deleteIncidentIfExists(request: APIRequestContext, id: string | null): Promise<void> {
  if (!token || !id) return
  try {
    await apiRequest(request, 'DELETE', `${INCIDENTS_API}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // Cleanup must not mask the assertion that already failed.
  } finally {
    createdIncidentIds.delete(id)
  }
}

async function mutateWithCurrentIncidentLock<TBody extends ErrorBody>(
  request: APIRequestContext,
  incidentId: string,
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  data: Record<string, unknown> = {},
): Promise<{ status: number; body: TBody | null }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const incident = await readIncident(request, incidentId)
    expect(typeof incident.updated_at, 'incident detail should expose updated_at for aggregate locking').toBe('string')
    const response = await request.fetch(resolveApiUrl(path), {
      method,
      headers: authHeaders(incident.updated_at as string),
      data,
    })
    const body = await readJsonSafe<TBody>(response)
    if (response.status() === 409 && isOptimisticLockConflict(body) && attempt === 0) {
      continue
    }
    return { status: response.status(), body }
  }
  throw new Error('unreachable optimistic-lock retry state')
}

async function addImpact(
  request: APIRequestContext,
  incidentId: string,
  data: Record<string, unknown>,
): Promise<{ status: number; body: ImpactCommandResponse | null }> {
  return mutateWithCurrentIncidentLock<ImpactCommandResponse>(
    request,
    incidentId,
    'POST',
    `${INCIDENTS_API}/${incidentId}/impacts`,
    data,
  )
}

async function updateImpactStatus(
  request: APIRequestContext,
  incidentId: string,
  impactId: string,
  impactStatus: string,
): Promise<{ status: number; body: ImpactCommandResponse | null }> {
  return mutateWithCurrentIncidentLock<ImpactCommandResponse>(
    request,
    incidentId,
    'PUT',
    `${INCIDENTS_API}/${incidentId}/impacts/${impactId}`,
    { impactStatus },
  )
}

async function removeImpact(
  request: APIRequestContext,
  incidentId: string,
  impactId: string,
): Promise<{ status: number; body: ImpactCommandResponse | null }> {
  return mutateWithCurrentIncidentLock<ImpactCommandResponse>(
    request,
    incidentId,
    'DELETE',
    `${INCIDENTS_API}/${incidentId}/impacts/${impactId}`,
  )
}

async function recomputeImpacts(
  request: APIRequestContext,
  incidentId: string,
): Promise<{ status: number; body: RecomputeResponse | null }> {
  return mutateWithCurrentIncidentLock<RecomputeResponse>(
    request,
    incidentId,
    'POST',
    `${INCIDENTS_API}/${incidentId}/impacts/recompute`,
  )
}

test.describe('TC-INC-006: Incident impact + revenue rollup', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    scope = getTokenContext(token)
  })

  test.afterAll(async ({ request }) => {
    for (const id of Array.from(createdIncidentIds)) {
      await deleteIncidentIfExists(request, id)
    }
  })

  test('add, reject duplicates, list, validate PII, update, remove, recompute, and query by target', async ({ request }) => {
    let incidentId: string | null = null
    try {
      incidentId = await createIncident(request)
      const firstTargetId = randomUuid()
      const firstImpactPayload = {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        targetType: 'sales_order',
        targetId: firstTargetId,
        impactStatus: 'major_outage',
        revenueAmountMinor: '150000',
        revenueCurrency: 'USD',
        snapshot: { label: 'ORD-TEST' },
      }

      const firstImpact = await addImpact(request, incidentId, firstImpactPayload)
      expect([200, 201], 'impact add should succeed').toContain(firstImpact.status)
      const firstImpactId = expectId(firstImpact.body?.impactId, 'impact add should return impactId')

      let detail = await readIncident(request, incidentId)
      expect(detail.revenue_at_risk_minor, 'first impact should roll up revenue at risk').toBe('150000')
      expect(detail.revenue_at_risk_currency, 'first impact should roll up revenue currency').toBe('USD')

      const duplicate = await addImpact(request, incidentId, firstImpactPayload)
      expect(duplicate.status, 'duplicate impact target should be rejected').toBe(409)
      expect(errorText(duplicate.body), 'duplicate target response should mention duplicate').toContain('duplicate')

      const listResponse = await apiRequest(request, 'GET', `${INCIDENTS_API}/${incidentId}/impacts`, { token })
      expect(listResponse.status(), 'impact list should succeed').toBe(200)
      const impactList = await readJsonSafe<ListResponse<ImpactRecord>>(listResponse)
      expect(
        itemsFrom(impactList).some((item) =>
          item.id === firstImpactId &&
          item.target_type === 'sales_order' &&
          item.impact_status === 'major_outage' &&
          item.revenue_amount_minor === '150000',
        ),
        'impact list should include the first sales order impact with status and revenue',
      ).toBe(true)

      const piiImpact = await addImpact(request, incidentId, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        targetType: 'sales_order',
        targetId: randomUuid(),
        impactStatus: 'degraded',
        snapshot: { label: 'person@example.com' },
      })
      expect(piiImpact.status, 'snapshot label containing an email should be rejected').toBe(400)

      const secondTargetId = randomUuid()
      const secondImpact = await addImpact(request, incidentId, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        targetType: 'sales_order',
        targetId: secondTargetId,
        impactStatus: 'major_outage',
        revenueAmountMinor: '50000',
        revenueCurrency: 'USD',
        snapshot: { label: 'ORD-TEST-2' },
      })
      expect([200, 201], 'second impact add should succeed').toContain(secondImpact.status)
      const secondImpactId = expectId(secondImpact.body?.impactId, 'second impact add should return impactId')

      detail = await readIncident(request, incidentId)
      expect(detail.revenue_at_risk_minor, 'second impact should increase revenue at risk').toBe('200000')
      expect(detail.revenue_at_risk_currency, 'second impact should preserve revenue currency').toBe('USD')

      const updateSecond = await updateImpactStatus(request, incidentId, secondImpactId, 'degraded')
      expect(updateSecond.status, 'impact status update should succeed').toBe(200)

      const removeSecond = await removeImpact(request, incidentId, secondImpactId)
      expect(removeSecond.status, 'impact delete should succeed').toBe(200)
      detail = await readIncident(request, incidentId)
      expect(detail.revenue_at_risk_minor, 'removing the second impact should recompute revenue at risk').toBe('150000')
      expect(detail.revenue_at_risk_currency, 'remaining rollup should keep USD').toBe('USD')

      const recomputed = await recomputeImpacts(request, incidentId)
      expect(recomputed.status, 'impact recompute should succeed').toBe(200)
      expect(typeof recomputed.body?.revenueAtRiskMinor, 'recompute response should include revenueAtRiskMinor').toBe('string')

      const byTargetResponse = await apiRequest(
        request,
        'GET',
        `${INCIDENTS_API}/by-target?targetType=sales_order&targetId=${encodeURIComponent(firstTargetId)}`,
        { token },
      )
      expect(byTargetResponse.status(), 'by-target endpoint should succeed').toBe(200)
      const byTarget = await readJsonSafe<ListResponse<ByTargetRecord>>(byTargetResponse)
      expect(
        itemsFrom(byTarget).some((item) => item.id === incidentId),
        'by-target endpoint should include the incident linked to the first sales order impact',
      ).toBe(true)
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })
})
