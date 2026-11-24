import type { AttachmentPartition } from '../data/entities'

export function canUseAttachmentPartition(
  partition: Pick<AttachmentPartition, 'tenantId' | 'organizationId'>,
  scope: { tenantId?: string | null; organizationId?: string | null } | undefined,
): boolean {
  if (partition.tenantId == null) return partition.organizationId == null
  if (partition.tenantId !== scope?.tenantId) return false
  return partition.organizationId == null || partition.organizationId === scope.organizationId
}
