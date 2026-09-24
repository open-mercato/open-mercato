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
import {
  IMPORT_HISTORY_MAX_EMPTY_PAGES,
  resolveImportHistoryPageBudget,
} from '../lib/import-history-limits'
import type { ChannelAdapterRegistry } from '../lib/registry'
import type {
  ChannelImportHistoryJobPayload,
} from '../commands/queue-import-history'
import type {
  ProgressService,
  ProgressServiceContext,
} from '../../progress/lib/progressService'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'channel-import-history' })

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

    // Guards against an adapter that claims `hasMore` forever. An empty page is
    // NOT a fault on its own — adapters legitimately drop every message on a
    // page (Gmail 404/410 between listing and fetching, server-side filters) —
    // so the hard stop is a cursor that stops advancing; the empty-page counter
    // and the page budget are backstops.
    const maxPages = resolveImportHistoryPageBudget(maxMessages)
    let consecutiveEmptyPages = 0
    let truncationReason: string | null = null
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      if (await progressService.isCancellationRequested(progressJobId, scope.tenantId, scope.organizationId)) {
        await progressService.markCancelled(progressJobId, progressContext)
        return
      }

      const requestedCursor = cursor
      const page = await adapter.importHistory!({
        credentials,
        scope: { tenantId: scope.tenantId, organizationId: scope.organizationId },
        sinceDays,
        contactEmails,
        maxMessages,
        cursor,
      })

      if (page.hasMore && page.nextCursor !== undefined && page.nextCursor === requestedCursor) {
        truncationReason = 'adapter repeated the same pagination cursor'
        break
      }

      if (page.messages.length === 0 && page.hasMore) {
        consecutiveEmptyPages += 1
        if (consecutiveEmptyPages >= IMPORT_HISTORY_MAX_EMPTY_PAGES) {
          truncationReason = `adapter returned no messages on ${consecutiveEmptyPages} consecutive pages`
          break
        }
      } else {
        consecutiveEmptyPages = 0
      }

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
          logger.warn('permanent ingest failure; skipping message', { channelId: channel.id, externalMessageId: message.externalMessageId, reason: classification.message })
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
      if (pageIndex === maxPages - 1) {
        truncationReason = `page budget of ${maxPages} exhausted while the adapter still reported more messages`
      }
    }

    if (truncationReason) {
      // Surfaced as a failed job on purpose: the operator must see that the
      // backlog is incomplete rather than a clean "imported N" summary.
      logger.warn('history import stopped early', { channelId: channel.id, reason: truncationReason, processedCount })
      await progressService.failJob(
        progressJobId,
        {
          errorMessage: `History import stopped early after ${processedCount} messages: ${truncationReason}`,
        },
        progressContext,
      )
      return
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
      logger.error('failed to mark progress job as failed', { progressJobId, err: failErr })
    }
    throw err
  }
}
