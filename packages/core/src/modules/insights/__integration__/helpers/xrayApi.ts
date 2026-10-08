import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

export const XRAY_STATUS_PATH = '/api/insights/xray/status'
export const XRAY_SETTINGS_PATH = '/api/insights/xray/settings'
export const XRAY_BACKFILL_PATH = '/api/insights/xray/backfill'
export const XRAY_BACKFILL_QUEUE = 'insights-xray-backfill'
export const DEAL_PROCESS_KEY = 'customers.deal'
export const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
  : path.resolve(process.cwd(), 'apps/mercato')

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
}

const BACKFILL_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 1000

export type XrayScopeOptions = { selectedOrgId?: string }

export type XrayResult<TBody> = { status: number; text: string; body: TBody | null }

export type XraySettingsBody = {
  ok: true
  result: {
    enabled: boolean
    retentionDays: number
    kAnonymity: number
    debounceSeconds: number
    individualsEnabled: boolean
    conformanceWorkflowId: string | null
    activityStepMap: Record<string, string> | null
    updatedAt: string | null
  }
}

export type XrayStatusBody = {
  organizationId: string
  ingestEnabled: boolean
  registry: { ready: boolean; contractHash: string; processes: Array<{ processKey: string }>; rejected: number }
  cursor: { status: string; contractMatches: boolean; computedThrough: string | null; scan: { id: string } | null } | null
  processes: Array<{ processKey: string; n: number; voidedEvents: number; cases: number; openCases: number }>
  computedThrough: string | null
}

export type ProjectedEvent = {
  source_log_id: string
  seq: number
  activity_key: string
  activity_kind: string
  voided: boolean
  voided_by_log_id: string | null
  cause_kind: string
  actor_pseudonym: string | null
  organization_id: string
  tenant_id: string
  followup_value: string | null
}

export type ProjectedCase = {
  status: string
  event_count: number
  variant_keys: string[]
  dimensions: { stages?: Record<string, string> }
}

async function send(
  request: APIRequestContext,
  method: string,
  url: string,
  token: string,
  options: XrayScopeOptions & { data?: unknown; headers?: Record<string, string> } = {},
) {
  const headers = {
    ...(options.selectedOrgId ? { Cookie: `om_selected_org=${options.selectedOrgId}` } : {}),
    ...(options.headers ?? {}),
  }
  return apiRequest(request, method, url, { token, data: options.data, headers })
}

async function readResult<TBody>(response: { status: () => number; text: () => Promise<string> }): Promise<XrayResult<TBody>> {
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

export async function getXrayStatus(request: APIRequestContext, token: string, options: XrayScopeOptions = {}): Promise<XrayResult<XrayStatusBody>> {
  return readResult<XrayStatusBody>(await send(request, 'GET', XRAY_STATUS_PATH, token, options))
}

export async function getXraySettings(request: APIRequestContext, token: string, options: XrayScopeOptions = {}): Promise<XrayResult<XraySettingsBody>> {
  return readResult<XraySettingsBody>(await send(request, 'GET', XRAY_SETTINGS_PATH, token, options))
}

export async function putXraySettings(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
  options: XrayScopeOptions & { expectedUpdatedAt?: string | null } = {},
): Promise<XrayResult<XraySettingsBody & { code?: string; currentUpdatedAt?: string }>> {
  const headers = options.expectedUpdatedAt ? { [OPTIMISTIC_LOCK_HEADER]: options.expectedUpdatedAt } : undefined
  return readResult(await send(request, 'PUT', XRAY_SETTINGS_PATH, token, { selectedOrgId: options.selectedOrgId, data, headers }))
}

/**
 * Starts a backfill of the caller's (or the selected) organization, drains the backfill
 * queue in the app context and waits until the progress job is terminal.
 */
export async function runXrayBackfill(request: APIRequestContext, token: string, options: XrayScopeOptions = {}): Promise<{ progressJobId: string; scanId: string }> {
  const started = await readResult<{ ok: boolean; progressJobId: string | null; scanId: string }>(
    await send(request, 'POST', XRAY_BACKFILL_PATH, token, { selectedOrgId: options.selectedOrgId, data: {} }),
  )
  expect(started.status, `POST ${XRAY_BACKFILL_PATH} should return 202: ${started.text}`).toBe(202)
  const progressJobId = started.body?.progressJobId
  expect(progressJobId, 'the backfill is tracked by a progress job').toBeTruthy()
  const deadline = Date.now() + BACKFILL_TIMEOUT_MS
  let lastStatus: string | null = null
  while (Date.now() < deadline) {
    await drainIntegrationQueue(XRAY_BACKFILL_QUEUE, { appRoot: APP_ROOT })
    const job = await readResult<{ status?: string; errorMessage?: string | null }>(
      await send(request, 'GET', `/api/progress/jobs/${progressJobId}`, token, { selectedOrgId: options.selectedOrgId }),
    )
    lastStatus = job.body?.status ?? null
    if (lastStatus === 'completed') return { progressJobId: progressJobId as string, scanId: started.body?.scanId as string }
    if (lastStatus === 'failed' || lastStatus === 'cancelled') {
      throw new Error(`[internal] X-Ray backfill ${progressJobId} ended as ${lastStatus}: ${job.text}`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`[internal] X-Ray backfill ${progressJobId} did not finish (last status: ${lastStatus})`)
}

export async function readProjectedEvents(caseId: string, processKey: string = DEAL_PROCESS_KEY): Promise<ProjectedEvent[]> {
  return withClient(async (client) => (await client.query<ProjectedEvent>(
    `select source_log_id, seq, activity_key, activity_kind, voided, voided_by_log_id, cause_kind, actor_pseudonym,
            organization_id, tenant_id, followup_value
       from insights_process_events
      where process_key = $1 and case_id = $2
      order by occurred_at, source_log_id, seq`,
    [processKey, caseId],
  )).rows)
}

export async function readProjectedCase(caseId: string, processKey: string = DEAL_PROCESS_KEY): Promise<ProjectedCase | null> {
  return withClient(async (client) => (await client.query<ProjectedCase>(
    'select status, event_count, variant_keys, dimensions from insights_process_cases where process_key = $1 and case_id = $2',
    [processKey, caseId],
  )).rows[0] ?? null)
}

/** Removes the projection rows of the given cases (fixtures clean up after themselves). */
export async function deleteProjectedCases(caseIds: Array<string | null>): Promise<void> {
  const ids = caseIds.filter((id): id is string => Boolean(id))
  if (ids.length === 0) return
  await withClient(async (client) => {
    await client.query('delete from insights_process_events where case_id = any($1::uuid[])', [ids])
    await client.query('delete from insights_process_cases where case_id = any($1::uuid[])', [ids])
  })
}

/** Removes every X-Ray row of an organization created only for a test. */
export async function deleteXrayOrganizationState(organizationId: string | null): Promise<void> {
  if (!organizationId) return
  await withClient(async (client) => {
    for (const table of ['insights_process_events', 'insights_process_cases', 'insights_process_rollups', 'insights_process_cursors', 'insights_process_settings']) {
      await client.query(`delete from ${table} where organization_id = $1`, [organizationId])
    }
  })
}

export async function readSettingsRowExists(tenantId: string, organizationId: string): Promise<boolean> {
  return withClient(async (client) => (await client.query(
    'select id from insights_process_settings where tenant_id = $1 and organization_id = $2',
    [tenantId, organizationId],
  )).rows.length > 0)
}

export async function deleteSettingsRow(tenantId: string, organizationId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('delete from insights_process_settings where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
  })
}
