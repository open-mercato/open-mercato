import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import { Migration20261125183000_customers } from '../Migration20261125183000_customers'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

async function runMigration(client: Client, direction: 'up' | 'down'): Promise<void> {
  const migration = Object.create(Migration20261125183000_customers.prototype) as Migration20261125183000_customers
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: (statement: string) => statements.push(statement),
  })
  await migration[direction]()
  for (const statement of statements) await client.query(statement)
}

async function readColumns(client: Client) {
  return (await client.query<{ column_name: string; is_nullable: string; data_type: string }>(
    `select column_name, is_nullable, data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'customer_interactions' order by ordinal_position`,
  )).rows
}

describeWithPostgres('interaction body format migration against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let client: Client | undefined

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'note_format_test', POSTGRES_USER: 'note_format_test', POSTGRES_PASSWORD: 'note_format_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    client = new Client({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      database: 'note_format_test',
      user: 'note_format_test',
      password: 'note_format_test',
    })
    await client.connect()
  }, 60_000)

  afterAll(async () => {
    try {
      await client?.end()
    } finally {
      await postgres?.stop()
    }
  })

  it('preserves existing bodies and scope through upgrade, rollback and reapplication', async () => {
    if (!client) throw new Error('[internal] PostgreSQL fixture was not initialized')
    await client.query(`create table customer_interactions (
      id uuid primary key, tenant_id uuid not null, organization_id uuid not null, body text
    )`)
    const existing = {
      id: randomUUID(),
      tenant_id: randomUUID(),
      organization_id: randomUUID(),
      body: 'Literal <reference> &amp; &#x20; ',
    }
    await client.query('insert into customer_interactions values ($1, $2, $3, $4)', Object.values(existing))
    const originalColumns = await readColumns(client)

    await runMigration(client, 'up')
    expect(await readColumns(client)).toEqual([
      ...originalColumns,
      { column_name: 'body_format', is_nullable: 'YES', data_type: 'text' },
    ])
    expect((await client.query('select * from customer_interactions')).rows).toEqual([{ ...existing, body_format: null }])

    const markdown = { ...existing, id: randomUUID(), body: 'Escaped \\&#x20; then a space&#x20;' }
    await client.query('insert into customer_interactions values ($1, $2, $3, $4, $5)', [...Object.values(markdown), 'markdown'])
    expect((await client.query('select body, body_format from customer_interactions where id = $1', [markdown.id])).rows)
      .toEqual([{ body: markdown.body, body_format: 'markdown' }])

    await runMigration(client, 'down')
    expect(await readColumns(client)).toEqual(originalColumns)
    expect((await client.query('select * from customer_interactions order by id')).rows)
      .toEqual([existing, markdown].sort((left, right) => left.id.localeCompare(right.id)))

    await runMigration(client, 'up')
    expect((await client.query('select * from customer_interactions order by id')).rows)
      .toEqual([existing, markdown].sort((left, right) => left.id.localeCompare(right.id)).map((row) => ({ ...row, body_format: null })))
  })
})
