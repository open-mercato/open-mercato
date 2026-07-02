import type { EntityManager, EntityMetadata } from '@mikro-orm/postgresql'
import { resolveEntityIdFromMetadata } from '../encryption/entityIds'
import { seedDocumentSchema, type SeedDocument } from './types'

export type SeedLoadScope = {
  tenantId: string
  organizationId: string
}

export type SeedLoadProgress = {
  index: number
  total: number
  entity: string
  action: 'created' | 'skipped'
}

export type SeedLoadOptions = {
  /** Apply inside a transaction and roll it back; reports what would happen. */
  dryRun?: boolean
  onProgress?: (progress: SeedLoadProgress) => void
}

export type SeedLoadResult = {
  total: number
  created: number
  skipped: number
}

class SeedDryRunRollback extends Error {}

function resolveEntityClass(meta: EntityMetadata<any>): unknown {
  return (meta as any).class ?? meta.className ?? meta.name
}

function buildEntityIdIndex(em: EntityManager): Map<string, EntityMetadata<any>> {
  const storage = em.getMetadata() as unknown as {
    getAll?: () =>
      | Map<unknown, EntityMetadata<any>>
      | Record<string, EntityMetadata<any>>
      | EntityMetadata<any>[]
    metadata?: Record<string, EntityMetadata<any>>
  }
  const all = (typeof storage.getAll === 'function' ? storage.getAll() : storage.metadata) ?? {}
  // MikroORM v7's instance getAll() returns a Map; older shapes returned a plain
  // object or array. Normalize all three to a flat list.
  const list: EntityMetadata<any>[] =
    all instanceof Map ? [...all.values()] : Array.isArray(all) ? all : Object.values(all)
  const index = new Map<string, EntityMetadata<any>>()
  for (const meta of list) {
    if (!meta || (meta as any).abstract) continue
    const entityId = resolveEntityIdFromMetadata(meta)
    if (!entityId) continue
    if (!index.has(entityId)) index.set(entityId, meta)
  }
  return index
}

function hasProperty(meta: EntityMetadata<any>, name: string): boolean {
  return Boolean(meta.properties && (meta.properties as Record<string, unknown>)[name])
}

/**
 * Insert seed records through the ORM so the tenant-data-encryption subscriber
 * encrypts marked fields at rest automatically. Records are applied in order;
 * `tenantId`/`organizationId` are injected from `scope` for every entity that
 * declares them. Records with a `match` list are skipped when an existing row
 * matches (idempotent re-runs); match fields MUST be non-encrypted natural keys.
 */
export async function loadSeedDocument(
  em: EntityManager,
  document: SeedDocument,
  scope: SeedLoadScope,
  options: SeedLoadOptions = {},
): Promise<SeedLoadResult> {
  const doc = seedDocumentSchema.parse(document)
  const index = buildEntityIdIndex(em)
  const total = doc.records.length
  let created = 0
  let skipped = 0

  const run = async (tem: EntityManager) => {
    for (let i = 0; i < doc.records.length; i += 1) {
      const record = doc.records[i]
      const meta = index.get(record.entity)
      if (!meta) {
        throw new Error(
          `[internal] Unknown seed entity "${record.entity}" at record ${i}: not a registered entity id.`,
        )
      }
      const entityClass = resolveEntityClass(meta)
      const data: Record<string, unknown> = { ...record.data }
      if (hasProperty(meta, 'tenantId')) data.tenantId = scope.tenantId
      if (hasProperty(meta, 'organizationId')) data.organizationId = scope.organizationId

      if (record.match && record.match.length) {
        const where: Record<string, unknown> = {}
        for (const field of record.match) where[field] = data[field]
        if (hasProperty(meta, 'tenantId')) where.tenantId = scope.tenantId
        if (hasProperty(meta, 'organizationId')) where.organizationId = scope.organizationId
        const existing = await tem.findOne(entityClass as any, where as any)
        if (existing) {
          skipped += 1
          options.onProgress?.({ index: i, total, entity: record.entity, action: 'skipped' })
          continue
        }
      }

      const entity = tem.create(entityClass as any, data as any)
      tem.persist(entity)
      await tem.flush()
      created += 1
      options.onProgress?.({ index: i, total, entity: record.entity, action: 'created' })
    }
    if (options.dryRun) throw new SeedDryRunRollback()
  }

  try {
    await em.transactional(run)
  } catch (err) {
    if (!(err instanceof SeedDryRunRollback)) throw err
  }

  return { total, created, skipped }
}
