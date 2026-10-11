import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { checkRateLimit } from '@open-mercato/shared/lib/ratelimit/helpers'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import {
  simulationErrorSchema,
  simulationListQuerySchema,
  simulationListResponseSchema,
  simulationRequestResponseSchema,
  simulationRequestSchema,
  type SimulationRequestBody,
  type SimulationRequestCommandInput,
} from '../../data/validators'
import { SIMULATION_REQUEST_COMMAND_ID, type SimulationRequestResult } from '../../commands/simulations'
import {
  SIMULATION_LIMITS,
  SIMULATION_RATE_LIMIT_KEY_PREFIX,
  SIMULATION_RUN_FEATURE,
  SIMULATION_RUN_RESOURCE_KIND,
  SIMULATION_VIEW_FEATURE,
} from '../../lib/simulation/constants'
import { createFeatureCheck } from '../../lib/simulation/context'
import { storedRunFeatures } from '../../lib/simulation/features'
import { jsonByteLength, jsonDepth } from '../../lib/simulation/hash'
import { getSimulationKind, listSimulationKinds } from '../../lib/simulation/registry'
import {
  resolveSimulationRouteContext,
  runAfterSuccessSafely,
  simulationError,
  simulationJson,
  simulationRouteFailure,
  type SimulationRouteContext,
} from '../../lib/simulation/routes'
import { listSimulationRuns } from '../../lib/simulation/store'
import { resolveSimulationWindow } from '../../lib/simulation/window'
import { toSimulationRunSummary } from '../../lib/simulation/views'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [SIMULATION_VIEW_FEATURE] },
  POST: { requireAuth: true, requireFeatures: [SIMULATION_RUN_FEATURE] },
}

const requestRateLimitConfig = readEndpointRateLimitConfig('INSIGHTS_SIMULATION_REQUEST', {
  points: SIMULATION_LIMITS.submissionsPerHour,
  duration: 60 * 60,
  keyPrefix: SIMULATION_RATE_LIMIT_KEY_PREFIX,
})

async function enforceRequestRateLimit(container: { resolve: (name: string) => unknown }, key: string, translate: TranslateFn): Promise<NextResponse | null> {
  let service: RateLimiterService | null = null
  try {
    service = container.resolve('rateLimiterService') as RateLimiterService
  } catch {
    service = null
  }
  if (!service) return null
  const limited = await checkRateLimit(
    service,
    requestRateLimitConfig,
    key,
    translate('insights.simulation.errors.rate_limited'),
    { failClosed: true, unavailableMessage: translate('insights.simulation.errors.rate_limit_unavailable') },
  )
  if (!limited) return null
  const code = limited.status === 429 ? 'rate_limited' : 'rate_limit_unavailable'
  const body = await readJsonSafe<{ error?: string }>(limited, {})
  const headers: Record<string, string> = {}
  limited.headers.forEach((value: string, name: string) => {
    if (name.toLowerCase() !== 'content-type' && name.toLowerCase() !== 'content-length') headers[name] = value
  })
  return simulationJson({ error: body?.error ?? translate(`insights.simulation.errors.${code}`), code }, limited.status, headers)
}

/**
 * Own runs of the selected organization (S10: `insights.simulator.view` means "my runs"). A run whose
 * proposal now needs a feature the caller lost is left out of its page; `total` and `totalPages`
 * count every live run of the caller so every page stays reachable.
 */
export async function GET(req: Request) {
  let translate: TranslateFn | null = null
  try {
    const context = await resolveSimulationRouteContext(req)
    if (context instanceof NextResponse) return context
    translate = context.translate
    const query = simulationListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!query.success) return simulationError(context.translate, 'invalid_request', 400)
    const page = query.data.page ?? 1
    const pageSize = Math.min(query.data.pageSize ?? 20, 100)
    const hasFeatures = createFeatureCheck(context.container, context.userId, context.scope)
    const visibleKinds: string[] = []
    for (const registered of listSimulationKinds()) {
      if (await hasFeatures(registered.definition.requiredFeatures)) visibleKinds.push(registered.definition.kind)
    }
    const em = (context.container.resolve('em') as EntityManager).fork()
    const { items, total } = await listSimulationRuns(em, { scope: context.scope, requesterUserId: context.userId, kinds: visibleKinds, page, pageSize })
    const visible = []
    for (const run of items) {
      const kind = getSimulationKind(run.kind)
      if (kind && (await hasFeatures(storedRunFeatures(kind.definition, run.inputJson)))) visible.push(toSimulationRunSummary(run, kind))
    }
    return simulationJson({
      items: visible,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    return simulationRouteFailure(error, 'simulations.list', translate)
  }
}

type CheckedSimulationRequest = {
  request: SimulationRequestBody
  window: { from: Date; to: Date }
}

/**
 * The body checks of a simulation request, run on the body and again on a payload a mutation
 * guard transformed: the strict schema, `proposal` ≤ 64 KB and nesting ≤ 64, a registered kind
 * whose `requiredFeatures` the caller holds (wildcard-aware), and the window.
 */
async function checkSimulationRequest(
  context: SimulationRouteContext,
  hasFeatures: ReturnType<typeof createFeatureCheck>,
  candidate: unknown,
  now: Date,
): Promise<CheckedSimulationRequest | NextResponse> {
  const parsed = simulationRequestSchema.safeParse(candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {})
  if (!parsed.success) return simulationError(context.translate, 'invalid_request', 400)
  const request = parsed.data
  if (jsonByteLength(request.proposal) > SIMULATION_LIMITS.maxInputBytes) return simulationError(context.translate, 'proposal_too_large', 422)
  if (jsonDepth(request.proposal, SIMULATION_LIMITS.maxInputDepth) > SIMULATION_LIMITS.maxInputDepth) return simulationError(context.translate, 'invalid_proposal', 422)
  const registered = getSimulationKind(request.kind)
  if (!registered) return simulationError(context.translate, 'unsupported_kind', 422)
  if (!(await hasFeatures(registered.definition.requiredFeatures))) {
    return simulationError(context.translate, 'forbidden', 403, { requiredFeatures: [...registered.definition.requiredFeatures] })
  }
  const window = resolveSimulationWindow(request.window, now)
  if (!window) return simulationError(context.translate, 'invalid_window', 422)
  return { request, window }
}

/**
 * Requests a simulation (`insights.simulation.request`): `insights.simulator.run` (route guard) +
 * the body checks of `checkSimulationRequest`, 20 submissions per user per hour, the registered
 * mutation guards, then dedupe and the active-run limits in the command. A guard-transformed
 * `kind`/`artifactId` is dispatched only after the body checks pass again on it. 202 for a new
 * run, 200 for the caller's identical live run, and 200 for an `inline` kind, whose run is
 * computed in this request and answered as `completed`.
 */
export async function POST(req: Request) {
  let translate: TranslateFn | null = null
  try {
    const context = await resolveSimulationRouteContext(req)
    if (context instanceof NextResponse) return context
    translate = context.translate
    const body = await readJsonSafe<unknown>(req, null)
    const now = new Date()
    const hasFeatures = createFeatureCheck(context.container, context.userId, context.scope)
    const checked = await checkSimulationRequest(context, hasFeatures, body, now)
    if (checked instanceof NextResponse) return checked
    const limited = await enforceRequestRateLimit(context.container, `${context.scope.tenantId}:${context.userId}`, context.translate)
    if (limited) return limited
    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: { userId: context.userId, tenantId: context.scope.tenantId, organizationId: context.scope.organizationId },
      input: {
        resourceKind: SIMULATION_RUN_RESOURCE_KIND,
        resourceId: null,
        operation: 'create',
        mutationPayload: { kind: checked.request.kind, artifactId: checked.request.artifactId ?? null },
      },
    })
    if (!guarded.ok) return guarded.response
    const accepted = guarded.modifiedPayload
      ? await checkSimulationRequest(context, hasFeatures, { ...checked.request, ...guarded.modifiedPayload }, now)
      : checked
    if (accepted instanceof NextResponse) return accepted
    const { request, window } = accepted
    const commandBus = context.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<SimulationRequestCommandInput, SimulationRequestResult>(SIMULATION_REQUEST_COMMAND_ID, {
      input: {
        tenantId: context.scope.tenantId,
        organizationId: context.scope.organizationId,
        userId: context.userId,
        kind: request.kind,
        artifactId: request.artifactId ?? null,
        proposal: request.proposal,
        windowFrom: window.from.toISOString(),
        windowTo: window.to.toISOString(),
      },
      ctx: context.commandContext,
    })
    const queued = result.created && result.status !== 'completed'
    const response = simulationJson({
      ok: true,
      runId: result.runId,
      progressJobId: result.progressJobId,
      status: result.status,
      deduplicated: !result.created,
    }, queued ? 202 : 200)
    await runAfterSuccessSafely(guarded, 'simulations.request')
    return response
  } catch (error) {
    const rejection = getCommandInterceptorHttpRejection(error)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return simulationRouteFailure(error, 'simulations.request', translate)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Change simulations',
  methods: {
    GET: {
      summary: 'List my simulation runs',
      description: 'Runs requested by the caller in the selected organization (never other users\' runs), newest first, excluding expired runs and kinds whose features the caller no longer holds. `pageSize` ≤ 100.',
      query: simulationListQuerySchema,
      responses: [{ status: 200, description: 'Own runs', schema: simulationListResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid query or no organization selected (`organization_scope_required`)', schema: simulationErrorSchema },
        { status: 401, description: 'Authentication required', schema: simulationErrorSchema },
        { status: 403, description: 'Missing `insights.simulator.view` or not a user principal', schema: simulationErrorSchema },
      ],
    },
    POST: {
      summary: 'Request a change simulation',
      description: 'Evaluates (never executes) the proposed change against recorded history in a background job tracked by a ProgressJob. Needs `insights.simulator.run` and the kind\'s required features. The proposal is validated by the owning module (422 `invalid_proposal` with `issues`); the artifact version and proposal fingerprint are captured on the server. A live identical run of the caller (same kind, proposal, artifact version, window hour, versions, organization) is returned with 200 instead of a new run. An `inline` kind (`auth.role_acl_preview`: needs `auth.acl.manage` + `auth.users.list`) is computed in this request from the live configuration, after an access-log row is written (503 `access_log_unavailable` when it cannot be), and answered with 200 and status `completed` (never deduplicated; `window` is ignored). Limits: 2 active runs per user and 5 per tenant (429 `simulation_busy`), 20 requests per user per hour (429 `rate_limited`), proposal ≤ 64 KB. Runs the registered mutation guards (`insights.simulation_run`).',
      requestBody: { contentType: 'application/json', schema: simulationRequestSchema },
      responses: [
        { status: 202, description: 'Run queued', schema: simulationRequestResponseSchema },
        { status: 200, description: 'The caller\'s identical live run (deduplicated), or the completed run of an inline kind', schema: simulationRequestResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid body or no organization selected (`organization_scope_required`)', schema: simulationErrorSchema },
        { status: 401, description: 'Authentication required', schema: simulationErrorSchema },
        { status: 403, description: 'Missing `insights.simulator.run` or the kind\'s features, or the owning module would refuse to apply the proposal (`forbidden`)', schema: simulationErrorSchema },
        { status: 404, description: 'The artifact does not exist or is outside the caller\'s scope (`artifact_unavailable`, identical for both)', schema: simulationErrorSchema },
        { status: 422, description: '`unsupported_kind`, `invalid_proposal`, `proposal_too_large`, `invalid_window`, `unsupported_event_payload`, `artifact_not_found`, `not_customized`, or blocked by a mutation guard', schema: simulationErrorSchema },
        { status: 429, description: '`simulation_busy` (active-run limits) or `rate_limited`', schema: simulationErrorSchema },
        { status: 503, description: 'Rate limiter unavailable (`rate_limit_unavailable`) or the access log of an inline kind cannot be written (`access_log_unavailable`)', schema: simulationErrorSchema },
      ],
    },
  },
}
