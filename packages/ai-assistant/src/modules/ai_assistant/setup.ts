import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

const PENDING_ACTION_CLEANUP_SCHEDULE_ID = 'ai_assistant:pending-action-cleanup'

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
  },
}

export default setup
