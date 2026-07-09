import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import {
  COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID,
  type IngestInboundMessageInput,
} from '../commands/ingest-inbound-message'
import { COMMUNICATION_CHANNELS_QUEUES } from '../lib/queue'
import { refreshCredentialsIfNeeded } from '../lib/credential-refresh'
import { classifyOutboundError } from '../lib/error-classification'
import type { ChannelAdapterRegistry } from '../lib/registry'
import type {
  ChannelImportHistoryJobPayload,
} from '../commands/queue-import-history'
import type {
  ProgressService,
  ProgressServiceContext,
} from '../../progress/lib/progressService'

/**
 * Spec B § Phase B6 — operator-triggered backlog import worker.
 *
 * Distinct from `poll-channel` (which runs every scheduler tick and ingests
 * *new* mail since the channel cursor). This worker reaches backward in time
 * by calling `adapter.importHistory` with explicit `sinceDays` / `contactEmails`
 * filters, paginating until the adapter signals `hasMore: false` or the
 * `maxMessages` cap is reached.
 *
 * Runs with `concurrency: 1` to avoid hammering the provider with multiple
 * historical sweeps in parallel; per-channel concurrency is additionally
 * enforced at enqueue time by `queueImportHistory`.
 */
export const metadata: WorkerMeta = {
  queue: COMMUNICATION_CHANNELS_QUEUES.importHistory,
  id: 'communication_channels:channel-import-history',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

type CredentialsServiceLike = {
  resolve: (
    integrationId: string,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<Record<string, unknown> | null>
  save?: (
    integrationId: string,
    credentials: Record<string, unknown>,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<void>
}

export default async function handle(
  job: QueuedJob<ChannelImportHistoryJobPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const payload = job.payload
  const { progressJobId, channelId, sinceDays, contactEmails, maxMessages, scope } = payload

  const progressService = ctx.resolve<ProgressService>('progressService')
  const progressContext: ProgressServiceContext = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }

  const em = (ctx.resolve('em') as EntityManager).fork()
  const adapterRegistry = ctx.resolve<ChannelAdapterRegistry>('channelAdapterRegistry')

  try {
    await progressService.startJob(progressJobId, progressContext)

    const channel = await findOneWithDecryption(
      em,
      CommunicationChannel,
      {
        id: channelId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    if (!channel) {
      await progressService.failJob(
        progressJobId,
        { errorMessage: 'Channel not found' },
        progressContext,
      )
      return
    }
    if (!channel.isActive || channel.status !== 'connected') {
      await progressService.failJob(
        progressJobId,
        { errorMessage: `Channel is not connected (status=${channel.status})` },
        progressContext,
      )
      return
    }

    const adapter = adapterRegistry?.get(channel.providerKey)
    if (!adapter || typeof adapter.importHistory !== 'function') {
      await progressService.failJob(
        progressJobId,
        {
          errorMessage: `Provider "${channel.providerKey}" does not support history import`,
        },
        progressContext,
      )
      return
    }

    // Resolve + refresh credentials. Same flow as poll-channel.
    let credentialsService: CredentialsServiceLike | null = null
    try {
      credentialsService = ctx.resolve<CredentialsServiceLike>('integrationCredentialsService')
    } catch {
      credentialsService = null
    }
    const credentialsScope = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: channel.userId ?? null,
    }
    let credentials: Record<string, unknown> = {}
    if (channel.credentialsRef && credentialsService) {
      try {
        credentials =
          (await credentialsService.resolve(`channel_${channel.providerKey}`, credentialsScope)) ?? {}
      } catch {
        credentials = {}
      }
    }
    const refreshed = await refreshCredentialsIfNeeded(
      { adapter, channelId: channel.id, credentials, scope: credentialsScope },
      { credentialsService },
    )
    credentials = refreshed.credentials

    const commandBus = ctx.resolve<CommandBus>('commandBus')
    const containerProxy = { resolve: ctx.resolve.bind(ctx) }
    const commandCtx = {
      container: containerProxy as never,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: scope.organizationId,
      organizationIds: [scope.organizationId],
    }

    let cursor: string | undefined
    let processedCount = 0
    let totalCount = maxMessages
    let firstPage = true

    // Bounded loop guards against a misbehaving adapter (infinite hasMore).
    // 100 pages * HARD_CAP (default 200) = 20k messages — far above the 5k cap
    // enforced by the schema, so this only trips on adapter bugs.
    const MAX_PAGES = 100
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
      if (await progressService.isCancellationRequested(progressJobId, scope.tenantId, scope.organizationId)) {
        await progressService.markCancelled(progressJobId, progressContext)
        return
      }

      const page = await adapter.importHistory!({
        credentials,
        scope: { tenantId: scope.tenantId, organizationId: scope.organizationId },
        sinceDays,
        contactEmails,
        maxMessages,
        cursor,
      })

      if (firstPage && typeof page.totalCandidates === 'number') {
        totalCount = Math.min(maxMessages, page.totalCandidates)
        await progressService.updateProgress(
          progressJobId,
          { totalCount, processedCount: 0 },
          progressContext,
        )
        firstPage = false
      }

      for (const message of page.messages) {
        if (processedCount >= maxMessages) break
        try {
          const input: IngestInboundMessageInput = {
            channelId: channel.id,
            providerKey: channel.providerKey,
            channelType: channel.channelType,
            scope: { tenantId: scope.tenantId, organizationId: scope.organizationId },
            message,
          }
          await commandBus.execute(COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID, {
            input,
            ctx: commandCtx as never,
          })
        } catch (err) {
          // Import-history is best-effort per-message. Same classification
          // logic as poll-channel: a transient failure aborts the whole job
          // (the operator can retry), permanent failures are logged and
          // skipped (the bad message would loop forever otherwise).
          const classification = classifyOutboundError(err)
          if (classification.transient) {
            throw err
          }
          console.warn(
            `[communication_channels:channel-import-history] permanent ingest failure on channel ${channel.id}; skipping message ${message.externalMessageId}. Reason: ${classification.message}`,
          )
        }
        processedCount += 1
      }

      await progressService.updateProgress(
        progressJobId,
        { processedCount, totalCount },
        progressContext,
      )

      if (processedCount >= maxMessages) break
      if (!page.hasMore || !page.nextCursor) break
      cursor = page.nextCursor
    }

    await progressService.completeJob(
      progressJobId,
      { resultSummary: { importedCount: processedCount, channelId } },
      progressContext,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import history job failed'
    const stack = err instanceof Error ? err.stack : undefined
    try {
      await progressService.failJob(
        progressJobId,
        { errorMessage: message.slice(0, 2000), errorStack: stack?.slice(0, 10000) },
        progressContext,
      )
    } catch (failErr) {
      console.error(
        `[communication_channels:channel-import-history] failed to mark progress job ${progressJobId} as failed: ${
          failErr instanceof Error ? failErr.message : String(failErr)
        }`,
      )
    }
    throw err
  }
}
