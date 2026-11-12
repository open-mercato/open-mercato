import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { Kysely, PostgresDialect } from 'kysely'
import type { EntityManager } from '@mikro-orm/postgresql'
import { recomputeNextInteraction } from '../interactionProjection'
import {
  Migration20261107010000_private_next_interaction_names,
  queryIndexReindexEntityTypes,
} from '../../migrations/Migration20261107010000_private_next_interaction_names'

const postgresUrl = process.env.OM_CUSTOMERS_MIGRATION_PG_URL
const describePostgres = postgresUrl ? describe : describe.skip

describePostgres('shared next-interaction privacy against PostgreSQL', () => {
  let pool: Pool
  let db: Kysely<Record<string, Record<string, unknown>>>
  let em: EntityManager
  const tenantId = randomUUID()
  const organizationId = randomUUID()
  const entityId = randomUUID()

  beforeEach(async () => {
    pool = new Pool({ connectionString: postgresUrl, max: 1 })
    db = new Kysely({ dialect: new PostgresDialect({ pool }) })
    em = { getKysely: () => db } as unknown as EntityManager
    const schema = `projection_${randomUUID().replaceAll('-', '')}`
    await pool.query('BEGIN')
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await pool.query(`SET LOCAL search_path TO "${schema}"`)
    await pool.query(`CREATE TABLE customer_entities (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, organization_id uuid NOT NULL,
      next_interaction_at timestamptz, next_interaction_name text,
      next_interaction_ref_id text, next_interaction_icon text,
      next_interaction_color text, updated_at timestamptz
    )`)
    await pool.query(`CREATE TABLE customer_interactions (
      id uuid PRIMARY KEY, entity_id uuid NOT NULL, tenant_id uuid NOT NULL,
      organization_id uuid NOT NULL, interaction_type text NOT NULL,
      title text, visibility text, scheduled_at timestamptz, status text,
      priority integer, created_at timestamptz DEFAULT now(), deleted_at timestamptz,
      appearance_icon text, appearance_color text
    )`)
    await pool.query('INSERT INTO customer_entities (id, tenant_id, organization_id) VALUES ($1, $2, $3)',
      [entityId, tenantId, organizationId])
  })

  afterEach(async () => {
    try { await pool.query('ROLLBACK') } finally { await db.destroy() }
  })

  async function interaction(options: {
    type?: string; visibility?: string | null; title?: string; status?: string;
    scheduledAt?: string | null; organization?: string
  } = {}): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO customer_interactions
      (id, entity_id, tenant_id, organization_id, interaction_type, title, visibility, scheduled_at, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      id, entityId, tenantId, options.organization ?? organizationId,
      options.type ?? 'email', options.title ?? 'Synthetic subject', options.visibility ?? null,
      options.scheduledAt === undefined ? '2027-01-01T12:00:00Z' : options.scheduledAt,
      options.status ?? 'planned',
    ])
    return id
  }

  async function projection() {
    return (await pool.query<{ next_interaction_name: string | null; next_interaction_ref_id: string | null }>(
      'SELECT next_interaction_name, next_interaction_ref_id FROM customer_entities WHERE id = $1', [entityId],
    )).rows[0]
  }

  test.each(['Private synthetic subject', 'v1:opaque-encrypted-private-subject'])(
    'never copies private title %s into the shared projection', async (title) => {
      const id = await interaction({ visibility: 'private', title })
      await recomputeNextInteraction(em, entityId, organizationId)
      expect(await projection()).toEqual({ next_interaction_name: null, next_interaction_ref_id: id })
    },
  )

  test.each([
    { type: 'call', visibility: 'private' },
    { type: 'email', visibility: 'shared' },
    { type: 'email', visibility: null },
  ])('retains useful permitted subjects for %j', async (options) => {
    const id = await interaction(options)
    await recomputeNextInteraction(em, entityId, organizationId)
    expect(await projection()).toEqual({ next_interaction_name: 'Synthetic subject', next_interaction_ref_id: id })
  })

  test('keeps scheduling order and re-redacts after visibility revocation', async () => {
    const first = await interaction({ visibility: 'shared' })
    await interaction({ type: 'call', scheduledAt: '2027-01-02T12:00:00Z' })
    await interaction({ scheduledAt: '2026-01-01T12:00:00Z', status: 'done' })
    await interaction({ scheduledAt: '2026-01-01T12:00:00Z', status: 'canceled' })
    await interaction({ scheduledAt: null })
    await interaction({ organization: randomUUID(), scheduledAt: '2026-01-01T12:00:00Z' })
    await recomputeNextInteraction(em, entityId, organizationId)
    expect((await projection()).next_interaction_ref_id).toBe(first)
    await pool.query("UPDATE customer_interactions SET visibility = 'private' WHERE id = $1", [first])
    await recomputeNextInteraction(em, entityId, organizationId)
    expect(await projection()).toEqual({ next_interaction_name: null, next_interaction_ref_id: first })
    await pool.query('DELETE FROM customer_interactions')
    await recomputeNextInteraction(em, entityId, organizationId)
    expect(await projection()).toEqual({ next_interaction_name: null, next_interaction_ref_id: null })
  })

  test('repairs existing plaintext or opaque encrypted names idempotently and declares reindexing', async () => {
    const id = await interaction({ visibility: 'private' })
    const migration = Object.create(Migration20261107010000_private_next_interaction_names.prototype) as Migration20261107010000_private_next_interaction_names
    const statements: string[] = []
    Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
    migration.up()
    for (const oldName of ['Private historical subject', 'v1:opaque-historical-subject']) {
      await pool.query('UPDATE customer_entities SET next_interaction_name = $1, next_interaction_ref_id = $2', [oldName, id])
      for (const statement of statements) await pool.query(statement)
      for (const statement of statements) await pool.query(statement)
      for (const statement of statements) await pool.query(statement)
      expect((await projection()).next_interaction_name).toBeNull()
    }
    expect(queryIndexReindexEntityTypes).toEqual([
      'customers:customer_entity', 'customers:customer_person_profile', 'customers:customer_company_profile',
    ])
    migration.down()
    expect(statements).toHaveLength(1)
  })

  test('backfill preserves permitted/manual names and removes foreign or missing references', async () => {
    const publicId = await interaction({ visibility: 'shared' })
    const legacyId = await interaction({ visibility: null })
    const callId = await interaction({ type: 'call', visibility: 'private' })
    const migration = Object.create(Migration20261107010000_private_next_interaction_names.prototype) as Migration20261107010000_private_next_interaction_names
    const statements: string[] = []
    Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
    migration.up()
    for (const reference of [publicId, legacyId, callId, null]) {
      await pool.query('UPDATE customer_entities SET next_interaction_name = $1, next_interaction_ref_id = $2', ['Permitted name', reference])
      for (const statement of statements) await pool.query(statement)
      expect((await projection()).next_interaction_name).toBe('Permitted name')
    }
    await pool.query('UPDATE customer_interactions SET tenant_id = $1 WHERE id = $2', [randomUUID(), publicId])
    for (const reference of [publicId, randomUUID(), 'malformed-historical-reference', '']) {
      await pool.query('UPDATE customer_entities SET next_interaction_name = $1, next_interaction_ref_id = $2', ['Unverified name', reference])
      for (const statement of statements) await pool.query(statement)
      for (const statement of statements) await pool.query(statement)
      expect((await projection()).next_interaction_name).toBeNull()
    }
  })
})
