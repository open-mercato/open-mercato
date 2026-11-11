import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { enforceMarketingRateLimit, optOutRateLimitConfig } from '../../lib/rate-limit.js'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { reportError } from '@open-mercato/telemetry'
import { MarketingCampaignRun } from '../../data/entities.js'
import { escapeAttribute, escapeText } from '../../lib/html-escape.js'
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

/**
 * Deliberately minimal and self-contained: no stylesheet to fetch, nothing to track, nothing to leak through a
 * referrer — and now in the reader's own language rather than always in English.
 *
 * The locale comes from the browser (`resolveTranslations` reads `accept-language`), because the person is holding
 * one. Which language we EMAIL them in is a different decision they make in the preference centre. `lang` follows
 * it, so a screen reader does not announce Polish text as English.
 */
function page(locale: string, title: string, body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="${escapeAttribute(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeText(title)}</title></head>`
    + `<body style="font-family:system-ui,sans-serif;margin:3rem auto;max-width:32rem;line-height:1.5;color:#111"><h1 style="font-size:1.25rem">${escapeText(title)}</h1><p>${escapeText(body)}</p></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )
}

/** The one page whose body is a form rather than a sentence, so it composes its own markup. */
async function invalidLink(): Promise<NextResponse> {
  const { locale, t } = await resolveTranslations()
  return page(
    locale,
    t('marketing_automation.public.invalidTitle', 'This link is not valid'),
    t('marketing_automation.public.unsubscribe.invalidBody', 'Please use the unsubscribe link from a recent message.'),
    400,
  )
}

/**
 * The page a person sees when they follow the link, with the button that does the work.
 *
 * The token is RE-MINTED from the verified claims rather than echoed out of the request: interpolating
 * request bytes into an HTML attribute is how the survey page acquired a reflected XSS, and a minted token is
 * a value we produced.
 */
async function confirmPage(claims: TrackingClaims, secret: string): Promise<NextResponse> {
  const token = encodeURIComponent(signTrackingToken(claims, secret))
  const { locale, t } = await resolveTranslations()
  const title = t('marketing_automation.public.unsubscribe.title', 'Unsubscribe')
  return new NextResponse(
    `<!doctype html><html lang="${escapeAttribute(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeText(title)}</title></head>`
    + `<body style="font-family:system-ui,sans-serif;margin:3rem auto;max-width:32rem;line-height:1.5;color:#111">`
    + `<h1 style="font-size:1.25rem">${escapeText(title)}</h1>`
    + `<p>${escapeText(t('marketing_automation.public.unsubscribe.confirmBody', 'Confirm that you no longer want marketing email from us.'))}</p>`
    + `<form method="post" action="?${TRACKING_TOKEN_PARAM}=${token}">`
    + `<p><button type="submit" style="font:inherit;padding:.5rem 1rem">${escapeText(t('marketing_automation.public.unsubscribe.submit', 'Unsubscribe me'))}</button></p>`
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
  if (!verified) return invalidLink()
  const { claims } = verified

  const { locale, t } = await resolveTranslations()

  try {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const scope = { tenantId: claims.tenantId, organizationId: claims.organizationId }

    const run = await em.findOne(MarketingCampaignRun, { id: claims.runId, ...scope })
    if (!run?.subjectEntityId) {
      // The run is gone, so there is nobody to unsubscribe. Said plainly rather than pretending it worked:
      // a false confirmation is worse than an honest failure for a request like this one.
      return page(
        locale,
        t('marketing_automation.public.unsubscribe.notFoundTitle', 'We could not find that subscription'),
        t('marketing_automation.public.unsubscribe.notFoundBody', 'The message this link came from is no longer on record. Please contact us and we will remove you.'),
        404,
      )
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
    return page(
      locale,
      t('marketing_automation.public.errorTitle', 'Something went wrong'),
      t('marketing_automation.public.unsubscribe.errorBody', 'We could not record that just now. Please try again, or contact us and we will remove you.'),
      500,
    )
  }

  return page(
    locale,
    t('marketing_automation.public.unsubscribe.doneTitle', 'You have been unsubscribed'),
    t('marketing_automation.public.unsubscribe.doneBody', 'You will not receive marketing email from us again. It may take a moment to take effect for messages already on their way.'),
  )
}

/** Asks. A link scanner fetching this changes nothing, which is the entire reason it only asks. */
export async function GET(req: Request) {
  const verified = readClaims(req)
  if (!verified) return invalidLink()
  return confirmPage(verified.claims, verified.secret)
}

/**
 * Fail-closed, because this one changes something.
 *
 * The GET beside it deliberately changes nothing — link scanners and gateways fetch every URL in an email —
 * so the limit belongs on the action, where an unenforced one is worse than a rejected request. A person
 * does this once; anything beyond a handful a minute per link is not a person.
 */
async function enforceLimit(req: Request): Promise<NextResponse | null> {
  const container = await createRequestContainer()
  return enforceMarketingRateLimit({
    req,
    container,
    config: optOutRateLimitConfig,
    namespace: 'marketing-unsubscribe',
    credential: new URL(req.url).searchParams.get(TRACKING_TOKEN_PARAM),
    errorMessage: 'Too many requests',
    posture: 'fail-closed',
  })
}

/** Acts — for the button on that page, and for mail clients that implement RFC 8058 one-click. */
export async function POST(req: Request) {
  const limited = await enforceLimit(req)
  if (limited) return limited
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
