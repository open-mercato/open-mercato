import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const SCHEDULER_JOBS_PATH = '/api/scheduler/jobs'
export const SCHEDULER_TARGETS_PATH = '/api/scheduler/targets'
export const SCHEDULER_TRIGGER_PATH = '/api/scheduler/trigger'

/** Queue registered by the scheduler module's execute-schedule worker. */
export const SCHEDULER_EXECUTION_QUEUE = 'scheduler-execution'

export type SchedulerJob = {
  id: string
  name: string
  description: string | null
  scopeType: 'system' | 'organization' | 'tenant'
  organizationId: string | null
  tenantId: string | null
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone: string
  targetType: 'queue' | 'command'
  targetQueue: string | null
  targetCommand: string | null
  isEnabled: boolean
  createdAt: string | null
  updatedAt: string | null
}

export type CreateScheduleOverrides = {
  name?: string
  description?: string | null
  scopeType?: 'system' | 'organization' | 'tenant'
  scheduleType?: 'cron' | 'interval'
  scheduleValue?: string
  timezone?: string
  targetType?: 'queue' | 'command'
  targetQueue?: string
  targetCommand?: string
  targetPayload?: Record<string, unknown>
  isEnabled?: boolean
  sourceType?: 'user' | 'module'
}

let sequence = 0

/** Stable-ish unique label so concurrent fixtures never collide on name. */
export function uniqueScheduleName(prefix: string): string {
  sequence += 1
  return `${prefix} ${Date.now()}-${sequence}`
}

/**
 * Create an organization-scoped queue-target schedule via the API and return its id.
 * Org/tenant are derived server-side from the caller's auth context, so the caller
 * only needs an admin (or otherwise scheduler.jobs.manage) token.
 */
export async function createScheduleJob(
  request: APIRequestContext,
  token: string,
  overrides: CreateScheduleOverrides = {},
): Promise<string> {
  const targetType = overrides.targetType ?? 'queue'
  const data: Record<string, unknown> = {
    name: overrides.name ?? uniqueScheduleName('Integration Scheduler'),
    description: overrides.description ?? 'Created by scheduler integration tests',
    scopeType: overrides.scopeType ?? 'organization',
    scheduleType: overrides.scheduleType ?? 'interval',
    scheduleValue: overrides.scheduleValue ?? '15m',
    timezone: overrides.timezone ?? 'UTC',
    targetType,
    targetPayload: overrides.targetPayload ?? { source: 'integration-test' },
    isEnabled: overrides.isEnabled ?? true,
    sourceType: overrides.sourceType ?? 'user',
  }
  if (targetType === 'command') {
    data.targetCommand = overrides.targetCommand
  } else {
    data.targetQueue = overrides.targetQueue ?? SCHEDULER_EXECUTION_QUEUE
  }

  const response = await apiRequest(request, 'POST', SCHEDULER_JOBS_PATH, { token, data })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), 'POST /api/scheduler/jobs should return 201').toBe(201)
  const id = body?.id
  expect(typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id), 'create response should include a UUID id').toBe(true)
  return String(id)
}

/** Fetch a single schedule by id from the list endpoint; null when absent (e.g. soft-deleted). */
export async function getScheduleJobById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<SchedulerJob | null> {
  const response = await apiRequest(request, 'GET', `${SCHEDULER_JOBS_PATH}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), 'GET /api/scheduler/jobs?id should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: SchedulerJob[] }>(response)
  return (body?.items ?? []).find((item) => item.id === id) ?? null
}

/** Best-effort cleanup; swallows errors so teardown never masks the real assertion. */
export async function deleteScheduleJob(
  request: APIRequestContext,
  token: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  await apiRequest(request, 'DELETE', SCHEDULER_JOBS_PATH, { token, data: { id } }).catch(() => null)
}
