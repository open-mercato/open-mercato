import { QueryOrder, type ObjectQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AttachmentPartition } from '../data/entities'
import type { AttachmentScope } from './access'

export function canUseAttachmentPartition(
  partition: Pick<AttachmentPartition, 'tenantId' | 'organizationId'>,
  scope: AttachmentScope | undefined,
): boolean {
  if (partition.tenantId == null) return partition.organizationId == null
  if (partition.tenantId !== scope?.tenantId) return false
  return partition.organizationId == null || partition.organizationId === scope.organizationId
}

export function attachmentPartitionVisibility(
  scope: AttachmentScope | undefined,
  includeTenantOrganizations = false,
): ObjectQuery<AttachmentPartition> {
  const shared = { tenantId: null, organizationId: null }
  if (!scope?.tenantId) return shared
  if (includeTenantOrganizations) return { $or: [shared, { tenantId: scope.tenantId }] }
  const tenant = { tenantId: scope.tenantId, organizationId: null }
  return {
    $or: scope.organizationId
      ? [shared, tenant, { tenantId: scope.tenantId, organizationId: scope.organizationId }]
      : [shared, tenant],
  }
}

export function resolveAttachmentPartition(
  em: EntityManager,
  code: string,
  scope: AttachmentScope | undefined,
  options?: { decrypt?: boolean },
) {
  const where = { code, ...attachmentPartitionVisibility(scope) }
  const orderBy = { tenantId: QueryOrder.ASC_NULLS_LAST, organizationId: QueryOrder.ASC_NULLS_LAST }
  return options?.decrypt
    ? findOneWithDecryption(em, AttachmentPartition, where, { orderBy }, scope)
    : em.findOne(AttachmentPartition, where, { orderBy })
}

export function indexAttachmentPartitions(partitions: readonly AttachmentPartition[]) {
  const keyed = new Map<string, AttachmentPartition>()
  const keyFor = (code: string, tenantId?: string | null, organizationId?: string | null) =>
    JSON.stringify([code, tenantId ?? null, organizationId ?? null])
  for (const partition of partitions) {
    keyed.set(keyFor(partition.code, partition.tenantId, partition.organizationId), partition)
  }
  return (code: string, scope: AttachmentScope): AttachmentPartition | undefined =>
    (scope.tenantId
      ? keyed.get(keyFor(code, scope.tenantId, scope.organizationId)) ?? keyed.get(keyFor(code, scope.tenantId))
      : undefined)
    ?? keyed.get(keyFor(code))
}
