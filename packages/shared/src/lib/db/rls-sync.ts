/**
 * RLS Policy Sync Utility
 *
 * Discovers all tables with a `tenant_id` column and ensures each one has a
 * corresponding RLS policy for tenant isolation. This is designed to run
 * automatically after database migrations so that newly created tables are
 * covered without manual intervention.
 *
 * Usage (programmatic):
 * ```typescript
 * import { syncRlsPolicies } from '@open-mercato/shared/lib/db/rls-sync'
 *
 * const knex = em.getConnection().getKnex()
 * const result = await syncRlsPolicies(knex)
 * console.log(result.policiesCreated) // ['new_table_a', 'new_table_b']
 * ```
 *
 * Usage (CLI):
 * ```bash
 * yarn mercato db rls-sync
 * ```
 */

import type { Knex } from 'knex'
import { RLS_POLICY_PREFIX, buildRlsPolicySql } from './rls'

export type RlsSyncResult = {
  /** Total number of tables with a `tenant_id` column */
  tablesChecked: number
  /** Tables that already had an RLS policy */
  alreadyCovered: string[]
  /** Tables that received a new RLS policy during this sync */
  policiesCreated: string[]
  /** Tables where policy creation failed (non-fatal) */
  failed: Array<{ table: string; error: string }>
}

export type RlsSyncOptions = {
  /** Suppress console output */
  quiet?: boolean
  /** Only report what would be done without making changes */
  dryRun?: boolean
}

type TenantTable = {
  table_name: string
  is_nullable: string
}

/**
 * Discover all public tables that have a `tenant_id` column.
 */
async function discoverTenantTables(knex: Knex): Promise<TenantTable[]> {
  const result = await knex.raw(`
    SELECT DISTINCT c.table_name, c.is_nullable
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON c.table_name = t.table_name AND c.table_schema = t.table_schema
    WHERE c.column_name = 'tenant_id'
      AND c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  `)
  return (result.rows ?? result) as TenantTable[]
}

/**
 * Discover which tables already have an RLS policy matching our naming
 * convention (`rls_tenant_isolation_<table>`).
 */
async function discoverExistingPolicies(knex: Knex): Promise<Set<string>> {
  const result = await knex.raw(`
    SELECT DISTINCT tablename
    FROM pg_policies
    WHERE policyname LIKE '${RLS_POLICY_PREFIX}%'
      AND schemaname = 'public'
  `)
  const rows = (result.rows ?? result) as Array<{ tablename: string }>
  return new Set(rows.map((row) => row.tablename))
}

/**
 * Check whether *any* RLS policies exist in the database.
 * This is used to decide whether to run sync even when `RLS_ENABLED` is not
 * explicitly set — if policies already exist (from the initial migration), we
 * should keep them in sync regardless of the env flag.
 */
export async function hasAnyRlsPolicies(knex: Knex): Promise<boolean> {
  const result = await knex.raw(`
    SELECT 1 FROM pg_policies
    WHERE policyname LIKE '${RLS_POLICY_PREFIX}%'
      AND schemaname = 'public'
    LIMIT 1
  `)
  const rows = (result.rows ?? result) as unknown[]
  return rows.length > 0
}

/**
 * Synchronize RLS policies: discover all tenant-scoped tables and create
 * missing policies.
 *
 * Safe to run multiple times — it is idempotent. Already-covered tables are
 * skipped.
 */
export async function syncRlsPolicies(
  knex: Knex,
  options: RlsSyncOptions = {},
): Promise<RlsSyncResult> {
  const { quiet = false, dryRun = false } = options

  const tables = await discoverTenantTables(knex)
  const existingPolicies = await discoverExistingPolicies(knex)

  const result: RlsSyncResult = {
    tablesChecked: tables.length,
    alreadyCovered: [],
    policiesCreated: [],
    failed: [],
  }

  for (const { table_name: tableName, is_nullable: isNullableStr } of tables) {
    if (existingPolicies.has(tableName)) {
      result.alreadyCovered.push(tableName)
      continue
    }

    const isNullable = isNullableStr === 'YES'

    if (dryRun) {
      result.policiesCreated.push(tableName)
      if (!quiet) {
        // eslint-disable-next-line no-console
        console.log(`[rls-sync] (dry-run) Would create policy for "${tableName}" (nullable: ${isNullable})`)
      }
      continue
    }

    try {
      const statements = buildRlsPolicySql(tableName, isNullable)
      for (const sql of statements) {
        await knex.raw(sql)
      }
      result.policiesCreated.push(tableName)
      if (!quiet) {
        // eslint-disable-next-line no-console
        console.log(`[rls-sync] Created RLS policy for "${tableName}" (nullable: ${isNullable})`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.failed.push({ table: tableName, error: message })
      if (!quiet) {
        // eslint-disable-next-line no-console
        console.warn(`[rls-sync] Failed to create policy for "${tableName}":`, message)
      }
    }
  }

  return result
}
