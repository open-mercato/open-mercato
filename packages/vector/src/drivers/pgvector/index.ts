import { Pool, type PoolClient } from 'pg'
import type { VectorDriver, VectorDriverDocument, VectorDriverQuery, VectorDriverQueryResult } from '../../types'

type PgVectorDriverOptions = {
  pool?: Pool
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

async function withClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
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
  const dimension = opts.dimension ?? DEFAULT_DIMENSION
  const distanceMetric = opts.distanceMetric ?? 'cosine'
  const tableIdent = quoteIdent(tableName)
  const migrationsIdent = quoteIdent(migrationsTable)

  const pool =
    opts.pool ??
    (() => {
      const conn = opts.connectionString ?? process.env.DATABASE_URL
      if (!conn) {
        throw new Error('[vector.pgvector] DATABASE_URL is not configured')
      }
      return new Pool({ connectionString: conn })
    })()

  let ready: Promise<void> | null = null

  const ensureReady = async () => {
    if (!ready) {
      ready = withClient(pool, async (client) => {
        await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
        await client.query('CREATE EXTENSION IF NOT EXISTS vector')
        await client.query(
          `CREATE TABLE IF NOT EXISTS ${migrationsIdent} (
            id text primary key,
            applied_at timestamptz not null default now()
          )`,
        )

        const applied = await client.query<{ id: string }>(
          `SELECT id FROM ${migrationsIdent} WHERE id = $1`,
          ['0001_init'],
        )

        if (applied.rowCount === 0) {
          const initSql = `
            CREATE TABLE IF NOT EXISTS ${tableIdent} (
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
              created_at timestamptz not null default now(),
              updated_at timestamptz not null default now()
            );
            CREATE UNIQUE INDEX IF NOT EXISTS ${tableName}_uniq ON ${tableIdent} (driver_id, entity_id, record_id, tenant_id);
            CREATE INDEX IF NOT EXISTS ${tableName}_lookup ON ${tableIdent} (tenant_id, organization_id, entity_id);
            CREATE INDEX IF NOT EXISTS ${tableName}_embedding_idx ON ${tableIdent}
              USING ivfflat (embedding vector_${distanceMetric}_ops) WITH (lists = 100);
          `
          await client.query('BEGIN')
          try {
            await client.query(initSql)
            await client.query(
              `INSERT INTO ${migrationsIdent} (id, applied_at) VALUES ($1, now())`,
              ['0001_init'],
            )
            await client.query('COMMIT')
          } catch (err) {
            await client.query('ROLLBACK')
            throw err
          }
        }
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
          embedding, url, presenter, links, payload, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6, $7::vector, $8, $9::jsonb, $10::jsonb, $11::jsonb, now(), now())
        ON CONFLICT (driver_id, entity_id, record_id, tenant_id)
        DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          checksum = EXCLUDED.checksum,
          embedding = EXCLUDED.embedding,
          url = EXCLUDED.url,
          presenter = EXCLUDED.presenter,
          links = EXCLUDED.links,
          payload = EXCLUDED.payload,
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
    const params: any[] = [
      vectorLiteral,
      DRIVER_ID,
      filter.tenantId,
      filter.organizationId ?? null,
      Array.isArray(filter.entityIds) && filter.entityIds.length ? filter.entityIds : null,
      input.limit ?? 20,
    ]
    const res = await pool.query(
      `
        SELECT
          entity_id,
          record_id,
          checksum,
          url,
          presenter,
          links,
          payload,
          embedding <=> $1::vector AS distance
        FROM ${tableIdent}
        WHERE driver_id = $2
          AND tenant_id = $3::uuid
          AND (
            ($4::uuid IS NULL AND organization_id IS NULL)
            OR ($4::uuid IS NOT NULL AND (organization_id = $4::uuid OR organization_id IS NULL))
          )
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
        checksum: row.checksum,
        url: row.url ?? null,
        presenter: row.presenter ? JSON.parse(row.presenter) : null,
        links: row.links ? JSON.parse(row.links) : null,
        payload: row.payload ? JSON.parse(row.payload) : null,
        score,
      }
    })
  }

  return {
    id: 'pgvector',
    ensureReady,
    upsert,
    delete: remove,
    getChecksum,
    purge,
    query,
  }
}
