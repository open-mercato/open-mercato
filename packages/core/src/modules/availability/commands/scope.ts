import type { FilterQuery } from '@mikro-orm/core'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { buildScopedWhere } from '@open-mercato/shared/lib/api/crud'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'

type AvailabilityPolicyScopedRecord = { organizationId: string; tenantId: string }

export function buildAvailabilityPolicyCommandWhere<T extends object>(
  ctx: CommandRuntimeContext,
  base: FilterQuery<T>,
): FilterQuery<T> {
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? undefined
  return buildScopedWhere(base as Record<string, unknown>, {
    organizationId,
    organizationIds: ctx.organizationIds ?? undefined,
    tenantId: ctx.auth?.tenantId ?? undefined,
  }) as FilterQuery<T>
}

export function ensureAvailabilityPolicyCommandScope(
  ctx: CommandRuntimeContext,
  record: AvailabilityPolicyScopedRecord,
): void {
  ensureTenantScope(ctx, record.tenantId)
  ensureOrganizationScope(ctx, record.organizationId)
}
