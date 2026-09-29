import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import { isValidNpsScore, recordSurveyAnswer } from '../../lib/survey.js'
import { resolveTrackingSecret } from '../../lib/tracking/secret.js'
import { signTrackingToken, verifyTrackingToken } from '../../lib/tracking/token.js'
import type { TrackingClaims } from '../../lib/tracking/token.js'
import { TRACKING_TOKEN_PARAM } from '../../lib/tracking/urls.js'

/**
 * Records an NPS answer from a link in an email.
 *
 * PUBLIC, authorised only by the signed token — the person answering has a message, not a session. The score
 * travels INSIDE the signature, so a recipient cannot change their own answer by editing the URL, and a
 * different score is a different link rather than a different parameter.
 *
 * **GET records nothing.** Every URL in an email is fetched by something that is not the recipient —
 * SafeLinks, antivirus gateways, proxies, chat unfurlers — and a GET that stored the score let any of them
 * invent an answer. That is worse here than an unsubscribe: the score is what `survey.nps <= 6` audiences
 * target, so a fabricated 9 hides a detractor and a fabricated 0 mails an apology to somebody who is happy.
 *
 * So GET shows the score back with a Send button, and POST records it along with whatever they typed. The
 * extra click costs an answer from somebody who closes the tab; it buys answers that are real, and it is the
 * SAME click that submits the comment — which the page already existed to collect, because the score is the
 * number and the sentence after it is usually where the value is.
 */
const routeMetadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
}

export const metadata = routeMetadata

const logger = createLogger('marketing_automation')
const MAX_COMMENT_LENGTH = 2000

function page(title: string, body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title></head>`
    + `<body style="font-family:system-ui,sans-serif;margin:3rem auto;max-width:32rem;line-height:1.5;color:#111">`
    + `<h1 style="font-size:1.25rem">${title}</h1>${body}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )
}

/**
 * The page that asks, showing the score the person picked and collecting the sentence after it.
 *
 * The token is RE-MINTED from the verified claims rather than echoed from the request. Echoing request bytes into
 * an HTML attribute was a reflected XSS: the signature is base64url, and a lenient decoder let a valid signature
 * be followed by `=` and arbitrary characters — including `"><svg onload=…>` — while still verifying. The
 * verifier now rejects that shape too, but this page must not depend on the verifier for its escaping: a minted
 * token is a value we produced, which is the only kind of value safe to interpolate.
 */
function confirmAnswer(claims: TrackingClaims, secret: string, score: number): NextResponse {
  const canonicalToken = encodeURIComponent(signTrackingToken(claims, secret))
  return page(
    'Thank you',
    // The score came out of the signed token and is validated as an NPS score, so it is a number, not input.
    `<p>You picked <strong>${score}</strong> out of 10.</p>`
    + `<form method="post" action="?${TRACKING_TOKEN_PARAM}=${canonicalToken}">`
    + `<p><label for="c">Anything you would like to add?</label></p>`
    + `<textarea id="c" name="comment" rows="4" maxlength="${MAX_COMMENT_LENGTH}" style="width:100%;font:inherit;padding:.5rem"></textarea>`
    + `<p><button type="submit" style="font:inherit;padding:.5rem 1rem">Send my answer</button></p>`
    + `</form>`,
  )
}

async function readComment(req: Request): Promise<string | null> {
  const type = req.headers.get('content-type') ?? ''
  try {
    if (type.includes('application/json')) {
      const body = await req.json() as { comment?: unknown }
      return typeof body?.comment === 'string' ? body.comment.slice(0, MAX_COMMENT_LENGTH) : null
    }
    const form = await req.formData()
    const value = form.get('comment')
    return typeof value === 'string' ? value.slice(0, MAX_COMMENT_LENGTH) : null
  } catch {
    return null
  }
}

type VerifiedAnswer = { claims: TrackingClaims; secret: string; score: number }

function readAnswer(req: Request): VerifiedAnswer | null {
  const token = new URL(req.url).searchParams.get(TRACKING_TOKEN_PARAM)
  const secret = resolveTrackingSecret()
  if (!token || !secret) return null

  const claims = verifyTrackingToken(token, secret)
  // The purpose is signed, so an open, click or unsubscribe token cannot be replayed as an answer.
  if (!claims || claims.purpose !== 'survey' || !isValidNpsScore(claims.target)) return null
  return { claims, secret, score: Number(claims.target) }
}

const UNUSABLE = () => page('This link is not valid', '<p>Please use the link from the message we sent you.</p>', 400)

async function handle(req: Request, comment: string | null): Promise<NextResponse> {
  const verified = readAnswer(req)
  if (!verified) return UNUSABLE()
  const { claims, score } = verified

  try {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const outcome = await recordSurveyAnswer(em, {
      scope: { tenantId: claims.tenantId, organizationId: claims.organizationId },
      runId: claims.runId,
      stepId: claims.stepId,
      score,
      comment: comment ?? undefined,
      now: new Date(),
    })

    if (outcome === 'unknown_prompt') {
      // Honest rather than reassuring: there is nothing to attach this answer to, and pretending otherwise
      // would leave somebody believing they had been heard.
      return page('We could not find that survey', '<p>The message this link came from is no longer on record.</p>', 404)
    }
  } catch (error) {
    logger.error('[internal] marketing survey answer failed', {
      campaignId: claims.campaignId,
      error: error instanceof Error ? error.message : String(error),
    })
    reportError(error, {
      module: 'marketing_automation',
      code: 'marketing_automation.survey_answer_failed',
      attributes: { campaignId: claims.campaignId },
    })
    return page('Something went wrong', '<p>We could not record that just now. Please try the link again.</p>', 500)
  }

  return page('Thank you', '<p>Your answer has been recorded.</p>')
}

/** Asks, and records nothing — see the note at the top about who else fetches a link in an email. */
export async function GET(req: Request) {
  const verified = readAnswer(req)
  if (!verified) return UNUSABLE()
  return confirmAnswer(verified.claims, verified.secret, verified.score)
}

/** Records the score and the comment together, in one action by the person who meant it. */
export async function POST(req: Request) {
  return handle(req, await readComment(req))
}

export const openApi = {
  GET: {
    summary: 'Show the NPS answer back for confirmation',
    description:
      'Answers a page showing the score carried inside the signed token, with a Send button and a comment box. Deliberately records nothing: link scanners and gateways fetch every URL in an email, and a GET that stored the score would let them fabricate one — which matters more here than elsewhere, because the score is what win-back audiences target.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The confirmation page' }, 400: { description: 'Unusable link' } },
  },
  POST: {
    summary: 'Record an NPS answer',
    description: 'Stores the signed score along with the optional comment. The score is inside the signature, so a recipient cannot change their answer by editing the URL.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Recorded' }, 400: { description: 'Unusable link' }, 404: { description: 'No such survey' } },
  },
}
