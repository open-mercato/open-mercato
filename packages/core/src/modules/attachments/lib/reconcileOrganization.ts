import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { Attachment } from '../data/entities'

/**
 * Virtual entity id for library attachments — these are not attached to a
 * parent record that owns an organization, so there is nothing to reconcile
 * against. They are counted as skipped rather than unresolved.
 */
const LIBRARY_ENTITY_ID = 'attachments:library'

const DEFAULT_BATCH_SIZE = 500

export type AttachmentOrgReconcileEntityStat = {
  scanned: number
  updated: number
  unresolved: number
}

export type AttachmentOrgReconcileReport = {
  scanned: number
  updated: number
  unresolved: number
  skippedVirtual: number
  byEntity: Record<string, AttachmentOrgReconcileEntityStat>
}

type AttachmentScanRow = {
  id: string
  entity_id: string | null
  record_id: string | null
  organization_id: string | null
}

function readParentOrganizationId(record: Record<string, unknown>): string | null {
  const raw = record['organization_id'] ?? record['organizationId']
  if (typeof raw === 'string' && raw.trim().length) return raw.trim()
  return null
}

function ensureBucket(
  report: AttachmentOrgReconcileReport,
  entityId: string,
): AttachmentOrgReconcileEntityStat {
  const existing = report.byEntity[entityId]
  if (existing) return existing
  const bucket: AttachmentOrgReconcileEntityStat = { scanned: 0, updated: 0, unresolved: 0 }
  report.byEntity[entityId] = bucket
  return bucket
}

/**
 * Reconcile the `organization_id` of existing attachments to the organization
 * of the record they are attached to.
 *
 * Background (#3765): before the upload route became selected-organization
 * aware, a multi-org admin who switched the header organization uploaded files
 * that were silently stored under their *home* organization instead of the
 * selected one (the organization of the parent record). Those rows are now
 * invisible to org-scoped reads and stay orphaned. This heals them forward.
 *
 * The parent record's organization is the ground truth: an attachment is not
 * distinguishable from a legitimately home-org one by looking at the attachment
 * alone. Parent organizations are resolved generically through the Query Engine
 * by `entityId` (works for both base and custom entities, tenant-scoped and
 * organization-agnostic so the parent's real org is returned regardless of
 * which org the caller sits in) — the same mechanism the attachments module
 * already uses to enrich assignment details.
 *
 * The reconciliation is:
 * - idempotent — rows already matching their parent are left untouched;
 * - conservative — when the parent org cannot be resolved (unregistered
 *   entity id, hard-deleted parent, parent without an org column) the row is
 *   counted as `unresolved` and left as-is rather than guessed at;
 * - tenant-scoped — it reconciles every attachment in the tenant across all
 *   organizations (the whole point is moving rows between orgs).
 *
 * Writes go through the passed `EntityManager` (which the caller runs inside a
 * transaction) so the whole reconciliation commits atomically.
 */
export async function reconcileAttachmentOrganizations(opts: {
  em: EntityManager
  queryEngine: QueryEngine
  tenantId: string
  batchSize?: number
}): Promise<AttachmentOrgReconcileReport> {
  const { em, queryEngine, tenantId } = opts
  const batchSize = opts.batchSize && opts.batchSize > 0 ? opts.batchSize : DEFAULT_BATCH_SIZE
  const report: AttachmentOrgReconcileReport = {
    scanned: 0,
    updated: 0,
    unresolved: 0,
    skippedVirtual: 0,
    byEntity: {},
  }

  const rows = (await em.getConnection().execute(
    'select id, entity_id, record_id, organization_id from attachments where tenant_id = ?',
    [tenantId],
  )) as AttachmentScanRow[]
  report.scanned = rows.length
  if (!rows.length) return report

  const groups = new Map<string, AttachmentScanRow[]>()
  for (const row of rows) {
    if (!row.id || !row.entity_id || !row.record_id) continue
    const list = groups.get(row.entity_id) ?? []
    list.push(row)
    groups.set(row.entity_id, list)
  }

  const pendingUpdates: Array<{ id: string; organizationId: string }> = []

  for (const [entityId, group] of groups) {
    const bucket = ensureBucket(report, entityId)
    bucket.scanned += group.length

    if (entityId === LIBRARY_ENTITY_ID) {
      report.skippedVirtual += group.length
      continue
    }

    const recordIds = Array.from(
      new Set(group.map((row) => row.record_id).filter((value): value is string => !!value)),
    )
    const parentOrgByRecordId = new Map<string, string | null>()
    let resolvable = true

    for (let index = 0; index < recordIds.length; index += batchSize) {
      const chunk = recordIds.slice(index, index + batchSize)
      try {
        const result = await queryEngine.query(entityId as any, {
          fields: ['id', 'organization_id'],
          filters: { id: chunk.length === 1 ? { $eq: chunk[0] } : { $in: chunk } },
          tenantId,
          withDeleted: true,
          page: { pageSize: Math.max(chunk.length, 1) },
        })
        for (const item of result.items ?? []) {
          const record = item as Record<string, unknown>
          const recordId = record.id != null ? String(record.id) : null
          if (!recordId) continue
          parentOrgByRecordId.set(recordId, readParentOrganizationId(record))
        }
      } catch (error) {
        resolvable = false
        console.warn(
          '[attachments] org reconcile: cannot resolve parent organization for entity',
          entityId,
          error,
        )
        break
      }
    }

    if (!resolvable) {
      bucket.unresolved += group.length
      report.unresolved += group.length
      continue
    }

    for (const row of group) {
      const target = row.record_id ? parentOrgByRecordId.get(row.record_id) : null
      if (!target) {
        bucket.unresolved += 1
        report.unresolved += 1
        continue
      }
      if ((row.organization_id ?? null) === target) continue
      pendingUpdates.push({ id: row.id, organizationId: target })
      bucket.updated += 1
      report.updated += 1
    }
  }

  for (let index = 0; index < pendingUpdates.length; index += batchSize) {
    const chunk = pendingUpdates.slice(index, index + batchSize)
    for (const update of chunk) {
      const reference = em.getReference(Attachment, update.id)
      reference.organizationId = update.organizationId
    }
    await em.flush()
  }

  return report
}
