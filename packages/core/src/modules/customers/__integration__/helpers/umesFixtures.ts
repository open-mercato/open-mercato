import { expect, type APIRequestContext, type Page, type Request } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { DEFAULT_CREDENTIALS } from '@open-mercato/core/helpers/integration/auth'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export type CrmKind = 'people' | 'companies' | 'deals'
export type Priority = 'low' | 'normal' | 'high' | 'critical'
export type PriorityRecord = { id: string; priority: Priority; updatedAt: string }
export type CapturedWrite = { path: string; method: string; data: Record<string, unknown>; lockVersion?: string }

function asRecord(value: unknown): Record<string, unknown> {
  expect(typeof value === 'object' && value !== null && !Array.isArray(value)).toBe(true)
  return value as Record<string, unknown>
}

export async function authenticateCrm(page: Page, request: APIRequestContext): Promise<string> {
  if (process.env.TEST_ADMIN_PASSWORD) DEFAULT_CREDENTIALS.admin.password = process.env.TEST_ADMIN_PASSWORD
  const token = await getAuthToken(request, 'admin', process.env.TEST_ADMIN_PASSWORD)
  const { tenantId, organizationId } = getTokenContext(token)
  const baseUrl = process.env.BASE_URL
  expect(baseUrl, 'The configured integration base URL is available').toBeTruthy()
  await page.context().addCookies([
    { name: 'auth_token', value: token, url: baseUrl as string },
    { name: 'om_selected_tenant', value: tenantId, url: baseUrl as string },
    { name: 'om_selected_org', value: organizationId, url: baseUrl as string },
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl as string },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl as string },
    { name: 'om_feedback_suppress', value: '1', url: baseUrl as string },
  ])
  return token
}

export function captureCrmWrites(page: Page): { writes: CapturedWrite[]; stop: () => void } {
  const writes: CapturedWrite[] = []
  const listener = (request: Request) => {
    const path = new URL(request.url()).pathname
    if (!['POST', 'PUT'].includes(request.method())) return
    if (!/^\/api\/customers\/(people|companies|deals)$/.test(path) && path !== '/api/example/customer-priorities') return
    writes.push({ path, method: request.method(), data: asRecord(request.postDataJSON()), lockVersion: request.headers()[OPTIMISTIC_LOCK_HEADER_NAME] })
  }
  page.on('request', listener)
  return { writes, stop: () => page.off('request', listener) }
}

export function assertNativePayload(writes: CapturedWrite[], kind: CrmKind, method: 'POST' | 'PUT'): CapturedWrite {
  const native = writes.filter((write) => write.path === `/api/customers/${kind}` && write.method === method)
  expect(native).toHaveLength(1)
  const assertKeys = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value)) {
      expect(key, 'Contributor namespace and flat keys must stay out of native writes').not.toMatch(/^_[a-zA-Z]/)
      assertKeys(nested)
    }
  }
  assertKeys(native[0].data)
  return native[0]
}

export async function createPriority(request: APIRequestContext, token: string, customerId: string, priority: Priority): Promise<PriorityRecord> {
  const response = await apiRequest(request, 'POST', '/api/example/customer-priorities', { token, data: { customerId, priority } })
  expect(response.ok()).toBe(true)
  const body = asRecord(await readJsonSafe(response))
  expect(typeof body.id).toBe('string')
  expect(typeof body.updatedAt).toBe('string')
  return { id: body.id as string, updatedAt: body.updatedAt as string, priority }
}

export async function readPriorities(request: APIRequestContext, token: string, customerId: string): Promise<PriorityRecord[]> {
  const response = await apiRequest(request, 'GET', `/api/example/customer-priorities?customerId=${customerId}&pageSize=100`, { token })
  expect(response.ok()).toBe(true)
  const body = asRecord(await readJsonSafe(response))
  expect(Array.isArray(body.items)).toBe(true)
  return (body.items as unknown[]).map((entry) => {
    const record = asRecord(entry)
    expect(typeof record.id).toBe('string')
    expect(typeof record.updatedAt).toBe('string')
    expect(['low', 'normal', 'high', 'critical']).toContain(record.priority)
    return { id: record.id as string, updatedAt: record.updatedAt as string, priority: record.priority as Priority }
  })
}

export async function updatePriority(request: APIRequestContext, token: string, customerId: string, record: PriorityRecord, priority: Priority): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/example/customer-priorities', {
    token, data: { id: record.id, customerId, priority }, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: record.updatedAt },
  })
  expect(response.ok()).toBe(true)
}

export async function readCrmOverview(request: APIRequestContext, token: string, kind: CrmKind, id: string): Promise<{ envelope: Record<string, unknown>; record: Record<string, unknown>; priority: Record<string, unknown> }> {
  const response = await apiRequest(request, 'GET', `/api/customers/${kind}/${id}`, { token })
  expect(response.ok()).toBe(true)
  const envelope = asRecord(await readJsonSafe(response))
  const record = asRecord(envelope[kind === 'people' ? 'person' : kind === 'companies' ? 'company' : 'deal'])
  const priority = asRecord(record._example)
  expect(envelope._example).toEqual(priority)
  return { envelope, record, priority }
}

export async function cleanupCrmRecord(request: APIRequestContext, token: string, kind: CrmKind, id: string | null): Promise<void> {
  if (!id) return
  const children = await readPriorities(request, token, id)
  for (const child of children) {
    const response = await apiRequest(request, 'DELETE', '/api/example/customer-priorities', {
      token, data: { id: child.id }, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: child.updatedAt },
    })
    expect(response.ok(), 'Priority fixture cleanup succeeds').toBe(true)
  }
  const response = await apiRequest(request, 'DELETE', `/api/customers/${kind}?id=${id}`, { token })
  expect(response.ok(), 'CRM fixture cleanup succeeds').toBe(true)
}

export async function cleanupCrmPipeline(request: APIRequestContext, token: string, stageId: string | null, pipelineId: string | null): Promise<void> {
  for (const [path, id] of [['/api/customers/pipeline-stages', stageId], ['/api/customers/pipelines', pipelineId]]) {
    if (!id) continue
    const response = await apiRequest(request, 'DELETE', path as string, { token, data: { id } })
    expect(response.ok(), 'Pipeline fixture cleanup succeeds').toBe(true)
  }
}

export async function openCrmPriorityForm(page: Page, kind: CrmKind, id: string): Promise<void> {
  await page.goto(`/backend/customers/${kind === 'deals' ? kind : `${kind}-v2`}/${id}`)
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  await expect(page.locator('[data-zone-layout-mode][data-persistence-hydrated="true"]').first()).toBeVisible()
  const expand = page.getByRole('button', { name: 'Expand form panel', exact: true })
  if (await expand.isVisible()) await expand.click()
  await expect(page.getByRole('combobox', { name: 'Priority', exact: true })).toBeVisible()
}

export async function selectPriority(page: Page, priority: 'Low' | 'Normal' | 'High' | 'Critical'): Promise<void> {
  await page.getByRole('combobox', { name: 'Priority', exact: true }).click()
  await page.getByRole('option', { name: priority, exact: true }).click()
}
