import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CommunicationChannel } from '../../../../data/entities'
import {
  COMMUNICATION_CHANNELS_QUEUES,
  getCommunicationChannelsQueue,
} from '../../../../lib/queue'
import {
  decodeGmailPubSubBody,
  getGmailPubSubVerifier,
  GmailPubSubJwtError,
} from '../../../../lib/gmail-pubsub-jwt'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readBoundedRequestBody, WebhookBodyTooLargeError } from '@open-mercato/shared/lib/webhooks'

const logger = createLogger('communication_channels').child({ component: 'gmail-webhook' })

/**
 * Spec C § Phase C2 — Gmail Pub/Sub push webhook.
 *
 * Auth model: NOT authenticated via the platform's session cookie. Pub/Sub
 * authenticates with a Google-signed JWT in the `Authorization: Bearer …`
 * header, which we verify against Google's public certs.
 *
 * Validation pipeline:
 *   1. Bound the raw request body before cryptographic work.
 *   2. Verify JWT signature, audience (`OM_GMAIL_PUBSUB_AUDIENCE`), and
 *      email claim (`OM_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL`).
 *   3. Decode the Pub/Sub envelope → `{ emailAddress, historyId }`.
 *   4. Look up every active Gmail channel matching `emailAddress`. Multiple
 *      tenants may have the same mailbox connected — we enqueue one sync
 *      job per matching channel (each tenant sees their own data).
 *   5. Return `204 No Content` even when no channels match — returning 4xx
 *      would cause Pub/Sub to retry forever on a permanently-orphaned
 *      registration.
 */
export const metadata = {
  path: '/communication_channels/webhooks/gmail',
  // Unauthenticated at the platform layer (a Google-signed JWT is the auth).
  // Rate-limited so a caller can't drive unbounded JWT-verification +
  // cert-fetch work before the signature gate rejects them.
  POST: { requireAuth: false, rateLimit: { points: 120, duration: 60, keyPrefix: 'cc_webhook_gmail' } },
}

type GmailHistorySyncJobPayload = {
  channelId: string
  scope: { tenantId: string; organizationId: string | null }
  notification: { emailAddress: string; historyId: string }
}

export async function POST(req: Request): Promise<Response> {
  const expectedAudience = process.env.OM_GMAIL_PUBSUB_AUDIENCE
  const expectedEmail = process.env.OM_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL
  if (!expectedAudience || !expectedEmail) {
    // Misconfiguration is operator-facing; log and 503 so Pub/Sub retries
    // briefly and the operator notices.
    logger.error('OM_GMAIL_PUBSUB_AUDIENCE / OM_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL not set')
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  let rawBody: string
  try {
    rawBody = await readBoundedRequestBody(req)
  } catch (error) {
    if (error instanceof WebhookBodyTooLargeError) {
      return NextResponse.json({ error: 'Webhook payload too large' }, { status: 413 })
    }
    return NextResponse.json({ error: 'unreadable_body' }, { status: 400 })
  }

  const verifier = getGmailPubSubVerifier()
  try {
    await verifier.verify({
      authorizationHeader: req.headers.get('authorization'),
      expectedAudience,
      expectedEmail,
    })
  } catch (err) {
    if (err instanceof GmailPubSubJwtError) {
      const status =
        err.code === 'wrong_audience' ? 403 :
        err.code === 'fetch_certs_failed' ? 503 :
        401
      return NextResponse.json({ error: err.code, message: err.message }, { status })
    }
    throw err
  }

  let payload: { emailAddress: string; historyId: string | number }
  try {
    payload = decodeGmailPubSubBody(rawBody)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'invalid_payload' },
      { status: 400 },
    )
  }

  // Channel lookup is intentionally NOT tenant-scoped here — we don't have a
  // tenant signal beyond the email address. We enumerate matching channels
  // across all tenants and enqueue one sync job per match. Each job carries
  // its own tenant scope, so downstream ingest stays tenant-isolated.
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const channels = await findWithDecryption(
    em,
    CommunicationChannel,
    {
      providerKey: 'gmail',
      externalIdentifier: payload.emailAddress,
      isActive: true,
      deletedAt: null,
    },
  )
  if (channels.length === 0) {
    // Return 204 anyway — see route header comment.
    return new NextResponse(null, { status: 204 })
  }

  const queue = getCommunicationChannelsQueue(
    COMMUNICATION_CHANNELS_QUEUES.gmailHistorySync,
  )
  for (const channel of channels) {
    const job: GmailHistorySyncJobPayload = {
      channelId: channel.id,
      scope: {
        tenantId: channel.tenantId,
        organizationId: channel.organizationId ?? null,
      },
      notification: {
        emailAddress: payload.emailAddress,
        historyId: String(payload.historyId),
      },
    }
    try {
      await queue.enqueue(job as unknown as Record<string, unknown>)
    } catch (err) {
      logger.error(
        'failed to enqueue history-sync for channel',
        { channelId: channel.id, err },
      )
    }
  }

  return new NextResponse(null, { status: 204 })
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    POST: {
      summary: 'Gmail Pub/Sub push notification webhook (Spec C § Phase C2)',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 204, description: 'Notification verified + history-sync job enqueued' },
        { status: 400, description: 'Body not a valid Pub/Sub envelope' },
        { status: 401, description: 'Invalid JWT or email claim' },
        { status: 403, description: 'Wrong audience' },
        { status: 413, description: 'Webhook payload too large' },
        { status: 503, description: 'Webhook not configured / Google certs unreachable' },
      ],
    },
  },
}

export default POST
