import type { FilterQuery } from '@mikro-orm/core'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { buildScopedWhere } from '@open-mercato/shared/lib/api/crud'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'

type MarketCommandScopedRecord = {
  organizationId: string
  tenantId: string
}

export function buildMarketCommandWhere<T extends object>(
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

export function ensureMarketCommandScope(
  ctx: CommandRuntimeContext,
  record: MarketCommandScopedRecord,
): void {
  ensureTenantScope(ctx, record.tenantId)
  ensureOrganizationScope(ctx, record.organizationId)
}

export function resolveMarketScope(ctx: CommandRuntimeContext): { organizationId: string; tenantId: string } | null {
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const tenantId = ctx.auth?.tenantId ?? null
  if (!organizationId || !tenantId) return null
  return { organizationId, tenantId }
}
