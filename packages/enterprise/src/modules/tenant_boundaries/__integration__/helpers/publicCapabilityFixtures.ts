import { randomUUID, createHash } from 'node:crypto'
import { Pool } from 'pg'
import type { RlsLiveRuntime } from './liveRuntime'

export async function createPublicCapabilityFixtures(runtime: RlsLiveRuntime) {
  const database = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5_000, query_timeout: 10_000 })
  const tenantIds = [runtime.first.tenantId, runtime.second.tenantId]
  const roleId = randomUUID()
  const personIds = [randomUUID(), randomUUID()]
  const email = `rls-public-${randomUUID()}@example.test`
  const password = `Initial-${randomUUID()}!`
  const nextPassword = `Reset-${randomUUID()}!`
  const users = async () => (await database.query<{
    id: string; tenant_id: string; organization_id: string; person_entity_id: string | null; email_verified_at: Date | null
  }>('select id,tenant_id,organization_id,person_entity_id,email_verified_at from customer_users where tenant_id=any($1::uuid[]) and email=$2 order by tenant_id', [tenantIds, email])).rows
  const cleanup = async () => {
    const failures: unknown[] = []
    try {
      for (const table of ['customer_user_sessions', 'customer_user_email_verifications', 'customer_user_password_resets', 'customer_user_roles', 'customer_user_acls']) {
        try { await database.query(`delete from ${table} where user_id in (select id from customer_users where tenant_id=any($1::uuid[]))`, [tenantIds]) } catch (error) { failures.push(error) }
      }
      for (const table of ['notifications', 'access_logs', 'action_logs', 'customer_users', 'customer_role_acls', 'customer_roles', 'customer_people']) {
        try { await database.query(`delete from ${table} where tenant_id=any($1::uuid[])`, [tenantIds]) } catch (error) { failures.push(error) }
      }
      try { await database.query('delete from customer_entities where id=any($1::uuid[])', [personIds]) } catch (error) { failures.push(error) }
    } finally { await database.end() }
    if (failures.length) throw new AggregateError(failures, '[internal] Public capability fixture cleanup failed')
  }
  try {
    await database.query(`update user_acls set features_json='["customers.*","customer_accounts.manage"]'::json where user_id=$1`, [runtime.first.userId])
    await database.query(`insert into customer_roles(id,tenant_id,organization_id,name,slug,is_default,is_system,customer_assignable,created_at,updated_at) values($1,$2,$3,'RLS public','rls-public',true,false,false,now(),now())`, [roleId, runtime.first.tenantId, runtime.first.orgId])
    await database.query(`insert into customer_role_acls(id,role_id,tenant_id,features_json,is_portal_admin,created_at,updated_at) values($1,$2,$3,'["portal.account.manage"]'::json,false,now(),now())`, [randomUUID(), roleId, runtime.first.tenantId])
    for (const [index, actor] of [runtime.first, runtime.second].entries()) {
      await database.query(`insert into customer_entities(id,tenant_id,organization_id,kind,display_name,primary_email,is_active,created_at,updated_at) values($1,$2,$3,'person','RLS public match',$4,true,now(),now())`, [personIds[index], actor.tenantId, actor.orgId, email])
      await database.query('insert into customer_people(id,tenant_id,organization_id,entity_id,first_name,created_at,updated_at) values($1,$2,$3,$4,$5,now(),now())', [randomUUID(), actor.tenantId, actor.orgId, personIds[index], 'Public'])
    }
    const tokenState = async (rawToken: string) => (await database.query<{ user_id: string; used_at: Date | null }>('select user_id,used_at from customer_user_password_resets where token=$1', [createHash('sha256').update(rawToken).digest('hex')])).rows
    const sessions = async () => (await database.query<{ user_id: string }>('select user_id from customer_user_sessions where user_id in (select id from customer_users where tenant_id=any($1::uuid[]) and email=$2)', [tenantIds, email])).rows
    const retainedPeople = async () => (await database.query('select id,tenant_id,organization_id,primary_email,updated_at from customer_entities where id=any($1::uuid[]) order by id', [personIds])).rows as Record<string, unknown>[]
    return { email, password, nextPassword, personIds, roleId, users, tokenState, sessions, retainedPeople, cleanup }
  } catch (error) {
    try { await cleanup() } catch (cleanupError) { throw new AggregateError([error, cleanupError], '[internal] Public capability setup and cleanup failed') }
    throw error
  }
}
