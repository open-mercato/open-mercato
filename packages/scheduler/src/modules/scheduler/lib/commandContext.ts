import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

const SCHEDULER_SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'

type ScheduledCommandContextSchedule = {
  id: string
  tenantId?: string | null
  organizationId?: string | null
  scopeType: 'system' | 'organization' | 'tenant'
  createdByUserId?: string | null
}

function buildScheduledCommandAuth(schedule: ScheduledCommandContextSchedule): Exclude<AuthContext, null> {
  const actorId = schedule.createdByUserId || SCHEDULER_SYSTEM_ACTOR_ID
  return {
    sub: actorId,
    userId: actorId,
    tenantId: schedule.tenantId ?? null,
    orgId: schedule.organizationId ?? null,
    isSuperAdmin: false,
  }
}

export function buildScheduledCommandContext(
  schedule: ScheduledCommandContextSchedule,
  container: AppContainer,
): CommandRuntimeContext {
  const tenantId = schedule.tenantId ?? null
  const organizationId = schedule.organizationId ?? null
  const organizationIds = organizationId ? [organizationId] : null

  return {
    container,
    auth: buildScheduledCommandAuth(schedule),
    organizationScope:
      schedule.scopeType === 'organization' && organizationId
        ? {
            selectedId: organizationId,
            filterIds: [organizationId],
            allowedIds: [organizationId],
            tenantId,
          }
        : {
            selectedId: null,
            filterIds: null,
            allowedIds: null,
            tenantId,
          },
    selectedOrganizationId: organizationId,
    organizationIds,
    request: undefined,
  }
}
