import { Pool } from 'pg'
import { searchDebugWarn } from '../../../lib/debug'

type PgPoolQueryResult<T> = { rows: T[]; rowCount?: number }
type PgPoolClient = {
  query<T = any>(text: string, params?: any[]): Promise<PgPoolQueryResult<T>>
  release(): void
}
type PgPool = {
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
} from '../../types'

type PgVectorDriverOptions = {
  pool?: PgPool
  connectionString?: string
  tableName?: string
  migrationsTable?: string
  dimension?: number
  distanceMetric?: 'cosine' | 'euclidean' | 'inner'
}

const DEFAULT_TABLE = 'vector_search'
const DEFAULT_MIGRATIONS_TABLE = 'vector_search_migrations'
const DEFAULT_DIMENSION = 1536
const DRIVER_ID = 'pgvector' as const

function assertIdentifier(name: string, defaultName: string): string {
  const candidate = name ?? defaultName
  if (!candidate || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(candidate)) return defaultName
  return candidate
}

function quoteIdent(name: string): string {
  return `"${name}"`
}

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

export function createPgVectorDriver(opts: PgVectorDriverOptions = {}): VectorDriver {
  const tableName = assertIdentifier(opts.tableName ?? DEFAULT_TABLE, DEFAULT_TABLE)
  const migrationsTable = assertIdentifier(opts.migrationsTable ?? DEFAULT_MIGRATIONS_TABLE, DEFAULT_MIGRATIONS_TABLE)
  let dimension = opts.dimension ?? DEFAULT_DIMENSION
  const distanceMetric = opts.distanceMetric ?? 'cosine'
  const tableIdent = quoteIdent(tableName)
  const migrationsIdent = quoteIdent(migrationsTable)

  const pool: PgPool =
    opts.pool ??
    (() => {
      const conn = opts.connectionString ?? process.env.DATABASE_URL
      if (!conn) {
        throw new Error('[vector.pgvector] DATABASE_URL is not configured')
      }
      return new Pool({ connectionString: conn }) as unknown as PgPool
    })()

  let ready: Promise<void> | null = null

  const ensureReady = async () => {
    if (!ready) {
      ready = withClient(pool, async (client) => {
        const ensureExtension = async (extension: 'pgcrypto' | 'vector') => {
          try {
            await client.query(`CREATE EXTENSION IF NOT EXISTS ${extension}`)
          } catch (error) {
            const pgError = error as { code?: string; message?: string }
            if (pgError?.code === '42501') {
              const details = pgError.message ? ` (${pgError.message})` : ''
              searchDebugWarn('vector.pgvector', `skipping ${extension} extension creation; requires superuser${details}`)
              return
            }
            throw error
          }
        }

        await ensureExtension('pgcrypto')
        await ensureExtension('vector')

        await client.query(
          `CREATE TABLE IF NOT EXISTS ${migrationsIdent} (
            id text primary key,
            applied_at timestamptz not null default now()
          )`,
        )

        await client.query(
          `CREATE TABLE IF NOT EXISTS ${tableIdent} (
            id uuid primary key default gen_random_uuid(),
            driver_id text not null,
            entity_id text not null,
            record_id text not null,
            tenant_id uuid not null,
            organization_id uuid null,
            checksum text not null,
            embedding vector(${dimension}) not null,
            url text null,
            presenter jsonb null,
            links jsonb null,
            payload jsonb null,
            result_title text null,
            result_subtitle text null,
            result_icon text null,
            result_badge text null,
            result_snapshot text null,
            primary_link_href text null,
            primary_link_label text null,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          )`,
        )

        await client.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${tableName}_uniq ON ${tableIdent} (driver_id, entity_id, record_id, tenant_id)`,
        )
        await client.query(
          `CREATE INDEX IF NOT EXISTS ${tableName}_lookup ON ${tableIdent} (tenant_id, organization_id, entity_id)`,
        )
        // ivfflat index only supports up to 2000 dimensions
        // For higher dimensions, skip the index (uses sequential scan, slower but works)
        // Also check actual table dimension in case driver was initialized with different value
        let actualDimension = dimension
        try {
          const dimResult = await client.query<{ atttypmod: number }>(
            `SELECT a.atttypmod
             FROM pg_attribute a
             JOIN pg_class c ON a.attrelid = c.oid
             WHERE c.relname = $1
             AND a.attname = 'embedding'
             AND a.atttypmod > 0`,
            [tableName]
          )
          if (dimResult.rows.length > 0 && dimResult.rows[0].atttypmod > 0) {
            actualDimension = dimResult.rows[0].atttypmod
          }
        } catch {
          // Ignore errors reading dimension, use configured value
        }

        if (actualDimension <= 2000) {
          try {
            await client.query(
              `CREATE INDEX IF NOT EXISTS ${tableName}_embedding_idx ON ${tableIdent}
                USING ivfflat (embedding vector_${distanceMetric}_ops) WITH (lists = 100)`,
            )
          } catch (indexErr: unknown) {
            // Handle case where dimension exceeds ivfflat limit
            const errorMessage = indexErr instanceof Error ? indexErr.message : String(indexErr)
            if (errorMessage.includes('2000 dimensions')) {
              searchDebugWarn('pgvector', 'Skipping ivfflat index - dimension exceeds 2000 limit. Searches will use sequential scan.')
            } else {
              throw indexErr
            }
          }
        } else {
          searchDebugWarn('pgvector', `Skipping ivfflat index - dimension ${actualDimension} exceeds 2000 limit. Searches will use sequential scan.`)
        }

        const columnAlters = [
          `ALTER TABLE ${tableIdent} ADD COLUMN IF NOT EXISTS result_title text`,
          `ALTER TABLE ${tableIdent} ADD COLUMN IF NOT EXISTS result_subtitle text`,
          `ALTER TABLE ${tableIdent} ADD COLUMN IF NOT EXISTS result_icon text`,
          `ALTER TABLE ${tableIdent} ADD COLUMN IF NOT EXISTS result_badge text`,
          `ALTER TABLE ${tableIdent} ADD COLUMN IF NOT EXISTS result_snapshot text`,
          `ALTER TABLE ${tableIdent} ADD COLUMN IF NOT EXISTS primary_link_href text`,
          `ALTER TABLE ${tableIdent} ADD COLUMN IF NOT EXISTS primary_link_label text`,
        ]
        for (const statement of columnAlters) {
          await client.query(statement)
        }

        await client.query(
          `INSERT INTO ${migrationsIdent} (id, applied_at) VALUES ($1, now()) ON CONFLICT (id) DO NOTHING`,
          ['0001_init'],
        )
      }).catch((err) => {
        ready = null
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

  const purge = async (entityId: string, tenantId: string) => {
    await ensureReady()
    await pool.query(
      `DELETE FROM ${tableIdent} WHERE driver_id = $1 AND entity_id = $2 AND tenant_id = $3::uuid`,
      [DRIVER_ID, entityId, tenantId],
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
    const params: any[] = [
      vectorLiteral,
      DRIVER_ID,
      filter.tenantId,
      normalizedOrganizationId,
      Array.isArray(filter.entityIds) && filter.entityIds.length ? filter.entityIds : null,
      input.limit ?? 20,
    ]
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
          embedding <=> $1::vector AS distance
        FROM ${tableIdent}
        WHERE driver_id = $2
          AND tenant_id = $3::uuid
          AND ($4::uuid IS NULL OR organization_id = $4::uuid)
          AND (
            $5::text[] IS NULL OR entity_id = ANY($5::text[])
          )
        ORDER BY embedding <=> $1::vector
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
    try {
      const res = await pool.query<{ atttypmod: number }>(
        `SELECT a.atttypmod
         FROM pg_attribute a
         JOIN pg_class c ON a.attrelid = c.oid
         WHERE c.relname = $1
         AND a.attname = 'embedding'
         AND a.atttypmod > 0`,
        [tableName]
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
    await withClient(pool, async (client) => {
      await client.query(`DROP TABLE IF EXISTS ${tableIdent} CASCADE`)
      await client.query(`DROP TABLE IF EXISTS ${migrationsIdent} CASCADE`)
    })
    ready = null
    dimension = newDimension
    await ensureReady()
  }

  return {
    id: 'pgvector',
    ensureReady,
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
}
