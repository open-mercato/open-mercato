import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { deleteAttachmentIfExists } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { portalCookieHeaders } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { SUPPORT_CATEGORY_DICTIONARY_KEY, routingPreview, type PortalCustomer } from './fixtures'

export const SETTINGS_PATH = '/backend/staff/time-tracking/settings'
export const SUPPORT_INBOX_PATH = '/backend/staff/time-tracking/support'
export const TASK_ENTITY_ID = 'staff:staff_time_task'

export type TimeTrackingSettingsSnapshot = Record<string, unknown> & {
  targets?: { dailyHours?: number | null } & Record<string, unknown>
  support?: { referencePrefix?: string } & Record<string, unknown>
}

export async function readTimeTrackingSettings(
  request: APIRequestContext,
  token: string,
): Promise<TimeTrackingSettingsSnapshot> {
  const response = await apiRequest(request, 'GET', '/api/staff/timesheets/settings', { token })
  const body = await readJsonSafe<TimeTrackingSettingsSnapshot>(response)
  expect(response.ok(), `read time tracking settings failed with ${response.status()}`).toBeTruthy()
  return body as TimeTrackingSettingsSnapshot
}

export async function restoreTimeTrackingSettings(
  request: APIRequestContext,
  token: string,
  snapshot: TimeTrackingSettingsSnapshot,
) {
  return apiRequest(request, 'PUT', '/api/staff/timesheets/settings', { token, data: snapshot })
}

export type SupportCategoryEntry = { id: string; value: string; label: string }

async function supportCategoryDictionaryId(request: APIRequestContext, token: string): Promise<string> {
  const response = await apiRequest(request, 'GET', '/api/dictionaries', { token })
  const body = await readJsonSafe<{ items?: Array<{ id: string; key: string }> }>(response)
  const dictionary = body?.items?.find((item) => item.key === SUPPORT_CATEGORY_DICTIONARY_KEY)
  expect(dictionary, 'the support category dictionary should be seeded').toBeTruthy()
  return (dictionary as { id: string }).id
}

export async function listSupportCategoryEntries(
  request: APIRequestContext,
  token: string,
): Promise<SupportCategoryEntry[]> {
  const dictionaryId = await supportCategoryDictionaryId(request, token)
  const response = await apiRequest(request, 'GET', `/api/dictionaries/${dictionaryId}/entries`, { token })
  const body = await readJsonSafe<{ items?: SupportCategoryEntry[] }>(response)
  return body?.items ?? []
}

export async function findSupportCategoryEntry(
  request: APIRequestContext,
  token: string,
  value: string,
): Promise<SupportCategoryEntry | null> {
  const entries = await listSupportCategoryEntries(request, token)
  return entries.find((entry) => entry.value === value) ?? null
}

export async function deleteSupportCategoryByValue(request: APIRequestContext, token: string, value: string) {
  const dictionaryId = await supportCategoryDictionaryId(request, token)
  const entries = await listSupportCategoryEntries(request, token)
  const entry = entries.find((candidate) => candidate.value === value)
  if (!entry) return
  await apiRequest(request, 'DELETE', `/api/dictionaries/${dictionaryId}/entries/${entry.id}`, { token })
}

export async function findRoutingRuleForCategory(request: APIRequestContext, token: string, categoryValue: string) {
  const preview = await routingPreview(request, token)
  return preview.rules.find((rule) => rule.categoryValue === categoryValue) ?? null
}

export async function deleteRoutingRuleForCategory(request: APIRequestContext, token: string, categoryValue: string) {
  const rule = await findRoutingRuleForCategory(request, token, categoryValue)
  if (!rule) return
  await apiRequest(request, 'DELETE', `/api/staff/timesheets/support-routing-rules?id=${rule.id}`, { token })
}

export async function currentFallbackProjectId(request: APIRequestContext, token: string): Promise<string | null> {
  const preview = await routingPreview(request, token)
  return preview.fallback?.project.id ?? null
}

export async function listTaskAttachments(
  request: APIRequestContext,
  token: string,
  taskId: string,
): Promise<Array<{ id: string; fileName: string; tags?: string[] }>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/attachments?entityId=${encodeURIComponent(TASK_ENTITY_ID)}&recordId=${encodeURIComponent(taskId)}`,
    { token },
  )
  const body = await readJsonSafe<{ items?: Array<{ id: string; fileName: string; tags?: string[] }> }>(response)
  return body?.items ?? []
}

export async function deleteTaskAttachments(request: APIRequestContext, token: string, taskId: string) {
  const items = await listTaskAttachments(request, token, taskId)
  for (const item of items) await deleteAttachmentIfExists(request, token, item.id)
}

export async function listPortalTicketAttachmentNames(
  request: APIRequestContext,
  customer: PortalCustomer,
  taskId: string,
): Promise<string[]> {
  const response = await request.get(`/api/staff/portal/support-tickets/${taskId}/attachments`, {
    headers: portalCookieHeaders(customer.session),
  })
  expect(response.status(), 'the portal ticket attachments should be readable by its customer').toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ fileName: string }> }>(response)
  return (body?.items ?? []).map((item) => item.fileName)
}
