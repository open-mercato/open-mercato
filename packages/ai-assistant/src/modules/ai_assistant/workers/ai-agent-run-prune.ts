import { createLogger } from '@open-mercato/shared/lib/logger'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { AiAgentRun, AiAgentRunStep, AiAgentRunToolCall } from '../data/entities'
import { reportAiAssistantError } from '../lib/report-ai-assistant-error'

const logger = createLogger('ai_assistant')

/** Default retention window for the ai_agent_runs table (days). */
const DEFAULT_RETENTION_DAYS = 30
/** Batch size for delete operations to avoid long locks. */
const DELETE_BATCH_SIZE = 1_000

export const metadata: WorkerMeta = {
  queue: 'ai-agent-run-prune',
  id: 'ai_assistant:agent-run-prune',
  concurrency: 1,
}

export interface AgentRunPruneRunOptions {
  em: EntityManager
  /** Override for deterministic tests. Defaults to `new Date()`. */
  now?: Date
  /** Override retention days (default from env). */
  retentionDays?: number
  /** Override batch size (default 1000). */
  batchSize?: number
}

export interface AgentRunPruneSummary {
  runsDeleted: number
  stepsDeleted: number
  toolCallsDeleted: number
}

/**
 * Reads `AI_AGENT_RUNS_RETENTION_DAYS` env var (default 30). Invalid or
 * non-positive values fall back to the default.
 */
export function resolveAgentRunRetentionDays(): number {
  const raw = process.env.AI_AGENT_RUNS_RETENTION_DAYS
  if (!raw) return DEFAULT_RETENTION_DAYS
  const parsed = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS
}

function prunableRunsFilter(cutoff: Date): FilterQuery<AiAgentRun> {
  return {
    $or: [
      { createdAt: { $lt: cutoff } },
      { deletedAt: { $ne: null } },
    ],
  }
}

/**
 * Core logic for the agent-run prune worker. Exported for unit testing.
 *
 * Hard-deletes runs created before the retention cutoff and runs that were
 * soft-deleted (for example together with their conversation). Steps and tool
 * calls are removed by `run_id` before their runs because no ORM cascade
 * exists between these tables. Works in batches of `batchSize` runs.
 */
export async function runAgentRunPrune(
  options: AgentRunPruneRunOptions,
): Promise<AgentRunPruneSummary> {
  const now = options.now ?? new Date()
  const retentionDays = options.retentionDays ?? resolveAgentRunRetentionDays()
  const batchSize = options.batchSize ?? DELETE_BATCH_SIZE

  const cutoff = new Date(now)
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays)

  const summary: AgentRunPruneSummary = { runsDeleted: 0, stepsDeleted: 0, toolCallsDeleted: 0 }

  try {
    for (;;) {
      const batch = await findWithDecryption<AiAgentRun>(
        options.em,
        AiAgentRun,
        prunableRunsFilter(cutoff),
        { fields: ['id'], limit: batchSize },
      )
      const runIds = batch.map((run) => run.id)
      if (runIds.length === 0) break

      summary.toolCallsDeleted += await options.em.nativeDelete(AiAgentRunToolCall, {
        runId: { $in: runIds },
      })
      summary.stepsDeleted += await options.em.nativeDelete(AiAgentRunStep, {
        runId: { $in: runIds },
      })
      summary.runsDeleted += await options.em.nativeDelete(AiAgentRun, {
        id: { $in: runIds },
      })

      if (runIds.length < batchSize) break
    }
  } catch (error) {
    logger.error('Failed to prune agent runs', { err: error })
    reportAiAssistantError(error, 'ai_assistant.agent_run_prune_failed')
  }

  logger.info('Agent-run prune done', { ...summary, retentionDays })

  return summary
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  _job: QueuedJob,
  ctx: HandlerContext,
): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  await runAgentRunPrune({ em })
}
