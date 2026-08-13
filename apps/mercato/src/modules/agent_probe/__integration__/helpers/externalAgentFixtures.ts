/**
 * Shared fixtures for the external-agent (`INVOKE_AGENT` → suspend → callback →
 * resume) integration suite.
 *
 * These specs live beside the probe module rather than inside
 * `packages/enterprise/.../agent_orchestrator/__integration__` for the reason
 * `apps/mercato/src/modules/ratelimit_probe/__integration__` already establishes:
 * the behaviour under test belongs to another module, but the only harness that
 * can drive it without reaching a third party lives here, and a spec that imports
 * its own module's constants cannot drift from them.
 */

import { expect, type APIRequestContext } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  PROBE_SIGNATURE_HEADER,
  PROBE_CONNECTOR_ID,
  probeSecretForOrganization,
} from '../../lib/probeConnector'

/**
 * Duplicated from `../../ai-agents` on purpose: importing that module would run
 * `defineExternalAgent` inside the Playwright process, registering agents into the
 * enterprise registry as a side effect of loading a test helper. The ids are
 * contract strings, and the specs assert against the live agents endpoint, so a
 * drift shows up as a skipped suite with a named reason rather than silently.
 */
export const PROBE_AGENT_ID = 'probe.echo'
export const PROBE_EXPIRING_AGENT_ID = 'probe.echo_expiring'

export { PROBE_CONNECTOR_ID, PROBE_SIGNATURE_HEADER }

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

export const STATIC_CALLBACK_PATH = `/api/agent_orchestrator/external-runs/connectors/${PROBE_CONNECTOR_ID}/callback`

export type Scoped = { token: string; organizationId: string; tenantId: string }

function url(path: string): string {
  return path.startsWith('http') ? path : `${BASE_URL}${path}`
}

function decodeClaims(token: string): { tenantId: string; orgId: string | null } {
  const payload = token.split('.')[1]
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { tenantId: string; orgId: string | null }
}

/**
 * The signature a provider would send. Derived from the connector's own
 * per-organization secret, so a test cannot accidentally prove something the
 * connector does not actually check.
 */
export function probeSignature(organizationId: string, rawBody: string): string {
  return createHmac('sha256', probeSecretForOrganization(organizationId)).update(rawBody).digest('hex')
}

export async function superadminScope(request: APIRequestContext): Promise<Scoped> {
  const token = await getAuthToken(request, 'superadmin')
  const claims = decodeClaims(token)
  if (!claims.orgId) throw new Error('[internal] superadmin token carries no organization')
  return { token, organizationId: claims.orgId, tenantId: claims.tenantId }
}

/** Authenticated JSON call pinned to ONE organization via the selection cookie. */
export async function scopedRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  scope: { token: string; organizationId?: string | null },
  data?: unknown,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${scope.token}`,
    'Content-Type': 'application/json',
  }
  if (scope.organizationId) headers.Cookie = `om_selected_org=${scope.organizationId}`
  return request.fetch(url(path), { method, headers, data, timeout: 30_000 })
}

/**
 * True when this deployment actually carries the probe connector — i.e. it was
 * generated with `OM_INTEGRATION_TEST` and the enterprise agents module is on.
 * Every spec calls this and skips with a named reason rather than failing, so a
 * developer running the suite against an ordinary dev server gets a diagnosis
 * instead of eight red tests.
 */
export async function probeConnectorAvailable(request: APIRequestContext, token: string): Promise<boolean> {
  const res = await scopedRequest(request, 'GET', `/api/agent_orchestrator/agents/${PROBE_AGENT_ID}`, { token })
  return res.status() === 200
}

export const PROBE_UNAVAILABLE_REASON =
  'The agent_probe module is not deployed here: run the app with OM_ENABLE_ENTERPRISE_MODULES=true, OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true and OM_INTEGRATION_TEST=true, then `yarn mercato generate`.'

export type StartedProbeRun = { runId: string; externalRunId: string }

/**
 * Start a parked external run through the Playground route — the cheapest HTTP
 * entry point that reaches `ExternalAgentRunner`, and the one that must answer
 * 202 rather than 200 because nothing has finished yet.
 */
export async function startProbeRun(
  request: APIRequestContext,
  scope: Scoped,
  options: { agentId?: string; brief?: string; forceExternalRunId?: string } = {},
): Promise<StartedProbeRun> {
  const input: Record<string, unknown> = { brief: options.brief ?? 'integration probe brief' }
  if (options.forceExternalRunId) input.forceExternalRunId = options.forceExternalRunId
  const res = await scopedRequest(
    request,
    'POST',
    `/api/agent_orchestrator/agents/${options.agentId ?? PROBE_AGENT_ID}/run`,
    scope,
    { input },
  )
  expect(res.status(), `POST /agents/${options.agentId ?? PROBE_AGENT_ID}/run should answer 202 for an external agent`).toBe(202)
  const body = (await res.json()) as { runId: string; status: string; externalRunId: string | null }
  expect(body.status).toBe('suspended')
  expect(body.runId).toBeTruthy()
  expect(body.externalRunId).toBeTruthy()
  return { runId: body.runId, externalRunId: body.externalRunId as string }
}

export type ExternalRunView = {
  externalRun: {
    id: string
    connectorId: string
    status: string
    externalRunId: string | null
    expiresAt: string | null
    processId: string | null
    stepId: string | null
    signalName: string | null
    updatedAt: string | null
  } | null
  connector: { id: string; registered: boolean; supportsRecording: boolean } | null
}

export async function readExternalRun(
  request: APIRequestContext,
  scope: Scoped,
  runId: string,
): Promise<ExternalRunView> {
  const res = await scopedRequest(request, 'GET', `/api/agent_orchestrator/runs/${runId}/external`, scope)
  expect(res.status(), `GET /runs/${runId}/external should return 200`).toBe(200)
  return (await res.json()) as ExternalRunView
}

export async function readRun(request: APIRequestContext, scope: Scoped, runId: string) {
  const res = await scopedRequest(request, 'GET', `/api/agent_orchestrator/runs/${runId}`, scope)
  expect(res.status(), `GET /runs/${runId} should return 200`).toBe(200)
  return (await res.json()) as {
    run: { status: string; runtime: string; output: unknown; errorMessage: string | null; completedAt: string | null }
  }
}

export type ProbeStart = {
  externalRunId: string
  callbackUrl: string
  agentId: string
  tenantId: string
  organizationId: string
  createdAt: string
}

export async function readProbeStarts(
  request: APIRequestContext,
  scope: { token: string },
  externalRunId?: string,
): Promise<ProbeStart[]> {
  const query = externalRunId ? `?externalRunId=${encodeURIComponent(externalRunId)}` : ''
  const res = await scopedRequest(request, 'GET', `/api/agent_probe/starts${query}`, scope)
  expect(res.status(), 'GET /api/agent_probe/starts should return 200').toBe(200)
  return ((await res.json()) as { entries: ProbeStart[] }).entries
}

/**
 * The per-run callback URL the runner minted. Only the connector ever saw it —
 * the row stores a SHA-256 digest — so this is the sole way a test can address
 * the token route at all.
 */
export async function probeCallbackUrl(
  request: APIRequestContext,
  scope: Scoped,
  externalRunId: string,
): Promise<string> {
  const starts = await readProbeStarts(request, scope, externalRunId)
  const mine = starts.filter((entry) => entry.organizationId === scope.organizationId)
  expect(mine.length, `the probe should have captured exactly one start for ${externalRunId} in this organization`).toBe(1)
  return mine[0].callbackUrl
}

/** Play the provider: POST a signed callback to whichever route the caller names. */
export async function postSignedCallback(
  request: APIRequestContext,
  target: string,
  options: { body: Record<string, unknown>; signWithOrganizationId: string; signature?: string },
) {
  const raw = JSON.stringify(options.body)
  return request.fetch(url(target), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [PROBE_SIGNATURE_HEADER]: options.signature ?? probeSignature(options.signWithOrganizationId, raw),
    },
    data: raw,
    timeout: 30_000,
  })
}

/**
 * Advance a queue, when — and only when — this environment lets a test do so
 * SAFELY.
 *
 * `drainIntegrationQueue` has two modes and only one of them is correct here.
 * With `OM_TEST_APP_ROOT` set it spawns a child rooted at the app, so the job
 * runs with the app's own working directory; without it, it drains IN THIS
 * PROCESS, which executes the connector with Playwright's working directory and
 * writes the probe's capture somewhere the app itself cannot read. Worse, in the
 * repository's ephemeral runner the app already boots real workers
 * (`AUTO_SPAWN_WORKERS=true`), so an in-process drain would race a genuine worker
 * for the same job.
 *
 * So: drain when it is safe, otherwise simply wait for the app's workers. Every
 * caller is inside a poll loop, so waiting is always a valid answer.
 */
export async function advanceQueue(queueName: string): Promise<void> {
  if (!process.env.OM_TEST_APP_ROOT?.trim()) return
  const { drainIntegrationQueue } = await import('@open-mercato/core/helpers/integration/queue')
  await drainIntegrationQueue(queueName).catch(() => 0)
}

export async function createOrganization(
  request: APIRequestContext,
  scope: Scoped,
  name: string,
): Promise<string> {
  const res = await scopedRequest(request, 'POST', '/api/directory/organizations', scope, {
    name,
    tenantId: scope.tenantId,
  })
  expect(res.status(), 'POST /api/directory/organizations should return 201').toBe(201)
  return ((await res.json()) as { id: string }).id
}

export async function deleteOrganizationIfExists(
  request: APIRequestContext,
  scope: Scoped,
  organizationId: string | null,
): Promise<void> {
  if (!organizationId) return
  await scopedRequest(request, 'DELETE', '/api/directory/organizations', scope, { id: organizationId }).catch(
    () => undefined,
  )
}
