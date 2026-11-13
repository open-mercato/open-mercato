import { z } from 'zod'
import { readCatalogRows } from './catalog'
import { quoteBoundaryIdentifier } from './config'
import { assertTenantTableInventory, readTenantCatalog, type TenantCatalogTable, type TenantTableEntry, type TenantTableManifest } from './manifest'
import type { BoundaryClient } from './pool'

export const tenantPolicyName = 'om_tenant_boundary_v1'
const policySchema = z.object({
  table_oid: z.coerce.number().int(), name: z.string(), command: z.string(), permissive: z.boolean(),
  roles: z.array(z.coerce.number().int()), using_expression: z.string().nullable(), check_expression: z.string().nullable(),
})
export type TenantPolicy = z.output<typeof policySchema>

export function tenantPolicyPredicate(): string {
  return "tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid"
}

export function canonicalTenantPolicyExpression(): string {
  return "(tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)"
}

function tableIdentity(entry: Pick<TenantTableEntry, 'schema' | 'table'>): string {
  return `${quoteBoundaryIdentifier(entry.schema)}.${quoteBoundaryIdentifier(entry.table)}`
}

export async function readTenantPolicies(client: Pick<BoundaryClient, 'query'>, tableOids: readonly number[]): Promise<TenantPolicy[]> {
  return readCatalogRows(client, `
    select polrelid as table_oid, polname as name, polcmd::text as command, polpermissive as permissive,
      to_json(polroles) as roles, pg_get_expr(polqual, polrelid) as using_expression,
      pg_get_expr(polwithcheck, polrelid) as check_expression
    from pg_policy where polrelid = any($1::oid[]) order by polrelid, polname
  `, [tableOids], policySchema)
}

export function assertEffectiveTenantPolicies(manifest: TenantTableManifest, tables: readonly TenantCatalogTable[], policies: readonly TenantPolicy[]): void {
  for (const entry of manifest.tables.filter((table) => table.classification === 'enforced')) {
    const installed = tables.find((table) => table.schema === entry.schema && table.table === entry.table)
    if (!installed || !installed.row_security || !installed.force_row_security) {
      throw new Error('[internal] Tenant boundary canary requires enabled and forced row-level security')
    }
    const applied = policies.filter((policy) => policy.table_oid === installed.oid)
    if (applied.length !== 1) throw new Error('[internal] Tenant boundary canary has missing or additional policies')
    const policy = applied[0]
    if (
      policy.name !== tenantPolicyName || policy.command !== '*' || !policy.permissive
      || policy.roles.length !== 1 || policy.roles[0] !== 0
      || policy.using_expression !== canonicalTenantPolicyExpression()
      || policy.check_expression !== canonicalTenantPolicyExpression()
    ) throw new Error('[internal] Tenant boundary canary policy differs from its canonical version')
  }
}

export async function verifyTenantTablePolicies(client: Pick<BoundaryClient, 'query'>, manifest: TenantTableManifest, runtimeRole?: string): Promise<void> {
  const tables = await readTenantCatalog(client)
  assertTenantTableInventory(manifest, tables, 'runtime')
  const enforced = manifest.tables.filter((table) => table.classification === 'enforced')
  const tableOids = tables.filter((table) => enforced.some((entry) => entry.schema === table.schema && entry.table === table.table)).map((table) => table.oid)
  const policies = await readTenantPolicies(client, tableOids)
  assertEffectiveTenantPolicies(manifest, tables, policies)
  const views = await readCatalogRows(client, `
    with recursive dependent_views(oid) as (
      select rewrite.ev_class from pg_depend dependency join pg_rewrite rewrite on rewrite.oid = dependency.objid
      where dependency.classid = 'pg_rewrite'::regclass and dependency.refclassid = 'pg_class'::regclass
        and dependency.refobjid = any($1::oid[])
      union
      select rewrite.ev_class from pg_depend dependency join pg_rewrite rewrite on rewrite.oid = dependency.objid
        join dependent_views parent on parent.oid = dependency.refobjid
      where dependency.classid = 'pg_rewrite'::regclass and dependency.refclassid = 'pg_class'::regclass
    )
    select relation.relname as name from dependent_views dependency join pg_class relation on relation.oid = dependency.oid
    where relation.relkind in ('v','m') and has_table_privilege(coalesce($2::name, current_user), relation.oid, 'SELECT')
    limit 1
  `, [tableOids, runtimeRole ?? null], z.object({ name: z.string() }))
  if (views.length) throw new Error('[internal] Tenant boundary canary has an accessible dependent view requiring explicit security review')
}

async function withPolicyTransaction(client: BoundaryClient, callback: () => Promise<void>): Promise<void> {
  await client.query('begin')
  try {
    await client.query("set local lock_timeout = '10s'")
    await client.query("select pg_advisory_xact_lock(hashtextextended('open-mercato:tenant-rls-policy:v1', 0))")
    await callback()
    await client.query('commit')
  } catch (error) {
    try { await client.query('rollback') } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], '[internal] Tenant boundary reconciliation and rollback failed')
    }
    throw error
  }
}

export async function reconcileTenantTablePolicies(client: BoundaryClient, manifest: TenantTableManifest, runtimeRole: string): Promise<void> {
  await withPolicyTransaction(client, async () => {
    const tables = await readTenantCatalog(client)
    assertTenantTableInventory(manifest, tables, 'runtime')
    for (const entry of manifest.tables.filter((table) => table.classification === 'enforced')) {
      const table = tables.find((candidate) => candidate.schema === entry.schema && candidate.table === entry.table)
      if (!table) throw new Error('[internal] Tenant boundary canary table is missing after migrations')
      const policies = await readTenantPolicies(client, [table.oid])
      if (policies.some((policy) => policy.name !== tenantPolicyName)) {
        throw new Error('[internal] Tenant boundary refuses to overwrite an unowned table policy')
      }
      const relation = tableIdentity(entry)
      const policy = quoteBoundaryIdentifier(tenantPolicyName)
      await client.query(`alter table ${relation} enable row level security`)
      await client.query(`alter table ${relation} force row level security`)
      await client.query(`drop policy if exists ${policy} on ${relation}`)
      await client.query(`create policy ${policy} on ${relation} as permissive for all to public using (${tenantPolicyPredicate()}) with check (${tenantPolicyPredicate()})`)
    }
    await verifyTenantTablePolicies(client, manifest, runtimeRole)
  })
}

export async function rollbackTenantTablePolicies(client: BoundaryClient, manifest: TenantTableManifest, runtimeRole: string): Promise<void> {
  await withPolicyTransaction(client, async () => {
    await verifyTenantTablePolicies(client, manifest, runtimeRole)
    for (const entry of manifest.tables.filter((table) => table.classification === 'enforced')) {
      const relation = tableIdentity(entry)
      await client.query(`drop policy ${quoteBoundaryIdentifier(tenantPolicyName)} on ${relation}`)
      await client.query(`alter table ${relation} no force row level security`)
      await client.query(`alter table ${relation} disable row level security`)
    }
  })
}
