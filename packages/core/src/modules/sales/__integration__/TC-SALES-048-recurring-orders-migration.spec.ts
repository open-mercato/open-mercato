import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  createSalesOrderFixture,
  createSalesQuoteFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { Migration20261026120000_sales_recurring_orders } from '../migrations/Migration20261026120000_sales_recurring_orders'

/**
 * TC-SALES-048 — the recurring-orders migration rolls forward and back (spec 2026-10-21-sales-recurring-orders).
 *
 * The migration runs in a throwaway schema that copies the structure of the sales tables it
 * references, holding real sales rows created for this test. Nothing in the shared schema changes.
 */

type DbClient = Parameters<Parameters<typeof withClient>[0]>[0]

const REFERENCED_TABLES = ['sales_quotes', 'sales_orders', 'sales_invoices', 'sales_credit_memos']
const NEW_TABLES = ['sales_order_recurrences', 'sales_quote_recurrences', 'sales_recurring_periods']

const EXPECTED_CONSTRAINTS = [
  ['sales_order_recurrences', 'sales_order_recurrences_order_id_foreign', 'FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON UPDATE CASCADE ON DELETE CASCADE'],
  ['sales_order_recurrences', 'sales_order_recurrences_order_unique', 'UNIQUE (order_id)'],
  ['sales_quote_recurrences', 'sales_quote_recurrences_quote_id_foreign', 'FOREIGN KEY (quote_id) REFERENCES sales_quotes(id) ON UPDATE CASCADE ON DELETE CASCADE'],
  ['sales_quote_recurrences', 'sales_quote_recurrences_quote_unique', 'UNIQUE (quote_id)'],
  ['sales_recurring_periods', 'sales_recurring_periods_credit_memo_id_foreign', 'FOREIGN KEY (credit_memo_id) REFERENCES sales_credit_memos(id) ON UPDATE CASCADE ON DELETE SET NULL'],
  ['sales_recurring_periods', 'sales_recurring_periods_invoice_id_foreign', 'FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON UPDATE CASCADE ON DELETE SET NULL'],
  ['sales_recurring_periods', 'sales_recurring_periods_order_id_foreign', 'FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON UPDATE CASCADE'],
  ['sales_recurring_periods', 'sales_recurring_periods_order_period_unique', 'UNIQUE (order_id, period_index)'],
]

async function runMigration(client: DbClient, direction: 'up' | 'down'): Promise<void> {
  const migration = new Migration20261026120000_sales_recurring_orders(undefined as never, undefined as never)
  await migration[direction]()
  for (const sql of migration.getQueries()) await client.query(String(sql))
}

async function listTables(client: DbClient, schema: string): Promise<string[]> {
  const result = await client.query(
    'select table_name from information_schema.tables where table_schema = $1 and table_name = any($2) order by 1',
    [schema, NEW_TABLES],
  )
  return result.rows.map((row) => String(row.table_name))
}

async function listConstraints(client: DbClient, schema: string): Promise<string[][]> {
  const result = await client.query(
    `select rel.relname as tbl, con.conname, pg_get_constraintdef(con.oid) as def
       from pg_constraint con
       join pg_class rel on rel.oid = con.conrelid
       join pg_namespace ns on ns.oid = rel.relnamespace
      where ns.nspname = $1 and rel.relname = any($2) and con.contype in ('f', 'u')
      order by 1, 2`,
    [schema, NEW_TABLES],
  )
  return result.rows.map((row) => [String(row.tbl), String(row.conname), String(row.def)])
}

async function fingerprintSalesData(client: DbClient): Promise<Record<string, string>> {
  const fingerprint: Record<string, string> = {}
  for (const table of REFERENCED_TABLES) {
    const result = await client.query(
      `select count(*)::text as count, coalesce(md5(string_agg(row_to_json(t)::text, '|' order by id)), '') as hash from ${table} t`,
    )
    fingerprint[table] = `${result.rows[0].count}:${result.rows[0].hash}`
  }
  return fingerprint
}

async function expectSqlError(client: DbClient, sql: string, params: unknown[], code: string, label: string): Promise<void> {
  const error = await client.query(sql, params).then(
    () => null,
    (failure: { code?: string }) => failure,
  )
  expect(error?.code, label).toBe(code)
}

test.describe('TC-SALES-048 recurring orders migration', () => {
  test('creates the recurrence tables with their constraints and drops only them on rollback', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const schema = `tc_sales_048_${randomBytes(6).toString('hex')}`
    let quoteId: string | null = null
    let orderId: string | null = null
    try {
      quoteId = await createSalesQuoteFixture(request, token)
      orderId = await createSalesOrderFixture(request, token)

      await withClient(async (client) => {
        try {
          await client.query(`create schema "${schema}"`)
          for (const table of REFERENCED_TABLES) {
            await client.query(`create table "${schema}".${table} (like public.${table} including all)`)
          }
          await client.query(`insert into "${schema}".sales_quotes select * from public.sales_quotes where id = $1`, [quoteId])
          await client.query(`insert into "${schema}".sales_orders select * from public.sales_orders where id = $1`, [orderId])
          await client.query(`set search_path to "${schema}"`)
          const current = await client.query('select current_schema() as name')
          expect(current.rows[0].name, 'the migration must run in the throwaway schema').toBe(schema)

          const before = await fingerprintSalesData(client)
          expect(before.sales_quotes.startsWith('1:'), 'the quote fixture is copied').toBe(true)
          expect(before.sales_orders.startsWith('1:'), 'the order fixture is copied').toBe(true)

          await runMigration(client, 'up')
          expect(await listTables(client, schema)).toEqual(NEW_TABLES)
          expect(await listConstraints(client, schema)).toEqual(EXPECTED_CONSTRAINTS)
          expect(await fingerprintSalesData(client), 'up leaves existing sales rows unchanged').toEqual(before)

          const scope = await client.query('select organization_id, tenant_id from sales_orders where id = $1', [orderId])
          const { organization_id: organizationId, tenant_id: tenantId } = scope.rows[0]
          const quoteRecurrence = `insert into sales_quote_recurrences
              (organization_id, tenant_id, quote_id, frequency, starts_on, created_at, updated_at)
            values ($1, $2, $3, 'monthly', current_date, now(), now())`
          await client.query(quoteRecurrence, [organizationId, tenantId, quoteId])
          await expectSqlError(client, quoteRecurrence, [organizationId, tenantId, quoteId], '23505', 'one recurrence per quote')

          const orderRecurrence = `insert into sales_order_recurrences
              (organization_id, tenant_id, order_id, frequency, starts_on, next_invoice_on, created_at, updated_at)
            values ($1, $2, $3, 'monthly', current_date, current_date, now(), now())`
          await client.query(orderRecurrence, [organizationId, tenantId, orderId])
          await expectSqlError(client, orderRecurrence, [organizationId, tenantId, orderId], '23505', 'one recurrence per order')
          await expectSqlError(client, orderRecurrence, [organizationId, tenantId, quoteId], '23503', 'a recurrence needs an existing order')

          const period = `insert into sales_recurring_periods
              (organization_id, tenant_id, order_id, period_index, period_start, period_end, created_at, updated_at)
            values ($1, $2, $3, 0, current_date, current_date + 30, now(), now())`
          await client.query(period, [organizationId, tenantId, orderId])
          await expectSqlError(client, period, [organizationId, tenantId, orderId], '23505', 'one row per order period')
          await expectSqlError(client, 'delete from sales_orders where id = $1', [orderId], '23503', 'an order with periods cannot be deleted')

          await runMigration(client, 'down')
          expect(await listTables(client, schema)).toEqual([])
          expect(await fingerprintSalesData(client), 'down leaves existing sales rows unchanged').toEqual(before)

          await runMigration(client, 'up')
          expect(await listConstraints(client, schema), 'the migration can be applied again after rollback').toEqual(EXPECTED_CONSTRAINTS)
        } finally {
          await client.query('set search_path to default')
          await client.query(`drop schema if exists "${schema}" cascade`)
        }
      })
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })
})
