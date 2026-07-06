import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  ProgressService,
  ProgressServiceContext,
} from '../../progress/lib/progressService'
import { CommunicationChannel } from '../data/entities'
import { getChannelAdapterRegistry } from '../lib/adapter-registry-singleton'
import { COMMUNICATION_CHANNELS_QUEUES, getCommunicationChannelsQueue } from '../lib/queue'

/**
 * Spec B § Phase B6 — operator-triggered backlog import.
 *
 * Validates the channel + adapter capability, creates a `ProgressJob`, then
 * enqueues a `channel-import-history` job. Returns the job id so the UI can
 * track progress via the existing ProgressTopBar.
 *
 * Concurrency guard: at most one in-flight import per channel — a second call
 * while the first is still running returns a 429 envelope via
 * `createCrudFormError`. The worker itself runs with `concurrency: 1` so a
 * dropped guard is still safe.
 */

export const queueImportHistorySchema = z.object({
  channelId: z.string().uuid(),
  sinceDays: z.number().int().min(1).max(365).default(30),
  contactEmails: z
    .array(z.string().email().max(255))
    .max(200)
    .optional(),
  maxMessages: z.number().int().min(1).max(5000).default(1000),
})

export type QueueImportHistoryInput = z.infer<typeof queueImportHistorySchema>

export interface QueueImportHistoryScope {
  tenantId: string
  organizationId: string
  userId?: string | null
}

export interface QueueImportHistoryResult {
  progressJobId: string
  totalCountHint: number
}

export const CHANNEL_IMPORT_HISTORY_JOB_TYPE = 'communication_channels.channel.import_history'

export interface ChannelImportHistoryJobPayload {
  progressJobId: string
  channelId: string
  sinceDays: number
  contactEmails?: string[]
  maxMessages: number
  scope: { tenantId: string; organizationId: string }
}

export async function queueImportHistory(params: {
  container: AwilixContainer
  scope: QueueImportHistoryScope
  input: QueueImportHistoryInput
}): Promise<QueueImportHistoryResult> {
  const input = queueImportHistorySchema.parse(params.input)
  const { container, scope } = params

  const em = (container.resolve('em') as EntityManager).fork()
  const dscope = { tenantId: scope.tenantId, organizationId: scope.organizationId }

  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: input.channelId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    dscope,
  )
  if (!channel) {
    throw createCrudFormError(
      'Channel not found',
      { channelId: 'Channel not found' },
      { status: 404 },
    )
  }
  if (!channel.isActive || channel.status !== 'connected') {
    // 409 (not 400): the request is well-formed but the channel is in a
    // conflicting state (requires_reauth / error / disconnected). The UI maps
    // this to the localized "reconnect first" flash; see spec § API Contracts.
    throw createCrudFormError(
      'Channel is not connected',
      { channelId: 'Channel must be connected to import history' },
      { status: 409 },
    )
  }

  // Adapter must declare `importHistory` — Gmail / IMAP adapters gain it
  // in Spec C. Other providers (chat, SMS) cannot do historical inbox sweeps.
  const adapter = getChannelAdapterRegistry().get(channel.providerKey)
  if (!adapter) {
    throw createCrudFormError(
      'Channel provider is not available',
      { channelId: `No adapter registered for provider "${channel.providerKey}"` },
      { status: 400 },
    )
  }
  if (typeof adapter.importHistory !== 'function') {
    throw createCrudFormError(
      'History import is not supported on this provider',
      { channelId: `Provider "${channel.providerKey}" does not support history import yet` },
      { status: 400 },
    )
  }

  const progressService = container.resolve('progressService') as ProgressService
  const progressContext: ProgressServiceContext = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: scope.userId ?? null,
  }

  // Concurrency guard (best-effort): refuse if another import is already
  // in-flight for the same channel. We can't query by meta in a portable way
  // without DB-specific JSON operators, so we scan the small active-jobs window.
  // This check and `createJob` below are NOT atomic — two near-simultaneous
  // requests for the same channel can both pass and enqueue. That is acceptable,
  // not corrupting: the import worker runs at concurrency 1 (duplicate jobs run
  // sequentially, never in parallel) and inbound ingest dedups by the
  // `(channel_id, external_message_id)` unique index, so the worst case is
  // wasted re-fetch work, never duplicate rows.
  const active = await progressService.getActiveJobs(progressContext)
  const conflict = active.find((job) => {
    if (job.jobType !== CHANNEL_IMPORT_HISTORY_JOB_TYPE) return false
    const meta = (job.meta ?? {}) as Record<string, unknown>
    return meta.channelId === channel.id
  })
  if (conflict) {
    throw createCrudFormError(
      'An import is already in progress for this channel',
      { channelId: 'Another history import is already running' },
      { status: 429 },
    )
  }

  const progressJob = await progressService.createJob(
    {
      jobType: CHANNEL_IMPORT_HISTORY_JOB_TYPE,
      name: `Import history: ${channel.displayName ?? channel.externalIdentifier ?? channel.providerKey}`,
      description: `Import up to ${input.maxMessages} messages from the last ${input.sinceDays} days`,
      totalCount: input.maxMessages,
      cancellable: true,
      meta: {
        channelId: channel.id,
        providerKey: channel.providerKey,
        sinceDays: input.sinceDays,
        contactEmailsCount: input.contactEmails?.length ?? 0,
        maxMessages: input.maxMessages,
      },
    },
    progressContext,
  )

  const payload: ChannelImportHistoryJobPayload = {
    progressJobId: progressJob.id,
    channelId: channel.id,
    sinceDays: input.sinceDays,
    contactEmails: input.contactEmails,
    maxMessages: input.maxMessages,
    scope: { tenantId: scope.tenantId, organizationId: scope.organizationId },
  }
  const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.importHistory)
  await queue.enqueue(payload as unknown as Record<string, unknown>)

  return { progressJobId: progressJob.id, totalCountHint: input.maxMessages }
}
