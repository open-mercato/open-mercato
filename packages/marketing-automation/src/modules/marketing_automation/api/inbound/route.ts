import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import { findPeopleByAddresses } from '@open-mercato/core/modules/customers/lib/findPeopleByAddresses'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { MarketingInboundHook } from '../../data/entities.js'
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

    hook.receivedCount += 1
    hook.lastReceivedAt = new Date()
    hook.lastOutcome = subjectEntityId
      ? 'identified'
      : payload.customerId || payload.email
        ? 'no matching customer'
        : 'no customerId or email in the payload'
    await em.flush()

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
async function resolveSubject(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  customerId: string | undefined,
  email: string | undefined,
): Promise<string | null> {
  if (customerId) {
    const found = await em.findOne(CustomerEntity, { id: customerId, ...scope, deletedAt: null })
    if (found) return found.id
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
