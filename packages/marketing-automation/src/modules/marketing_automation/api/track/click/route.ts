import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { enforceMarketingRateLimit, trackingRateLimitConfig } from '../../../lib/rate-limit.js'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import { recordTrackingEvent } from '../../../lib/tracking/record.js'
import { resolveTrackingSecret, resolveTrackingSecrets } from '../../../lib/tracking/secret.js'
import { isSafeRedirectTarget, verifyTrackingTokenWithAny } from '../../../lib/tracking/token.js'
import { TRACKING_TOKEN_PARAM } from '../../../lib/tracking/urls.js'

/**
 * The click redirect.
 *
 * PUBLIC, like the pixel, and authorised by the same signed token. The destination travels INSIDE
 * the signature, which is what keeps this from being an open redirect: a URL nobody signed cannot be
 * reached through it.
 */
const routeMetadata = {
  GET: { requireAuth: false },
}

export const metadata = routeMetadata

const logger = createLogger('marketing_automation')

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get(TRACKING_TOKEN_PARAM)
  const secret = resolveTrackingSecret()
  if (!token || !secret) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const claims = verifyTrackingTokenWithAny(token, resolveTrackingSecrets())
  if (!claims || claims.purpose !== 'click') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  // Signed by us is not the same as safe: the author wrote the link, and a `javascript:` href would
  // otherwise become a redirect that carries the shop's own domain in front of it.
  if (!isSafeRedirectTarget(claims.target)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const container = await createRequestContainer()
    /**
     * The limit guards the WRITE, not the redirect.
     *
     * Somebody clicked a link in an email and expects the page — the rule below — so a 429 here would break a
     * message already delivered, which cannot be fixed afterwards. What a flood actually costs is rows in
     * `marketing_message_send_events`, and skipping one is what the limit is for. Fail-open for the same
     * reason the pixel is.
     */
    const limited = await enforceMarketingRateLimit({
      req,
      container,
      config: trackingRateLimitConfig,
      namespace: 'marketing-track-click',
      credential: token,
      errorMessage: 'Too many requests',
      posture: 'fail-open',
    })
    if (!limited) {
      const em = container.resolve<EntityManager>('em')
      await recordTrackingEvent(em, claims, { type: 'clicked', linkUrl: claims.target, now: new Date() })
    }
  } catch (error) {
    // The redirect happens regardless. Somebody clicked a link in an email and expects the page, not
    // an apology about our statistics.
    logger.error('[internal] failed to record a marketing click', {
      campaignId: claims.campaignId,
      error: error instanceof Error ? error.message : String(error),
    })
    reportError(error, {
      module: 'marketing_automation',
      code: 'marketing_automation.track_click_failed',
      attributes: { campaignId: claims.campaignId },
    })
  }

  // 302, not 301: a permanent redirect would be cached by the browser and the second click on the
  // same link would never reach us.
  return NextResponse.redirect(claims.target as string, 302)
}

export const openApi = {
  GET: {
    summary: 'Marketing click redirect',
    description:
      'Records a click and redirects to the destination carried inside the signed token. Public. Not an open redirect: an unsigned or non-http(s) destination answers 404.',
    tags: ['Marketing Automation'],
    responses: { 302: { description: 'Redirect to the signed destination' }, 404: { description: 'Unusable token' } },
  },
}
