import type { DatabaseStorageConnection, DatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import type { DatabaseStorageDescriptor } from '@open-mercato/shared/lib/db/runtime'
import { searchDebugWarn } from '../../../lib/debug'

export type PgVectorStorageOptions = {
  schema?: string
  applicationSchema?: string
  tableName?: string
  migrationsTable?: string
  dimension?: number
  distanceMetric?: 'cosine' | 'euclidean' | 'inner'
}

export function quoteIdent(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value) || Buffer.byteLength(value) > 63) {
    throw new Error('[internal] Invalid pgvector storage identifier')
  }
  return `"${value}"`
}

export function resolvePgVectorStorage(options: PgVectorStorageOptions = {}) {
  const schema = options.schema ?? process.env.SEARCH_PGVECTOR_SCHEMA ?? 'public'
  const applicationSchema = options.applicationSchema ?? process.env.SEARCH_PGVECTOR_APPLICATION_SCHEMA ?? schema
  const tableName = options.tableName ?? process.env.SEARCH_PGVECTOR_TABLE ?? 'vector_search'
  const migrationsTable = options.migrationsTable ?? process.env.SEARCH_PGVECTOR_MIGRATIONS_TABLE ?? 'vector_search_migrations'
  const dimension = options.dimension ?? Number(process.env.SEARCH_PGVECTOR_DIMENSION ?? 1536)
  const metric = options.distanceMetric ?? process.env.SEARCH_PGVECTOR_DISTANCE_METRIC ?? 'cosine'
  if (metric !== 'cosine' && metric !== 'euclidean' && metric !== 'inner') throw new Error('[internal] Invalid pgvector distance metric')
  const distanceMetric = metric
  for (const identifier of [schema, applicationSchema, tableName, migrationsTable, `${tableName}_embedding_idx`]) quoteIdent(identifier)
  const reserved = ['entity_indexes', 'custom_entities_storage']
  if ([tableName, migrationsTable].some((name) => reserved.includes(name)) || [tableName, `${tableName}_uniq`, `${tableName}_lookup`, `${tableName}_embedding_idx`].includes(migrationsTable) || !Number.isInteger(dimension) || dimension < 1 || dimension > 16000) {
    throw new Error('[internal] Ambiguous pgvector storage tables or dimension')
  }
  const operatorClass = { cosine: 'vector_cosine_ops', euclidean: 'vector_l2_ops', inner: 'vector_ip_ops' }[distanceMetric]
  const tableIdent = `${quoteIdent(schema)}.${quoteIdent(tableName)}`
  const migrationsIdent = `${quoteIdent(schema)}.${quoteIdent(migrationsTable)}`
  const descriptor: DatabaseStorageDescriptor = Object.freeze({
    kind: 'search.pgvector', schema, tables: Object.freeze([tableName, migrationsTable]),
    configuration: Object.freeze({ applicationSchema, dimension, distanceMetric, indexLists: 100, vectorIndex: dimension <= 2000 }),
  })
  const tables = [`${schema}.${tableName}`, `${schema}.${migrationsTable}`, `${applicationSchema}.entity_indexes`, `${applicationSchema}.custom_entities_storage`]
  return { schema, applicationSchema, tableName, migrationsTable, dimension, distanceMetric, operatorClass, tableIdent, migrationsIdent, descriptor, tables } as const
}

export type PgVectorStorage = ReturnType<typeof resolvePgVectorStorage>

export async function provisionPgVectorStorage(connection: DatabaseStorageConnection, storage: PgVectorStorage, requireConfiguredDimension = false): Promise<void> {
  const { tableName, dimension, operatorClass, tableIdent, migrationsIdent } = storage
  const client = connection
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
    `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdent(`${tableName}_uniq`)} ON ${tableIdent} (driver_id, entity_id, record_id, tenant_id)`,
  )
  await client.query(
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${tableName}_lookup`)} ON ${tableIdent} (tenant_id, organization_id, entity_id)`,
  )
  let actualDimension = dimension
  try {
    const rows = catalogRows<{ atttypmod: number }>(await client.query(
      `SELECT a.atttypmod FROM pg_attribute a JOIN pg_class c ON a.attrelid = c.oid
       JOIN pg_namespace n ON c.relnamespace = n.oid
       WHERE n.nspname = $1 AND c.relname = $2 AND a.attname = 'embedding' AND a.atttypmod > 0`,
      [storage.schema, tableName],
    ))
    actualDimension = rows[0]?.atttypmod ?? dimension
  } catch (error) {
    if (requireConfiguredDimension) throw error
  }
  if (requireConfiguredDimension && actualDimension !== dimension) {
    throw new Error('[internal] Pgvector storage dimension differs from the declared configuration; migrate the storage explicitly')
  }

  if (actualDimension <= 2000) {
    try {
      await client.query(
        `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${tableName}_embedding_idx`)} ON ${tableIdent}
          USING ivfflat (embedding ${operatorClass}) WITH (lists = 100)`,
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
}

type CatalogColumn = { table_name: string; name: string; type: string; nullable: boolean; default_expression: string | null }
type CatalogIndex = { table_name: string; name: string; method: string; unique: boolean; primary: boolean; valid: boolean; partial: boolean; columns: string[]; operator_classes: string[]; options: string[] | null }

function catalogRows<Row>(result: unknown): Row[] {
  if (!result || typeof result !== 'object' || !('rows' in result) || !Array.isArray(result.rows)) {
    throw new Error('[internal] Invalid pgvector storage catalog response')
  }
  return result.rows as Row[]
}

export async function validatePgVectorStorage(connection: DatabaseStorageConnection, storage: PgVectorStorage): Promise<void> {
  const fail = (detail: string): never => {
    throw new Error(`[internal] Pgvector storage ${storage.schema}.${storage.tableName} is not ready: ${detail}; run database migrations with the maintenance connection`)
  }
  const environment = catalogRows<{ installed: boolean; visible: boolean; application_schema: string; correlated_reads_match: boolean }>(await connection.query(
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS installed,
      EXISTS (SELECT 1 FROM pg_type t JOIN pg_extension e ON e.extnamespace = t.typnamespace
        WHERE e.extname = 'vector' AND t.typname = 'vector' AND pg_type_is_visible(t.oid)) AS visible,
      current_schema() AS application_schema,
      to_regclass('entity_indexes') = to_regclass($1) AND to_regclass('custom_entities_storage') = to_regclass($2) AS correlated_reads_match`,
    [`${quoteIdent(storage.applicationSchema)}."entity_indexes"`, `${quoteIdent(storage.applicationSchema)}."custom_entities_storage"`],
  ))[0]
  if (!environment?.installed || !environment.visible) fail('vector extension missing or not visible')
  if (!environment.correlated_reads_match) fail('correlated search tables missing or resolved outside the declared schema')
  if (environment.application_schema !== storage.applicationSchema) fail('search_path does not match the declared correlated-read schema')
  const columns = catalogRows<CatalogColumn>(await connection.query(
    `SELECT c.relname AS table_name, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
      NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS default_expression
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE n.nspname = $1 AND c.relname = ANY($2::text[]) AND c.relkind = 'r'`,
    [storage.schema, storage.descriptor.tables],
  ))
  const required: Record<string, readonly [string, boolean]> = {
    id: ['uuid', false], driver_id: ['text', false], entity_id: ['text', false], record_id: ['text', false],
    tenant_id: ['uuid', false], organization_id: ['uuid', true], checksum: ['text', false],
    embedding: [`vector(${storage.dimension})`, false], url: ['text', true], presenter: ['jsonb', true],
    links: ['jsonb', true], payload: ['jsonb', true], created_at: ['timestamp with time zone', false], updated_at: ['timestamp with time zone', false],
    result_title: ['text', true], result_subtitle: ['text', true], result_icon: ['text', true], result_badge: ['text', true],
    result_snapshot: ['text', true], primary_link_href: ['text', true], primary_link_label: ['text', true],
  }
  for (const [table, definition] of [
    [storage.tableName, required],
    [storage.migrationsTable, { id: ['text', false], applied_at: ['timestamp with time zone', false] }],
  ] as const) {
    for (const [name, [type, nullable]] of Object.entries(definition)) {
      const column = columns.find((entry) => entry.table_name === table && entry.name === name)
      if (!column) return fail(`missing column ${table}.${name}`)
      if (column.type !== type || column.nullable !== nullable) fail(`missing or incompatible column ${table}.${name} (expected ${type})`)
      if (['created_at', 'updated_at', 'applied_at'].includes(name) && column.default_expression !== 'now()') fail(`incompatible default for ${table}.${name}`)
      if (table === storage.tableName && name === 'id' && !/^(?:[a-zA-Z_]+\.)?gen_random_uuid\(\)$/.test(column.default_expression ?? '')) fail('missing UUID default')
    }
  }
  const indexes = catalogRows<CatalogIndex>(await connection.query(
    `SELECT t.relname AS table_name, c.relname AS name, am.amname AS method,
      i.indisunique AS unique, i.indisprimary AS primary, i.indisvalid AND i.indisready AS valid,
      i.indpred IS NOT NULL AS partial, c.reloptions AS options,
      ARRAY(SELECT COALESCE(a.attname::text, '<expression>') FROM unnest(i.indkey) WITH ORDINALITY k(attnum, position)
        LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum ORDER BY k.position) AS columns,
      ARRAY(SELECT o.opcname::text FROM unnest(i.indclass) WITH ORDINALITY k(opclass, position)
        JOIN pg_opclass o ON o.oid = k.opclass ORDER BY k.position) AS operator_classes
     FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
     JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_am am ON am.oid = c.relam
     WHERE n.nspname = $1 AND t.relname = ANY($2::text[])`,
    [storage.schema, storage.descriptor.tables],
  ))
  const hasIndex = (table: string, names: string[], unique: boolean, method: string, primary = false) => indexes.some((entry) =>
    entry.table_name === table && entry.valid && !entry.partial && entry.method === method && entry.unique === unique
    && (!primary || entry.primary) && JSON.stringify(entry.columns) === JSON.stringify(names),
  )
  if (!hasIndex(storage.tableName, ['id'], true, 'btree', true)
    || !hasIndex(storage.migrationsTable, ['id'], true, 'btree', true)
    || !hasIndex(storage.tableName, ['driver_id', 'entity_id', 'record_id', 'tenant_id'], true, 'btree')
    || !hasIndex(storage.tableName, ['tenant_id', 'organization_id', 'entity_id'], false, 'btree')) fail('missing or incompatible primary/lookup/unique indexes')
  const vectorIndexes = indexes.filter((entry) => entry.columns.includes('embedding'))
  if (storage.dimension <= 2000) {
    if (vectorIndexes.length !== 1 || !vectorIndexes.some((entry) => entry.valid && !entry.partial && entry.method === 'ivfflat'
      && JSON.stringify(entry.columns) === JSON.stringify(['embedding']) && JSON.stringify(entry.operator_classes) === JSON.stringify([storage.operatorClass])
      && JSON.stringify(entry.options) === JSON.stringify(['lists=100']))) fail('missing or ambiguous vector index configuration')
  } else if (vectorIndexes.length) fail('unexpected vector index for high dimension storage')
  const ledger = catalogRows<{ id: string }>(await connection.query(`SELECT id FROM ${storage.migrationsIdent} WHERE id = $1`, ['0001_init']))
  if (ledger.length !== 1) fail('initial storage migration not recorded')
}

export function createPgVectorDatabaseDeclarations(options: PgVectorStorageOptions = {}): DatabaseModuleDeclarations {
  const storage = resolvePgVectorStorage(options)
  return {
    storageProviders: [{
      id: `search.pgvector:${storage.schema}.${storage.tableName}`,
      descriptor: storage.descriptor,
      provision: async (connection) => {
        await provisionPgVectorStorage(connection, storage, true)
        await validatePgVectorStorage(connection, storage)
      },
    }],
    storageTables: [
      { schema: storage.schema, table: storage.tableName, tenantColumn: 'tenant_id', tenantType: 'uuid', tenantNullable: false,
        classification: 'deferred', reason: 'Shared vector search storage retains application tenant and organization predicates.' },
      { schema: storage.schema, table: storage.migrationsTable, tenantColumn: null, tenantType: null, tenantNullable: null,
        classification: 'global', reason: 'Pgvector storage migration ledger; no tenant records.' },
    ],
  }
}
