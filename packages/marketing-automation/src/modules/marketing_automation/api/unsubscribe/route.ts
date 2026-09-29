import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import { MarketingCampaignRun } from '../../data/entities.js'
import { recordConsent } from '../../lib/consent.js'
import { resolveTrackingSecret, resolveTrackingSecrets } from '../../lib/tracking/secret.js'
import { signTrackingToken, verifyTrackingTokenWithAny } from '../../lib/tracking/token.js'
import type { TrackingClaims } from '../../lib/tracking/token.js'
import { TRACKING_TOKEN_PARAM } from '../../lib/tracking/urls.js'

/**
 * One-click unsubscribe.
 *
 * PUBLIC, and it must be: the person using it has a message, not a session. Authorised solely by the
 * signed token, which carries the tenant, the organization, the campaign and the RUN — never the customer.
 * The customer is resolved from the run, so the link in the email identifies nobody even to somebody who
 * intercepts it.
 *
 * Answers HTML rather than JSON because a mail client opens it in a browser, and a person who has just
 * asked to be left alone should see a sentence confirming it rather than a JSON object.
 *
 * **GET changes nothing.** Every URL in an email gets fetched by things that are not the recipient: Outlook
 * SafeLinks, antivirus gateways, corporate proxies and chat unfurlers all follow links to inspect them. A GET
 * that unsubscribed meant a scanner could opt somebody out of mail they never chose to leave, silently, and
 * nothing in the trail would distinguish it from the person's own click. So GET asks, and POST acts.
 *
 * The one-click promise is kept where it is actually made: RFC 8058 clients POST, so their unsubscribe still
 * takes exactly one action and shows the person a confirmation afterwards rather than before.
 */
const routeMetadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
}

export const metadata = routeMetadata

const logger = createLogger('marketing_automation')

function page(title: string, body: string, status = 200): NextResponse {
  // Deliberately minimal and self-contained: no stylesheet to fetch, nothing to track, nothing to leak
  // through a referrer.
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title></head>`
    + `<body style="font-family:system-ui,sans-serif;margin:3rem auto;max-width:32rem;line-height:1.5;color:#111"><h1 style="font-size:1.25rem">${title}</h1><p>${body}</p></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )
}

/**
 * The page a person sees when they follow the link, with the button that does the work.
 *
 * The token is RE-MINTED from the verified claims rather than echoed out of the request: interpolating
 * request bytes into an HTML attribute is how the survey page acquired a reflected XSS, and a minted token is
 * a value we produced.
 */
function confirmPage(claims: TrackingClaims, secret: string): NextResponse {
  const token = encodeURIComponent(signTrackingToken(claims, secret))
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Unsubscribe</title></head>`
    + `<body style="font-family:system-ui,sans-serif;margin:3rem auto;max-width:32rem;line-height:1.5;color:#111">`
    + `<h1 style="font-size:1.25rem">Unsubscribe</h1>`
    + `<p>Confirm that you no longer want marketing email from us.</p>`
    + `<form method="post" action="?${TRACKING_TOKEN_PARAM}=${token}">`
    + `<p><button type="submit" style="font:inherit;padding:.5rem 1rem">Unsubscribe me</button></p>`
    + `</form>`
    + `</body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )
}

function readClaims(req: Request): { claims: TrackingClaims; secret: string } | null {
  const token = new URL(req.url).searchParams.get(TRACKING_TOKEN_PARAM)
  const secret = resolveTrackingSecret()
  if (!token || !secret) return null
  const claims = verifyTrackingTokenWithAny(token, resolveTrackingSecrets())
  // The purpose is signed, so an open or click token cannot be replayed here.
  if (!claims || claims.purpose !== 'unsubscribe') return null
  return { claims, secret }
}

async function handle(req: Request): Promise<NextResponse> {
  const verified = readClaims(req)
  if (!verified) {
    return page('This link is not valid', 'Please use the unsubscribe link from a recent message.', 400)
  }
  const { claims } = verified

  try {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const scope = { tenantId: claims.tenantId, organizationId: claims.organizationId }

    const run = await em.findOne(MarketingCampaignRun, { id: claims.runId, ...scope })
    if (!run?.subjectEntityId) {
      // The run is gone, so there is nobody to unsubscribe. Said plainly rather than pretending it worked:
      // a false confirmation is worse than an honest failure for a request like this one.
      return page('We could not find that subscription', 'The message this link came from is no longer on record. Please contact us and we will remove you.', 404)
    }

    await recordConsent(em, {
      scope,
      subjectEntityId: run.subjectEntityId,
      channel: 'email',
      state: 'unsubscribed',
      reason: 'one-click unsubscribe',
      source: 'customer',
      campaignId: claims.campaignId,
      now: new Date(),
    })
  } catch (error) {
    logger.error('[internal] marketing unsubscribe failed', {
      campaignId: claims.campaignId,
      error: error instanceof Error ? error.message : String(error),
    })
    reportError(error, {
      module: 'marketing_automation',
      code: 'marketing_automation.unsubscribe_failed',
      attributes: { campaignId: claims.campaignId },
    })
    // Never claim success we did not achieve: the person would stay subscribed believing otherwise.
    return page('Something went wrong', 'We could not record that just now. Please try again, or contact us and we will remove you.', 500)
  }

  return page('You have been unsubscribed', 'You will not receive marketing email from us again. It may take a moment to take effect for messages already on their way.')
}

/** Asks. A link scanner fetching this changes nothing, which is the entire reason it only asks. */
export async function GET(req: Request) {
  const verified = readClaims(req)
  if (!verified) {
    return page('This link is not valid', 'Please use the unsubscribe link from a recent message.', 400)
  }
  return confirmPage(verified.claims, verified.secret)
}

/** Acts — for the button on that page, and for mail clients that implement RFC 8058 one-click. */
export async function POST(req: Request) {
  return handle(req)
}

export const openApi = {
  GET: {
    summary: 'Ask to confirm an unsubscribe',
    description:
      'Answers a short HTML page with a button that POSTs. Deliberately changes nothing: link scanners, antivirus gateways and chat unfurlers fetch every URL in an email, and a GET that opted somebody out would let them do it on the recipient\'s behalf. Public, authorised only by the signed token, which names the run rather than the person.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The confirmation page' }, 400: { description: 'Unusable link' } },
  },
  POST: {
    summary: 'Unsubscribe',
    description:
      'Records a marketing opt-out for the customer behind the signed token. Used by the button on the GET page and by RFC 8058 one-click mail clients, whose single action still lands here.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Unsubscribed' }, 400: { description: 'Unusable link' }, 404: { description: 'No such subscription' } },
  },
}
