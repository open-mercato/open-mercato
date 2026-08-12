/**
 * The provider's post-call webhook (external-agent-invocation design §5.5; risk
 * R3; tracker task 2.6) — the ONE publicly reachable, unauthenticated surface in
 * this module, and the thing that wakes a parked business process.
 *
 * `requireAuth: false` for the same reason `api/trace/ingest` carries it: there
 * is no user session behind a machine-to-machine callback. What replaces the
 * session is a pair of independent proofs, and BOTH must hold before anything is
 * settled:
 *
 *   1. **The token proves WHICH run.** A 256-bit single-use bearer minted by the
 *      runner and handed only to the provider. We never stored it — only its
 *      SHA-256 digest — so a dump of `agent_external_runs` yields nothing
 *      forgeable, and the digest is what addresses the row.
 *   2. **The signature proves WHO.** The connector named by that row verifies the
 *      provider's signature over the RAW body. Verification never happens here:
 *      only the provider's own package knows its scheme, and a route that tried
 *      to generalise it would settle on a check weaker than every provider's.
 *
 * Everything that follows derives from the ROW, never from the request: the
 * tenant, the organization, the connector, the agent, the parked step. A body
 * claiming a `tenant_id` is ignored entirely — that is precisely the forgery R3
 * describes, where a fabricated "the owner approved" transcript is settled
 * against somebody else's workflow.
 *
 * ORDER IS LOAD-BEARING and is the reason each step is numbered below. Rate limit
 * before reading; read raw before parsing; resolve the row before choosing a
 * verifier; verify before parsing; parse before normalizing; settle last.
 *
 * WHAT THIS ROUTE DOES NOT DO. It does not wire the mutation-guard registry, and
 * that is deliberate rather than overlooked — see `MUTATION GUARDS` below.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_ERROR_FALLBACK,
  rateLimitErrorSchema,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { readBoundedRequestBody, WebhookBodyTooLargeError } from '@open-mercato/shared/lib/webhooks'
import { AgentExternalRun } from '../../../../data/entities'
import { hashCallbackToken } from '../../../../lib/runtime/callbackToken'
import {
  completeExternalRun,
  type ExternalRunSettlement,
} from '../../../../lib/runtime/completeExternalRun'
import { getExternalAgentConnector } from '../../../../lib/runtime/externalConnectorRegistry'
import { agentOrchestratorTag } from '../../../openapi'

const logger = createLogger('agent_orchestrator').child({ component: 'external-run-callback' })

/**
 * MUTATION GUARDS — why this custom write route does not call
 * `runMutationGuards`, following `api/trace/ingest`, the module's only other
 * unauthenticated write route.
 *
 * The registry is the USER-authorization layer: `runMutationGuards` filters
 * guards by the caller's granted ACL features and hands each one a `userId`.
 * Here there is no user at all, so the contract could only be satisfied by
 * fabricating one — an empty `userFeatures` list (which filters out every gated
 * guard, leaving the "contract" running only its ungated subset) plus a `userId`
 * naming a principal that does not exist and about which no guard could reach a
 * meaningful decision.
 *
 * It would also be actively harmful. Guards read `input.requestHeaders`, and on
 * this route every header is third-party-supplied. `customers`' `optimistic-lock`
 * guard targets `'*'` and keys on a request header, so wiring the registry here
 * would let a provider's stray header turn a legitimate, correctly signed
 * settlement into a 409 — parking the workflow until the deadline sweep notices
 * half an hour later. A concurrency mechanism for human edits must not become an
 * availability bug on a machine path.
 *
 * The write path itself is NOT unguarded: `completeExternalRun` mutates
 * exclusively through Commands (`external_runs.claim` / `.settle`,
 * `runs.complete` / `runs.fail`), so command interceptors, audit logging and
 * column encryption all still apply, and the single-shot claim is enforced in SQL.
 */
export const metadata = {
  POST: { requireAuth: false },
}

type RouteContext = { params: Promise<{ token: string }> }

/**
 * Body cap: 8 MiB by default, overridable per deployment.
 *
 * The 1 MiB shared default (`resolveWebhookBodyLimitBytes`) is right for a JSON
 * event and wrong here: ElevenLabs' `post_call_audio` callback carries the whole
 * call recording as base64 mp3, and ten minutes at 32 kbps is ~2.4 MB of audio →
 * ~3.2 MB base64. 8 MiB clears that with headroom for a long transcript in the
 * same payload while still bounding what one unauthenticated request can make
 * this process buffer and HMAC. `readBoundedRequestBody` enforces it by
 * streaming — it rejects on the declared `content-length` and again on the
 * running byte count, so an oversized body is aborted mid-flight rather than
 * fully read and then measured.
 */
const DEFAULT_CALLBACK_BODY_LIMIT_BYTES = 8 * 1024 * 1024
const CALLBACK_BODY_LIMIT_ENV = 'OM_AGENT_EXTERNAL_CALLBACK_MAX_BODY_BYTES'

/**
 * A provider legitimately calls back once per run, twice if it redelivers. The
 * per-token budget is therefore generous by two orders of magnitude and still
 * closes signature-retry loops against one known token; the per-IP budget bounds
 * a spray of guessed tokens from one source.
 */
const CALLBACK_IP_RATE_LIMIT = {
  points: 60,
  duration: 60,
  keyPrefix: 'agent_orchestrator:external-callback:ip',
}
const CALLBACK_TOKEN_RATE_LIMIT = {
  points: 20,
  duration: 60,
  keyPrefix: 'agent_orchestrator:external-callback:token',
}

/**
 * The minted token is `xrun_` + 64 hex characters. This bound is deliberately far
 * looser than that — the route must not encode the minting format, or a future
 * change to it would 404 every live call — and exists only so a multi-megabyte
 * path segment cannot be hashed.
 */
const MAX_CALLBACK_TOKEN_LENGTH = 512

/**
 * One body for every "no such run" answer, whatever the reason. An unknown token,
 * a token whose row belongs to another tenant and a malformed token are
 * indistinguishable to the caller: nothing here reveals whether a tenant, a run
 * or an agent exists.
 */
const NOT_FOUND_BODY = { error: 'Not found' } as const

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  const { token } = await ctx.params

  // The plaintext token is the only credential on this route and it dies in this
  // function: it is never logged, never echoed into an error body, never used as
  // a cache or rate-limit key, and never persisted. Everything downstream refers
  // to the correlation row by id.
  if (!token || token.length > MAX_CALLBACK_TOKEN_LENGTH) {
    return NextResponse.json(NOT_FOUND_BODY, { status: 404 })
  }
  const callbackTokenHash = hashCallbackToken(token)

  const container = await createRequestContainer()

  // 0. RATE LIMIT FIRST, before the body is read and before the database is
  //    touched, so a flood costs a cache increment instead of an 8 MiB read plus
  //    a query. The token hash is available straight from the path, so nothing
  //    has to be parsed to get here.
  const rateLimited = await enforceCallbackRateLimits(container, req, callbackTokenHash)
  if (rateLimited) return rateLimited

  // 1. RAW BODY, AS TEXT, BOUNDED. Never parsed before verification: a signature
  //    covers the exact bytes that were sent (T2.9's ElevenLabs HMAC signs
  //    `${timestamp}.${rawBody}`), so a JSON round-trip through parse/stringify
  //    would silently break every digest — and parsing unverified input is itself
  //    attack surface.
  let rawBody: string
  try {
    rawBody = await readBoundedRequestBody(req, { maxBytes: resolveCallbackBodyLimitBytes() })
  } catch (error) {
    if (error instanceof WebhookBodyTooLargeError) {
      logger.warn('external run callback rejected: payload exceeds the body limit', {
        limitBytes: error.limitBytes,
      })
      return NextResponse.json({ error: 'Callback payload too large' }, { status: 413 })
    }
    throw error
  }

  // 2. RESOLVE THE ROW BY THE TOKEN'S DIGEST. `callback_token_hash` is unique and
  //    indexed, and deliberately not encrypted (T2.1) precisely so this lookup
  //    stays a single SQL equality on a one-way value.
  //
  //    TIMING: the comparison an attacker could hope to walk is done by Postgres
  //    over a SHA-256 digest, so a partial-prefix match reveals a property of the
  //    digest, not of the token — there is no incremental path from "my guess
  //    shares a leading byte" to the pre-image. The two rejection arms below do
  //    differ in work (404 skips verification, 401 performs one HMAC), which is an
  //    existence oracle for a token the caller already holds; that is not a
  //    capability, since holding the token IS the credential, and reaching the
  //    oracle for a token you do not hold means guessing one of 2^256 values
  //    through the per-IP limiter above.
  //
  //    Only the correlation columns are projected. The row's `request_payload` /
  //    `result_payload` / `failure_reason` are encrypted PII (a brief, a
  //    transcript); not selecting them means nothing to decrypt and no transcript
  //    materialised inside an unauthenticated request handler.
  const em = (container.resolve('em') as EntityManager).fork()
  const row = await findOneWithDecryption(
    em,
    AgentExternalRun,
    { callbackTokenHash },
    {
      fields: [
        'id',
        'tenantId',
        'organizationId',
        'runId',
        'agentId',
        'connectorId',
        'processId',
        'stepId',
        'signalName',
      ],
    },
  )
  if (!row) {
    // No identifying detail, in the log or the response: the token is a secret and
    // there is nothing else to name.
    logger.warn('external run callback rejected: no correlation row for the presented token')
    return NextResponse.json(NOT_FOUND_BODY, { status: 404 })
  }

  // 3. SCOPE COMES FROM THE ROW. This is the single most important line in the
  //    file. The tenancy that authorises the settlement is the tenancy the runner
  //    wrote when it placed the call — never a body field, never a header. A
  //    callback body claiming some other `tenant_id` is not rejected so much as
  //    never consulted.
  const scope = { tenantId: row.tenantId, organizationId: row.organizationId }
  // The same scope plus THIS request's container, for the two connector entry
  // points that may need to read the tenant's own credentials (the webhook secret
  // to verify with, and — for a connector configured per tenant — where the answer
  // sits in the payload). Kept as its own object so what reaches
  // `completeExternalRun` stays exactly the tenancy pair it already took.
  const callbackScope = { ...scope, container }

  // 4. THE VERIFIER COMES FROM THE ROW TOO. Reading the connector id from the body
  //    or a header would let a caller choose which signature check it must pass —
  //    pick the one connector whose scheme it can forge, and hand it another
  //    connector's run.
  const connector = getExternalAgentConnector(row.connectorId)
  if (!connector) {
    // A deployment problem (the provider package is absent, or its `di.ts` never
    // ran in this process), not a caller problem. 503 so the provider retries: the
    // row is untouched and still `pending`, so a redelivery after the deploy is
    // fixed settles normally, and the deadline sweep is the backstop if it is not.
    logger.error('external run callback cannot be verified; no connector is registered', {
      externalRunRowId: row.id,
      runId: row.runId,
      connectorId: row.connectorId,
    })
    return NextResponse.json({ error: 'Callback cannot be processed' }, { status: 503 })
  }

  // 5. VERIFY — the connector's job, never the route's (T2.2's interface rule, and
  //    the webhooks module's rule before it). A connector that throws is treated
  //    exactly as one that returned false: an exception during verification is a
  //    failure to verify, and must never fall through as "probably fine".
  let verified = false
  try {
    verified = await connector.verifyCallback(req.headers, rawBody, callbackScope)
  } catch (error) {
    logger.warn('connector threw while verifying an external run callback; treating as unverified', {
      externalRunRowId: row.id,
      runId: row.runId,
      connectorId: row.connectorId,
      error: error instanceof Error ? error.message : String(error),
    })
    verified = false
  }
  if (!verified) {
    logger.warn('external run callback failed connector verification', {
      externalRunRowId: row.id,
      runId: row.runId,
      agentId: row.agentId,
      connectorId: row.connectorId,
    })
    return NextResponse.json({ error: 'Callback verification failed' }, { status: 401 })
  }

  // 6. ONLY NOW IS THE BODY PARSED. Everything above ran on bytes.
  let parsedBody: unknown
  try {
    parsedBody = rawBody.length ? JSON.parse(rawBody) : {}
  } catch {
    // Signed but not JSON. The row stays `pending` so a redelivery can still
    // settle it, and the deadline sweep is the backstop.
    logger.warn('external run callback carried a verified but unparseable body', {
      externalRunRowId: row.id,
      runId: row.runId,
      connectorId: row.connectorId,
    })
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // 7. NORMALIZE. A connector that throws here cannot map this provider payload —
  //    a deterministic integration defect, so redelivering the same bytes will not
  //    help and leaving the row `pending` would park the workflow until the
  //    deadline. Reporting it as a connector failure settles the run now and wakes
  //    the step down the `error` handle, which is exactly the classification
  //    T2.4's `failure` arm exists for.
  let settlement: ExternalRunSettlement
  try {
    // Awaited: `normalize` may be asynchronous, because a connector configured per
    // tenant has to read a credential to know where the answer lives. A connector
    // that returns a plain value is unaffected, and a rejected promise lands in the
    // same catch a throw does.
    settlement = { kind: 'result', payload: await connector.normalize(parsedBody, callbackScope) }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.warn('connector could not normalize a verified external run callback', {
      externalRunRowId: row.id,
      runId: row.runId,
      connectorId: row.connectorId,
      error: reason,
    })
    settlement = {
      kind: 'failure',
      reason: `connector "${row.connectorId}" could not normalize its callback payload: ${reason}`,
    }
  }

  // 8. SETTLE. The row is passed as an explicit projection rather than the loaded
  //    entity, so it is visible at the call site that exactly these columns cross
  //    the boundary and no encrypted one does.
  const commandBus = container.resolve('commandBus') as CommandBus
  const result = await completeExternalRun({
    container,
    commandBus,
    row: {
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      runId: row.runId,
      agentId: row.agentId,
      connectorId: row.connectorId,
      processId: row.processId ?? null,
      stepId: row.stepId ?? null,
      signalName: row.signalName ?? null,
    },
    scope,
    settlement,
  })

  switch (result.status) {
    case 'scope_denied':
      // Unreachable: `scope` IS the row's own scope, four statements up. It is
      // reported rather than assumed because `completeExternalRun` also carries
      // both scope columns in its claim predicate, and a future caller — the
      // deadline sweep, an operator tool — could pass a scope that is not the
      // row's. Answered with the SAME 404 an unknown token gets, so a cross-tenant
      // attempt is indistinguishable from a miss.
      logger.error('external run callback resolved a row outside its own scope; refusing', {
        externalRunRowId: row.id,
        runId: row.runId,
      })
      return NextResponse.json(NOT_FOUND_BODY, { status: 404 })
    case 'already_settled':
      // 200, not an error status. Redelivery is normal provider behaviour, the run
      // is terminal and the workflow was resumed exactly once; answering non-2xx
      // would only make the provider retry a settled run.
      return NextResponse.json({ ok: true, status: result.status }, { status: 200 })
    case 'failed':
      // 200 as well: the callback was accepted and the run IS settled. The failure
      // is recorded on the run and routed down the `error` / `guardrailBlocked`
      // handle — it is not a transport failure, and asking the provider to retry
      // would achieve nothing.
      return NextResponse.json({ ok: true, status: result.status }, { status: 200 })
    case 'completed':
      return NextResponse.json({ ok: true, status: result.status }, { status: 200 })
  }
}

/**
 * Two buckets, because they stop two different things.
 *
 * The per-IP bucket bounds a spray of guessed tokens from one source — the only
 * way to probe for a valid token at all. It is SKIPPED when the deployment has
 * not declared a reverse-proxy depth, because `getClientIp` then returns null and
 * the alternative (a shared `'unknown'` bucket, as the carrier webhook route
 * uses) would let one attacker exhaust the budget every legitimate provider
 * shares.
 *
 * The per-token bucket bounds repeated attempts against ONE known token —
 * signature-retry loops, redelivery storms. It is keyed on the DIGEST, never the
 * token: rate-limit keys land in the shared cache, and the digest is already what
 * the database stores, so keying on it discloses nothing new. Per-token
 * granularity also means no run's budget can be exhausted by traffic aimed at
 * another.
 */
async function enforceCallbackRateLimits(
  container: { resolve: (name: string) => unknown },
  req: Request,
  callbackTokenHash: string,
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
    CALLBACK_TOKEN_RATE_LIMIT,
    callbackTokenHash,
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
  summary: 'External agent run callback',
  methods: {
    POST: {
      summary: 'Settle an external agent run from its provider callback',
      description:
        'Unauthenticated machine-to-machine webhook. The single-use path token addresses one agent_external_runs row by its SHA-256 digest; the connector named by that row verifies the provider signature over the raw body. Tenant and organization scope come from the row, never from the request. Idempotent: a redelivered callback returns 200 without settling or resuming a second time.',
      responses: [
        {
          status: 200,
          description:
            'Callback accepted. `status` is `completed` (run settled and the parked step resumed), `failed` (run settled as failed and routed down the error/guardrailBlocked handle) or `already_settled` (redelivery; nothing was changed or resumed).',
          schema: callbackAcceptedSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Verified body was not valid JSON', schema: errorSchema },
        {
          status: 401,
          description: 'Connector signature verification failed',
          schema: errorSchema,
        },
        {
          status: 404,
          description:
            'No pending external run addresses this token — unknown, malformed, or out of scope. Deliberately indistinguishable arms.',
          schema: errorSchema,
        },
        { status: 413, description: 'Callback payload exceeds the body limit', schema: errorSchema },
        { status: 429, description: 'Rate limit exceeded', schema: rateLimitErrorSchema },
        {
          status: 503,
          description: 'No connector is registered for this run in this process',
          schema: errorSchema,
        },
      ],
    },
  },
}
