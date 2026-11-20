import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteIntegrationCredentialsInDb,
  withClient,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  AUTOPAY_STATUS_POLLER_BATCH_LIMIT,
  AUTOPAY_STATUS_POLLER_INTERVAL,
  AUTOPAY_STATUS_POLLER_QUEUE,
  buildStatusPollerScheduleId,
} from '../../lib/status-poller-schedule'

export const AUTOPAY_INTEGRATION_ID = 'gateway_autopay'
export const AUTOPAY_PROVIDER_KEY = 'autopay'

/**
 * The worked-example values from the Autopay Online v1.1 documentation. They
 * only make the hash math verifiable; every provider call in these specs is
 * answered by the in-process HTTP stub, never by Autopay.
 */
export const AUTOPAY_FIXTURE_SERVICE_ID = '2'
export const AUTOPAY_FIXTURE_SHARED_KEY = '2test2'
export const AUTOPAY_FIXTURE_GATEWAY_URL = 'https://testpay.autopay.eu/integration-fixture'

/** Bootstrapping the app in-process and spawning the CLI both exceed the 20s default. */
export const AUTOPAY_INTEGRATION_TEST_TIMEOUT_MS = 240_000

export type AutopayScope = { tenantId: string; organizationId: string }

export type AutopaySchedule = {
  id: string
  scopeType: string
  organizationId: string | null
  tenantId: string | null
  scheduleType: string
  scheduleValue: string
  timezone: string
  targetType: string
  targetQueue: string | null
  targetCommand: string | null
  targetPayload: Record<string, unknown> | null
  isEnabled: boolean
  sourceType: string
  sourceModule: string | null
  lastRunAt: string | null
  nextRunAt: string | null
}

export type GatewayTransactionDetails = {
  transaction: {
    id: string
    paymentId: string
    providerKey: string
    providerSessionId: string | null
    unifiedStatus: string
    lastPolledAt: string | null
  }
  logs: Array<{
    id: string
    level: string
    message: string
    code: string | null
    payload: Record<string, unknown> | null
  }>
}

export type IntegrationLogEntry = {
  id: string
  integrationId: string
  scopeEntityType: string | null
  scopeEntityId: string | null
  level: string
  message: string
  code: string | null
  payload: Record<string, unknown> | null
}

export type PaymentSessionFixture = {
  transactionId: string
  sessionId: string
  paymentId: string
  status: string
}

/**
 * Superadmin requests act inside the fixture organization through the same
 * selection cookies the backend UI sets, so every API call below is scoped to
 * the organization the test created rather than the superadmin's home one.
 */
export function scopeHeaders(scope: AutopayScope): Record<string, string> {
  return { Cookie: `om_selected_tenant=${scope.tenantId}; om_selected_org=${scope.organizationId}` }
}

export function expectedScheduleShape(scope: AutopayScope) {
  return {
    id: buildStatusPollerScheduleId(scope),
    scopeType: 'organization',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    scheduleType: 'interval',
    scheduleValue: AUTOPAY_STATUS_POLLER_INTERVAL,
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: AUTOPAY_STATUS_POLLER_QUEUE,
    targetCommand: null,
    targetPayload: { limit: AUTOPAY_STATUS_POLLER_BATCH_LIMIT },
    sourceType: 'module',
    sourceModule: AUTOPAY_INTEGRATION_ID,
  }
}

export async function createTenantFixture(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201)
  return expectId(body?.id, 'Tenant creation response should include id')
}

export type AutopayScopeFixture = {
  scope: AutopayScope
  scheduleId: string
  cleanup: () => Promise<void>
}

/**
 * Creates a tenant and an organization through the directory API and waits for
 * the organization-created hook to register the reconciliation schedule. The
 * hook runs from a persistent event subscriber, so the events queue is drained
 * before the schedule is awaited.
 */
export async function createAutopayScopeFixture(
  request: APIRequestContext,
  token: string,
  label: string,
  drainEvents: () => Promise<unknown>,
): Promise<AutopayScopeFixture> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let tenantId: string | null = null
  let organizationId: string | null = null

  const cleanup = async () => {
    const scope = tenantId && organizationId ? { tenantId, organizationId } : null
    if (scope) {
      await deleteAutopaySchedule(request, token, scope).catch(() => undefined)
      await deleteIntegrationCredentialsInDb(scope.organizationId).catch(() => undefined)
    }
    await deleteOrganizationIfExists(request, token, organizationId)
    if (tenantId) {
      await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', tenantId)
    }
  }

  try {
    tenantId = await createTenantFixture(request, token, `${unique}-tenant`)
    organizationId = await createOrganizationFixture(request, token, { name: `${unique}-org`, tenantId })
    const scope = { tenantId, organizationId }
    await drainEvents()
    const schedule = await waitForAutopaySchedule(request, token, scope)
    return { scope, scheduleId: schedule.id, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

export async function listAutopaySchedules(
  request: APIRequestContext,
  token: string,
  scope: AutopayScope,
): Promise<AutopaySchedule[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/scheduler/jobs?sourceModule=${AUTOPAY_INTEGRATION_ID}&pageSize=100`,
    { token, headers: scopeHeaders(scope) },
  )
  expect(response.status(), 'GET /api/scheduler/jobs should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: AutopaySchedule[] }>(response)
  return (body?.items ?? []).filter(
    (item) => item.organizationId === scope.organizationId && item.sourceModule === AUTOPAY_INTEGRATION_ID,
  )
}

export async function waitForAutopaySchedule(
  request: APIRequestContext,
  token: string,
  scope: AutopayScope,
): Promise<AutopaySchedule> {
  await expect
    .poll(async () => (await listAutopaySchedules(request, token, scope)).length, {
      message: 'the organization-created hook should register the Autopay reconciliation schedule',
      timeout: 30_000,
    })
    .toBeGreaterThan(0)
  const schedules = await listAutopaySchedules(request, token, scope)
  return schedules[0]
}

export async function setAutopayScheduleEnabled(
  request: APIRequestContext,
  token: string,
  scope: AutopayScope,
  scheduleId: string,
  isEnabled: boolean,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/scheduler/jobs', {
    token,
    headers: scopeHeaders(scope),
    data: { id: scheduleId, isEnabled },
  })
  expect(response.status(), `PUT /api/scheduler/jobs isEnabled=${isEnabled} should succeed`).toBe(200)
}

export type AutopayScheduleRow = {
  id: string
  is_enabled: boolean
  source_type: string
  source_module: string | null
  target_queue: string | null
  target_payload: Record<string, unknown> | null
  schedule_type: string
  schedule_value: string
  created_by_user_id: string | null
  last_run_at: Date | null
  next_run_at: Date | null
  updated_at: Date
}

/**
 * Reads the schedule rows straight from the database. The scheduler list API
 * is served through the CRUD cache, which a CLI write (`seed:defaults`) or the
 * in-process scheduler tick never invalidates, so assertions about what those
 * writers changed must not trust the cached API answer.
 */
export async function readAutopayScheduleRows(scope: AutopayScope): Promise<AutopayScheduleRow[]> {
  return withClient(async (client) => {
    const result = await client.query<AutopayScheduleRow>(
      `select id, is_enabled, source_type, source_module, target_queue, target_payload,
              schedule_type, schedule_value, created_by_user_id, last_run_at, next_run_at, updated_at
         from scheduled_jobs
        where organization_id = $1 and tenant_id = $2 and source_module = $3 and deleted_at is null
        order by id`,
      [scope.organizationId, scope.tenantId, AUTOPAY_INTEGRATION_ID],
    )
    return result.rows
  })
}

/**
 * The scheduler only fires a schedule whose `next_run_at` is due. Registration
 * sets it one interval ahead, so the specs move it into the past instead of
 * waiting five minutes.
 */
export async function makeAutopayScheduleDue(scheduleId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      "update scheduled_jobs set next_run_at = now() - interval '1 minute' where id = $1 and deleted_at is null",
      [scheduleId],
    )
  })
}

async function deleteAutopaySchedule(request: APIRequestContext, token: string, scope: AutopayScope): Promise<void> {
  const scheduleId = buildStatusPollerScheduleId(scope)
  await apiRequest(request, 'DELETE', '/api/scheduler/jobs', {
    token,
    headers: scopeHeaders(scope),
    data: { id: scheduleId },
  }).catch(() => undefined)
  await withClient(async (client) => {
    await client.query('delete from scheduled_jobs where id = $1', [scheduleId])
  })
}

export async function configureAutopayIntegration(
  request: APIRequestContext,
  token: string,
  scope: AutopayScope,
): Promise<void> {
  const credentialsResponse = await apiRequest(
    request,
    'PUT',
    `/api/integrations/${AUTOPAY_INTEGRATION_ID}/credentials`,
    {
      token,
      headers: scopeHeaders(scope),
      data: {
        credentials: {
          serviceId: AUTOPAY_FIXTURE_SERVICE_ID,
          sharedKey: AUTOPAY_FIXTURE_SHARED_KEY,
          hashAlgorithm: 'sha256',
          gatewayUrl: AUTOPAY_FIXTURE_GATEWAY_URL,
        },
      },
    },
  )
  expect(
    credentialsResponse.status(),
    `PUT Autopay credentials should succeed: ${await credentialsResponse.text()}`,
  ).toBe(200)

  const stateResponse = await apiRequest(request, 'PUT', `/api/integrations/${AUTOPAY_INTEGRATION_ID}/state`, {
    token,
    headers: scopeHeaders(scope),
    data: { isEnabled: true },
  })
  expect(stateResponse.status(), `PUT Autopay state should succeed: ${await stateResponse.text()}`).toBe(200)
}

async function createPaymentSessionFixture(
  request: APIRequestContext,
  token: string,
  scope: AutopayScope,
  data: Record<string, unknown>,
): Promise<PaymentSessionFixture> {
  const response = await apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
    token,
    headers: scopeHeaders(scope),
    data,
  })
  const body = await readJsonSafe<Partial<PaymentSessionFixture>>(response)
  expect(response.status(), `POST /api/payment_gateways/sessions should return 201: ${JSON.stringify(body)}`).toBe(201)
  return {
    transactionId: expectId(body?.transactionId, 'session response should include transactionId'),
    sessionId: expectId(body?.sessionId, 'session response should include sessionId'),
    paymentId: expectId(body?.paymentId, 'session response should include paymentId'),
    status: String(body?.status ?? ''),
  }
}

/** A hosted Autopay session: no provider call is made, the transaction starts `pending`. */
export async function createAutopaySession(
  request: APIRequestContext,
  token: string,
  scope: AutopayScope,
  amount: number,
): Promise<PaymentSessionFixture> {
  return createPaymentSessionFixture(request, token, scope, {
    providerKey: AUTOPAY_PROVIDER_KEY,
    amount,
    currencyCode: 'PLN',
    description: `TC-AUTOPAY reconciliation ${Date.now()}`,
    metadata: { customerEmail: 'qa-autopay@example.com' },
  })
}

/**
 * A manual-capture session on the in-repo mock provider. It stays `authorized`,
 * which the core poller would otherwise list, so it proves the Autopay worker
 * never touches another provider's transactions in the same organization.
 */
export async function createMockProviderSession(
  request: APIRequestContext,
  token: string,
  scope: AutopayScope,
): Promise<PaymentSessionFixture> {
  return createPaymentSessionFixture(request, token, scope, {
    providerKey: 'mock',
    amount: 20,
    currencyCode: 'USD',
    captureMethod: 'manual',
    description: `TC-AUTOPAY control transaction ${Date.now()}`,
  })
}

export async function getTransactionDetails(
  request: APIRequestContext,
  token: string,
  scope: AutopayScope,
  transactionId: string,
): Promise<GatewayTransactionDetails> {
  const response = await apiRequest(request, 'GET', `/api/payment_gateways/transactions/${transactionId}`, {
    token,
    headers: scopeHeaders(scope),
  })
  expect(response.status(), 'GET /api/payment_gateways/transactions/:id should return 200').toBe(200)
  const body = await readJsonSafe<GatewayTransactionDetails>(response)
  if (!body?.transaction) throw new Error('[internal] transaction details response has no transaction')
  return body
}

export async function listStatusPollFailureLogs(
  request: APIRequestContext,
  token: string,
  scope: AutopayScope,
  transactionId: string,
): Promise<IntegrationLogEntry[]> {
  const query = new URLSearchParams({
    integrationId: AUTOPAY_INTEGRATION_ID,
    entityType: 'payment_transaction',
    entityId: transactionId,
    pageSize: '100',
  })
  const response = await apiRequest(request, 'GET', `/api/integrations/logs?${query.toString()}`, {
    token,
    headers: scopeHeaders(scope),
  })
  expect(response.status(), 'GET /api/integrations/logs should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: IntegrationLogEntry[] }>(response)
  return (body?.items ?? []).filter((item) => item.code === 'payment_gateways.status_poll_failed')
}

function resolveMercatoCliBin(appRoot: string): string {
  if (process.env.OM_TEST_APP_ROOT?.trim()) {
    try {
      return createRequire(path.join(appRoot, 'package.json')).resolve('@open-mercato/cli/dist/bin.js')
    } catch {
      // The standalone app does not expose the CLI entry: fall back to the monorepo layout.
    }
  }
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(currentDir, '..', '..', '..', '..', '..', '..', '..')
  return path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js')
}

/**
 * Re-runs the module's `seedDefaults` hook the way an operator does:
 * `mercato seed:defaults --module gateway_autopay` against the app under test.
 * The command walks every organization, so the fixture organization is covered.
 */
export function runAutopaySeedDefaults(): string {
  const appRoot = resolveAppRoot()
  return execFileSync(
    process.execPath,
    [resolveMercatoCliBin(appRoot), 'seed:defaults', '--module', AUTOPAY_INTEGRATION_ID],
    {
      cwd: appRoot,
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    },
  )
}
