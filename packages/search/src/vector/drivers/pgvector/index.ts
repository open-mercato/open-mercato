import { Pool } from 'pg'
import { configureDatabasePool, databaseStorageMode, resolveDatabaseConnectionUrl, type DatabasePoolLifecycle } from '@open-mercato/shared/lib/db/runtime'
import { resolvePgVectorStorage, provisionPgVectorStorage, validatePgVectorStorage, type PgVectorStorageOptions } from './storage'
import { reportSearchError, searchWarn } from '../../../lib/debug'
import { compileIndexDocFilterExists, compileSearchScopePredicate } from '../../../lib/index-doc-filter'

type PgPoolQueryResult<T> = { rows: T[]; rowCount?: number }
type PgPoolClient = {
  query<T = any>(text: string, params?: any[]): Promise<PgPoolQueryResult<T>>
  release(): void
}
export type PgPool = {
  connect(): Promise<PgPoolClient>
  query<T = any>(text: string, params?: any[]): Promise<PgPoolQueryResult<T>>
  end(): Promise<void>
}
import type {
  VectorDriver,
  VectorDriverDocument,
  VectorDriverQuery,
  VectorDriverQueryResult,
  VectorDriverListParams,
  VectorDriverCountParams,
  VectorIndexEntry,
  VectorDriverRemoveOrphansParams,
  VectorResultPresenter,
  VectorLinkDescriptor,
  VectorDriverStatus,
} from '../../types'

export type PgVectorDriverOptions = PgVectorStorageOptions & {
  pool?: PgPool
  connectionString?: string
}

type PgVectorDriver = VectorDriver & { close(): Promise<void> }
const poolStorageKey = Symbol.for('@open-mercato/search.pgvectorPoolStorage.v1')
function poolStorage() {
  const globals = globalThis as typeof globalThis & { [poolStorageKey]?: WeakMap<object, { configuration: string; driver: PgVectorDriver }> }
  return globals[poolStorageKey] ??= new WeakMap()
}

const DRIVER_ID = 'pgvector' as const

// `undefined_file` is what Postgres raises for `extension "vector" is not available`
// (the pgvector shared library is not installed on the server); `feature_not_supported`
// covers managed providers that refuse the extension outright, and `undefined_object`
// the case where the extension record is missing. None of these can be resolved by
// retrying, so the driver reports itself unhealthy instead of failing every record.
const EXTENSION_MISSING_CODES = new Set(['58P01', '0A000', '42704'])
const EXTENSION_UNAVAILABLE_REASON = 'extension "vector" is not available on this PostgreSQL server'
// Re-probe occasionally so installing pgvector recovers without restarting the process.
const UNAVAILABLE_RECHECK_MS = 60_000

function toVectorLiteral(values: number[]): string {
  const formatted = values.map((n) => {
    if (!Number.isFinite(n)) return '0'
    const rounded = Math.fround(n)
    return Number.isInteger(rounded) ? `${rounded}.0` : `${rounded}`
  })
  return `[${formatted.join(',')}]`
}

function parseJsonColumn<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      // When `jsonb` stores a JSON string, node-postgres parses it into a plain JS string.
      // In that case, there is nothing to JSON.parse — return the raw string value.
      return value as unknown as T
    }
  }
  if (typeof value === 'object') {
    return value as T
  }
  return null
}

async function withClient<T>(pool: PgPool, fn: (client: PgPoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

export function createPgVectorDriver(opts: PgVectorDriverOptions = {}): PgVectorDriver {
  let storage = resolvePgVectorStorage(opts)
  const { tableName, tableIdent, migrationsIdent } = storage

  const pool: PgPool =
    opts.pool ??
    (() => {
      const conn = opts.connectionString ?? process.env.DATABASE_URL
      if (!conn) {
        throw new Error('[vector.pgvector] DATABASE_URL is not configured')
      }
      return new Pool({ connectionString: resolveDatabaseConnectionUrl('runtime', conn) }) as unknown as PgPool
    })()

  const configuration = JSON.stringify(storage.descriptor)
  const existing = poolStorage().get(pool)
  if (existing) {
    if (existing.configuration !== configuration) throw new Error('[internal] Conflicting pgvector storage configuration for the same pool')
    return existing.driver
  }
  let lifecycle: DatabasePoolLifecycle
  try {
    lifecycle = configureDatabasePool(pool, {
      id: `search.pgvector:${storage.schema}.${tableName}`, purpose: 'runtime', tables: storage.tables,
    })
  } catch (error) {
    void pool.end().catch((cleanupError: unknown) => reportSearchError('vector.pgvector', cleanupError, 'search.pool_cleanup_failed'))
    throw error
  }

  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    try { await pool.end() } finally { lifecycle.dispose(); poolStorage().delete(pool) }
  }

  const ensurePoolReady = async () => {
    if (closed) throw new Error('[internal] Pgvector driver is closed')
    try { await lifecycle.ready() } catch (error) { await close(); throw error }
  }

  let ready: Promise<void> | null = null
  let status: { value: VectorDriverStatus; at: number } | null = null
  let reportedReason: string | null = null

  const cacheStatus = (value: VectorDriverStatus): VectorDriverStatus => {
    status = { value, at: Date.now() }
    if (value.available) {
      reportedReason = null
    } else if (value.reason && value.reason !== reportedReason) {
      reportedReason = value.reason
      // Always visible: replacing a per-record error storm with silence would hide the fact
      // that vector indexing has stopped until someone opens Settings > Search.
      searchWarn('vector.pgvector', `vector store unavailable — skipping vector indexing and search (${value.reason})`)
    }
    return value
  }

  // The operator-facing reason is curated rather than the raw Postgres message, which the
  // settings API surfaces to the browser.
  const markExtensionMissing = () => {
    cacheStatus({ available: false, reason: EXTENSION_UNAVAILABLE_REASON })
  }

  const readCachedStatus = (): VectorDriverStatus | null => {
    if (!status) return null
    return Date.now() - status.at < UNAVAILABLE_RECHECK_MS ? status.value : null
  }

  const getStatus = async (): Promise<VectorDriverStatus> => {
    await ensurePoolReady()
    if (databaseStorageMode(storage.descriptor) === 'validate') {
      await ensureReady()
      return { available: true }
    }
    const cached = readCachedStatus()
    if (cached) return cached
    try {
      const res = await pool.query<{ installed: boolean; installable: boolean }>(
        `SELECT
           EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS installed,
           EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS installable`,
      )
      const row = res.rows[0]
      if (row?.installed || row?.installable) return cacheStatus({ available: true })
      return cacheStatus({ available: false, reason: EXTENSION_UNAVAILABLE_REASON })
    } catch {
      // A probe that cannot run (connection refused, permissions on the catalogs)
      // says nothing about pgvector itself — stay optimistic so genuinely transient
      // database problems keep their existing retry semantics.
      return { available: true }
    }
  }

  const isHealthy = async (): Promise<boolean> => (await getStatus()).available

  const ensureReady = async () => {
    await ensurePoolReady()
    const cached = readCachedStatus()
    if (cached && !cached.available) {
      throw new Error(`[vector.pgvector] ${cached.reason ?? 'vector store unavailable'}`)
    }
    if (!ready) {
      ready = withClient(pool, async (client) => {
        if (databaseStorageMode(storage.descriptor) === 'validate') {
          await validatePgVectorStorage(client, storage)
        } else {
          await provisionPgVectorStorage(client, storage)
        }
      }).then(() => {
        cacheStatus({ available: true })
      }).catch(async (err) => {
        ready = null
        const pgError = err as { code?: string; message?: string }
        // Without the extension the `vector` column type does not exist either, so the
        // table DDL fails even when `CREATE EXTENSION` was skipped rather than raised.
        if (pgError?.code && EXTENSION_MISSING_CODES.has(pgError.code) && /\bvector\b/.test(pgError.message ?? '')) {
          markExtensionMissing()
        }
        if (databaseStorageMode(storage.descriptor) === 'validate') await close()
        throw err
      })
    }
    return ready
  }

  const upsert = async (doc: VectorDriverDocument) => {
    await ensureReady()
    const vectorLiteral = toVectorLiteral(doc.embedding)
    await pool.query(
      `
        INSERT INTO ${tableIdent} (
          driver_id, entity_id, record_id, tenant_id, organization_id, checksum,
          embedding, url, presenter, links, payload,
          result_title, result_subtitle, result_icon, result_badge, result_snapshot,
          primary_link_href, primary_link_label,
          created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4::uuid, $5::uuid, $6, $7::vector, $8, $9::jsonb, $10::jsonb, $11::jsonb,
          $12, $13, $14, $15, $16, $17, $18,
          now(), now()
        )
        ON CONFLICT (driver_id, entity_id, record_id, tenant_id)
        DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          checksum = EXCLUDED.checksum,
          embedding = EXCLUDED.embedding,
          url = EXCLUDED.url,
          presenter = EXCLUDED.presenter,
          links = EXCLUDED.links,
          payload = EXCLUDED.payload,
          result_title = EXCLUDED.result_title,
          result_subtitle = EXCLUDED.result_subtitle,
          result_icon = EXCLUDED.result_icon,
          result_badge = EXCLUDED.result_badge,
          result_snapshot = EXCLUDED.result_snapshot,
          primary_link_href = EXCLUDED.primary_link_href,
          primary_link_label = EXCLUDED.primary_link_label,
          updated_at = now()
      `,
      [
        doc.driverId ?? DRIVER_ID,
        doc.entityId,
        doc.recordId,
        doc.tenantId,
        doc.organizationId ?? null,
        doc.checksum,
        vectorLiteral,
        doc.url ?? null,
        doc.presenter ? JSON.stringify(doc.presenter) : null,
        doc.links ? JSON.stringify(doc.links) : null,
        doc.payload ? JSON.stringify(doc.payload) : null,
        doc.resultTitle,
        doc.resultSubtitle ?? null,
        doc.resultIcon ?? null,
        doc.resultBadge ?? null,
        doc.resultSnapshot ?? null,
        doc.primaryLinkHref ?? null,
        doc.primaryLinkLabel ?? null,
      ],
    )
  }

  const remove = async (entityId: string, recordId: string, tenantId: string) => {
    await ensureReady()
    await pool.query(
      `DELETE FROM ${tableIdent} WHERE driver_id = $1 AND entity_id = $2 AND record_id = $3 AND tenant_id = $4::uuid`,
      [DRIVER_ID, entityId, recordId, tenantId],
    )
  }

  const getChecksum = async (entityId: string, recordId: string, tenantId: string): Promise<string | null> => {
    await ensureReady()
    const res = await pool.query<{ checksum: string }>(
      `SELECT checksum FROM ${tableIdent} WHERE driver_id = $1 AND entity_id = $2 AND record_id = $3 AND tenant_id = $4::uuid`,
      [DRIVER_ID, entityId, recordId, tenantId],
    )
    return res.rowCount ? res.rows[0].checksum : null
  }

  const purge = async (entityId: string, tenantId: string, organizationId?: string | null) => {
    await ensureReady()
    const normalizedOrganizationId =
      typeof organizationId === 'string' && organizationId.trim().length > 0 ? organizationId.trim() : null
    const conditions = ['driver_id = $1', 'entity_id = $2', 'tenant_id = $3::uuid']
    const values: any[] = [DRIVER_ID, entityId, tenantId]
    if (normalizedOrganizationId !== null) {
      conditions.push('organization_id = $4::uuid')
      values.push(normalizedOrganizationId)
    }
    await pool.query(
      `DELETE FROM ${tableIdent} WHERE ${conditions.join(' AND ')}`,
      values,
    )
  }

  const query = async (input: VectorDriverQuery): Promise<VectorDriverQueryResult[]> => {
    await ensureReady()
    const vectorLiteral = toVectorLiteral(input.vector)
    const filter = input.filter ?? { tenantId: '' }
    const normalizedOrganizationId =
      typeof filter.organizationId === 'string' && filter.organizationId.trim().length > 0
        ? filter.organizationId.trim()
        : null
    const normalizedOrganizationIds = normalizedOrganizationId
      ? [normalizedOrganizationId]
      : Array.isArray(filter.organizationIds)
        ? Array.from(new Set(
            filter.organizationIds
              .map((value) => (typeof value === 'string' ? value.trim() : ''))
              .filter((value) => value.length > 0),
          ))
        : null
    if (normalizedOrganizationIds && normalizedOrganizationIds.length === 0) {
      return []
    }
    const { resolveQueryIndexSearchScope, buildQueryIndexSearchScopePredicate } = await import('@open-mercato/core/modules/query_index/lib/search-scope')
    const scope = await resolveQueryIndexSearchScope()
    const params: any[] = [
      vectorLiteral,
      DRIVER_ID,
      filter.tenantId,
      normalizedOrganizationIds,
      Array.isArray(filter.entityIds) && filter.entityIds.length ? filter.entityIds : null,
      input.limit ?? 20,
    ]
    const sourceScopeClause = compileSearchScopePredicate(buildQueryIndexSearchScopePredicate(scope, { entityTypeRef: `${tableName}.entity_id`, recordIdRef: `${tableName}.record_id`, organizationIdRef: `${tableName}.organization_id` }, filter.tenantId), params.length + 1)
    params.push(...sourceScopeClause.parameters)
    const indexDocClause = filter.indexDocFilter
      ? compileIndexDocFilterExists(
          filter.indexDocFilter,
          {
            entityTypeRef: `${tableName}.entity_id`,
            recordIdRef: `${tableName}.record_id`,
            tenantIdRef: `${tableName}.tenant_id`,
            tenantGlobalEntityTypes: scope.tenantGlobalEntityTypes,
          },
          params.length + 1,
        )
      : null
    if (indexDocClause) params.push(...indexDocClause.parameters)
    const res = await pool.query<{
      entity_id: string
      record_id: string
      organization_id: string | null
      checksum: string
      url: string | null
      presenter: string | null
      links: string | null
      payload: string | null
      result_title: string | null
      result_subtitle: string | null
      result_icon: string | null
      result_badge: string | null
      result_snapshot: string | null
      primary_link_href: string | null
      primary_link_label: string | null
      distance: number
    }>(
      `
        SELECT
          entity_id,
          record_id,
          organization_id,
          checksum,
          url,
          presenter,
          links,
          payload,
          result_title,
          result_subtitle,
          result_icon,
          result_badge,
          result_snapshot,
          primary_link_href,
          primary_link_label,
          embedding ${storage.distanceMetric === 'euclidean' ? '<->' : storage.distanceMetric === 'inner' ? '<#>' : '<=>'} $1::vector AS distance
        FROM ${tableIdent}
        WHERE driver_id = $2
          AND tenant_id = $3::uuid
          AND ($4::uuid[] IS NULL OR organization_id = ANY($4::uuid[]))
          AND (
            $5::text[] IS NULL OR entity_id = ANY($5::text[])
          )
          AND ${sourceScopeClause.sql}
          ${indexDocClause ? `AND ${indexDocClause.sql}` : ''}
        ORDER BY embedding ${storage.distanceMetric === 'euclidean' ? '<->' : storage.distanceMetric === 'inner' ? '<#>' : '<=>'} $1::vector
        LIMIT $6
      `,
      params,
    )
    return res.rows.map<VectorDriverQueryResult>((row) => {
      const distance = typeof row.distance === 'number' ? row.distance : Number(row.distance || 1)
      const score = 1 - distance
      return {
        entityId: row.entity_id,
        recordId: row.record_id,
        organizationId: row.organization_id ?? null,
        checksum: row.checksum,
        url: row.url ?? null,
        presenter: parseJsonColumn<VectorResultPresenter>(row.presenter),
        links: parseJsonColumn<VectorLinkDescriptor[]>(row.links),
        payload: parseJsonColumn<Record<string, unknown>>(row.payload),
        resultTitle: row.result_title ?? '',
        resultSubtitle: row.result_subtitle ?? null,
        resultIcon: row.result_icon ?? null,
        resultBadge: row.result_badge ?? null,
        resultSnapshot: row.result_snapshot ?? null,
        primaryLinkHref: row.primary_link_href ?? null,
        primaryLinkLabel: row.primary_link_label ?? null,
        score,
      }
    })
  }

  const list = async (params: VectorDriverListParams): Promise<VectorIndexEntry[]> => {
    await ensureReady()
    const limit = Math.max(1, Math.min(params.limit ?? 50, 200))
    const offset = Math.max(0, params.offset ?? 0)
    const orderColumn = params.orderBy === 'created' ? 'created_at' : 'updated_at'
    const conditions: string[] = [
      'driver_id = $1',
      'tenant_id = $2::uuid',
    ]
    const values: any[] = [DRIVER_ID, params.tenantId]
    let nextParam = 3

    const normalizedOrganizationId =
      typeof params.organizationId === 'string' && params.organizationId.trim().length > 0
        ? params.organizationId.trim()
        : null
    if (normalizedOrganizationId !== null) {
      conditions.push(`organization_id = $${nextParam}::uuid`)
      values.push(normalizedOrganizationId)
      nextParam += 1
    }

    if (params.entityId) {
      conditions.push(`entity_id = $${nextParam}::text`)
      values.push(params.entityId)
      nextParam += 1
    }

    const limitParam = nextParam
    const offsetParam = nextParam + 1
    values.push(limit, offset)

    const sql = `
        SELECT
          entity_id,
          record_id,
          tenant_id,
          organization_id,
          checksum,
          url,
          presenter,
          links,
          payload,
          result_title,
          result_subtitle,
          result_icon,
          result_badge,
          result_snapshot,
          primary_link_href,
          primary_link_label,
          created_at,
          updated_at
        FROM ${tableIdent}
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY ${orderColumn} DESC
        LIMIT $${limitParam} OFFSET $${offsetParam}
      `

    const res = await pool.query<{
      entity_id: string
      record_id: string
      tenant_id: string
      organization_id: string | null
      checksum: string
      url: string | null
      presenter: string | null
      links: string | null
      payload: string | null
      result_title: string | null
      result_subtitle: string | null
      result_icon: string | null
      result_badge: string | null
      result_snapshot: string | null
      primary_link_href: string | null
      primary_link_label: string | null
      created_at: Date | string
      updated_at: Date | string
    }>(sql, values)
    return res.rows.map<VectorIndexEntry>((row) => {
      const presenter = parseJsonColumn<VectorResultPresenter>(row.presenter)
      const links = parseJsonColumn<VectorLinkDescriptor[]>(row.links)
      const payload = parseJsonColumn<Record<string, unknown>>(row.payload)
      const createdAt =
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(row.created_at ?? Date.now()).toISOString()
      const updatedAt =
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : new Date(row.updated_at ?? Date.now()).toISOString()
      return {
        entityId: row.entity_id,
        recordId: row.record_id,
        driverId: DRIVER_ID,
        tenantId: row.tenant_id,
        organizationId: row.organization_id ?? null,
        checksum: row.checksum,
        url: row.url ?? null,
        presenter,
        links,
        payload,
        metadata: payload,
        resultTitle: row.result_title ?? '',
        resultSubtitle: row.result_subtitle ?? null,
        resultIcon: row.result_icon ?? null,
        resultBadge: row.result_badge ?? null,
        resultSnapshot: row.result_snapshot ?? null,
        primaryLinkHref: row.primary_link_href ?? null,
        primaryLinkLabel: row.primary_link_label ?? null,
        createdAt,
        updatedAt,
        score: null,
      }
    })
  }

  const count = async (params: VectorDriverCountParams): Promise<number> => {
    await ensureReady()
    const conditions: string[] = [
      'driver_id = $1',
      'tenant_id = $2::uuid',
    ]
    const values: any[] = [DRIVER_ID, params.tenantId]
    let nextParam = 3

    const normalizedOrganizationId =
      typeof params.organizationId === 'string' && params.organizationId.trim().length > 0
        ? params.organizationId.trim()
        : null
    if (normalizedOrganizationId !== null) {
      conditions.push(`organization_id = $${nextParam}::uuid`)
      values.push(normalizedOrganizationId)
      nextParam += 1
    }
    if (params.entityId) {
      conditions.push(`entity_id = $${nextParam}::text`)
      values.push(params.entityId)
      nextParam += 1
    }

    const sql = `
        SELECT count(*)::bigint AS total
        FROM ${tableIdent}
        WHERE ${conditions.join('\n          AND ')}
      `
    const res = await pool.query<{ total: string }>(sql, values)
    const raw = res.rows?.[0]?.total
    if (!raw) return 0
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const removeOrphans = async (params: VectorDriverRemoveOrphansParams): Promise<number> => {
    await ensureReady()
    const conditions: string[] = [
      'driver_id = $1',
      'entity_id = $2',
      'updated_at < $3::timestamptz',
    ]
    const values: any[] = [DRIVER_ID, params.entityId, (params.olderThan instanceof Date ? params.olderThan : new Date(params.olderThan)).toISOString()]
    let nextParam = 4

    if (params.tenantId !== undefined) {
      conditions.push(`tenant_id is not distinct from $${nextParam}::uuid`)
      values.push(params.tenantId)
      nextParam += 1
    }

    if (params.organizationId !== undefined) {
      conditions.push(`organization_id is not distinct from $${nextParam}::uuid`)
      values.push(params.organizationId)
      nextParam += 1
    }

    const sql = `
        DELETE FROM ${tableIdent}
        WHERE ${conditions.join('\n          AND ')}
      `
    const res = await pool.query(sql, values)
    return res.rowCount ?? 0
  }

  const getTableDimension = async (): Promise<number | null> => {
    if (closed) throw new Error('[internal] Pgvector driver is closed')
    if (databaseStorageMode(storage.descriptor) === 'validate') await ensureReady()
    else await ensurePoolReady()
    try {
      const res = await pool.query<{ atttypmod: number }>(
        `SELECT a.atttypmod
         FROM pg_attribute a
         JOIN pg_class c ON a.attrelid = c.oid
         JOIN pg_namespace n ON c.relnamespace = n.oid
         WHERE c.relname = $1 AND n.nspname = $2
         AND a.attname = 'embedding'
         AND a.atttypmod > 0`,
        [tableName, storage.schema]
      )
      if (res.rows.length > 0 && res.rows[0].atttypmod > 0) {
        return res.rows[0].atttypmod
      }
      return null
    } catch {
      return null
    }
  }

  const recreateWithDimension = async (newDimension: number): Promise<void> => {
    if (databaseStorageMode(storage.descriptor) === 'validate') {
      throw new Error('[internal] Pgvector dimension changes require maintenance storage provisioning')
    }
    const nextStorage = resolvePgVectorStorage({ schema: storage.schema, applicationSchema: storage.applicationSchema, tableName, migrationsTable: storage.migrationsTable, dimension: newDimension, distanceMetric: storage.distanceMetric })
    await ensurePoolReady()
    await withClient(pool, async (client) => {
      await client.query(`DROP TABLE IF EXISTS ${tableIdent} CASCADE`)
      await client.query(`DROP TABLE IF EXISTS ${migrationsIdent} CASCADE`)
    })
    ready = null
    storage = nextStorage
    poolStorage().set(pool, { configuration: JSON.stringify(storage.descriptor), driver })
    await ensureReady()
  }

  const driver: PgVectorDriver = {
    id: 'pgvector',
    close,
    supportsIndexDocFilter: true,
    ensureReady,
    isHealthy,
    getStatus,
    upsert,
    delete: remove,
    getChecksum,
    purge,
    query,
    list,
    count,
    removeOrphans,
    getTableDimension,
    recreateWithDimension,
  }
  poolStorage().set(pool, { configuration, driver })
  return driver
}
