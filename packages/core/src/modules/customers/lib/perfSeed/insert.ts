import { sql, type Kysely } from 'kysely'
import type { SeedScope, SqlRow, SqlValue } from './types'

export type PerfSeedDatabase = Record<string, Record<string, SqlValue>>
export type PerfSeedDb = Kysely<PerfSeedDatabase>

const MAX_PARAMETERS_PER_STATEMENT = 30000

export function collectColumns(rows: readonly SqlRow[]): string[] {
  const columns = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) columns.add(key)
  }
  return Array.from(columns)
}

export function chunkSizeFor(columnCount: number): number {
  return Math.max(1, Math.floor(MAX_PARAMETERS_PER_STATEMENT / Math.max(1, columnCount)))
}

export async function insertRows(db: PerfSeedDb, table: string, rows: readonly SqlRow[]): Promise<number> {
  if (!rows.length) return 0
  const columns = collectColumns(rows)
  const chunkSize = chunkSizeFor(columns.length)
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize)
    const values = chunk.map((row) => sql`(${sql.join(columns.map((column) => row[column] ?? null))})`)
    await sql`insert into ${sql.table(table)} (${sql.join(columns.map((column) => sql.ref(column)))}) values ${sql.join(values)} on conflict do nothing`.execute(db)
  }
  return rows.length
}

const LINK_TABLES_VIA_DEAL = new Set(['customer_deal_people', 'customer_deal_companies'])

export async function countScopedRows(db: PerfSeedDb, table: string, scope: SeedScope): Promise<number> {
  const result = LINK_TABLES_VIA_DEAL.has(table)
    ? await sql<{ total: string | number }>`select count(*) as total from ${sql.table(table)} as link join customer_deals as deal on deal.id = link.deal_id where deal.tenant_id = ${scope.tenantId} and deal.organization_id = ${scope.organizationId}`.execute(db)
    : await sql<{ total: string | number }>`select count(*) as total from ${sql.table(table)} where tenant_id = ${scope.tenantId} and organization_id = ${scope.organizationId}`.execute(db)
  return Number(result.rows[0]?.total ?? 0)
}

export async function countTagsBySlug(db: PerfSeedDb, scope: SeedScope, slugs: readonly string[]): Promise<number> {
  if (!slugs.length) return 0
  const result = await sql<{ total: string | number }>`select count(*) as total from customer_tags where tenant_id = ${scope.tenantId} and organization_id = ${scope.organizationId} and slug in (${sql.join([...slugs])})`.execute(db)
  return Number(result.rows[0]?.total ?? 0)
}

export async function loadTableColumns(db: PerfSeedDb, tables: readonly string[]): Promise<Map<string, Set<string>>> {
  const result = await sql<{ table_name: string; column_name: string }>`select table_name, column_name from information_schema.columns where table_schema = current_schema() and table_name in (${sql.join([...tables])})`.execute(db)
  const columns = new Map<string, Set<string>>()
  for (const row of result.rows) {
    const set = columns.get(row.table_name) ?? new Set<string>()
    set.add(row.column_name)
    columns.set(row.table_name, set)
  }
  return columns
}

export async function selectRowsByIds(
  db: PerfSeedDb,
  table: string,
  ids: readonly string[],
): Promise<Array<Record<string, unknown>>> {
  if (!ids.length) return []
  const result = await sql<Record<string, unknown>>`select * from ${sql.table(table)} where id in (${sql.join([...ids])})`.execute(db)
  return result.rows
}

export async function selectCustomFieldRows(
  db: PerfSeedDb,
  scope: SeedScope,
  recordIds: readonly string[],
): Promise<Array<Record<string, unknown>>> {
  if (!recordIds.length) return []
  const result = await sql<Record<string, unknown>>`select * from custom_field_values where tenant_id = ${scope.tenantId} and organization_id = ${scope.organizationId} and deleted_at is null and record_id in (${sql.join([...recordIds])})`.execute(db)
  return result.rows
}
