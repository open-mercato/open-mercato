import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { loadConsentState, recordConsent } from '../../../lib/consent.js'
import { loadPreferenceSummary, saveContactPreference, MAX_PER_WEEK } from '../../../lib/preferences.js'
import { MAX_PAUSE_DAYS } from '../../../lib/engine/gates.js'

/**
 * The preference centre, for the recipient themselves.
 *
 * Authorised by the PORTAL session, and scoped to the customer that session is linked to — never to a
 * customer id in the request. A preference centre that took the subject from its input would let anybody
 * unsubscribe anybody, which is the one thing this page must not allow.
 *
 * Offers the middle ground consent does not have: "less often" and "not until then". That is the whole reason
 * it reduces unsubscribes — somebody who only wanted fewer emails has otherwise had to choose "none".
 */
const routeMetadata = {
  GET: { requireAuth: false },
  PUT: { requireAuth: false },
}

export const metadata = routeMetadata

const logger = createLogger('marketing_automation')

const bodySchema = z.object({
  /** `true` subscribes, `false` unsubscribes. Absent leaves consent as it is. */
  subscribed: z.boolean().optional(),
  /** Messages per week, or null for "no limit of mine". */
  maxPerWeek: z.number().int().min(1).max(MAX_PER_WEEK).nullable().optional(),
  /** Days to pause for, or null to resume now. */
  pauseDays: z.number().int().min(0).max(MAX_PAUSE_DAYS).nullable().optional(),
})

async function resolveSubject(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) }
  if (!auth.customerEntityId || !auth.tenantId || !auth.orgId) {
    return {
      error: NextResponse.json(
        { ok: false, error: 'This account is not linked to a customer record', code: 'marketing_automation.errors.portalNotLinked' },
        { status: 403 },
      ),
    }
  }
  return {
    subjectEntityId: auth.customerEntityId,
    // The portal session calls it `orgId`; every read and write in this module wants `organizationId`.
    scope: { tenantId: auth.tenantId, organizationId: auth.orgId },
  }
}

export async function GET(req: Request) {
  const resolved = await resolveSubject(req)
  if ('error' in resolved) return resolved.error
  const { subjectEntityId, scope } = resolved

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const [consent, preference] = await Promise.all([
    loadConsentState(em, subjectEntityId, scope, 'email'),
    loadPreferenceSummary(em, scope, subjectEntityId),
  ])

  return NextResponse.json({
    ok: true,
    /**
     * Null means nothing is on record, which this module treats as permitted — so the page can say "you are
     * subscribed" without claiming the customer ever said so.
     */
    consent,
    preference,
    limits: { maxPerWeek: MAX_PER_WEEK, maxPauseDays: MAX_PAUSE_DAYS },
  })
}

export async function PUT(req: Request) {
  const resolved = await resolveSubject(req)
  if ('error' in resolved) return resolved.error
  const { subjectEntityId, scope } = resolved

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      {
        ok: false,
        error: issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload',
        code: 'marketing_automation.validation.invalidPayload',
      },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const now = new Date()

  try {
    if (parsed.data.subscribed !== undefined) {
      /**
       * Recorded with source `customer`, which is what makes the consent provably first-party.
       *
       * The same append-only trail as a one-click unsubscribe: the state row is what the send gate reads, the
       * event row is the evidence of who said what and when.
       */
      await recordConsent(em, {
        scope,
        subjectEntityId,
        channel: 'email',
        state: parsed.data.subscribed ? 'subscribed' : 'unsubscribed',
        // `customer` is the consent vocabulary's word for "the person themselves said so", which is exactly
        // what a portal session proves — and reusing it keeps one source list rather than two.
        source: 'customer',
        now,
      })
    }

    const preference = (parsed.data.maxPerWeek !== undefined || parsed.data.pauseDays !== undefined)
      ? await saveContactPreference(
          em,
          scope,
          subjectEntityId,
          { maxPerWeek: parsed.data.maxPerWeek, pauseDays: parsed.data.pauseDays, source: 'portal' },
          now,
        )
      : null

    return NextResponse.json({
      ok: true,
      consent: await loadConsentState(em, subjectEntityId, scope, 'email'),
      preference: preference
        ? {
            maxPerWeek: preference.maxPerWeek,
            pausedUntil: preference.pausedUntil ? preference.pausedUntil.toISOString() : null,
            source: 'portal',
          }
        : await loadPreferenceSummary(em, scope, subjectEntityId),
    })
  } catch (error) {
    logger.error('[internal] marketing portal preference save failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    reportError(error, { module: 'marketing_automation', code: 'marketing_automation.portal_preference_failed' })
    return NextResponse.json(
      { ok: false, error: 'Could not save your preferences', code: 'marketing_automation.errors.preferenceSaveFailed' },
      { status: 500 },
    )
  }
}

export const openApi = {
  GET: {
    summary: 'The signed-in customer own marketing preferences',
    description: 'Portal session only, and always scoped to the customer that session is linked to — never to an id in the request.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Consent, preference and the limits the form should offer' }, 401: { description: 'No portal session' } },
  },
  PUT: {
    summary: 'Update the signed-in customer own marketing preferences',
    description:
      'Consent is recorded with source `portal` on the same append-only trail as a one-click unsubscribe. The frequency preference and the pause are the middle ground consent lacks, which is what makes this page reduce unsubscribes rather than collect them.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The stored preferences' }, 400: { description: 'Invalid payload' }, 401: { description: 'No portal session' } },
  },
}
