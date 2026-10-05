import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { enforceMarketingRateLimit, inboundRateLimitConfig } from '../../lib/rate-limit.js'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import { findPeopleByAddresses } from '@open-mercato/core/modules/customers/lib/findPeopleByAddresses'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { MarketingInboundHook } from '../../data/entities.js'
import { recordInboundRequest } from '../../lib/inbound-requests.js'
import { emitMarketingAutomationEvent } from '../../events.js'
import { resolveTrackingSecret, resolveTrackingSecrets } from '../../lib/tracking/secret.js'
import {
  INBOUND_TOKEN_PARAM,
  MAX_INBOUND_BODY_BYTES,
  readBoundedBody,
  readInboundPayload,
  verifyInboundTokenWithAny,
} from '../../lib/inbound.js'

/**
 * The inbound hook receiver.
 *
 * PUBLIC, authorised solely by the signed token in the query string — the caller is somebody else's
 * system, which has no session here. The token names a hook row; the hook names the campaign.
 *
 * **It answers the same thing to every caller that got past the signature.** Reporting whether the posted
 * address matched a customer would turn a leaked URL into an address-existence oracle for the shop's whole
 * customer list. What happened is recorded on the hook instead, where the admin screen shows it to somebody
 * who is logged in — that is where an integrator debugs.
 */
const routeMetadata = {
  POST: { requireAuth: false },
}

export const metadata = routeMetadata

const logger = createLogger('marketing_automation')

/** One answer, whatever happened after the signature verified. */
const ACCEPTED = { accepted: true } as const

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get(INBOUND_TOKEN_PARAM)

  /**
   * The tightest limit in the module, and fail-closed.
   *
   * Every accepted POST resolves an address through a bounded decrypt scan — the most expensive thing an
   * unauthenticated caller can ask this module to do — and a leaked hook URL was enough to spend it on
   * repeat. A partner posting a real event does so once per event, so the window is sized for a burst
   * rather than a stream, and an unenforced limit here is worse than a rejected delivery: the partner
   * retries, the scan does not come back.
   *
   * Keyed on the token as well as the address, so one hook being hammered cannot exhaust another's quota.
   */
  const limited = await enforceMarketingRateLimit({
    req,
    container: await createRequestContainer(),
    config: inboundRateLimitConfig,
    namespace: 'marketing-inbound',
    credential: token,
    errorMessage: 'Too many requests',
    posture: 'fail-closed',
  })
  if (limited) return limited
  const secret = resolveTrackingSecret()
  if (!token || !secret) return NextResponse.json({ error: 'Invalid hook' }, { status: 400 })

  const claims = verifyInboundTokenWithAny(token, resolveTrackingSecrets())
  if (!claims) return NextResponse.json({ error: 'Invalid hook' }, { status: 400 })

  /**
   * Bounded WHILE reading, not after.
   *
   * Refused rather than truncated: half a payload silently becomes a campaign acting on half the facts — and the
   * reading itself stops at the ceiling, because this endpoint is reachable by anybody holding a hook URL and a
   * check that runs once the body is already in memory has not limited anything.
   */
  const body = await readBoundedBody(req, MAX_INBOUND_BODY_BYTES)
  if (!body.ok) return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  const raw = body.text

  let parsedBody: unknown = {}
  if (raw.trim().length > 0) {
    try {
      parsedBody = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
  }
  const payload = readInboundPayload(parsedBody)
  if (!payload) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  try {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const scope = { tenantId: claims.tenantId, organizationId: claims.organizationId }

    const hook = await em.findOne(MarketingInboundHook, { id: claims.hookId, ...scope, deletedAt: null })
    // A revoked hook answers exactly like an unknown one: a caller whose URL was withdrawn learns only
    // that it no longer works, which is all they are owed.
    if (!hook || hook.revokedAt) return NextResponse.json({ error: 'Invalid hook' }, { status: 400 })

    const subjectEntityId = await resolveSubject(em, scope, payload.customerId, payload.email)

    /**
     * The counters are written WITHOUT touching `updated_at`, and atomically.
     *
     * Two reasons, and the second is the one that made revoking a hook impossible. Loading the entity and
     * flushing it runs the `onUpdate` hook, so every public POST advanced the optimistic-lock version — and
     * a hook receiving traffic therefore answered 409 to the admin trying to revoke it, for ever, because
     * the version they had read was stale before the form rendered. These three columns are telemetry about
     * the hook, not the content somebody is editing, so they are not what the lock is protecting.
     *
     * And `received_count = received_count + 1` in SQL rather than read-modify-write in memory: this is the
     * one endpoint in the module that genuinely runs concurrently with itself.
     */
    const outcome = subjectEntityId
      ? 'identified'
      : payload.customerId || payload.email
        ? 'no matching customer'
        : 'no customerId or email in the payload'
    await em.execute(
      `update marketing_inbound_hooks
          set received_count = received_count + 1,
              last_received_at = ?,
              last_outcome = ?
        where id = ? and tenant_id = ? and organization_id = ?`,
      [new Date(), outcome, hook.id, scope.tenantId, scope.organizationId],
    )

    /**
     * The request itself, body and all, so somebody can answer "what did they actually send".
     *
     * The three counters above say a request arrived and how it ended; they cannot settle an argument with a
     * partner who insists they posted the right thing. The same `outcome` vocabulary is reused rather than
     * invented, so the hook row and this log never describe one request two different ways.
     *
     * Wrapped on its own because this endpoint answers 202 to every verified caller: a logging failure must
     * not become a delivery failure, or the partner retries a request that was in fact accepted and the
     * campaign runs twice.
     */
    try {
      await recordInboundRequest(em, scope, {
        hookId: hook.id,
        subjectEntityId,
        outcome,
        body: parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)
          ? parsedBody as Record<string, unknown>
          : null,
        bodyBytes: Buffer.byteLength(raw, 'utf8'),
      })
    } catch (logError) {
      logger.warn('[internal] marketing: could not log an inbound request', { err: logError })
      reportError(logError)
    }

    if (!subjectEntityId) return NextResponse.json(ACCEPTED, { status: 202 })

    /**
     * Emitted rather than enrolled here.
     *
     * The subscriber path already applies the audience, the re-entry policy, the per-subject budget and
     * the duplicate guard keyed on this payload — so a redelivery of the same body inside the occurrence
     * window cannot start a second run, for free.
     */
    await emitMarketingAutomationEvent('marketing_automation.inbound.received', {
      entityId: subjectEntityId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      hookId: hook.id,
      hookName: hook.name,
      campaignId: hook.campaignId,
      /**
       * The hook names ONE campaign, and this is what makes that true at dispatch time.
       *
       * Without it the generic `inbound.received` event reached every enabled campaign triggered by it, so one
       * partner's URL fired everybody's inbound campaigns — contradicting this endpoint's own contract and
       * multiplying what a leaked URL can cause.
       */
      restrictToCampaignId: hook.campaignId,
      data: payload.data,
    }, { persistent: true })

    return NextResponse.json(ACCEPTED, { status: 202 })
  } catch (error) {
    logger.error('[internal] marketing inbound hook failed', {
      hookId: claims.hookId,
      error: error instanceof Error ? error.message : String(error),
    })
    reportError(error, { module: 'marketing_automation', code: 'marketing_automation.inbound_failed' })
    return NextResponse.json({ error: 'Could not accept the hook' }, { status: 500 })
  }
}

/**
 * Who the post is about.
 *
 * A `customerId` is checked against the tenant before it is trusted — it arrived over a public endpoint,
 * and a uuid from one tenant must not enrol anybody in another. An address is resolved through the
 * customers module's own helper, which handles the encrypted-column case that a `where primary_email = ?`
 * silently fails at.
 */
/** The shape `customer_entities.id` actually is. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolveSubject(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  customerId: string | undefined,
  email: string | undefined,
): Promise<string | null> {
  if (customerId) {
    /**
     * Shape-checked before it reaches a uuid column.
     *
     * `id` is `uuid`, so a malformed value made Postgres raise and the endpoint answered 500 — to a public
     * caller, for a field they got wrong, which also tells them more about the schema than a 202 does. An
     * unusable id is treated exactly like an absent one: fall through to the address, and let the hook's
     * recorded outcome say nobody matched.
     */
    if (UUID_PATTERN.test(customerId)) {
      const found = await em.findOne(CustomerEntity, { id: customerId, ...scope, deletedAt: null })
      if (found) return found.id
    }
  }
  if (email) {
    /**
     * Matching by address is BEST EFFORT, and a caller that can should send `customerId`.
     *
     * `primary_email` is encrypted with a random IV, so with tenant encryption on there is no `where
     * primary_email = ?` to run: the platform helper decrypts the most recent `MATCH_CANDIDATE_LIMIT` (500)
     * person rows and compares in memory. On an installation with more people than that, an older customer's
     * address will not be found — not a failure this module can fix from here, because a blind-index column
     * on `customer_entities` is a core change (platform issue #5515, and a roadmap proposal in the spec).
     *
     * What saves it from being silent: an unmatched address is recorded as the hook's outcome, which the
     * inbound-hooks screen shows to somebody who is logged in. The endpoint itself still answers 202, because
     * telling the caller would turn a leaked hook URL into an address-existence oracle.
     */
    const matches = await findPeopleByAddresses(em, [email], scope.tenantId, scope.organizationId)
    if (matches.length > 0) return matches[0].id
  }
  return null
}

export const openApi = {
  POST: {
    summary: 'Start a campaign from outside the platform',
    description:
      'Public, authorised by the signed token in the `t` query parameter. Identify the customer with `customerId` or `email`; every other field is exposed to the campaign as `trigger.*`. Always answers 202 once the signature verifies, so the endpoint cannot be used to probe which addresses exist — what happened is shown on the hook in the admin UI.',
    tags: ['Marketing Automation'],
    responses: {
      202: { description: 'Accepted' },
      400: { description: 'Unusable token, revoked hook, or malformed body' },
      413: { description: 'Body larger than the accepted limit' },
    },
  },
}
