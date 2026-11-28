import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { Migration20261123144618_sales_invoices_gl_posting } from '@open-mercato/core/modules/sales_invoices_gl_posting/migrations/Migration20261123144618_sales_invoices_gl_posting'

/**
 * TC-SIGP-001: the module's schema in a disposable PostgreSQL schema. The
 * scoped unique constraints are the double-posting guard and the one
 * assignment per invoice line that the posting command relies on, so they
 * are exercised against a real database; the migration must also roll down
 * and up cleanly.
 */

async function runMigration(client: IntegrationDbClient, direction: 'up' | 'down') {
  const statements: string[] = []
  const migration = Object.create(Migration20261123144618_sales_invoices_gl_posting.prototype) as {
    up(): void | Promise<void>
    down(): void | Promise<void>
  }
  Object.defineProperty(migration, 'addSql', { value: (statement: string) => statements.push(statement) })
  await migration[direction]()
  for (const statement of statements) await client.query(statement)
}

async function withDisposableSchema(run: (client: IntegrationDbClient) => Promise<void>) {
  const schema = `sigp_test_${randomUUID().replaceAll('-', '')}`
  await withClient(async (client) => {
    await client.query('begin')
    try {
      await client.query(`create schema "${schema}"`)
      await client.query(`set local search_path to "${schema}", pg_catalog`)
      await run(client)
    } finally {
      await client.query('rollback')
    }
  })
}

async function violates(client: IntegrationDbClient, statement: string, values: unknown[]): Promise<string | null> {
  await client.query('savepoint attempt')
  try {
    await client.query(statement, values)
    await client.query('release savepoint attempt')
    return null
  } catch (error) {
    await client.query('rollback to savepoint attempt')
    return (error as { constraint?: string }).constraint ?? String(error)
  }
}

const insertPosting = `insert into sales_invoice_gl_postings
  (organization_id, tenant_id, sales_invoice_id, journal_entry_id, posted_at, created_at)
  values ($1, $2, $3, $4, now(), now())`
const insertAssignment = `insert into sales_invoice_line_revenue_accounts
  (organization_id, tenant_id, sales_invoice_line_id, account_id, created_at)
  values ($1, $2, $3, $4, now())`

test('a second posting of the same invoice in one organization is refused, other scopes are independent', async () => {
  await withDisposableSchema(async (client) => {
    await runMigration(client, 'up')
    const tenantId = randomUUID()
    const orgA = randomUUID()
    const orgB = randomUUID()
    const invoiceId = randomUUID()

    expect(await violates(client, insertPosting, [orgA, tenantId, invoiceId, randomUUID()])).toBeNull()
    expect(await violates(client, insertPosting, [orgA, tenantId, invoiceId, randomUUID()])).toBe('sales_invoice_gl_postings_scope_invoice_unique')
    expect(await violates(client, insertPosting, [orgB, tenantId, invoiceId, randomUUID()])).toBeNull()
    expect(await violates(client, insertPosting, [orgA, randomUUID(), invoiceId, randomUUID()])).toBeNull()

    const contractor = await client.query<{ contractor_id: string | null }>(
      'select contractor_id from sales_invoice_gl_postings where organization_id = $1 and tenant_id = $2',
      [orgA, tenantId],
    )
    expect(contractor.rows).toEqual([{ contractor_id: null }])
  })
})

test('an invoice line gets one revenue account per organization', async () => {
  await withDisposableSchema(async (client) => {
    await runMigration(client, 'up')
    const tenantId = randomUUID()
    const orgA = randomUUID()
    const orgB = randomUUID()
    const lineId = randomUUID()

    expect(await violates(client, insertAssignment, [orgA, tenantId, lineId, randomUUID()])).toBeNull()
    expect(await violates(client, insertAssignment, [orgA, tenantId, lineId, randomUUID()])).toBe('sales_invoice_line_revenue_accounts_scope_line_unique')
    expect(await violates(client, insertAssignment, [orgB, tenantId, lineId, randomUUID()])).toBeNull()
  })
})

test('the migration rolls down and up in a disposable schema', async () => {
  await withDisposableSchema(async (client) => {
    const tables = async () => (await client.query<{ postings: string | null; assignments: string | null }>(
      "select to_regclass('sales_invoice_gl_postings') as postings, to_regclass('sales_invoice_line_revenue_accounts') as assignments",
    )).rows[0]
    await runMigration(client, 'up')
    expect(await tables()).toEqual({ postings: 'sales_invoice_gl_postings', assignments: 'sales_invoice_line_revenue_accounts' })
    await runMigration(client, 'down')
    expect(await tables()).toEqual({ postings: null, assignments: null })
    await runMigration(client, 'up')
    expect(await tables()).toEqual({ postings: 'sales_invoice_gl_postings', assignments: 'sales_invoice_line_revenue_accounts' })
  })
})
