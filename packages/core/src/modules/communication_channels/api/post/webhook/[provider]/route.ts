import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CommunicationChannel } from '../../../../data/entities'
import { getChannelAdapterRegistry } from '../../../../lib/adapter-registry-singleton'
import {
  COMMUNICATION_CHANNELS_QUEUES,
  getCommunicationChannelsQueue,
} from '../../../../lib/queue'
import type { InboundMessage } from '../../../../lib/adapter'
import type { InboundProcessorPayload } from '../../../../workers/inbound-processor'
import type { ReactionInboundJob } from '../../../../lib/reaction-processor-types'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'inbound-webhook' })

/**
 * Inbound webhook endpoint for the communication_channels hub.
 *
 * One endpoint per provider — provider key in the path. The hub iterates all
 * candidate `CommunicationChannel` rows for `(provider_key, is_active=true,
 * deleted_at IS NULL)` across tenants and asks each adapter to verify the
 * signature with that channel's credentials. The first successful verification
 * pins the request to that channel's tenant scope; we then enqueue an inbound
 * processor job and return 202.
 *
 * Fail-closed: if no candidate verifies, we return 401 — never 200. This mirrors
 * the per-tenant authentication model used by `shipping_carriers/api/webhook/[provider]`
 * and the security note in SPEC-045d §13.
 *
 * No auth required at the route level — signature verification IS the auth.
 */
export const metadata = {
  path: '/communication_channels/webhook/[provider]',
  POST: {
    requireAuth: false,
    // Unauthenticated by design (signature verification IS the auth), but the
    // handler fans out an O(N) cross-tenant candidate scan, so bound per-IP
    // request volume to limit abuse. Generous enough for real provider traffic;
    // the dedicated gmail route carries its own matching limits.
    rateLimit: { points: 120, duration: 60, keyPrefix: 'cc_webhook_inbound' },
  },
}

type RouteContext = {
  params: Promise<{ provider: string }> | { provider: string }
}

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const resolvedParams = await params
  const providerKey = resolvedParams.provider

  const registry = getChannelAdapterRegistry()
  const adapter = registry?.get(providerKey)
  if (!adapter) {
    return NextResponse.json(
      { error: `No ChannelAdapter for provider: ${providerKey}` },
      { status: 404 },
    )
  }

  const rawBody = await req.text()
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headers[key] = value
  })

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  type CredentialsServiceLike = {
    resolve: (
      providerOrIntegrationId: string,
      scope: { organizationId: string; tenantId: string; userId?: string | null },
    ) => Promise<Record<string, unknown> | null>
  }
  let credentialsService: CredentialsServiceLike | null = null
  try {
    credentialsService = container.resolve<CredentialsServiceLike>('integrationCredentialsService')
  } catch {
    credentialsService = null
  }

  try {
    // The webhook is unauthenticated. The TENANT MUST be derived from a channel whose
    // per-tenant credentials successfully verify the inbound signature — NEVER from
    // attacker-controlled payload headers or unsigned retries.
    const candidates = await findWithDecryption(
      em,
      CommunicationChannel,
      {
        providerKey,
        isActive: true,
        deletedAt: null,
      },
      { orderBy: { createdAt: 'desc' } },
    )

    let matchedChannel: CommunicationChannel | null = null
    let matchedScope: { tenantId: string; organizationId: string } | null = null
    let event: InboundMessage | null = null
    let lastVerificationError: unknown = null

    for (const candidate of candidates as CommunicationChannel[]) {
      const candidateScope = {
        tenantId: candidate.tenantId,
        organizationId: candidate.organizationId ?? candidate.tenantId,
      }
      // Per-user credential lookup: each candidate channel has its own user
      // and therefore its own credentials row. See review R2-C1 / N1.
      const credentialsLookupScope = {
        ...candidateScope,
        userId: candidate.userId ?? null,
      }
      let credentials: Record<string, unknown> = {}
      if (candidate.credentialsRef && credentialsService) {
        try {
          credentials =
            (await credentialsService.resolve(`channel_${providerKey}`, credentialsLookupScope)) ?? {}
        } catch {
          credentials = {}
        }
      }
      try {
        event = await adapter.verifyWebhook({
          rawBody,
          headers,
          credentials,
          scope: candidateScope,
        })
        matchedChannel = candidate
        matchedScope = candidateScope
        break
      } catch (error: unknown) {
        lastVerificationError = error
      }
    }

    if (!event || !matchedChannel || !matchedScope) {
      throw (
        lastVerificationError ?? new Error('Webhook verification failed: no matching channel')
      )
    }

    // Dispatch by event type:
    //   - 'message' (default) → inbound-processor (slice 2b)
    //   - 'reaction'           → reaction-processor (slice 2d)
    //   - 'status_update' / 'other' → 202 not handled (future slice)
    if (event.eventType === 'reaction') {
      if (typeof adapter.normalizeInboundReaction !== 'function') {
        return NextResponse.json(
          {
            received: true,
            queued: false,
            reason: `adapter '${providerKey}' does not implement normalizeInboundReaction`,
          },
          { status: 202 },
        )
      }
      const reactionEvent = await adapter.normalizeInboundReaction(event)
      const reactionJob: ReactionInboundJob = {
        kind: 'inbound',
        providerKey,
        channelId: matchedChannel.id,
        channelType: matchedChannel.channelType,
        event: reactionEvent,
        // Use the channel's REAL org (null when null), matching the poll and
        // dedicated gmail webhook path — `candidateScope` falls org
        // back to tenantId for credential/verify lookups, which must not leak
        // into the ingest scope (it would diverge dedup for null-org channels).
        scope: { tenantId: matchedScope.tenantId, organizationId: matchedChannel.organizationId ?? null },
        attempt: 1,
      }
      const reactionsQueue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.reactions)
      await reactionsQueue.enqueue(reactionJob as unknown as Record<string, unknown>)
      return NextResponse.json({ received: true, queued: true, kind: 'reaction' }, { status: 202 })
    }

    if (event.eventType && event.eventType !== 'message') {
      return NextResponse.json(
        {
          received: true,
          queued: false,
          reason: `event ${event.eventType} not yet handled`,
        },
        { status: 202 },
      )
    }

    const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.inbound)
    const jobPayload: InboundProcessorPayload = {
      providerKey,
      channelId: matchedChannel.id,
      channelType: matchedChannel.channelType,
      raw: event,
      // Ingest scope uses the channel's REAL org (null when null) so dedup matches
      // the poll + dedicated webhook paths; see the reaction branch above.
      scope: { tenantId: matchedScope.tenantId, organizationId: matchedChannel.organizationId ?? null },
    }
    await queue.enqueue(jobPayload as unknown as Record<string, unknown>)

    return NextResponse.json({ received: true, queued: true, kind: 'message' }, { status: 202 })
  } catch (error: unknown) {
    // Do not echo adapter/verification internals to an unauthenticated caller;
    // log the detail server-side and return a fixed, minimal message.
    logger.warn(
      'inbound webhook verification failed',
      { err: error },
    )
    return NextResponse.json({ error: 'verification_failed' }, { status: 401 })
  }
}

export const openApi = {
  tags: ['CommunicationChannels'],
  summary: 'Receive a communication channel webhook',
  methods: {
    POST: {
      summary: 'Process an inbound channel webhook (Slack, WhatsApp, Email, ...)',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 202, description: 'Webhook accepted for async processing' },
        { status: 401, description: 'Signature verification failed against every candidate channel' },
        { status: 404, description: 'Unknown provider' },
      ],
    },
  },
}
export default POST
