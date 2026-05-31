import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { applyMicrosoftLifecycleEvent } from '../../../../../../commands/apply-microsoft-lifecycle'
import { validateMicrosoftWebhookChannel } from '../../../../../../lib/microsoft-webhook-channel'

/**
 * Spec C § Phase C3 — Microsoft Graph lifecycle webhook.
 *
 * Graph emits three lifecycle events on a subscription:
 *
 *   - `missed` — Graph dropped one or more change notifications (e.g. our
 *      webhook returned non-2xx, or there was a Graph-side blip). We respond
 *      by enqueuing a delta-sync to catch up.
 *
 *   - `reauthorizationRequired` — the user revoked OAuth, the access token's
 *      scopes were narrowed, or the subscription is about to expire and
 *      Graph wants a renew with a fresh token. We flip the channel to
 *      `status='requires_reauth'` so the operator sees a reconnect prompt.
 *
 *   - `subscriptionRemoved` — Graph dropped the subscription (e.g. after
 *      missing too many notifications, or after `reauthorizationRequired`
 *      went unanswered). We clear push status and let the polling fallback
 *      take over.
 *
 * Same auth model as the notification webhook: `clientState` constant-time
 * compare against the encrypted-at-rest value, plus validation handshake
 * on `?validationToken=…`.
 */
export const metadata = {
  path: '/communication_channels/webhooks/microsoft/[subscriptionId]/lifecycle',
  // Unauthenticated lifecycle callback; rate-limited like the notification route
  // so channel-resolution work cannot be driven by repeated unauthenticated hits.
  POST: {
    requireAuth: false,
    rateLimit: { points: 120, duration: 60, keyPrefix: 'cc_webhook_microsoft_lifecycle' },
  },
}

type RouteContext = {
  params: Promise<{ subscriptionId: string }> | { subscriptionId: string }
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const { subscriptionId } = await context.params

  const url = new URL(req.url)
  const validationToken = url.searchParams.get('validationToken')
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

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
  const events = Array.isArray(parsed.value) ? parsed.value : []
  if (events.length === 0) {
    return NextResponse.json({ error: 'no_events' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const validation = await validateMicrosoftWebhookChannel({
    em,
    pathToken: subscriptionId,
    events,
  })
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status })
  }
  const matched = validation.resolution.channel

  for (const evt of events) {
    const lifecycleEvent = typeof evt.lifecycleEvent === 'string' ? evt.lifecycleEvent : ''
    try {
      await applyMicrosoftLifecycleEvent({ em, channel: matched, lifecycleEvent })
    } catch (err) {
      console.error(
        `[microsoft-lifecycle] failed to handle ${lifecycleEvent} for channel ${matched.id}:`,
        err,
      )
    }
  }

  return new NextResponse(null, { status: 202 })
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    POST: {
      summary: 'Microsoft Graph subscription lifecycle webhook (Spec C § Phase C3)',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 200, description: 'Validation handshake echoed' },
        { status: 202, description: 'Lifecycle event handled' },
        { status: 401, description: 'clientState mismatch' },
        { status: 410, description: 'Subscription not found' },
      ],
    },
  },
}

export default POST
