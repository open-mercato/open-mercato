import type { QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  COMMUNICATION_CHANNELS_QUEUES,
  getCommunicationChannelsQueue,
} from '@open-mercato/core/modules/communication_channels/lib/queue'
import { parseDiscordCredentialsOrThrow } from '../lib/credentials'
import { getDiscordRestClient } from '../lib/discord-rest'
import {
  buildInteractionFollowUpContent,
  buildInteractionInboundJob,
  sendInteractionFollowUp,
  type DispatchableInteraction,
} from '../lib/interactions-dispatch'
import {
  CHANNEL_DISCORD_INTERACTIONS_QUEUE,
  type InteractionDispatchJobPayload,
} from '../lib/interactions-queue'

const logger = createLogger('channel_discord').child({ component: 'interactions-worker' })

/**
 * Discord interaction dispatch worker.
 *
 * WHY A WORKER: Discord gives the Interactions endpoint three seconds to answer,
 * and closes the interaction if it misses. So the route verifies the signature,
 * returns a deferred acknowledgement, and hands the rest here — where the two
 * slow halves can take as long as they need: writing the interaction into the
 * hub, and replacing the "thinking…" placeholder with a real message.
 *
 * The queue is the ORDINARY module queue, consumed by the app's standard worker
 * runner — unlike `channel_discord_gateway`, nothing has to be started by hand.
 *
 * IDEMPOTENCE: the hub dedups on `(channel_id, external_message_id)` and the
 * external id is the interaction snowflake, so a retry after a failed follow-up
 * re-enqueues the same inbound job harmlessly rather than duplicating the record.
 */
export const metadata: WorkerMeta = {
  queue: CHANNEL_DISCORD_INTERACTIONS_QUEUE,
  id: 'channel_discord:interactions',
  concurrency: 5,
}

type CredentialsServiceLike = {
  resolve: (
    integrationId: string,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<Record<string, unknown> | null>
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Translate the acknowledgement, falling back to each key's English default when
 * no dictionary is available — a worker process that never loaded the app's
 * modules must still send the user a readable answer rather than a translation
 * key. `resolveTranslations` is imported dynamically because it pulls in
 * `server-only`, which has no business in this module's static graph.
 */
async function resolveFollowUpContent(interaction: DispatchableInteraction): Promise<string> {
  try {
    const { resolveTranslations } = await import('@open-mercato/shared/lib/i18n/server')
    const { t } = await resolveTranslations()
    return buildInteractionFollowUpContent(interaction, t)
  } catch (err) {
    logger.debug('falling back to the untranslated interaction acknowledgement', { err })
    return buildInteractionFollowUpContent(interaction, createTranslator({}))
  }
}

export default async function handle(
  job: QueuedJob<InteractionDispatchJobPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const payload = job.payload
  if (!payload?.interaction) {
    logger.warn('interaction dispatch job carried no interaction — dropping')
    return
  }

  const { interaction } = payload

  const inboundJob = buildInteractionInboundJob({
    dispatch: interaction,
    channel: {
      channelId: payload.channelId,
      channelType: payload.channelType,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    },
  })
  if (inboundJob) {
    await getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.inbound).enqueue(
      inboundJob as unknown as Record<string, unknown>,
    )
    logger.debug('discord interaction enqueued to the hub inbound queue', {
      channelId: payload.channelId,
      interactionId: interaction.id,
      queue: COMMUNICATION_CHANNELS_QUEUES.inbound,
    })
  } else {
    logger.debug('discord interaction dropped — invoked by a bot', {
      channelId: payload.channelId,
      interactionId: interaction.id,
    })
  }

  let credentialsService: CredentialsServiceLike | null = null
  try {
    credentialsService = ctx.resolve<CredentialsServiceLike>('integrationCredentialsService')
  } catch {
    credentialsService = null
  }
  if (!credentialsService) {
    logger.warn('integrationCredentialsService unavailable — cannot acknowledge the interaction', {
      channelId: payload.channelId,
    })
    return
  }

  const credentials = await credentialsService.resolve('channel_discord', {
    tenantId: payload.credentialScope.tenantId,
    organizationId: payload.credentialScope.organizationId,
    userId: payload.credentialScope.userId,
  })
  if (!credentials) {
    logger.warn('no Discord credentials for the interaction channel — cannot acknowledge', {
      channelId: payload.channelId,
    })
    return
  }
  const parsed = parseDiscordCredentialsOrThrow(credentials)
  if (parsed.applicationId !== interaction.applicationId) {
    // The interaction verified against this channel's public key, so the two
    // ought to agree. When they do not the credential bag has drifted from the
    // application that actually signed, and following up under the stored id
    // would 401 — say so once rather than retrying blindly.
    logger.warn('interaction application id does not match the stored credentials', {
      channelId: payload.channelId,
      interactionId: interaction.id,
    })
  }

  const delivery = await sendInteractionFollowUp(getDiscordRestClient(), {
    // Addressed with the application the interaction itself carries: the whole
    // body is Ed25519-signed, so this value is as verified as the channel match.
    applicationId: interaction.applicationId,
    interactionToken: interaction.token,
    content: await resolveFollowUpContent(interaction),
    ephemeral: true,
  })

  logger.info('discord interaction acknowledged', {
    channelId: payload.channelId,
    interactionId: interaction.id,
    interactionType: interaction.type,
    delivery,
  })
}
