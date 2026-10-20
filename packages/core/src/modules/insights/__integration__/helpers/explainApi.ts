import { randomInt } from 'node:crypto'
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const EXPLAIN_PATH = '/api/insights/explain'
export const EXPLAIN_DESCRIPTORS_PATH = '/api/insights/explain/descriptors'
export const EXPLAIN_LOG_PATH = '/api/insights/explain/log'
export const DEALS_PATH = '/api/customers/deals'
export const AUDIT_ACTIONS_PATH = '/api/audit_logs/audit-logs/actions'
export const DEAL_RESOURCE_KIND = 'customers.deal'
export const DEAL_UPDATE_COMMAND_ID = 'customers.deals.update'
export const DEAL_CUSTOM_FIELD_ENTITY_ID = 'customers:customer_deal'
export const ALL_ORGANIZATIONS_SELECTION = '__all__'
export const NOT_FOUND_BODY = { error: 'not_found' }
export const QA_USER_PASSWORD = 'Secret123!'

export type ExplainValue = {
  value: unknown
  display: string | null
  valueKind: string
  source: 'snapshot' | 'implicit' | 'changes'
  redacted: boolean
}

export type ExplainCauseFrame = {
  kind: string
  id: string | null
  ref: string | null
  label: string | null
  href: string | null
  available: boolean
}

export type ExplainCause = ExplainCauseFrame & {
  labelKey: string | null
  legacy: boolean
  derivedFromActor: boolean
  frames: ExplainCauseFrame[]
}

export type ExplainActor = {
  kind: 'user' | 'api_key' | 'system'
  id: string | null
  label: string | null
  isSelf: boolean
  redacted: boolean
}

export type ExplainChainEntry = {
  logId: string
  at: string
  state: 'done' | 'undone' | 'redone'
  action: string | null
  commandId: string | null
  from: ExplainValue | null
  to: ExplainValue | null
  actor: ExplainActor
  cause: ExplainCause
  origin?: ExplainCause
  causedBy: { logId: string | null; available: boolean } | null
  correlationId: string | null
  undoneBy: string | null
  confidence: 'proven' | 'inferred' | 'unknown'
}

export type ExplainGap = {
  afterLogId: string | null
  beforeLogId: string | null
  reason: 'unlogged_change' | 'current_differs' | 'missing_snapshot'
  at: string | null
}

export type ExplainViewer = {
  canSeeActors: boolean
  canSeePastValues: boolean
  canSeeOwnValues: boolean
}

export type ExplainFieldBody = {
  resourceKind: string
  resourceId: string
  field: string
  itemId: string | null
  labelKey: string
  current: { value: unknown; display: string | null; valueKind: string }
  verdict: 'explained' | 'partially_explained' | 'unexplained' | 'no_history' | 'pending'
  confidence: 'proven' | 'inferred' | 'unknown'
  summary: { key: string; params: Record<string, string | number | boolean | null> }
  chain: ExplainChainEntry[]
  gaps: ExplainGap[]
  hints: Array<{ key: string; params: Record<string, string | number | boolean | null> }>
  page: { limit: number; nextBefore: string | null; scanned: number; truncated: boolean; continuation: boolean }
  viewer: ExplainViewer
}

export type ExplainOverviewBody = {
  resourceKind: string
  resourceId: string
  fields: Array<{ field: string; labelKey: string; valueKind: string; verdict: string; confidence: string; lastChangeAt: string | null }>
  coverage: {
    scanned: number
    truncated: boolean
    legacyRows: number
    causeKinds: Record<string, number>
    noHistory: { reasonKey: string } | null
  }
  viewer: ExplainViewer
}

export type ExplainDescriptorsBody = {
  resources: Array<{
    resourceKind: string
    labelKey: string
    fields: Array<{ key: string; valueKind: string }>
    customFields: { entityId: string; allowKeys: string[] | null } | null
    noHistory: { reasonKey: string } | null
  }>
}

export type ExplainLogBody = {
  logId: string
  at: string
  resourceKind: string | null
  resourceId: string | null
  commandId: string | null
  action: string | null
  state: 'done' | 'undone' | 'redone'
  actor: ExplainActor
  cause: ExplainCause
  correlationId: string | null
  confidence: 'proven' | 'inferred' | 'unknown'
  viewer: ExplainViewer
}

export type ApiResult<TBody> = { status: number; text: string; body: TBody | null }

export type AuditActionItem = {
  id: string
  commandId: string
  executionState: 'done' | 'undone' | 'failed' | 'redone'
  resourceKind: string | null
  resourceId: string | null
  undoToken: string | null
  causeKind?: string | null
  causeId?: string | null
}

export type ScopeOptions = { selectedOrgId?: string }

export function uniqueSuffix(): string {
  return `${Date.now()}_${randomInt(1_000_000)}`
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    search.set(key, String(value))
  }
  return search.toString()
}

async function send(
  request: APIRequestContext,
  method: string,
  path: string,
  token: string,
  options: ScopeOptions & { data?: unknown } = {},
): Promise<APIResponse> {
  if (options.selectedOrgId) {
    return apiRequestWithSelectedOrg(request, method, path, {
      token,
      selectedOrgId: options.selectedOrgId,
      data: options.data,
    })
  }
  return apiRequest(request, method, path, { token, data: options.data })
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

export async function explainRecord<TBody = ExplainFieldBody>(
  request: APIRequestContext,
  token: string,
  query: { resourceKind: string; resourceId: string; field?: string; limit?: number },
  options: ScopeOptions = {},
): Promise<ApiResult<TBody>> {
  const path = `${EXPLAIN_PATH}?${buildQuery(query)}`
  return readResult<TBody>(await send(request, 'GET', path, token, options))
}

export async function explainAuditEntry(
  request: APIRequestContext,
  token: string,
  logId: string,
  options: ScopeOptions = {},
): Promise<ApiResult<ExplainLogBody>> {
  const path = `${EXPLAIN_LOG_PATH}?${buildQuery({ logId })}`
  return readResult<ExplainLogBody>(await send(request, 'GET', path, token, options))
}

export async function getExplainDescriptors(
  request: APIRequestContext,
  token: string,
): Promise<ApiResult<ExplainDescriptorsBody>> {
  return readResult<ExplainDescriptorsBody>(await send(request, 'GET', EXPLAIN_DESCRIPTORS_PATH, token))
}

/** Explains one field and asserts a 200, returning the typed body. */
export async function explainFieldOk(
  request: APIRequestContext,
  token: string,
  query: { resourceKind: string; resourceId: string; field: string },
  options: ScopeOptions = {},
): Promise<ExplainFieldBody> {
  const result = await explainRecord<ExplainFieldBody>(request, token, query, options)
  expect(result.status, `GET ${EXPLAIN_PATH} (${query.resourceKind}/${query.field}) should return 200: ${result.text}`).toBe(200)
  expect(result.body, 'explain response should be JSON').not.toBeNull()
  return result.body as ExplainFieldBody
}

export async function createQaDeal(
  request: APIRequestContext,
  token: string,
  input: { title: string; status?: string; customFields?: Record<string, unknown> } & ScopeOptions,
): Promise<string> {
  const data: Record<string, unknown> = { title: input.title }
  if (input.status) data.status = input.status
  if (input.customFields) data.customFields = input.customFields
  const response = await send(request, 'POST', DEALS_PATH, token, { selectedOrgId: input.selectedOrgId, data })
  const result = await readResult<{ id?: string; dealId?: string }>(response)
  expect(result.status, `POST ${DEALS_PATH} should return 201: ${result.text}`).toBe(201)
  return expectId(result.body?.id ?? result.body?.dealId, 'deal create response should include id')
}

export async function updateQaDeal(
  request: APIRequestContext,
  token: string,
  dealId: string,
  data: Record<string, unknown>,
  options: ScopeOptions = {},
): Promise<void> {
  const response = await send(request, 'PUT', DEALS_PATH, token, { ...options, data: { id: dealId, ...data } })
  const text = await response.text()
  expect(response.status(), `PUT ${DEALS_PATH} should return 200: ${text}`).toBe(200)
}

export async function deleteQaDealIfExists(
  request: APIRequestContext,
  token: string | null,
  dealId: string | null,
  options: ScopeOptions = {},
): Promise<void> {
  if (!token || !dealId) return
  await send(request, 'DELETE', `${DEALS_PATH}?id=${encodeURIComponent(dealId)}`, token, options).catch(() => undefined)
}

/** Lists the audit rows of one deal, newest first. */
export async function listDealAuditActions(
  request: APIRequestContext,
  token: string,
  dealId: string,
  options: ScopeOptions = {},
): Promise<AuditActionItem[]> {
  const path = `${AUDIT_ACTIONS_PATH}?${buildQuery({ resourceKind: DEAL_RESOURCE_KIND, resourceId: dealId })}`
  const result = await readResult<{ items?: AuditActionItem[] }>(await send(request, 'GET', path, token, options))
  expect(result.status, `GET ${AUDIT_ACTIONS_PATH} should return 200: ${result.text}`).toBe(200)
  return result.body?.items ?? []
}

export async function undoAuditAction(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const response = await apiRequest(request, 'POST', `${AUDIT_ACTIONS_PATH}/undo`, { token, data: { undoToken } })
  const text = await response.text()
  expect(response.status(), `undo should return 200: ${text}`).toBe(200)
}

export async function redoAuditAction(request: APIRequestContext, token: string, logId: string): Promise<string> {
  const response = await apiRequest(request, 'POST', `${AUDIT_ACTIONS_PATH}/redo`, { token, data: { logId } })
  const body = await readJsonSafe<{ logId?: string | null }>(response)
  expect(response.status(), 'redo should return 200').toBe(200)
  return expectId(body?.logId, 'redo should issue a new action log')
}

/**
 * Writes a deal status straight to the database, bypassing the command bus and
 * the audit log, and stamps `updated_at` `ageSeconds` in the past.
 */
export async function setDealStatusBypassingAudit(dealId: string, status: string, ageSeconds: number): Promise<void> {
  const updated = await withClient((client) => client.query<{ id: string }>(
    `update customer_deals
        set status = $2, updated_at = now() - ($3::int * interval '1 second')
      where id = $1
      returning id`,
    [dealId, status, ageSeconds],
  ))
  expect(updated.rowCount, 'the raw status update should touch exactly the fixture deal').toBe(1)
}

export type ScopedUserFixture = { roleId: string | null; userId: string | null }

/**
 * Creates a role with exactly `features` (optionally restricted to `organizations`)
 * and a user holding only that role in the admin's home organization, then logs in.
 * Ids are recorded on `fixture` as soon as they exist so `finally` can clean up.
 */
export async function createScopedUser(
  request: APIRequestContext,
  adminToken: string,
  fixture: ScopedUserFixture,
  input: { label: string; features: string[]; organizations?: string[] | null },
): Promise<{ token: string; userId: string }> {
  const { organizationId } = getTokenScope(adminToken)
  const suffix = uniqueSuffix()
  fixture.roleId = await createRoleFixture(request, adminToken, { name: `QA ${input.label} ${suffix}` })
  await setRoleAclFeatures(request, adminToken, {
    roleId: fixture.roleId,
    features: input.features,
    organizations: input.organizations ?? null,
  })
  const email = `qa-${input.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}@example.com`
  fixture.userId = await createUserFixture(request, adminToken, {
    email,
    password: QA_USER_PASSWORD,
    organizationId,
    roles: [fixture.roleId],
    name: `QA ${input.label}`,
  })
  const token = await getAuthToken(request, email, QA_USER_PASSWORD)
  return { token, userId: fixture.userId }
}

export async function deleteScopedUser(
  request: APIRequestContext,
  adminToken: string | null,
  fixture: ScopedUserFixture,
): Promise<void> {
  await deleteUserIfExists(request, adminToken, fixture.userId)
  await deleteRoleIfExists(request, adminToken, fixture.roleId)
}

export async function createDealTextFieldDefinition(
  request: APIRequestContext,
  token: string,
  key: string,
): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/entities/definitions', {
    token,
    data: { entityId: DEAL_CUSTOM_FIELD_ENTITY_ID, key, kind: 'text', configJson: { label: `QA ${key}` } },
  })
  const text = await response.text()
  expect(response.status(), `POST /api/entities/definitions should return 200: ${text}`).toBe(200)
}

export async function deleteDealFieldDefinitionIfExists(
  request: APIRequestContext,
  token: string | null,
  key: string | null,
): Promise<void> {
  if (!token || !key) return
  await apiRequest(request, 'DELETE', '/api/entities/definitions', {
    token,
    data: { entityId: DEAL_CUSTOM_FIELD_ENTITY_ID, key },
  }).catch(() => undefined)
}

export function findChainEntry(body: ExplainFieldBody, logId: string): ExplainChainEntry {
  const entry = body.chain.find((candidate) => candidate.logId === logId)
  expect(entry, `chain should contain log ${logId}`).toBeTruthy()
  return entry as ExplainChainEntry
}
