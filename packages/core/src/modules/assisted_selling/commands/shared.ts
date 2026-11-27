import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'

export { ensureOrganizationScope, ensureSameScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'

export const ASSISTED_SELLING_STORE_SETTINGS_RESOURCE_KIND = 'assisted_selling.store_settings'

export type VersionedRecord = {
  id: string
  updatedAt?: Date | string | null
}

export async function enforceAssistedSellingOptimisticLock(
  ctx: CommandRuntimeContext,
  record: VersionedRecord | null | undefined,
  resourceKind = ASSISTED_SELLING_STORE_SETTINGS_RESOURCE_KIND,
  expected?: string | Date | null,
): Promise<void> {
  if (!record) return
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind,
    resourceId: record.id,
    current: record.updatedAt ?? null,
    expected: expected ?? undefined,
    request: ctx.request ?? null,
  })
}
