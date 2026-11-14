import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { Migration20261015120000_catalog as CatalogDerogationsMigration } from '../migrations/Migration20261015120000_catalog'
import { Migration20261015120000_sales_line_omnibus_snapshot as SalesSnapshotMigration } from '../../sales/migrations/Migration20261015120000_sales_line_omnibus_snapshot'

/**
 * TC-CAT-OMNI-006: the two Omnibus phase 4-5 migrations round-trip in a scratch schema.
 * Source: `.ai/specs/2026-06-30-omnibus-price-tracking.md` — Phase 4 (`catalog_products.omnibus_exempt`,
 * `catalog_products.first_listed_at`, `catalog_product_variants.omnibus_exempt` with the
 * `created_at` backfill) and Phase 5 (six nullable snapshot columns on `sales_order_lines` and
 * `sales_quote_lines`).
 *
 * Each direction is executed through MikroORM's real migration object, so this exercises the
 * committed SQL rather than a hand-written copy of it: up leaves existing rows intact and fills
 * `first_listed_at`, down removes every added column, and a re-applied up is idempotent.
 */

const CATALOG_COLUMNS = ['omnibus_exempt', 'first_listed_at']

function catalogMigration(): CatalogDerogationsMigration {
  return new CatalogDerogationsMigration({} as never, {} as never)
}

function salesMigration(): SalesSnapshotMigration {
  return new SalesSnapshotMigration({} as never, {} as never)
}

test.describe('TC-CAT-OMNI-006: Omnibus migrations round-trip', () => {
  test('both migrations apply, revert and re-apply without touching existing rows', async () => {
    await withClient(async (client) => {
      const schema = `catalog_omnibus_${randomUUID().replace(/-/g, '')}`
      const previousPath = await client.query<{ search_path: string }>('show search_path')
      const productId = randomUUID()
      const variantId = randomUUID()
      const orderLineId = randomUUID()
      const quoteLineId = randomUUID()
      const createdAt = '2026-01-02T03:04:05.000Z'

      const execute = async (
        migration: { reset: () => void; getQueries: () => unknown[]; up: () => void | Promise<void>; down: () => void | Promise<void> },
        direction: 'up' | 'down',
      ) => {
        migration.reset()
        await migration[direction]()
        for (const sql of migration.getQueries()) await client.query(String(sql))
      }
      const readColumns = async (table: string) =>
        (
          await client.query<{ column_name: string }>(
            'select column_name from information_schema.columns where table_schema = $1 and table_name = $2',
            [schema, table],
          )
        ).rows.map((row) => row.column_name)

      try {
        await client.query(`create schema "${schema}"`)
        await client.query("select set_config('search_path', $1, false)", [schema])
        await client.query(
          'create table catalog_products (id uuid primary key, created_at timestamptz not null)',
        )
        await client.query('create table catalog_product_variants (id uuid primary key)')
        await client.query('create table sales_order_lines (id uuid primary key)')
        await client.query('create table sales_quote_lines (id uuid primary key)')
        await client.query('insert into catalog_products (id, created_at) values ($1, $2)', [productId, createdAt])
        await client.query('insert into catalog_product_variants (id) values ($1)', [variantId])
        await client.query('insert into sales_order_lines (id) values ($1)', [orderLineId])
        await client.query('insert into sales_quote_lines (id) values ($1)', [quoteLineId])

        await execute(catalogMigration(), 'up')
        expect(await readColumns('catalog_products')).toEqual(expect.arrayContaining(CATALOG_COLUMNS))
        expect(await readColumns('catalog_product_variants')).toContain('omnibus_exempt')
        const backfilled = await client.query<{ first_listed_at: Date; omnibus_exempt: boolean }>(
          'select first_listed_at, omnibus_exempt from catalog_products where id = $1',
          [productId],
        )
        expect(backfilled.rows[0]?.first_listed_at?.toISOString()).toBe(createdAt)
        expect(backfilled.rows[0]?.omnibus_exempt).toBe(false)
        const variantExempt = await client.query<{ omnibus_exempt: boolean | null }>(
          'select omnibus_exempt from catalog_product_variants where id = $1',
          [variantId],
        )
        expect(variantExempt.rows[0]?.omnibus_exempt, 'a variant inherits by default').toBeNull()

        await execute(salesMigration(), 'up')
        for (const table of ['sales_order_lines', 'sales_quote_lines']) {
          expect(await readColumns(table)).toEqual(
            expect.arrayContaining([
              'omnibus_reference_net',
              'omnibus_reference_gross',
              'omnibus_promotion_anchor_at',
              'omnibus_applicability_reason',
              'is_personalized',
              'personalization_reason',
            ]),
          )
        }

        await execute(salesMigration(), 'down')
        expect(await readColumns('sales_order_lines')).toEqual(['id'])
        expect(await readColumns('sales_quote_lines')).toEqual(['id'])
        await execute(catalogMigration(), 'down')
        expect(await readColumns('catalog_products')).toEqual(['id', 'created_at'])
        expect(await readColumns('catalog_product_variants')).toEqual(['id'])
        const surviving = await client.query<{ id: string; created_at: Date }>(
          'select id, created_at from catalog_products where id = $1',
          [productId],
        )
        expect(surviving.rows).toHaveLength(1)
        expect(surviving.rows[0]?.created_at.toISOString()).toBe(createdAt)

        await execute(catalogMigration(), 'up')
        await execute(salesMigration(), 'up')
        expect(await readColumns('catalog_products')).toEqual(expect.arrayContaining(CATALOG_COLUMNS))
        expect(await readColumns('sales_quote_lines')).toContain('omnibus_reference_gross')
        const reapplied = await client.query<{ first_listed_at: Date }>(
          'select first_listed_at from catalog_products where id = $1',
          [productId],
        )
        expect(reapplied.rows[0]?.first_listed_at?.toISOString()).toBe(createdAt)
      } finally {
        await client.query("select set_config('search_path', $1, false)", [previousPath.rows[0].search_path])
        await client.query(`drop schema if exists "${schema}" cascade`)
      }
    })
  })
})
