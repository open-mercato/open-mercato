/**
 * Row-Level Security (RLS) Helper Module
 *
 * Provides utilities for setting PostgreSQL session variables that are used by
 * RLS policies to enforce tenant isolation at the database level.
 *
 * RLS acts as a defense-in-depth layer: even if application code forgets to add
 * tenant filters, the database will automatically filter rows based on the
 * session context.
 *
 * Session Variables:
 * - app.current_tenant_id: The current tenant UUID
 * - app.current_organization_id: The current organization UUID (optional)
 *
 * Usage:
 * ```typescript
 * import { setRlsContext, isRlsEnabled } from '@open-mercato/shared/lib/db/rls'
 *
 * if (isRlsEnabled()) {
 *   const knex = em.getConnection().getKnex()
 *   await setRlsContext(knex, tenantId, organizationId)
 * }
 * ```
 */

import type { Knex } from 'knex'
import { parseBooleanWithDefault } from '../boolean'

/** Session variable name for tenant ID */
export const RLS_TENANT_VAR = 'app.current_tenant_id'

/** Session variable name for organization ID */
export const RLS_ORG_VAR = 'app.current_organization_id'

/**
 * Check if Row-Level Security is enabled via environment variable.
 * Defaults to false for backward compatibility.
 */
export function isRlsEnabled(): boolean {
  return parseBooleanWithDefault(process.env.RLS_ENABLED, false)
}

/**
 * Check if strict RLS mode is enabled.
 * In strict mode, queries will fail if RLS context is not set.
 * Defaults to false.
 */
export function isRlsStrict(): boolean {
  return parseBooleanWithDefault(process.env.RLS_STRICT, false)
}

/**
 * Set the RLS context for the current database session/transaction.
 *
 * Uses `set_config()` with `is_local = true` so the setting is transaction-scoped.
 * This means the context is automatically cleared when the transaction ends.
 *
 * @param knex - Knex instance or transaction
 * @param tenantId - The tenant UUID to set (required for tenant-scoped queries)
 * @param organizationId - The organization UUID (optional, for org-scoped queries)
 */
export async function setRlsContext(
  knex: Knex,
  tenantId: string | null,
  organizationId?: string | null
): Promise<void> {
  if (!isRlsEnabled()) {
    return
  }

  // Set tenant context (or empty string to clear)
  const tenantValue = tenantId ?? ''
  await knex.raw(`SELECT set_config(?, ?, true)`, [RLS_TENANT_VAR, tenantValue])

  // Set organization context if provided
  if (organizationId !== undefined) {
    const orgValue = organizationId ?? ''
    await knex.raw(`SELECT set_config(?, ?, true)`, [RLS_ORG_VAR, orgValue])
  }
}

/**
 * Clear the RLS context for the current database session/transaction.
 *
 * Sets both session variables to empty strings. This is useful when you need
 * to perform operations that should bypass RLS (e.g., system maintenance tasks).
 *
 * Note: Most use cases should rely on transaction boundaries to automatically
 * clear the context rather than calling this explicitly.
 *
 * @param knex - Knex instance or transaction
 */
export async function clearRlsContext(knex: Knex): Promise<void> {
  if (!isRlsEnabled()) {
    return
  }

  await knex.raw(`SELECT set_config(?, '', true)`, [RLS_TENANT_VAR])
  await knex.raw(`SELECT set_config(?, '', true)`, [RLS_ORG_VAR])
}

/**
 * Get the current RLS tenant context from the database session.
 * Useful for debugging and testing.
 *
 * @param knex - Knex instance or transaction
 * @returns The current tenant ID or null if not set
 */
export async function getRlsTenantContext(knex: Knex): Promise<string | null> {
  const result = await knex.raw(`SELECT current_setting(?, true) as value`, [RLS_TENANT_VAR])
  const value = result.rows?.[0]?.value ?? result[0]?.value ?? null
  return value === '' ? null : value
}

/**
 * Get the current RLS organization context from the database session.
 * Useful for debugging and testing.
 *
 * @param knex - Knex instance or transaction
 * @returns The current organization ID or null if not set
 */
export async function getRlsOrgContext(knex: Knex): Promise<string | null> {
  const result = await knex.raw(`SELECT current_setting(?, true) as value`, [RLS_ORG_VAR])
  const value = result.rows?.[0]?.value ?? result[0]?.value ?? null
  return value === '' ? null : value
}

/**
 * Helper to wrap a function with RLS context.
 * Sets the context before executing and relies on transaction boundaries to clear it.
 *
 * @param knex - Knex instance or transaction
 * @param tenantId - The tenant UUID
 * @param organizationId - The organization UUID (optional)
 * @param fn - The function to execute with RLS context
 * @returns The result of the function
 */
export async function withRlsContext<T>(
  knex: Knex,
  tenantId: string | null,
  organizationId: string | null | undefined,
  fn: () => Promise<T>
): Promise<T> {
  await setRlsContext(knex, tenantId, organizationId)
  return fn()
}

// ---------------------------------------------------------------------------
// RLS Policy Templates
// ---------------------------------------------------------------------------

/** Naming convention for tenant isolation policies */
export const RLS_POLICY_PREFIX = 'rls_tenant_isolation_'

/**
 * Build the policy name for a given table.
 */
export function rlsPolicyName(tableName: string): string {
  return `${RLS_POLICY_PREFIX}${tableName}`
}

/**
 * Generate the SQL statements required to enable RLS and create a tenant
 * isolation policy on a single table.
 *
 * @param tableName - The target table (must be a valid identifier)
 * @param nullable  - Whether the `tenant_id` column is nullable.
 *                    When nullable, rows with `tenant_id IS NULL` (system data)
 *                    remain visible to all sessions.
 * @returns An array of SQL strings to execute in order.
 */
export function buildRlsPolicySql(tableName: string, nullable: boolean): string[] {
  const policyName = rlsPolicyName(tableName)

  const enableSql = `ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY;`
  const forceSql = `ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY;`

  const tenantMatch = `
    NULLIF(current_setting('${RLS_TENANT_VAR}', true), '') IS NOT NULL
    AND tenant_id = current_setting('${RLS_TENANT_VAR}', true)::UUID`

  const usingClause = nullable
    ? `tenant_id IS NULL OR (${tenantMatch.trim()})`
    : tenantMatch.trim()

  const policySql = `CREATE POLICY "${policyName}" ON "${tableName}"
  FOR ALL
  USING (${usingClause})
  WITH CHECK (${usingClause});`

  return [enableSql, forceSql, policySql]
}
