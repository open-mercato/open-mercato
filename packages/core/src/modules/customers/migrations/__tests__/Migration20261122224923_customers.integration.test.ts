import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import { Migration20261122224923_customers } from '../Migration20261122224923_customers'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

async function runMigration(client: Client, direction: 'up' | 'down'): Promise<void> {
  const migration = Object.create(
    Migration20261122224923_customers.prototype,
  ) as Migration20261122224923_customers
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
  await migration[direction]()

  await client.query('begin')
  try {
    for (const statement of statements) await client.query(statement)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

describeWithPostgres('Nullable interaction parents migration against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let client: Client | undefined

  beforeAll(async () => {
    const postgresUrl = process.env.OM_CUSTOMERS_MIGRATION_PG_URL
    if (postgresUrl) {
      client = new Client({ connectionString: postgresUrl })
    } else {
      const { GenericContainer, Wait } = await import('testcontainers')
      postgres = await new GenericContainer('postgres:16')
        .withEnvironment({ POSTGRES_PASSWORD: 'customers_migration_test' })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
        .start()
      client = new Client({
        host: postgres.getHost(),
        port: postgres.getMappedPort(5432),
        database: 'postgres',
        user: 'postgres',
        password: 'customers_migration_test',
      })
    }
    await client.connect()
  }, 120_000)

  afterAll(async () => {
    try {
      await client?.end()
    } finally {
      await postgres?.stop()
    }
  }, 30_000)

  it('keeps the foreign key and rejects rollback until all interactions have a parent', async () => {
    if (!client) throw new Error('[internal] interaction migration database is not connected')
    const db = client
    const schema = `interaction_parent_${randomUUID().replaceAll('-', '')}`
    const parentId = randomUUID()
    const linkedId = randomUUID()
    const internalId = randomUUID()
    const readInteractions = async () => (await db.query<{ id: string; entity_id: string | null; title: string }>(
      'select id, entity_id, title from customer_interactions order by title',
    )).rows
    const linked = { id: linkedId, entity_id: parentId, title: 'Existing task' }
    const unlinked = { id: internalId, entity_id: null, title: 'Internal meeting' }

    await db.query(`create schema "${schema}"`)
    try {
      await db.query(`set search_path to "${schema}"`)
      await db.query('create table customer_entities (id uuid primary key)')
      await db.query(`
        create table customer_interactions (
          id uuid primary key,
          entity_id uuid not null,
          title text not null,
          constraint customer_interactions_entity_id_foreign
            foreign key (entity_id) references customer_entities (id) on update cascade
        )
      `)
      await db.query('insert into customer_entities (id) values ($1)', [parentId])
      await db.query('insert into customer_interactions (id, entity_id, title) values ($1, $2, $3)',
        [linked.id, linked.entity_id, linked.title])

      await runMigration(db, 'up')
      await db.query('insert into customer_interactions (id, entity_id, title) values ($1, null, $2)',
        [unlinked.id, unlinked.title])
      expect(await readInteractions()).toEqual([linked, unlinked])
      await expect(db.query('update customer_interactions set entity_id = $1 where id = $2', [randomUUID(), internalId]))
        .rejects.toMatchObject({ code: '23503', constraint: 'customer_interactions_entity_id_foreign' })
      await expect(db.query('delete from customer_entities where id = $1', [parentId]))
        .rejects.toMatchObject({ code: '23503', constraint: 'customer_interactions_entity_id_foreign' })

      await expect(runMigration(db, 'down')).rejects.toMatchObject({ code: '23502' })
      expect(await readInteractions()).toEqual([linked, unlinked])

      await db.query('update customer_interactions set entity_id = $1 where id = $2', [parentId, internalId])
      await runMigration(db, 'down')
      expect(await readInteractions()).toEqual([linked, { ...unlinked, entity_id: parentId }])
      await expect(db.query('update customer_interactions set entity_id = null where id = $1', [internalId]))
        .rejects.toMatchObject({ code: '23502' })
    } finally {
      await db.query('reset search_path')
      await db.query(`drop schema "${schema}" cascade`)
    }
  })
})
