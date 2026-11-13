import { z } from 'zod'
import { readCatalogRows, readRuntimeRoleIdentity, type RuntimeRoleIdentity } from './catalog'
import type { BoundaryClient } from './pool'

export function assertRuntimeRoleIdentity(role: RuntimeRoleIdentity): void {
  const major = Math.floor(role.server_version / 10_000)
  if (![16, 17, 18].includes(major)) throw new Error('[internal] Tenant boundary supports PostgreSQL 16 through 18 only')
  if (
    !role.login || role.current_role !== role.session_role || role.superuser || role.bypass
    || role.create_role || role.create_database || role.replication || role.memberships || role.owns_database
    || role.database_create || role.database_temp
  ) throw new Error('[internal] Tenant boundary runtime role has unsafe ownership, membership, DDL, temporary-table or bypass privileges')
}

export async function verifyMaintenanceDatabaseRole(client: Pick<BoundaryClient, 'query'>, expectedRole: string): Promise<RuntimeRoleIdentity> {
  const role = await readRuntimeRoleIdentity(client)
  const major = Math.floor(role.server_version / 10_000)
  if (![16, 17, 18].includes(major) || !role.login || role.current_role !== role.session_role
    || role.current_role !== expectedRole || !role.bypass || role.superuser || role.create_role
    || role.create_database || role.replication || role.memberships) {
    throw new Error('[internal] Tenant boundary maintenance requires its distinct reviewed BYPASSRLS login without role administration privileges')
  }
  return role
}

export async function verifyRuntimeDatabaseRole(client: Pick<BoundaryClient, 'query'>, schemas: readonly string[]): Promise<RuntimeRoleIdentity> {
  const role = await readRuntimeRoleIdentity(client)
  assertRuntimeRoleIdentity(role)
  const schemaRows = await readCatalogRows(client, `
    select namespace.nspname as name,
      namespace.nspowner = $1::oid as owns,
      has_schema_privilege($1::oid, namespace.oid, 'CREATE') as can_create,
      exists(select 1 from aclexplode(coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))) acl
        where acl.grantee in (0, $1::oid) and acl.is_grantable) as can_grant
    from pg_namespace namespace where (namespace.nspname = any($2::text[]) or (namespace.nspname !~ '^pg_' and namespace.nspname <> 'information_schema'))
  `, [role.role_id, schemas], z.object({ name: z.string(), owns: z.boolean(), can_create: z.boolean(), can_grant: z.boolean() }))
  if (schemaRows.some((schema) => schema.owns || schema.can_create || schema.can_grant)) {
    throw new Error('[internal] Tenant boundary runtime role cannot own, create in, or grant privileges on application schemas')
  }
  const unsafeRelations = await readCatalogRows(client, `
    select relation.relname as name from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
    where (namespace.nspname = any($2::text[]) or (namespace.nspname !~ '^pg_' and namespace.nspname <> 'information_schema')) and relation.relkind in ('r','p','v','m','f','S') and (
      relation.relowner = $1::oid
      or case when relation.relkind in ('r','p','f') then has_table_privilege($1::oid, relation.oid, 'TRUNCATE') else false end
      or exists(select 1 from aclexplode(coalesce(relation.relacl,
        acldefault(case when relation.relkind = 'S' then 'S'::"char" else 'r'::"char" end, relation.relowner))) acl
        where acl.grantee in (0, $1::oid) and acl.is_grantable)
      or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl
        where attribute.attrelid = relation.oid and attribute.attnum > 0 and not attribute.attisdropped
          and acl.grantee in (0, $1::oid) and acl.is_grantable)
    ) limit 1
  `, [role.role_id, schemas], z.object({ name: z.string() }))
  if (unsafeRelations.length) throw new Error('[internal] Tenant boundary runtime role cannot own, truncate or delegate privileges on application relations')
  const unsafeFunctions = await readCatalogRows(client, `
    select procedure.proname as name from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where (namespace.nspname = any($2::text[]) or (namespace.nspname !~ '^pg_' and namespace.nspname <> 'information_schema')) and (
      procedure.proowner = $1::oid
      or (procedure.prosecdef and has_function_privilege($1::oid, procedure.oid, 'EXECUTE'))
      or exists(select 1 from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
        where acl.grantee in (0, $1::oid) and acl.is_grantable)
    ) limit 1
  `, [role.role_id, schemas], z.object({ name: z.string() }))
  if (unsafeFunctions.length) throw new Error('[internal] Tenant boundary runtime role has unsafe application function ownership, delegation or SECURITY DEFINER access')
  return role
}
