import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import { discordCredentialsSchema } from '../../lib/credentials'
import { DISCORD_MESSAGE_FLAG_EPHEMERAL } from '../../lib/discord-rest'
import type { DispatchableInteraction } from '../../lib/interactions-dispatch'
import {
  DEFAULT_INTERACTION_MESSAGES,
  resolveDiscordInteraction,
  screenInteractionRequest,
  type InteractionCandidate,
  type InteractionCandidateFilter,
} from '../../lib/interactions-handler'
import {
  getInteractionDispatchQueue,
  type InteractionDispatchJobPayload,
} from '../../lib/interactions-queue'
import { DiscordInteractionResponseType } from '../../lib/interactions-verify'

const logger = createLogger('channel_discord').child({ component: 'interactions-route' })

/**
 * Discord Interactions endpoint (slash commands, buttons, PING handshake).
 *
 * This is a **provider-owned** signed route — the resolution to the spec's one
 * "under negotiation" hub touch-point. Discord requires a *synchronous* PONG
 * (`{ type: 1 }`) on the initial PING, which the hub's generic
 * `api/post/webhook/[provider]` route cannot return (it 202-acks + enqueues). By
 * shipping this route from the provider package we serve the handshake without
 * changing the hub contract. Operators set the Interactions Endpoint URL to
 * `/api/channel_discord/interactions`.
 *
 * Auth model: unauthenticated at the platform layer — Ed25519 signature
 * verification IS the auth, and it is fail-closed (a tampered/missing signature
 * verifies against no candidate channel → 401).
 *
 * Timing model: Discord closes an interaction that is not answered within three
 * seconds, so a verified slash command / component press is answered with a
 * DEFERRED acknowledgement and handed to `workers/discord-interactions.ts`,
 * which does the two slow halves — writing the interaction into the hub's
 * inbound queue and replacing the "thinking…" placeholder with a real message.
 * The hand-off happens BEFORE the ack is returned, so a queue that cannot accept
 * the job downgrades the response to a visible error instead of promising a
 * follow-up nothing will send.
 */
export const metadata = {
  // Pinned explicitly: this URL is operator-facing — it goes into the Discord
  // application's Interactions Endpoint field — so it is part of this route's
  // contract rather than a by-product of where the file happens to sit. It is
  // the same path the folder derives, so the pin documents the contract instead
  // of overriding it.
  path: '/channel_discord/interactions',
  POST: {
    requireAuth: false,
    // Unauthenticated by design. Unsigned traffic is now rejected before any
    // candidate is loaded, so this bounds the residual case: a caller who does
    // present well-formed, fresh headers and drives the narrowed candidate load
    // repeatedly before the signature gate rejects them.
    rateLimit: { points: 120, duration: 60, keyPrefix: 'discord_interactions' },
  },
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text()
  const signatureHex = req.headers.get('x-signature-ed25519')
  const timestamp = req.headers.get('x-signature-timestamp')

  // Screened here as well as inside `resolveDiscordInteraction` so that unsigned,
  // malformed or stale traffic returns before the dictionary load below — this
  // route is unauthenticated, so everything decidable from the request alone
  // stays ahead of every other cost.
  const screened = screenInteractionRequest({ signatureHex, timestamp })
  if (screened) return NextResponse.json(screened.body, { status: screened.status })

  const { t } = await resolveTranslations()

  const result = await resolveDiscordInteraction({
    rawBody,
    signatureHex,
    timestamp,
    loadCandidates: loadInteractionCandidates,
    messages: {
      notDispatchable: t(
        'channel_discord.interactions.notDispatchable',
        DEFAULT_INTERACTION_MESSAGES.notDispatchable,
      ),
      unsupported: t('channel_discord.interactions.unsupported', DEFAULT_INTERACTION_MESSAGES.unsupported),
    },
  })

  // A deferred acknowledgement is a promise of a follow-up. Enqueue it BEFORE
  // answering: if the hand-off fails the user gets a visible error instead of a
  // "thinking…" state nothing will ever replace.
  if (result.dispatch && result.matchedChannel) {
    const enqueued = await enqueueInteractionDispatch(result.dispatch, result.matchedChannel)
    if (!enqueued) {
      return NextResponse.json(
        {
          type: DiscordInteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: t(
              'channel_discord.interactions.dispatchFailed',
              'Open Mercato could not record this interaction right now. Please try again in a moment.',
            ),
            flags: DISCORD_MESSAGE_FLAG_EPHEMERAL,
          },
        },
        { status: 200 },
      )
    }
  }

  return NextResponse.json(result.body, { status: result.status })
}

/**
 * Hand the verified interaction to the dispatch worker. Returns `false` when the
 * job could not be queued at all, which is the one case where the deferred ack
 * must be downgraded to a visible reply.
 */
async function enqueueInteractionDispatch(
  dispatch: DispatchableInteraction,
  channel: InteractionCandidate,
): Promise<boolean> {
  const payload: InteractionDispatchJobPayload = {
    channelId: channel.channelId,
    channelType: channel.channelType,
    tenantId: channel.tenantId,
    organizationId: channel.organizationId,
    credentialScope: channel.credentialScope,
    interaction: dispatch,
  }
  try {
    await getInteractionDispatchQueue().enqueue(payload as unknown as Record<string, unknown>)
    return true
  } catch (err) {
    logger.error('failed to enqueue discord interaction dispatch', { err, channelId: channel.channelId })
    return false
  }
}

type CredentialsServiceLike = {
  resolve: (
    integrationId: string,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<Record<string, unknown> | null>
}

async function loadInteractionCandidates(
  filter: InteractionCandidateFilter,
): Promise<InteractionCandidate[]> {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  let credentialsService: CredentialsServiceLike | null = null
  try {
    credentialsService = container.resolve<CredentialsServiceLike>('integrationCredentialsService')
  } catch {
    credentialsService = null
  }
  if (!credentialsService) return []

  const candidates: InteractionCandidate[] = []
  try {
    const rows = (await findWithDecryption(em, CommunicationChannel, {
      providerKey: 'discord',
      isActive: true,
      deletedAt: null,
    })) as CommunicationChannel[]

    // Credentials are resolved per (tenant, organization, user) scope, and a
    // tenant's Discord channels usually share one — cache within this request so
    // N channel rows do not become N decrypts of the same credential bag.
    const resolvedByScope = new Map<string, Record<string, unknown> | null>()

    for (const channel of rows) {
      if (!channel.credentialsRef) continue
      const organizationId = channel.organizationId ?? channel.tenantId
      const userId = channel.userId ?? null
      const scopeKey = `${channel.tenantId}|${organizationId}|${userId ?? ''}`
      if (!resolvedByScope.has(scopeKey)) {
        try {
          resolvedByScope.set(
            scopeKey,
            await credentialsService.resolve('channel_discord', {
              tenantId: channel.tenantId,
              organizationId,
              userId,
            }),
          )
        } catch {
          resolvedByScope.set(scopeKey, null)
        }
      }
      const parsed = discordCredentialsSchema.safeParse(resolvedByScope.get(scopeKey) ?? {})
      if (!parsed.success) continue
      // Narrowing only — the signature still decides. A body claiming an
      // application nobody here owns simply verifies against nothing.
      if (filter.applicationId && parsed.data.applicationId !== filter.applicationId) continue
      candidates.push({
        channelId: channel.id,
        channelType: channel.channelType,
        tenantId: channel.tenantId,
        organizationId: channel.organizationId ?? null,
        publicKey: parsed.data.publicKey,
        applicationId: parsed.data.applicationId,
        // The exact scope this row's credentials resolved under, so the worker
        // re-resolves the same bag instead of guessing — and no token travels.
        credentialScope: { tenantId: channel.tenantId, organizationId, userId },
      })
    }
  } catch (err) {
    logger.warn('failed to load discord interaction candidates', { err })
    return []
  }

  return candidates
}

export const openApi = {
  tags: ['ChannelDiscord'],
  summary: 'Discord Interactions endpoint (slash commands, buttons, PING handshake)',
  methods: {
    POST: {
      summary: 'Verify (Ed25519, fail-closed) and dispatch a Discord interaction',
      tags: ['ChannelDiscord'],
      responses: [
        {
          status: 200,
          description:
            'Verified interaction — PONG for the handshake, a deferred ack for a dispatched slash command / component / modal submission, an empty autocomplete result, or an ephemeral message when the interaction cannot be dispatched',
        },
        { status: 400, description: 'Verified but malformed interaction body' },
        { status: 401, description: 'Signature verification failed against every candidate channel, or the signed timestamp is outside the replay window' },
      ],
    },
  },
}
