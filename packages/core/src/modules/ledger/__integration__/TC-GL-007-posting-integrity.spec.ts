import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { asValue, createContainer } from 'awilix'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import { commandRegistry, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  resolveIntegrationDatabaseUrl,
  withClient,
  type IntegrationDbClient,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import '@open-mercato/core/modules/ledger/commands/postJournalEntry'
import '@open-mercato/core/modules/ledger/commands/reverseJournalEntry'
import type { PostJournalEntryResult } from '@open-mercato/core/modules/ledger/commands/postJournalEntry'
import {
  FiscalPeriod, JournalEntry, JournalEntryLine, JournalEntrySequence, LedgerAccount,
} from '@open-mercato/core/modules/ledger/data/entities'
import { Migration20260922093649 } from '@open-mercato/core/modules/ledger/migrations/Migration20260922093649'
import { Migration20261012120000 } from '@open-mercato/core/modules/ledger/migrations/Migration20261012120000'
import { Migration20261013090000 } from '@open-mercato/core/modules/ledger/migrations/Migration20261013090000'
import { Migration20261023110000 } from '@open-mercato/core/modules/ledger/migrations/Migration20261023110000'
import { Migration20261029120000 } from '@open-mercato/core/modules/ledger/migrations/Migration20261029120000'

const migrations = [
  Migration20260922093649,
  Migration20261012120000,
  Migration20261013090000,
  Migration20261023110000,
  Migration20261029120000,
]

async function migrate(client: IntegrationDbClient, direction: 'up' | 'down') {
  const ordered = direction === 'up' ? migrations : migrations.slice().reverse()
  for (const MigrationClass of ordered) {
    const statements: string[] = []
    const migration = Object.create(MigrationClass.prototype) as { up(): Promise<void>; down(): Promise<void> }
    Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
    await migration[direction]()
    for (const statement of statements) await client.query(statement)
  }
}

async function executeLedgerCommand(
  commandId: 'ledger.postJournalEntry' | 'ledger.reverseJournalEntry',
  input: unknown,
  ctx: CommandRuntimeContext,
): Promise<PostJournalEntryResult> {
  const command = commandRegistry.get<unknown, PostJournalEntryResult>(commandId)
  if (!command) throw new Error(`[internal] Ledger command ${commandId} is missing`)
  return command.execute(input, ctx)
}

test('failed posting rolls back its sequence and duplicate reversals leave one entry', async () => {
  const schema = `ledger_test_${randomUUID().replaceAll('-', '')}`
  let orm: MikroORM<PostgreSqlDriver> | undefined
  let schemaCreated = false
  try {
    await withClient(async (client) => {
      await client.query('begin')
      await client.query(`create schema "${schema}"`)
      await client.query(`set local search_path to "${schema}", pg_catalog`)
      await migrate(client, 'up')
      await client.query('create table currencies (like public.currencies including all)')
      await client.query('commit')
      schemaCreated = true
    })

    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      clientUrl: resolveIntegrationDatabaseUrl(),
      driverOptions: { options: `-c search_path=${schema},pg_catalog` },
      schema,
      entities: [Currency, FiscalPeriod, JournalEntry, JournalEntryLine, JournalEntrySequence, LedgerAccount],
    })
    const em = orm.em.fork()
    const searchPath = await em.execute<Array<{ schema_name: string }>>('select current_schema as schema_name')
    expect(searchPath[0]?.schema_name).toBe(schema)
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const timestamps = { createdAt: new Date(), updatedAt: new Date() }
    const currency = em.create(Currency, {
      ...scope, ...timestamps, code: 'PLN', name: 'Polish złoty', isBase: true, isActive: true, decimalPlaces: 2,
    })
    em.create(FiscalPeriod, {
      ...scope, ...timestamps, startDate: new Date('2034-01-01'), endDate: new Date('2034-01-31'), isLocked: false,
    })
    const accountTypeId = randomUUID()
    const debit = em.create(LedgerAccount, { ...scope, ...timestamps, accountTypeId, number: '100' })
    const credit = em.create(LedgerAccount, { ...scope, ...timestamps, accountTypeId, number: '200' })
    await em.flush()

    const ctx: CommandRuntimeContext = {
      container: createContainer().register({ em: asValue(em) }),
      auth: { sub: randomUUID(), tenantId: scope.tenantId, orgId: scope.organizationId },
      organizationScope: null,
      selectedOrganizationId: scope.organizationId,
      organizationIds: [scope.organizationId],
    }
    const input = {
      ...scope,
      operationDate: '2034-01-15',
      currencyId: currency.id,
      description: 'QA posting',
      lines: [
        { accountId: debit.id, debit: '25' },
        { accountId: credit.id, credit: '25' },
      ],
    }

    await em.execute(`alter table "${schema}".journal_entry_lines add constraint ledger_test_refuse_post check (credit <> 25)`)
    await expect(executeLedgerCommand('ledger.postJournalEntry', input, ctx)).rejects.toThrow(/ledger_test_refuse_post/)
    expect(await em.count(JournalEntry, scope)).toBe(0)
    expect(await em.count(JournalEntryLine, scope)).toBe(0)
    expect(await em.count(JournalEntrySequence, scope)).toBe(0)

    await em.execute(`alter table "${schema}".journal_entry_lines drop constraint ledger_test_refuse_post`)
    const posted = await executeLedgerCommand('ledger.postJournalEntry', input, ctx)
    expect(posted.sequenceNumber).toBe(1)

    const reversal = { ...scope, operationDate: '2034-01-16', journalEntryId: posted.journalEntryId }
    const attempts = await Promise.allSettled([
      executeLedgerCommand('ledger.reverseJournalEntry', reversal, ctx),
      executeLedgerCommand('ledger.reverseJournalEntry', reversal, ctx),
    ])
    expect(attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'fulfilled', value: expect.objectContaining({ sequenceNumber: 2 }) }),
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ status: 409 }) }),
    ]))
    expect(await em.count(JournalEntry, { ...scope, type: 'REVERSAL', referenceId: posted.journalEntryId })).toBe(1)
    const sequence = await em.findOneOrFail(JournalEntrySequence, scope)
    expect(Number(sequence.nextValue)).toBe(3)
  } finally {
    await orm?.close(true)
    if (schemaCreated) await withClient((client) => client.query(`drop schema if exists "${schema}" cascade`))
  }
})

test('ledger migrations roll down and up in a disposable schema', async () => {
  const schema = `ledger_test_${randomUUID().replaceAll('-', '')}`
  await withClient(async (client) => {
    await client.query('begin')
    try {
      await client.query(`create schema "${schema}"`)
      await client.query(`set local search_path to "${schema}", pg_catalog`)
      await migrate(client, 'up')
      const readLineChecks = () => client.query<{ conname: string }>(
        `select conname from pg_constraint
         where conrelid = 'journal_entry_lines'::regclass and contype = 'c'
         order by conname`,
      )
      const original = await readLineChecks()
      expect(original.rows.map(({ conname }) => conname)).toEqual([
        'journal_entry_lines_amount_currency_nonneg_chk',
        'journal_entry_lines_one_sided_chk',
        'journal_entry_lines_rate_positive_chk',
      ])
      await migrate(client, 'down')
      const dropped = await client.query<{ lines: string | null }>("select to_regclass('journal_entry_lines') as lines")
      expect(dropped.rows[0]?.lines).toBeNull()
      await migrate(client, 'up')
      expect((await readLineChecks()).rows).toEqual(original.rows)
    } finally {
      await client.query('rollback')
    }
  })
})
