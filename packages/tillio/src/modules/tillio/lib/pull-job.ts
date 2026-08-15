import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type {
  NormalizedPhoneCall,
  NormalizedPhoneCallBatch,
} from '@open-mercato/shared/modules/phone_calls/types'
import type { PhoneCallProviderAdapter } from '@open-mercato/shared/modules/phone_calls/provider'
import type {
  ProgressService,
  ProgressServiceContext,
} from '@open-mercato/core/modules/progress/lib/progressService'
import {
  PHONE_CALLS_CALL_INGEST_COMMAND_ID,
  type IngestPhoneCallResult,
} from '@open-mercato/core/modules/phone_calls/commands/calls'
import { emitPhoneCallsEvent } from '@open-mercato/core/modules/phone_calls/events'
import { TILLIO_INTEGRATION_ID, TILLIO_PROVIDER_KEY } from '../integration'
import { tillioAdapter } from './adapter'
import { TillioApiError } from './errors'
import {
  classifyTillioError,
  isTillioEnvironmentHealthy,
  resolveEnvironment,
  type TillioResolvedEnvironment,
} from './operators'
import {
  readOperatorsBlob,
  type TillioCredentialsService,
  type TillioOperatorRecord,
} from './operators-store'
import { evaluatePullReadiness, type PullReadiness } from './pull-readiness'
import { zonedDayEnd, zonedDayStart } from './tz'

const logger = createLogger('tillio').child({ component: 'pull-job' })

export const TILLIO_PULL_JOB_TYPE = 'tillio.calls.pull'

// Only trips when the provider keeps advertising further pages, which would spin forever.
const MAX_BATCHES = 200

export type TillioPullScope = {
  tenantId: string
  organizationId: string
  userId?: string | null
}

// No operator token and no API key in the payload: the worker resolves credentials on every
// attempt, so a job replayed after a rotation uses the current ones instead of stale copies.
export type TillioPullJobPayload = {
  progressJobId: string
  scope: TillioPullScope
  from: string
  to: string
  cursor?: string | null
  limit?: number | null
}

export type TillioPullSummary = {
  fetched: number
  created: number
  updated: number
  failed: number
  batches: number
  cancelled: boolean
}

export type TillioPullContext = {
  readiness: PullReadiness
  environment: TillioResolvedEnvironment | null
  operator: TillioOperatorRecord | null
}

type IngestDeps = {
  commandBus: CommandBus
  commandContext: CommandRuntimeContext
  scope: IntegrationScope
}

type BatchCounts = Pick<TillioPullSummary, 'created' | 'updated' | 'failed'>

export async function resolvePullContext(
  credentialsService: TillioCredentialsService,
  em: EntityManager,
  scope: IntegrationScope,
): Promise<TillioPullContext> {
  const environment = await resolveEnvironment(credentialsService, scope)
  const environmentHealthy = environment ? await isTillioEnvironmentHealthy(em, scope) : false
  const blob = await readOperatorsBlob(credentialsService, scope)
  const operator =
    blob.operators.find((entry) => entry.id === blob.defaultOperatorId) ?? blob.operators[0] ?? null

  return {
    readiness: evaluatePullReadiness({ environment, environmentHealthy, operator }),
    environment,
    operator,
  }
}

function buildIngestInput(call: NormalizedPhoneCall, scope: IntegrationScope): Record<string, unknown> {
  return {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    providerKey: TILLIO_PROVIDER_KEY,
    integrationId: TILLIO_INTEGRATION_ID,
    externalCallId: call.externalCallId,
    externalConversationId: call.externalConversationId ?? null,
    direction: call.direction,
    status: call.status,
    participants: call.participants,
    recording: call.recording ?? null,
    startedAt: call.startedAt ?? null,
    answeredAt: call.answeredAt ?? null,
    endedAt: call.endedAt ?? null,
    durationSeconds: call.durationSeconds ?? null,
    providerFacts: call.providerFacts,
    rawPayload: call.rawPayload,
  }
}

function buildCommandContext(
  container: AwilixContainer,
  scope: IntegrationScope,
): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: {
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
      tenantId: scope.tenantId,
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

async function ingestBatch(calls: NormalizedPhoneCall[], deps: IngestDeps): Promise<BatchCounts> {
  const counts: BatchCounts = { created: 0, updated: 0, failed: 0 }

  for (const call of calls) {
    try {
      const executed = await deps.commandBus.execute<Record<string, unknown>, IngestPhoneCallResult>(
        PHONE_CALLS_CALL_INGEST_COMMAND_ID,
        { input: buildIngestInput(call, deps.scope), ctx: deps.commandContext },
      )
      if (executed.result.created) counts.created += 1
      else counts.updated += 1
    } catch (err) {
      // One transaction per call, so a single bad record only bumps `failed` and the rest of
      // the batch still lands.
      counts.failed += 1
      logger.warn('ingest failed for a pulled call', { externalCallId: call.externalCallId, err })
      await emitPhoneCallsEvent('phone_calls.call.ingest_failed', {
        providerKey: TILLIO_PROVIDER_KEY,
        externalCallId: call.externalCallId,
        organizationId: deps.scope.organizationId,
        tenantId: deps.scope.tenantId,
      }).catch(() => undefined)
    }
  }

  return counts
}

function describeFailure(err: unknown): string {
  if (err instanceof TillioApiError) return `${classifyTillioError(err)}: ${err.message}`
  if (err instanceof Error) return err.message
  return 'Tillio pull failed'
}

// Safe to retry: the ingest command keys on (providerKey, externalCallId) and updates in place,
// so a job the queue replays after a crash repeats work instead of duplicating rows.
export async function runTillioPullJob(params: {
  container: AwilixContainer
  payload: TillioPullJobPayload
  adapter?: PhoneCallProviderAdapter
}): Promise<TillioPullSummary> {
  const { container, payload } = params
  const adapter = params.adapter ?? tillioAdapter
  const scope: IntegrationScope = {
    organizationId: payload.scope.organizationId,
    tenantId: payload.scope.tenantId,
  }

  const progressService = container.resolve('progressService') as ProgressService
  const progressContext: ProgressServiceContext = {
    tenantId: payload.scope.tenantId,
    organizationId: payload.scope.organizationId,
    userId: payload.scope.userId ?? null,
  }
  const summary: TillioPullSummary = {
    fetched: 0,
    created: 0,
    updated: 0,
    failed: 0,
    batches: 0,
    cancelled: false,
  }

  await progressService.startJob(payload.progressJobId, progressContext)

  try {
    const credentialsService = container.resolve('integrationCredentialsService') as TillioCredentialsService
    const em = container.resolve('em') as EntityManager

    // Not trusted from enqueue time: credentials can rotate or the operator can be detached
    // while the job waits in the queue.
    const { readiness, environment, operator } = await resolvePullContext(credentialsService, em, scope)
    if (readiness.blocker || !environment || !operator) {
      await progressService.failJob(
        payload.progressJobId,
        { errorMessage: readiness.blocker ?? 'environment_not_ready' },
        progressContext,
      )
      return summary
    }

    const deps: IngestDeps = {
      commandBus: container.resolve('commandBus') as CommandBus,
      commandContext: buildCommandContext(container, scope),
      scope,
    }
    const credentials = {
      apiUrl: environment.apiUrl,
      apiKey: environment.apiKey,
      tenantSystemId: environment.tenantSystemId,
      timeZone: environment.timeZone,
      operator: {
        id: operator.id,
        plugin: operator.plugin,
        token: operator.token,
        tenantDomain: operator.tenantDomain,
      },
    }
    const fetchBatch = (cursor: string | null): Promise<NormalizedPhoneCallBatch> =>
      adapter.fetchCalls({
        credentials,
        scope,
        integrationId: TILLIO_INTEGRATION_ID,
        from: zonedDayStart(payload.from, environment.timeZone),
        to: zonedDayEnd(payload.to, environment.timeZone),
        cursor,
        limit: payload.limit ?? null,
      })

    let cursor = payload.cursor ?? null

    while (summary.batches < MAX_BATCHES) {
      const cancelled = await progressService.isCancellationRequested(
        payload.progressJobId,
        payload.scope.tenantId,
        payload.scope.organizationId,
      )
      if (cancelled) {
        summary.cancelled = true
        await progressService.markCancelled(payload.progressJobId, progressContext)
        return summary
      }

      const batch = await fetchBatch(cursor)
      const counts = await ingestBatch(batch.calls, deps)

      summary.batches += 1
      summary.fetched += batch.calls.length
      summary.created += counts.created
      summary.updated += counts.updated
      summary.failed += counts.failed

      // Tillio reports no range total, so the job carries a processed count without a total
      // and the top bar renders it without a percentage.
      await progressService.updateProgress(
        payload.progressJobId,
        { processedCount: summary.fetched },
        progressContext,
      )

      cursor = batch.nextCursor ?? null
      if (!cursor) break
    }

    await progressService.completeJob(
      payload.progressJobId,
      { resultSummary: { ...summary } },
      progressContext,
    )
    return summary
  } catch (err) {
    try {
      await progressService.failJob(
        payload.progressJobId,
        {
          errorMessage: describeFailure(err).slice(0, 2000),
          errorStack: err instanceof Error ? err.stack?.slice(0, 10000) : undefined,
        },
        progressContext,
      )
    } catch (failErr) {
      logger.error('failed to mark the pull progress job as failed', {
        progressJobId: payload.progressJobId,
        err: failErr,
      })
    }
    throw err
  }
}
