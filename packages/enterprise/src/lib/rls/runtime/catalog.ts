import { z } from 'zod'
import type { BoundaryClient } from './pool'

export async function readCatalogRows<Schema extends z.ZodType>(
  client: Pick<BoundaryClient, 'query'>,
  sql: string,
  parameters: readonly unknown[],
  schema: Schema,
): Promise<Array<z.output<Schema>>> {
  const result = await client.query(sql, parameters)
  if (!result || typeof result !== 'object' || !('rows' in result) || !Array.isArray(result.rows)) {
    throw new Error('[internal] PostgreSQL tenant boundary catalog returned an invalid result')
  }
  const parsed = z.array(schema).safeParse(result.rows)
  if (!parsed.success) throw new Error('[internal] PostgreSQL tenant boundary catalog does not match the supported server contract')
  return parsed.data
}

export const roleIdentitySchema = z.object({
  current_role: z.string(), session_role: z.string(), role_id: z.coerce.number().int(),
  server_version: z.coerce.number().int(), superuser: z.boolean(), bypass: z.boolean(),
  create_role: z.boolean(), create_database: z.boolean(), replication: z.boolean(), login: z.boolean(),
  memberships: z.boolean(), owns_database: z.boolean(), database_create: z.boolean(), database_temp: z.boolean(),
})

export type RuntimeRoleIdentity = z.output<typeof roleIdentitySchema>

export async function readRuntimeRoleIdentity(client: Pick<BoundaryClient, 'query'>): Promise<RuntimeRoleIdentity> {
  const rows = await readCatalogRows(client, `
    select current_user as current_role, session_user as session_role, role.oid as role_id,
      current_setting('server_version_num') as server_version,
      role.rolsuper as superuser, role.rolbypassrls as bypass,
      role.rolcreaterole as create_role, role.rolcreatedb as create_database,
      role.rolreplication as replication, role.rolcanlogin as login,
      exists(select 1 from pg_auth_members where member = role.oid) as memberships,
      database.datdba = role.oid as owns_database,
      has_database_privilege(role.oid, database.oid, 'CREATE') as database_create,
      has_database_privilege(role.oid, database.oid, 'TEMP') as database_temp
    from pg_roles role join pg_database database on database.datname = current_database()
    where role.rolname = current_user
  `, [], roleIdentitySchema)
  if (rows.length !== 1) throw new Error('[internal] Tenant boundary could not identify the runtime database role')
  return rows[0]
}
