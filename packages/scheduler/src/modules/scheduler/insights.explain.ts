import type { FilterQuery } from '@mikro-orm/core'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { defineExplainConfig } from '@open-mercato/shared/modules/insights/explain'
import type { ExplainCauseDetail, ExplainLoadContext, ExplainScope } from '@open-mercato/shared/modules/insights/explain'
import {
  normalizeExplainIds,
  resolveExplainDecryptionScope,
  resolveExplainOrganizationWhere,
  runExplainResolverSafely,
} from '@open-mercato/shared/modules/insights/helpers'
import { ScheduledJob } from './data/entities'

const TENANT_SCOPE_TYPE = 'tenant'

function buildScheduleVisibilityWhere(scope: ExplainScope, ids: string[]): FilterQuery<ScheduledJob> | null {
  const organizationWhere = resolveExplainOrganizationWhere(scope)
  if (!organizationWhere) return null
  const organizationBound: FilterQuery<ScheduledJob> = organizationWhere.organizationId
    ? { organizationId: organizationWhere.organizationId }
    : { organizationId: { $ne: null } }
  return {
    id: { $in: ids },
    tenantId: scope.tenantId,
    $or: [organizationBound, { organizationId: null, scopeType: TENANT_SCOPE_TYPE }],
  }
}

async function resolveScheduleCauses(ctx: ExplainLoadContext, ids: string[]): Promise<ExplainCauseDetail[]> {
  const scheduleIds = normalizeExplainIds(ids, { uuidOnly: true })
  if (scheduleIds.length === 0) return []
  const where = buildScheduleVisibilityWhere(ctx.scope, scheduleIds)
  if (!where) return []
  const schedules = await findWithDecryption(
    ctx.em,
    ScheduledJob,
    where,
    undefined,
    resolveExplainDecryptionScope(ctx.scope),
  )
  return schedules.map((schedule) => ({
    kind: 'schedule',
    id: schedule.id,
    label: schedule.name,
    href: schedule.deletedAt ? null : `/backend/config/scheduled-jobs/${encodeURIComponent(schedule.id)}`,
    organizationId: schedule.organizationId ?? null,
  }))
}

export const explainConfig = defineExplainConfig({
  version: 1,
  causeResolvers: [
    {
      kind: 'schedule',
      requiredFeatures: ['scheduler.jobs.view'],
      resolve: (ctx, ids) =>
        runExplainResolverSafely(
          { module: 'scheduler', code: 'scheduler.insights_cause_failed', kind: 'schedule' },
          () => resolveScheduleCauses(ctx, ids),
        ),
    },
  ],
})

export default explainConfig
