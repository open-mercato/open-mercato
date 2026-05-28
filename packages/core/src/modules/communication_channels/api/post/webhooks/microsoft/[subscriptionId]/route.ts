import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  COMMUNICATION_CHANNELS_QUEUES,
  getCommunicationChannelsQueue,
} from '../../../../../lib/queue'
import { validateMicrosoftWebhookChannel } from '../../../../../lib/microsoft-webhook-channel'

/**
 * Spec C § Phase C3 — Microsoft Graph change notification webhook.
 *
 * Auth model: NOT authenticated via the platform's session cookie. Microsoft
 * authenticates by echoing a per-channel `clientState` nonce in every
 * notification; we constant-time compare against the value persisted
 * encrypted at rest on `CommunicationChannel.client_state_encrypted`.
 *
 * The route handles TWO distinct request shapes:
 *
 *   1. **Validation handshake** — sent once at `createSubscription` time.
 *      Query string contains `?validationToken=…`. Route returns the token
 *      verbatim with `Content-Type: text/plain` and `200 OK` within 10 s.
 *
 *   2. **Change notification** — JSON body `{ value: [{ subscriptionId,
 *      clientState, resource, changeType, ... }] }`. We verify clientState
 *      and enqueue one `microsoft-delta-sync` job per notification.
 */
export const metadata = {
  path: '/communication_channels/webhooks/microsoft/[subscriptionId]',
  POST: { requireAuth: false },
}

type RouteContext = {
  params: Promise<{ subscriptionId: string }> | { subscriptionId: string }
}

type MicrosoftDeltaSyncJobPayload = {
  channelId: string
  scope: { tenantId: string; organizationId: string | null }
  notification: { subscriptionId: string; changeType: string; resource: string }
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const { subscriptionId } = await context.params

  // Validation handshake — Microsoft sends a query-string validationToken
  // and expects the body to be echoed back as text/plain within 10s.
  const url = new URL(req.url)
  const validationToken = url.searchParams.get('validationToken')
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  // Change notification — verify + enqueue.
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'unreadable_body' }, { status: 400 })
  }

  let parsed: { value?: Array<Record<string, unknown>> }
  try {
    parsed = JSON.parse(rawBody) as { value?: Array<Record<string, unknown>> }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const notifications = Array.isArray(parsed.value) ? parsed.value : []
  if (notifications.length === 0) {
    return NextResponse.json({ error: 'no_notifications' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const validation = await validateMicrosoftWebhookChannel({
    em,
    pathToken: subscriptionId,
    events: notifications,
  })
  if (!validation.ok) {
    if (validation.error === 'channel_missing_client_state') {
      console.warn(`[microsoft-webhook] subscription ${subscriptionId}: missing clientStateEncrypted`)
    }
    return NextResponse.json({ error: validation.error }, { status: validation.status })
  }
  const matchedChannel = validation.resolution.channel

  const queue = getCommunicationChannelsQueue(
    COMMUNICATION_CHANNELS_QUEUES.microsoftDeltaSync,
  )
  for (const n of notifications) {
    const payload: MicrosoftDeltaSyncJobPayload = {
      channelId: matchedChannel.id,
      scope: {
        tenantId: matchedChannel.tenantId,
        organizationId: matchedChannel.organizationId ?? null,
      },
      notification: {
        subscriptionId:
          typeof n.subscriptionId === 'string'
            ? n.subscriptionId
            : (validation.resolution.expectedSubscriptionId ?? subscriptionId),
        changeType: typeof n.changeType === 'string' ? n.changeType : 'created',
        resource: typeof n.resource === 'string' ? n.resource : '',
      },
    }
    try {
      await queue.enqueue(payload as unknown as Record<string, unknown>)
    } catch (err) {
      console.error(
        `[microsoft-webhook] failed to enqueue delta-sync for channel ${matchedChannel.id}:`,
        err,
      )
    }
  }

  // 202 Accepted — Graph requires a 2xx within 30 s.
  return new NextResponse(null, { status: 202 })
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    POST: {
      summary: 'Microsoft Graph change-notification webhook (Spec C § Phase C3)',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 200, description: 'Validation handshake echoed' },
        { status: 202, description: 'Notification verified + delta-sync job enqueued' },
        { status: 400, description: 'Body not a valid notification batch' },
        { status: 401, description: 'clientState mismatch (potential tampering)' },
        { status: 410, description: 'Subscription not found — Graph should drop' },
      ],
    },
  },
}

export default POST
