import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import { discordCredentialsSchema } from '../../../lib/credentials'
import {
  resolveDiscordInteraction,
  type InteractionCandidate,
  type InteractionCandidateFilter,
} from '../../../lib/interactions-handler'

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
 */
export const metadata = {
  // Pinned explicitly (the Gmail webhook route sets its path the same way):
  // module-scoped routes derive `/<moduleId>/<path-under-the-method-folder>`, so
  // the operator-facing URL below is part of this route's contract, not a
  // by-product of where the file happens to sit.
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

  // Nothing tenant-scoped is loaded here: `resolveDiscordInteraction` screens the
  // request first and only calls the loader below for a request that survives it,
  // so an unsigned, malformed or stale POST costs zero database round-trips and
  // zero credential decrypts.
  const result = await resolveDiscordInteraction({
    rawBody,
    signatureHex,
    timestamp,
    loadCandidates: loadInteractionCandidates,
  })
  return NextResponse.json(result.body, { status: result.status })
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
        tenantId: channel.tenantId,
        organizationId: channel.organizationId ?? null,
        publicKey: parsed.data.publicKey,
        applicationId: parsed.data.applicationId,
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
        { status: 200, description: 'Verified interaction — PONG or deferred ack' },
        { status: 400, description: 'Verified but malformed interaction body' },
        { status: 401, description: 'Signature verification failed against every candidate channel, or the signed timestamp is outside the replay window' },
      ],
    },
  },
}

export default POST
