import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import { recordTrackingEvent } from '../../../lib/tracking/record.js'
import { resolveTrackingSecret, resolveTrackingSecrets } from '../../../lib/tracking/secret.js'
import { verifyTrackingTokenWithAny } from '../../../lib/tracking/token.js'
import { TRACKING_TOKEN_PARAM } from '../../../lib/tracking/urls.js'

/**
 * The open pixel.
 *
 * PUBLIC by necessity: it is fetched by a recipient's mail client, which has no session. The signed
 * token is the entire authorisation, and it carries the tenant and organization the write belongs to
 * because an unauthenticated request has no scope of its own.
 */
const routeMetadata = {
  GET: { requireAuth: false },
}

export const metadata = routeMetadata

const logger = createLogger('marketing_automation')

/** A 1×1 transparent GIF. Smaller than a PNG of the same thing and understood by every client. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

/**
 * Always the pixel, whatever happened.
 *
 * A broken image in somebody's inbox is a worse outcome than a lost statistic, and an error status
 * would also tell anybody probing the endpoint which tokens are real.
 */
function pixelResponse(): NextResponse {
  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      'content-type': 'image/gif',
      'content-length': String(PIXEL.length),
      // Without this, a proxy serves the pixel from cache and the second open is never recorded.
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      pragma: 'no-cache',
    },
  })
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get(TRACKING_TOKEN_PARAM)
  const secret = resolveTrackingSecret()
  if (!token || !secret) return pixelResponse()

  const claims = verifyTrackingTokenWithAny(token, resolveTrackingSecrets())
  if (!claims || claims.purpose !== 'open') return pixelResponse()

  try {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    await recordTrackingEvent(em, claims, { type: 'opened', now: new Date() })
  } catch (error) {
    // The pixel still goes out: the recipient must never see a broken image because our write failed.
    logger.error('[internal] failed to record a marketing open', {
      campaignId: claims.campaignId,
      error: error instanceof Error ? error.message : String(error),
    })
    reportError(error, {
      module: 'marketing_automation',
      code: 'marketing_automation.track_open_failed',
      attributes: { campaignId: claims.campaignId },
    })
  }

  return pixelResponse()
}

export const openApi = {
  GET: {
    summary: 'Marketing open pixel',
    description:
      'Records an email open. Public, authorised solely by a signed token that carries the campaign, run, step and scope — never the recipient. Always answers with a 1×1 GIF, whatever the token turned out to be.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'A 1×1 transparent GIF' } },
  },
}
