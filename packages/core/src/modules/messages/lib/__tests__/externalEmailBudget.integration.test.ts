import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { Migration } from '@mikro-orm/migrations'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { Client } from 'pg'
import { MessageExternalEmailWindow, MessageExternalRecipientDay } from '../../data/entities'
import { checkExternalEmailBudget } from '../externalEmailBudget'
import { Migration20261111171228_messages } from '../../migrations/Migration20261111171228_messages'
import { Migration20261111210148_messages } from '../../migrations/Migration20261111210148_messages'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

type MigrationConstructor = {
  new (): Migration
  prototype: Migration
}

describeWithPostgres('external email budgets against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver> | undefined
  let externalDatabase: string | undefined
  let externalDatabaseUrl: string | undefined
  let dailyLimit = 100

  function manager(): EntityManager {
    if (!orm) throw new Error('[internal] PostgreSQL test ORM unavailable')
    return orm.em.fork()
  }

  async function runMigration(migrationClass: MigrationConstructor, direction: 'up' | 'down'): Promise<void> {
    const migration = Object.create(migrationClass.prototype) as Migration
    const statements: string[] = []
    Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
    await migration[direction]()
    for (const statement of statements) await manager().getConnection().execute(statement)
  }

  function budgetInput(tenantId: string, userId: string) {
    const em = manager()
    return {
      container: {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'moduleConfigService') {
            return { getValue: async () => dailyLimit }
          }
          throw new Error(`[internal] Unexpected test service: ${name}`)
        },
      },
      scope: { tenantId, userId },
    }
  }

  beforeAll(async () => {
    const externalUrl = process.env.OM_MESSAGES_BUDGET_PG_URL
    if (externalUrl) {
      externalDatabase = `messages_budget_${randomUUID().replaceAll('-', '')}`
      const adminUrl = new URL(externalUrl)
      adminUrl.pathname = '/postgres'
      const admin = new Client({ connectionString: adminUrl.toString() })
      await admin.connect()
      try {
        await admin.query(`create database "${externalDatabase}"`)
      } finally {
        await admin.end()
      }
      externalDatabaseUrl = new URL(externalUrl).toString()
      const databaseUrl = new URL(externalDatabaseUrl)
      databaseUrl.pathname = `/${externalDatabase}`
      externalDatabaseUrl = databaseUrl.toString()
    } else {
      postgres = await new GenericContainer('postgres:16-alpine')
        .withEnvironment({ POSTGRES_DB: 'messages_budget', POSTGRES_USER: 'messages_budget', POSTGRES_PASSWORD: 'messages_budget' })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
        .start()
    }
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      entities: [MessageExternalRecipientDay, MessageExternalEmailWindow],
      ...(externalDatabaseUrl
        ? { clientUrl: externalDatabaseUrl }
        : {
            host: postgres?.getHost(),
            port: postgres?.getMappedPort(5432),
            dbName: 'messages_budget',
            user: 'messages_budget',
            password: 'messages_budget',
          }),
    })
    await runMigration(Migration20261111171228_messages, 'up')
    await runMigration(Migration20261111210148_messages, 'up')
  }, 120_000)

  beforeEach(async () => {
    dailyLimit = 100
    await manager().getConnection().execute('truncate table message_external_recipient_days, message_external_email_windows')
  })

  afterAll(async () => {
    if (orm) {
      await runMigration(Migration20261111210148_messages, 'down')
      await runMigration(Migration20261111171228_messages, 'down')
      const tables = await manager().getConnection().execute<Array<{ table_name: string }>>(
        `select table_name from information_schema.tables where table_schema = 'public'
         and table_name in ('message_external_recipient_days', 'message_external_email_windows')`,
      )
      expect(tables).toEqual([])
    }
    await orm?.close(true)
    await postgres?.stop()
    if (externalDatabase && process.env.OM_MESSAGES_BUDGET_PG_URL) {
      const adminUrl = new URL(process.env.OM_MESSAGES_BUDGET_PG_URL)
      adminUrl.pathname = '/postgres'
      const admin = new Client({ connectionString: adminUrl.toString() })
      await admin.connect()
      try {
        await admin.query(`drop database if exists "${externalDatabase}"`)
      } finally {
        await admin.end()
      }
    }
  }, 30_000)

  it('allows exactly one new recipient under concurrent exact-cap admissions', async () => {
    dailyLimit = 1
    const tenantId = randomUUID()
    const userId = randomUUID()
    const first = budgetInput(tenantId, userId)
    const second = budgetInput(tenantId, userId)
    const now = new Date('2026-11-11T12:00:00.000Z')

    const responses = await Promise.all([
      checkExternalEmailBudget(first.container, first.scope, 'first@example.com', { now }),
      checkExternalEmailBudget(second.container, second.scope, 'second@example.com', { now }),
    ])

    expect(responses.map((response) => response?.status ?? 201).sort()).toEqual([201, 429])
    expect(await manager().getConnection().execute('select count(*)::int as count from message_external_recipient_days'))
      .toEqual([{ count: 1 }])
    expect(await manager().getConnection().execute('select scope, count from message_external_email_windows order by scope'))
      .toEqual([{ scope: 'tenant', count: 1 }, { scope: 'user', count: 1 }])
  }, 20_000)

  it('deduplicates normalized repeat recipients while counting durable hourly use', async () => {
    dailyLimit = 1
    const tenantId = randomUUID()
    const userId = randomUUID()
    const first = budgetInput(tenantId, userId)
    const second = budgetInput(tenantId, userId)
    const now = new Date('2026-11-11T12:00:00.000Z')

    await checkExternalEmailBudget(first.container, first.scope, ' Recipient@Example.com ', { now })
    const repeated = await checkExternalEmailBudget(second.container, second.scope, 'recipient@example.com', { now })

    expect(repeated).toBeNull()
    expect(await manager().getConnection().execute('select count(*)::int as count from message_external_recipient_days'))
      .toEqual([{ count: 1 }])
    expect(await manager().getConnection().execute('select scope, count from message_external_email_windows order by scope'))
      .toEqual([{ scope: 'tenant', count: 2 }, { scope: 'user', count: 2 }])
  })

  it('isolates recipient and window ledgers by tenant', async () => {
    dailyLimit = 1
    const firstTenant = randomUUID()
    const secondTenant = randomUUID()
    const userId = randomUUID()
    const first = budgetInput(firstTenant, userId)
    const second = budgetInput(secondTenant, userId)
    const now = new Date('2026-11-11T12:00:00.000Z')

    await checkExternalEmailBudget(first.container, first.scope, 'recipient@example.com', { now })
    const otherTenant = await checkExternalEmailBudget(second.container, second.scope, 'recipient@example.com', { now })

    expect(otherTenant).toBeNull()
    expect(await manager().getConnection().execute(
      'select count(distinct tenant_id)::int as count from message_external_recipient_days',
    )).toEqual([{ count: 2 }])
    expect(await manager().getConnection().execute(
      "select count(*)::int as count from message_external_email_windows where scope = 'tenant'",
    )).toEqual([{ count: 2 }])
  })

  it('rejects at the durable hourly cap across independent entity managers', async () => {
    const previous = process.env.RATE_LIMIT_MESSAGES_EXTERNAL_USER_POINTS
    process.env.RATE_LIMIT_MESSAGES_EXTERNAL_USER_POINTS = '1'
    try {
      const tenantId = randomUUID()
      const userId = randomUUID()
      const first = budgetInput(tenantId, userId)
      const second = budgetInput(tenantId, userId)
      const now = new Date('2026-11-11T12:00:00.000Z')

      await checkExternalEmailBudget(first.container, first.scope, 'first@example.com', { now })
      const response = await checkExternalEmailBudget(second.container, second.scope, 'second@example.com', { now })

      expect(response?.status).toBe(429)
      expect(response?.headers.get('X-RateLimit-Limit')).toBe('1')
    } finally {
      if (previous === undefined) delete process.env.RATE_LIMIT_MESSAGES_EXTERNAL_USER_POINTS
      else process.env.RATE_LIMIT_MESSAGES_EXTERNAL_USER_POINTS = previous
    }
  })
})
