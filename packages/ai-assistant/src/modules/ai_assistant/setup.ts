import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

const PENDING_ACTION_CLEANUP_SCHEDULE_ID = 'ai_assistant:pending-action-cleanup'
const TOKEN_USAGE_PRUNE_SCHEDULE_ID = 'ai_assistant:token-usage-prune'

/**
 * System-scoped recurring schedule: every 5 minutes, enqueue a job to the
 * `ai-pending-action-cleanup` queue so the worker can sweep rows whose TTL
 * elapsed without any confirm/cancel activity (Step 5.12). The schedule id
 * is stable and `scheduler.register()` is an upsert, so calling this from
 * every tenant bootstrap stays idempotent.
 */
async function ensurePendingActionCleanupSchedule(
  container: import('awilix').AwilixContainer | undefined,
): Promise<void> {
  if (!container) return
  let schedulerService:
    | {
        register: (registration: Record<string, unknown>) => Promise<void>
      }
    | undefined
  try {
    schedulerService = container.resolve('schedulerService')
  } catch {
    schedulerService = undefined
  }
  if (!schedulerService) return
  try {
    await schedulerService.register({
      id: PENDING_ACTION_CLEANUP_SCHEDULE_ID,
      name: 'AI pending-action cleanup',
      description:
        'Sweep pending AI mutation approvals whose TTL elapsed without confirm/cancel and flip them to expired.',
      scopeType: 'system',
      scheduleType: 'interval',
      scheduleValue: '5m',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: 'ai-pending-action-cleanup',
      targetPayload: {},
      sourceType: 'module',
      sourceModule: 'ai_assistant',
      isEnabled: true,
    })
  } catch (error) {
    console.warn(
      '[ai_assistant] Failed to register pending-action cleanup schedule:',
      error instanceof Error ? error.message : error,
    )
  }
}

/**
 * System-scoped daily schedule: enqueue a job to the `ai-token-usage-prune`
 * queue to prune events older than the retention window and reconcile the
 * daily rollup session counts.
 *
 * Phase 6.4 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
async function ensureTokenUsagePruneSchedule(
  container: import('awilix').AwilixContainer | undefined,
): Promise<void> {
  if (!container) return
  let schedulerService:
    | {
        register: (registration: Record<string, unknown>) => Promise<void>
      }
    | undefined
  try {
    schedulerService = container.resolve('schedulerService')
  } catch {
    schedulerService = undefined
  }
  if (!schedulerService) return
  try {
    await schedulerService.register({
      id: TOKEN_USAGE_PRUNE_SCHEDULE_ID,
      name: 'AI token-usage prune',
      description:
        'Delete ai_token_usage_events rows older than AI_TOKEN_USAGE_EVENTS_RETENTION_DAYS (default 90) and reconcile session_count on the daily rollup.',
      scopeType: 'system',
      scheduleType: 'interval',
      scheduleValue: '24h',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: 'ai-token-usage-prune',
      targetPayload: {},
      sourceType: 'module',
      sourceModule: 'ai_assistant',
      isEnabled: true,
    })
  } catch (error) {
    console.warn(
      '[ai_assistant] Failed to register token-usage prune schedule:',
      error instanceof Error ? error.message : error,
    )
  }
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: [
      'ai_assistant.view',
      'ai_assistant.settings.manage',
      'ai_assistant.mcp.serve',
      'ai_assistant.tools.list',
      'ai_assistant.mcp_servers.view',
      'ai_assistant.mcp_servers.manage',
    ],
    employee: ['ai_assistant.view'],
  },

  async seedDefaults({ container }) {
    await ensurePendingActionCleanupSchedule(container)
    await ensureTokenUsagePruneSchedule(container)
  },
}

export default setup
