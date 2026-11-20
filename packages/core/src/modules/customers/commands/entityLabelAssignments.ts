import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { CustomerEntity, CustomerLabel, CustomerLabelAssignment } from '../data/entities'
import type { QueryIndexEventEntry } from './shared'

/**
 * A label assignment removed together with its Person/Company. Labels are private to the user who assigned
 * them, so these rows travel only in the delete log's undo payload.
 */
export type LabelAssignmentRestoreSnapshot = {
  id: string
  labelId: string
  userId: string
  createdAt: Date | string
}

function entityScope(entity: Pick<CustomerEntity, 'organizationId' | 'tenantId'>) {
  return { organizationId: entity.organizationId, tenantId: entity.tenantId }
}

function referenceId(value: string | { id: string }): string {
  return typeof value === 'string' ? value : value.id
}

export async function removeEntityLabelAssignments(
  em: EntityManager,
  entity: CustomerEntity,
): Promise<LabelAssignmentRestoreSnapshot[]> {
  const scope = entityScope(entity)
  const assignments = await findWithDecryption(
    em,
    CustomerLabelAssignment,
    { entity, ...scope },
    { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' } },
    scope,
  )
  if (!assignments.length) return []
  await em.nativeDelete(CustomerLabelAssignment, { id: { $in: assignments.map((row) => row.id) }, ...scope })
  return assignments.map((row) => ({
    id: row.id,
    labelId: referenceId(row.label),
    userId: row.userId,
    createdAt: row.createdAt,
  }))
}

export async function restoreEntityLabelAssignments(
  em: EntityManager,
  entity: CustomerEntity,
  snapshot: LabelAssignmentRestoreSnapshot[] | null | undefined,
): Promise<LabelAssignmentRestoreSnapshot[]> {
  if (!Array.isArray(snapshot) || !snapshot.length) return []
  const scope = entityScope(entity)
  const labelIds = Array.from(new Set(snapshot.map((row) => row.labelId)))
  const labels = await findWithDecryption(em, CustomerLabel, { id: { $in: labelIds }, ...scope }, undefined, scope)
  const labelsById = new Map(labels.map((label) => [label.id, label]))
  const existing = await findWithDecryption(em, CustomerLabelAssignment, { entity, ...scope }, undefined, scope)
  const assignedLabelIds = new Set(existing.map((row) => referenceId(row.label)))
  const restored: LabelAssignmentRestoreSnapshot[] = []
  for (const row of snapshot) {
    const label = labelsById.get(row.labelId)
    if (!label || label.userId !== row.userId || assignedLabelIds.has(label.id)) continue
    em.persist(em.create(CustomerLabelAssignment, {
      id: row.id,
      ...scope,
      userId: row.userId,
      label,
      entity,
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    }))
    assignedLabelIds.add(label.id)
    restored.push(row)
  }
  return restored
}

export function labelAssignmentIndexEntries(
  entity: Pick<CustomerEntity, 'organizationId' | 'tenantId'>,
  rows: LabelAssignmentRestoreSnapshot[] | null | undefined,
): QueryIndexEventEntry[] {
  return (rows ?? []).map((row) => ({
    entityType: E.customers.customer_label_assignment,
    recordId: row.id,
    ...entityScope(entity),
  }))
}
