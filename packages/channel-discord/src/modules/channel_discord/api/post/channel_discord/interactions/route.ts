import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import { discordCredentialsSchema } from '../../../../lib/credentials'
import {
  handleDiscordInteraction,
  type InteractionCandidate,
} from '../../../../lib/interactions-handler'

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
  POST: {
    requireAuth: false,
    // Unauthenticated by design; bound per-IP volume so a caller can't drive the
    // O(N) candidate-verify fan-out unboundedly before the signature gate rejects.
    rateLimit: { points: 120, duration: 60, keyPrefix: 'discord_interactions' },
  },
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text()
  const signatureHex = req.headers.get('x-signature-ed25519')
  const timestamp = req.headers.get('x-signature-timestamp')

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  type CredentialsServiceLike = {
    resolve: (
      integrationId: string,
      scope: { organizationId: string; tenantId: string; userId?: string | null },
    ) => Promise<Record<string, unknown> | null>
  }
  let credentialsService: CredentialsServiceLike | null = null
  try {
    credentialsService = container.resolve<CredentialsServiceLike>('integrationCredentialsService')
  } catch {
    credentialsService = null
  }

  let candidates: InteractionCandidate[] = []
  try {
    const rows = (await findWithDecryption(em, CommunicationChannel, {
      providerKey: 'discord',
      isActive: true,
      deletedAt: null,
    })) as CommunicationChannel[]

    for (const channel of rows) {
      if (!channel.credentialsRef || !credentialsService) continue
      let credentials: Record<string, unknown> | null = null
      try {
        credentials = await credentialsService.resolve('channel_discord', {
          tenantId: channel.tenantId,
          organizationId: channel.organizationId ?? channel.tenantId,
          userId: channel.userId ?? null,
        })
      } catch {
        credentials = null
      }
      const parsed = discordCredentialsSchema.safeParse(credentials ?? {})
      if (!parsed.success) continue
      candidates.push({
        channelId: channel.id,
        tenantId: channel.tenantId,
        organizationId: channel.organizationId ?? null,
        publicKey: parsed.data.publicKey,
      })
    }
  } catch (err) {
    logger.warn('failed to load discord interaction candidates', { err })
    candidates = []
  }

  const result = handleDiscordInteraction({ rawBody, signatureHex, timestamp, candidates })
  return NextResponse.json(result.body, { status: result.status })
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
