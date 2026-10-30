import { expect, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteFeatureToggleIfExists } from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import { undoByToken } from '@open-mercato/core/helpers/integration/undoHarness'

export const GLOBAL_PATH = '/api/feature_toggles/global'

export type ToggleType = 'boolean' | 'string' | 'number' | 'json'

export type ToggleSnapshot = {
  id: string
  identifier: string
  name: string
  description: string | null
  category: string | null
  type: ToggleType
  defaultValue: unknown
  createdAt: string
  updatedAt: string
}

export type OverrideSnapshot = {
  id: string
  value: unknown
  tenantName: string
  tenantId: string
  toggleType: ToggleType
  updatedAt: string | null
}

export function uniqueUndoIdentifier(prefix: string): string {
  return `qa_undo_${prefix}_${randomUUID().replace(/-/g, '')}`
}

export function toggleScalars(snapshot: ToggleSnapshot) {
  return {
    id: snapshot.id,
    identifier: snapshot.identifier,
    name: snapshot.name,
    description: snapshot.description,
    category: snapshot.category,
    type: snapshot.type,
    defaultValue: snapshot.defaultValue,
  }
}

export function overrideFields(snapshot: OverrideSnapshot) {
  return {
    id: snapshot.id,
    value: snapshot.value,
    tenantName: snapshot.tenantName,
    tenantId: snapshot.tenantId,
    toggleType: snapshot.toggleType,
  }
}

export function expectVersionAdvanced(current: string | null, previous: string | null, context: string): void {
  expect(current, `${context}: a persisted record has an updatedAt version`).toBeTruthy()
  const currentTime = Date.parse(current ?? '')
  const previousTime = Date.parse(previous ?? '')
  expect(Number.isFinite(currentTime), `${context}: updatedAt is a valid timestamp`).toBe(true)
  expect(Number.isFinite(previousTime), `${context}: prior updatedAt is a valid timestamp`).toBe(true)
  expect(currentTime, `${context}: updatedAt advances from the immediately preceding persisted snapshot`).toBeGreaterThan(previousTime)
}

export async function readToggle(request: APIRequestContext, token: string, id: string): Promise<ToggleSnapshot> {
  const response = await apiRequest(request, 'GET', `${GLOBAL_PATH}/${encodeURIComponent(id)}`, { token })
  expect(response.status(), 'Global toggle detail is readable').toBe(200)
  const snapshot = await readJsonSafe<ToggleSnapshot>(response)
  expect(snapshot?.id).toBe(id)
  return snapshot as ToggleSnapshot
}

export async function expectToggleAbsent(
  request: APIRequestContext,
  token: string,
  id: string,
  identifier: string,
): Promise<void> {
  const detail = await apiRequest(request, 'GET', `${GLOBAL_PATH}/${encodeURIComponent(id)}`, { token })
  expect(detail.status(), 'Removed toggle is hidden from detail').toBe(404)
  const list = await apiRequest(request, 'GET', `${GLOBAL_PATH}?identifier=${encodeURIComponent(identifier)}&pageSize=100`, { token })
  expect(list.status()).toBe(200)
  const body = await readJsonSafe<{ items: Array<{ id: string }> }>(list)
  expect(body?.items).toBeDefined()
  expect(body?.items.some((item) => item.id === id), 'Removed toggle is hidden from the list').toBe(false)
}

export async function readOverride(
  request: APIRequestContext,
  token: string,
  toggle: Pick<ToggleSnapshot, 'id' | 'identifier' | 'type'>,
  value: unknown,
  source: 'default' | 'override',
): Promise<OverrideSnapshot> {
  const detail = await apiRequest(request, 'GET', `${GLOBAL_PATH}/${encodeURIComponent(toggle.id)}/override`, { token })
  expect(detail.status()).toBe(200)
  const snapshot = await readJsonSafe<OverrideSnapshot>(detail)
  expect(snapshot).toMatchObject({ tenantId: getTokenContext(token).tenantId, toggleType: toggle.type })
  expect(snapshot?.value).toEqual(value)
  expect(typeof snapshot?.tenantName).toBe('string')

  const check = await apiRequest(request, 'GET', `/api/feature_toggles/check/${toggle.type}?identifier=${encodeURIComponent(toggle.identifier)}`, { token })
  expect(check.status()).toBe(200)
  const resolved = await readJsonSafe<{ ok: boolean; value: unknown; resolution: { source: string } }>(check)
  expect(resolved).toMatchObject({ ok: true, resolution: { source } })
  expect(resolved?.value).toEqual(value)

  const list = await apiRequest(request, 'GET', `/api/feature_toggles/overrides?identifier=${encodeURIComponent(toggle.identifier)}&pageSize=100`, { token })
  expect(list.status()).toBe(200)
  const body = await readJsonSafe<{ items: Array<{ id: string; toggleId: string; tenantId: string; isOverride: boolean; updatedAt: string | null }> }>(list)
  const row = body?.items.find((item) => item.toggleId === toggle.id)
  expect(row).toMatchObject({
    id: snapshot?.id,
    toggleId: toggle.id,
    tenantId: getTokenContext(token).tenantId,
    isOverride: source === 'override',
    updatedAt: snapshot?.updatedAt,
  })
  if (source === 'default') {
    expect(snapshot?.id).toBe('')
    expect(snapshot?.updatedAt).toBeNull()
  } else {
    expect(snapshot?.id).toBeTruthy()
    expect(Number.isFinite(Date.parse(snapshot?.updatedAt ?? ''))).toBe(true)
  }
  return snapshot as OverrideSnapshot
}

export async function expectConsumedToken(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const response = await undoByToken(request, token, undoToken)
  expect(response.status(), 'A consumed undo token is rejected before redo').toBe(400)
  expect(await readJsonSafe(response)).toEqual({ error: 'Undo token not available' })
}

export async function cleanupToggle(
  request: APIRequestContext,
  superadminToken: string,
  adminToken: string,
  toggleId: string | null,
  restoreToken: string | null = null,
): Promise<void> {
  if (!toggleId) return
  if (restoreToken) await undoByToken(request, superadminToken, restoreToken).catch(() => undefined)
  await apiRequest(request, 'PUT', '/api/feature_toggles/overrides', {
    token: adminToken,
    data: { toggleId, isOverride: false },
  }).catch(() => undefined)
  await deleteFeatureToggleIfExists(request, superadminToken, toggleId)
}
