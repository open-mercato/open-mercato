/**
 * The STATIC, connector-addressed provider callback (external-agent-invocation
 * design §5.5; risk R3; tracker task 2.12) — the second publicly reachable,
 * unauthenticated surface in this module, and a sibling of
 * `external-runs/[token]/callback` rather than a replacement for it.
 *
 * WHY IT EXISTS. The token route is the stronger design and stays the default:
 * a single-use bearer minted per run proves WHICH run, and the provider's
 * signature proves WHO. It only works, though, for a provider that accepts a
 * per-call callback URL. ElevenLabs does not — its post-call webhook destination
 * is configured at the WORKSPACE/AGENT level and the verified outbound-call
 * request body has no webhook field — so the per-run URL the runner mints can
 * never be handed to it, and no real call could ever resume a workflow. Such a
 * provider posts every tenant's answer to ONE static URL, and the only thing in
 * the payload that identifies the run is the provider's own id.
 *
 * WHAT REPLACES THE TOKEN. Nothing. That is the honest statement of this route's
 * security model and the one thing to understand before touching it:
 *
 *   - The provider id in the body is an ADDRESS, not a credential. It is
 *     guessable, it is echoed in provider dashboards, and it proves nothing.
 *   - The per-tenant HMAC is the ONLY credential. It is what every ordinary
 *     webhook integration relies on, but here it carries the whole weight: the
 *     per-run defence of the token route is gone, so a leaked tenant webhook
 *     secret lets an attacker settle any of THAT tenant's pending external runs
 *     (and only that tenant's — the secret is per-tenant).
 *
 * HOW TENANCY IS DECIDED WITHOUT A TOKEN. `(organization_id, connector_id,
 * external_run_id)` is unique PER ORG (T2.1: a provider run id is unique within
 * a provider ACCOUNT, so two tenants on their own workspaces may legitimately
 * mint the same `conversation_id`). So a provider id can address more than one
 * row. All candidates are resolved and the SIGNATURE disambiguates: each
 * candidate is verified against its OWN tenant's webhook secret, and at most one
 * can verify because the secret is per-tenant. Zero verifying candidates ⇒ 401
 * with no detail. Scope still comes from the row that verified — never from the
 * body, never from a header.
 *
 * ORDER IS LOAD-BEARING, exactly as on the token route, with ONE deliberate
 * divergence: this route MUST parse before it can verify, because the address is
 * inside the body. That parse is bounded (a size-capped body, `JSON.parse` and
 * nothing else, a length-capped id) and it feeds a database lookup only —
 * nothing is trusted, written or settled until a signature has verified over the
 * ORIGINAL BYTES. The raw string is never reconstructed from the parsed copy: a
 * `JSON.stringify(JSON.parse(body))` round-trip reorders keys and drops
 * whitespace, which silently breaks every provider HMAC.
 *
 * MUTATION GUARDS are not wired here, for the reasons the token route's own
 * `MUTATION GUARDS` note sets out in full (no user to authorize, and guards that
 * read third-party request headers would turn a correctly signed settlement into
 * a 409). The write path still runs entirely through Commands.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_ERROR_FALLBACK,
  rateLimitErrorSchema,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { readBoundedRequestBody, WebhookBodyTooLargeError } from '@open-mercato/shared/lib/webhooks'
import { AgentExternalRun } from '../../../../../data/entities'
import {
  completeExternalRun,
  type ExternalRunSettlement,
} from '../../../../../lib/runtime/completeExternalRun'
import {
  getExternalAgentConnector,
  type ExternalAgentConnector,
  type ExternalAgentConnectorScope,
} from '../../../../../lib/runtime/externalConnectorRegistry'
import { agentOrchestratorTag } from '../../../../openapi'

const logger = createLogger('agent_orchestrator').child({
  component: 'external-run-connector-callback',
})

export const metadata = {
  POST: { requireAuth: false },
}

type RouteContext = { params: Promise<{ connectorId: string }> }

/**
 * Shared with the token route on purpose — one env var, one number, one thing to
 * size. 8 MiB clears ElevenLabs' base64-mp3 `post_call_audio` with headroom.
 */
const DEFAULT_CALLBACK_BODY_LIMIT_BYTES = 8 * 1024 * 1024
const CALLBACK_BODY_LIMIT_ENV = 'OM_AGENT_EXTERNAL_CALLBACK_MAX_BODY_BYTES'

/** Matches `agent_external_runs.connector_id`; a longer segment can address nothing. */
const MAX_CONNECTOR_ID_LENGTH = 100

/** Matches `agent_external_runs.external_run_id`; a longer id can address nothing either. */
const MAX_EXTERNAL_RUN_ID_LENGTH = 200

/**
 * How many candidate rows one provider id may resolve to.
 *
 * THE VERIFY-COST QUESTION, since `verifyCallback` is not free — the ElevenLabs
 * implementation reads the tenant's credential record (a container build, a
 * query, a decryption) before it computes its HMAC. An attacker chooses the
 * provider id in the body, so they choose WHICH rows are verified against; what
 * they cannot do is create rows, so the candidate set is bounded by how many
 * tenants of this deployment genuinely hold a run with that id under this
 * connector. Realistically that is ONE (T2.1's unique makes it at most one per
 * org, and a cross-org collision needs two tenants on separate provider accounts
 * to mint the same id). This cap turns "realistically one" into "never more than
 * ten, whatever the data looks like", so the per-request verification work is
 * fixed and the per-second work is bounded by the rate limits below rather than
 * by the contents of a table.
 *
 * Ten rather than one: truncating a legitimate collision would make the losing
 * tenant's callback unresolvable and park its workflow until the deadline sweep,
 * which is a worse failure than nine extra HMACs. A full page is logged, because
 * hitting the cap means a candidate may have been cut off.
 */
const CANDIDATE_LIMIT = 10

/**
 * Three buckets, checked at three different points, because they bound three
 * different things.
 *
 * PER IP, before anything is read: a spray from one source. Skipped when the
 * deployment declares no reverse-proxy depth (`getClientIp` returns null), for
 * the reason the token route gives — a shared `'unknown'` bucket would let one
 * attacker exhaust the budget every legitimate provider shares.
 *
 * PER CONNECTOR, also before anything is read: this URL is static and shared by
 * EVERY tenant on the deployment, so its budget must fit an entire deployment's
 * real callback traffic while still bounding an unauthenticated flood. That is
 * why it is an order of magnitude above the token route's per-run budget.
 *
 * PER ORGANIZATION, only AFTER a signature has verified: a redelivery storm
 * aimed at one tenant. It is deliberately not checked earlier — before
 * verification the organization is merely a candidate the CALLER's body pointed
 * at, and consuming a tenant's budget on an unsigned request would hand any
 * anonymous caller a way to lock a specific tenant out of its own callbacks.
 */
const CALLBACK_IP_RATE_LIMIT = {
  points: 60,
  duration: 60,
  keyPrefix: 'agent_orchestrator:external-connector-callback:ip',
}
const CALLBACK_CONNECTOR_RATE_LIMIT = {
  points: 600,
  duration: 60,
  keyPrefix: 'agent_orchestrator:external-connector-callback:connector',
}
const CALLBACK_ORG_RATE_LIMIT = {
  points: 60,
  duration: 60,
  keyPrefix: 'agent_orchestrator:external-connector-callback:org',
}

/**
 * One body for every "no such run" answer. An unknown connector, a connector
 * that is not addressable this way, an unknown provider id and a row outside its
 * own scope are indistinguishable to the caller: nothing here reveals whether a
 * connector is deployed, a tenant exists or a run is pending.
 */
const NOT_FOUND_BODY = { error: 'Not found' } as const

/** The correlation columns this route projects. No encrypted column is selected. */
type CandidateRow = {
  id: string
  tenantId: string
  organizationId: string
  runId: string
  agentId: string
  connectorId: string
  status: string
  processId?: string | null
  stepId?: string | null
  signalName?: string | null
  createdAt: Date
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  const { connectorId } = await ctx.params

  if (!connectorId || connectorId.length > MAX_CONNECTOR_ID_LENGTH) {
    return NextResponse.json(NOT_FOUND_BODY, { status: 404 })
  }

  const container = await createRequestContainer()

  // 0. RATE LIMIT FIRST, before the body is read and before the database is
  //    touched, so a flood costs a cache increment instead of an 8 MiB read, a
  //    parse and a query. The connector id comes straight from the path, so
  //    nothing has to be parsed to get here.
  const rateLimited = await enforceInboundRateLimits(container, req, connectorId)
  if (rateLimited) return rateLimited

  // 1. RAW BODY, AS TEXT, BOUNDED. This exact string is what reaches
  //    `verifyCallback`. It is kept for the whole request and never rebuilt from
  //    the parsed copy below — a signature covers the bytes that were sent.
  let rawBody: string
  try {
    rawBody = await readBoundedRequestBody(req, { maxBytes: resolveCallbackBodyLimitBytes() })
  } catch (error) {
    if (error instanceof WebhookBodyTooLargeError) {
      logger.warn('external connector callback rejected: payload exceeds the body limit', {
        connectorId,
        limitBytes: error.limitBytes,
      })
      return NextResponse.json({ error: 'Callback payload too large' }, { status: 413 })
    }
    throw error
  }

  // 2. RESOLVE THE CONNECTOR FROM THE PATH. Unlike the token route, the verifier
  //    cannot come from the row here — the row is what we are still looking for.
  //    Taking it from the PATH rather than the body is what keeps the choice out
  //    of the caller's payload: the URL an operator pasted into their provider
  //    settings decides which signature scheme must be satisfied.
  const connector = getExternalAgentConnector(connectorId)
  if (!connector) {
    // 404, not 503. On the token route a missing connector means a KNOWN run
    // cannot be verified, so the provider is asked to retry. Here nothing has
    // been identified at all, and answering differently would turn this route
    // into a probe for which connector packages a deployment runs.
    logger.warn('external connector callback for an unknown connector', { connectorId })
    return NextResponse.json(NOT_FOUND_BODY, { status: 404 })
  }
  if (typeof connector.extractExternalRunId !== 'function') {
    // The connector exists but is TOKEN-ADDRESSED: it never opted in to
    // self-addressing, so it has no way to say which run a payload belongs to
    // and this entry point is not its. Same 404 body, for the same reason.
    logger.warn('external connector callback for a connector that cannot self-address', {
      connectorId,
    })
    return NextResponse.json(NOT_FOUND_BODY, { status: 404 })
  }

  // 3. PARSE A COPY, ONLY TO FIND THE ADDRESS. The one place this route must do
  //    what the token route refuses to do: parse before verifying. It is bounded
  //    (the body cap above), it is `JSON.parse` and nothing else, and its single
  //    consumer is a lookup key. `rawBody` is untouched and is what gets verified.
  let parsedBody: unknown
  try {
    parsedBody = rawBody.length ? JSON.parse(rawBody) : {}
  } catch {
    logger.warn('external connector callback carried a body that is not JSON', { connectorId })
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const externalRunId = extractExternalRunId(connector, parsedBody)
  if (!externalRunId) {
    // 400, not 404: the payload is well-formed JSON that this connector cannot
    // address at all — a provider sending a callback shape nobody correlated, or
    // an event type that carries no conversation id. It names a request defect,
    // not a missing run, and no row was searched for.
    logger.warn('external connector callback carried no addressable external run id', {
      connectorId,
    })
    return NextResponse.json({ error: 'Callback carries no external run id' }, { status: 400 })
  }

  // 4. CANDIDATES. Every status, not just `pending`: a redelivery for a run that
  //    is already settled must resolve to its row and be answered 200 by
  //    `completeExternalRun`'s single-shot claim, because a 404 would only make
  //    the provider retry a settled run forever.
  const em = (container.resolve('em') as EntityManager).fork()
  const candidates = (await findWithDecryption(
    em,
    AgentExternalRun,
    { connectorId, externalRunId },
    {
      fields: [
        'id',
        'tenantId',
        'organizationId',
        'runId',
        'agentId',
        'connectorId',
        'status',
        'processId',
        'stepId',
        'signalName',
        'createdAt',
      ],
      orderBy: { createdAt: 'DESC' },
      limit: CANDIDATE_LIMIT,
    },
  )) as unknown as CandidateRow[]

  if (!candidates.length) {
    logger.warn('external connector callback matched no correlation row', {
      connectorId,
      externalRunId,
    })
    return NextResponse.json(NOT_FOUND_BODY, { status: 404 })
  }
  if (candidates.length >= CANDIDATE_LIMIT) {
    logger.error('external connector callback candidate set hit its cap; a row may be unreachable', {
      connectorId,
      externalRunId,
      candidateCount: candidates.length,
    })
  }

  // 5. THE SIGNATURE DISAMBIGUATES. Each candidate is verified against its OWN
  //    tenant's secret and the first that verifies wins; at most one can, because
  //    the webhook secret is per-tenant. A connector that THROWS is treated
  //    exactly as one that returned false — an exception during verification is a
  //    failure to verify, never "probably fine" — and the loop moves on rather
  //    than aborting, so one tenant's broken credentials cannot deny another
  //    tenant's correctly signed callback.
  const verified = await findVerifiedCandidate(connector, req.headers, rawBody, candidates)
  if (!verified) {
    logger.warn('external connector callback failed verification against every candidate', {
      connectorId,
      externalRunId,
      candidateCount: candidates.length,
    })
    return NextResponse.json({ error: 'Callback verification failed' }, { status: 401 })
  }

  // 6. SCOPE COMES FROM THE ROW THAT VERIFIED. The single most important line in
  //    the file, and the same rule the token route states: the tenancy that
  //    authorises the settlement is the tenancy the runner wrote when it placed
  //    the call. A body claiming some other tenant is never consulted.
  const scope: ExternalAgentConnectorScope = {
    tenantId: verified.tenantId,
    organizationId: verified.organizationId,
  }

  // Now — and only now — the organization is a proven fact rather than a claim,
  // so its bucket can safely be charged.
  const orgLimited = await enforceOrganizationRateLimit(container, scope.organizationId)
  if (orgLimited) return orgLimited

  // 7. NORMALIZE. A connector that throws here cannot map this payload — a
  //    deterministic integration defect, so redelivering the same bytes will not
  //    help and leaving the row pending would park the workflow until the
  //    deadline. Settling it as a connector failure wakes the step down the
  //    `error` handle now (the token route's precedent).
  let settlement: ExternalRunSettlement
  try {
    settlement = { kind: 'result', payload: connector.normalize(parsedBody) }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.warn('connector could not normalize a verified external connector callback', {
      connectorId,
      externalRunRowId: verified.id,
      runId: verified.runId,
      error: reason,
    })
    settlement = {
      kind: 'failure',
      reason: `connector "${connectorId}" could not normalize its callback payload: ${reason}`,
    }
  }

  // 8. SETTLE — through the SAME `completeExternalRun` the token route and the
  //    deadline sweep use, unchanged. There is exactly one settlement path in
  //    this module, so the single-shot claim, the output guardrail and the resume
  //    cannot drift between entry points.
  const commandBus = container.resolve('commandBus') as CommandBus
  const result = await completeExternalRun({
    container,
    commandBus,
    row: {
      id: verified.id,
      tenantId: verified.tenantId,
      organizationId: verified.organizationId,
      runId: verified.runId,
      agentId: verified.agentId,
      connectorId: verified.connectorId,
      processId: verified.processId ?? null,
      stepId: verified.stepId ?? null,
      signalName: verified.signalName ?? null,
    },
    scope,
    settlement,
  })

  switch (result.status) {
    case 'scope_denied':
      // Unreachable: `scope` IS the verified row's own scope. Reported rather than
      // assumed, and answered with the SAME 404 an unknown id gets, so a
      // cross-tenant attempt is indistinguishable from a miss.
      logger.error('external connector callback resolved a row outside its own scope; refusing', {
        connectorId,
        externalRunRowId: verified.id,
        runId: verified.runId,
      })
      return NextResponse.json(NOT_FOUND_BODY, { status: 404 })
    case 'already_settled':
      // 200: redelivery is normal provider behaviour and the run is terminal.
      return NextResponse.json({ ok: true, status: result.status }, { status: 200 })
    case 'failed':
      // 200: the callback was accepted and the run IS settled, down the `error` or
      // `guardrailBlocked` handle. Nothing about it is a transport failure.
      return NextResponse.json({ ok: true, status: result.status }, { status: 200 })
    case 'completed':
      return NextResponse.json({ ok: true, status: result.status }, { status: 200 })
  }
}

/**
 * Ask the connector for the address, defensively.
 *
 * The extractor runs on UNVERIFIED input, so a connector that throws on a shape
 * it did not expect must not become a 500 on a public route — that is reported
 * as "not addressable" (400) like any other unusable payload. The id is trimmed
 * and length-capped before it can reach a query: the column is 200 characters,
 * so a longer value could only ever match nothing while making the database do
 * the work of proving it.
 */
function extractExternalRunId(connector: ExternalAgentConnector, parsedBody: unknown): string | null {
  let extracted: string | null
  try {
    extracted = connector.extractExternalRunId?.(parsedBody) ?? null
  } catch (error) {
    logger.warn('connector threw while extracting an external run id; treating as unaddressable', {
      connectorId: connector.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
  if (typeof extracted !== 'string') return null
  const trimmed = extracted.trim()
  if (!trimmed || trimmed.length > MAX_EXTERNAL_RUN_ID_LENGTH) return null
  return trimmed
}

/**
 * The first candidate whose own tenant's secret verifies the raw bytes.
 *
 * Pending rows are tried first. That is a COST optimisation and never a
 * correctness one: only one candidate can verify at all, so the order cannot
 * change which row settles — it only tends to reach it in one verification
 * instead of several, since a live run is the overwhelmingly likely target of an
 * inbound callback.
 */
async function findVerifiedCandidate(
  connector: ExternalAgentConnector,
  headers: Headers,
  rawBody: string,
  candidates: CandidateRow[],
): Promise<CandidateRow | null> {
  const ordered = [...candidates].sort((left, right) => {
    const leftPending = left.status === 'pending' ? 0 : 1
    const rightPending = right.status === 'pending' ? 0 : 1
    return leftPending - rightPending
  })

  for (const candidate of ordered) {
    const scope: ExternalAgentConnectorScope = {
      tenantId: candidate.tenantId,
      organizationId: candidate.organizationId,
    }
    try {
      // `rawBody` is passed straight through, byte-identical to what arrived.
      if (await connector.verifyCallback(headers, rawBody, scope)) return candidate
    } catch (error) {
      logger.warn('connector threw while verifying a candidate; treating as unverified', {
        connectorId: connector.id,
        externalRunRowId: candidate.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return null
}

async function enforceInboundRateLimits(
  container: { resolve: (name: string) => unknown },
  req: Request,
  connectorId: string,
): Promise<Response | null> {
  const rateLimiterService = tryResolve<RateLimiterService>(container, 'rateLimiterService')
  if (!rateLimiterService) return null

  const clientIp = getClientIp(req, rateLimiterService.trustProxyDepth)
  if (clientIp) {
    const ipLimited = await checkRateLimit(
      rateLimiterService,
      CALLBACK_IP_RATE_LIMIT,
      clientIp,
      RATE_LIMIT_ERROR_FALLBACK,
    )
    if (ipLimited) return ipLimited
  }

  return checkRateLimit(
    rateLimiterService,
    CALLBACK_CONNECTOR_RATE_LIMIT,
    connectorId,
    RATE_LIMIT_ERROR_FALLBACK,
  )
}

async function enforceOrganizationRateLimit(
  container: { resolve: (name: string) => unknown },
  organizationId: string,
): Promise<Response | null> {
  const rateLimiterService = tryResolve<RateLimiterService>(container, 'rateLimiterService')
  if (!rateLimiterService) return null
  return checkRateLimit(
    rateLimiterService,
    CALLBACK_ORG_RATE_LIMIT,
    organizationId,
    RATE_LIMIT_ERROR_FALLBACK,
  )
}

function resolveCallbackBodyLimitBytes(): number {
  const parsed = parseNumberWithDefault(
    process.env[CALLBACK_BODY_LIMIT_ENV],
    DEFAULT_CALLBACK_BODY_LIMIT_BYTES,
    { min: 1024, integer: true },
  )
  return Number.isSafeInteger(parsed) ? parsed : DEFAULT_CALLBACK_BODY_LIMIT_BYTES
}

function tryResolve<T>(container: { resolve: (name: string) => unknown }, name: string): T | null {
  try {
    return container.resolve(name) as T
  } catch {
    return null
  }
}

const callbackAcceptedSchema = z.object({
  ok: z.literal(true),
  status: z.enum(['completed', 'failed', 'already_settled']),
})
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'External agent run callback (connector-addressed)',
  methods: {
    POST: {
      summary: "Settle an external agent run from a provider's workspace-level webhook",
      description:
        'Unauthenticated machine-to-machine webhook with ONE stable URL per connector, for providers whose webhook destination is configured at the workspace level and which therefore cannot be handed a per-run callback URL. The connector named by the path extracts the provider run id from the payload; every correlation row holding that id is resolved and each is verified against its own tenant\'s secret, so the signature — the only credential on this route — is what decides tenancy. Tenant and organization scope come from the row that verified, never from the request. Idempotent: a redelivered callback returns 200 without settling or resuming a second time.',
      responses: [
        {
          status: 200,
          description:
            'Callback accepted. `status` is `completed` (run settled and the parked step resumed), `failed` (run settled as failed and routed down the error/guardrailBlocked handle) or `already_settled` (redelivery; nothing was changed or resumed).',
          schema: callbackAcceptedSchema,
        },
      ],
      errors: [
        {
          status: 400,
          description:
            'Body was not valid JSON, or the connector could not extract an external run id from it',
          schema: errorSchema,
        },
        {
          status: 401,
          description: 'No candidate run verified the provider signature',
          schema: errorSchema,
        },
        {
          status: 404,
          description:
            'Unknown connector, a connector that is not addressable this way, or no external run holds this provider id. Deliberately indistinguishable arms.',
          schema: errorSchema,
        },
        { status: 413, description: 'Callback payload exceeds the body limit', schema: errorSchema },
        { status: 429, description: 'Rate limit exceeded', schema: rateLimitErrorSchema },
      ],
    },
  },
}
