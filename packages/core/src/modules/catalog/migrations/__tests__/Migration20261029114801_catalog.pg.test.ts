import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { Migration20261029114801_catalog } from '../Migration20261029114801_catalog'

const postgresUrl = process.env.OM_CATALOG_MIGRATION_PG_URL
const describePostgres = postgresUrl ? describe : describe.skip

async function runMigration(client: PoolClient, direction: 'up' | 'down'): Promise<void> {
  const migration = Object.create(
    Migration20261029114801_catalog.prototype,
  ) as Migration20261029114801_catalog
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: (statement: string) => statements.push(statement),
  })
  await migration[direction]()
  for (const statement of statements) await client.query(statement)
}

describePostgres('catalog category-suggestions migration against PostgreSQL', () => {
  let pool: Pool
  let client: PoolClient
  let schema: string

  beforeAll(() => {
    pool = new Pool({ connectionString: postgresUrl })
  })

  beforeEach(async () => {
    client = await pool.connect()
    schema = `catalog_suggestions_${randomUUID().replaceAll('-', '')}`
    await client.query('BEGIN')
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET LOCAL search_path TO "${schema}"`)
    await client.query(`CREATE TABLE catalog_products (id uuid PRIMARY KEY)`)
  })

  afterEach(async () => {
    await client.query('ROLLBACK')
    client.release()
  })

  afterAll(async () => {
    await pool.end()
  })

  async function tableExists(): Promise<boolean> {
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = 'catalog_product_category_suggestions'
       ) AS exists`,
      [schema],
    )
    return result.rows[0].exists
  }

  test('down() is a no-op when the table was never created', async () => {
    await runMigration(client, 'down')
    expect(await tableExists()).toBe(false)
  })

  test('up() creates the table, enforces the partial pending-unique index and the product foreign key', async () => {
    await runMigration(client, 'up')
    expect(await tableExists()).toBe(true)

    const productId = randomUUID()
    await client.query('INSERT INTO catalog_products (id) VALUES ($1)', [productId])

    const now = new Date().toISOString()
    const baseRow = {
      orgId: randomUUID(),
      tenantId: randomUUID(),
    }
    await client.query(
      `INSERT INTO catalog_product_category_suggestions
         (id, product_id, organization_id, tenant_id, outcome, status, trigger, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'suggested', 'pending', 'manual', $5, $5)`,
      [randomUUID(), productId, baseRow.orgId, baseRow.tenantId, now],
    )

    // Partial unique index: a second pending row for the same product is rejected.
    // A failed statement aborts the surrounding transaction in Postgres, so each
    // expected-to-fail insert runs inside its own SAVEPOINT and rolls back to it.
    await client.query('SAVEPOINT pending_unique')
    await expect(client.query(
      `INSERT INTO catalog_product_category_suggestions
         (id, product_id, organization_id, tenant_id, outcome, status, trigger, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'suggested', 'pending', 'manual', $5, $5)`,
      [randomUUID(), productId, baseRow.orgId, baseRow.tenantId, now],
    )).rejects.toMatchObject({ code: '23505' })
    await client.query('ROLLBACK TO SAVEPOINT pending_unique')

    // A non-pending row for the same product does not collide with the partial index.
    await client.query(
      `INSERT INTO catalog_product_category_suggestions
         (id, product_id, organization_id, tenant_id, outcome, status, trigger, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'suggested', 'rejected', 'manual', $5, $5)`,
      [randomUUID(), productId, baseRow.orgId, baseRow.tenantId, now],
    )

    // Foreign key: a suggestion row cannot reference a product that does not exist.
    await client.query('SAVEPOINT missing_fk')
    await expect(client.query(
      `INSERT INTO catalog_product_category_suggestions
         (id, product_id, organization_id, tenant_id, outcome, status, trigger, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'suggested', 'pending', 'manual', $5, $5)`,
      [randomUUID(), randomUUID(), baseRow.orgId, baseRow.tenantId, now],
    )).rejects.toMatchObject({ code: '23503' })
    await client.query('ROLLBACK TO SAVEPOINT missing_fk')

    // on delete cascade: deleting the product removes its suggestion rows.
    await client.query('DELETE FROM catalog_products WHERE id = $1', [productId])
    expect((await client.query(
      'SELECT id FROM catalog_product_category_suggestions WHERE product_id = $1',
      [productId],
    )).rowCount).toBe(0)
  })

  test('down() drops the table, its indexes and its foreign key constraint with no leftovers', async () => {
    await runMigration(client, 'up')
    await runMigration(client, 'down')
    expect(await tableExists()).toBe(false)
    const indexes = await client.query<{ index: string | null }>(
      `SELECT to_regclass('catalog_product_category_suggestions_pending_unique')::text AS index`,
    )
    expect(indexes.rows).toEqual([{ index: null }])
  })

  test('up/down survives a rollback-and-reapply cycle', async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runMigration(client, 'up')
      expect(await tableExists()).toBe(true)
      await runMigration(client, 'down')
      expect(await tableExists()).toBe(false)
    }
  })
})
