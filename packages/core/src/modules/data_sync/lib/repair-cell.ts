import type { EntityManager } from '@mikro-orm/postgresql'
import { removeRepairCell, upsertRepairCell } from '../../progress/lib/repair-cells'

type RepairScope = {
  tenantId: string
  organizationId?: string | null
}

export async function clearDataSyncRepairCell(
  em: EntityManager,
  progressJobId: string | null | undefined,
  scope: RepairScope,
): Promise<void> {
  if (!progressJobId) return
  await removeRepairCell(em, progressJobId, scope)
}

export async function recordDataSyncRepairCell(
  em: EntityManager,
  progressJobId: string | null | undefined,
  scope: RepairScope,
  direction: 'import' | 'export',
  reason: string,
): Promise<void> {
  if (!progressJobId) return
  await upsertRepairCell(em, {
    jobId: progressJobId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    cell: `data_sync.${direction}`,
    dueAt: new Date(),
    reason,
  })
}
