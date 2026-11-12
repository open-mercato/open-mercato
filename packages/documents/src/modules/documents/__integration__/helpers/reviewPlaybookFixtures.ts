import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const PLAYBOOKS_PATH = '/api/documents/review-playbooks'
export const RULES_PATH = '/api/documents/review-rules'
export const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

export type PlaybookBody = {
  id: string
  code: string
  name: string
  description: string | null
  instructions: string | null
  version: number
  isActive: boolean
  updatedAt: string
}

export type RuleBody = {
  id: string
  playbookId: string
  code: string
  title: string
  topic: string | null
  position: string
  preferredWording: string | null
  severity: 'blocking' | 'warning' | 'info'
  sortOrder: number
  isActive: boolean
  updatedAt: string
}

export type ReferenceBody = {
  id: string
  documentId: string
  title: string | null
  accessible: boolean
}

export function uniqueCode(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}

export async function createPlaybook(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<{ response: APIResponse; id: string | null; body: Record<string, unknown> | null }> {
  const response = await apiRequest(request, 'POST', PLAYBOOKS_PATH, { token, data })
  const body = await readJsonSafe<Record<string, unknown>>(response)
  const id = typeof body?.id === 'string' ? body.id : null
  return { response, id, body }
}

export async function createPlaybookOrFail(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const created = await createPlaybook(request, token, data)
  expect(created.response.status(), 'POST review playbook should return 201').toBe(201)
  return expectId(created.id, 'playbook create response should include id')
}

export async function readPlaybook(
  request: APIRequestContext,
  token: string,
  playbookId: string,
): Promise<PlaybookBody | null> {
  const params = new URLSearchParams({ id: playbookId, page: '1', pageSize: '1' })
  const response = await apiRequest(request, 'GET', `${PLAYBOOKS_PATH}?${params.toString()}`, { token })
  expect(response.status(), 'GET review playbooks should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: PlaybookBody[] }>(response)
  return body?.items?.[0] ?? null
}

export async function deletePlaybookIfExists(
  request: APIRequestContext,
  token: string | null,
  playbookId: string | null,
): Promise<void> {
  if (!token || !playbookId) return
  await apiRequest(request, 'DELETE', `${PLAYBOOKS_PATH}?id=${encodeURIComponent(playbookId)}`, { token })
    .catch(() => undefined)
}

export async function createRule(
  request: APIRequestContext,
  token: string,
  playbookId: string,
  data: Record<string, unknown>,
): Promise<{ response: APIResponse; body: Record<string, unknown> | null }> {
  const response = await apiRequest(request, 'POST', RULES_PATH, {
    token,
    data: { playbookId, title: 'Rule', position: 'Standard position.', severity: 'warning', ...data },
  })
  return { response, body: await readJsonSafe<Record<string, unknown>>(response) }
}

export async function listRules(
  request: APIRequestContext,
  token: string,
  playbookId: string,
): Promise<RuleBody[]> {
  const params = new URLSearchParams({ playbookId, page: '1', pageSize: '100' })
  const response = await apiRequest(request, 'GET', `${RULES_PATH}?${params.toString()}`, { token })
  expect(response.status(), 'GET review rules should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: RuleBody[] }>(response)
  return body?.items ?? []
}

export function referencesPath(playbookId: string): string {
  return `${PLAYBOOKS_PATH}/${encodeURIComponent(playbookId)}/references`
}

export async function listReferences(
  request: APIRequestContext,
  token: string,
  playbookId: string,
): Promise<ReferenceBody[]> {
  const response = await apiRequest(request, 'GET', referencesPath(playbookId), { token })
  expect(response.status(), 'GET playbook references should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: ReferenceBody[] }>(response)
  return body?.items ?? []
}
