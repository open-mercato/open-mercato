import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import type { RlsLiveRuntime, RlsPrincipal } from './liveRuntime'

export async function createPeopleBrowserFixtures(runtime: RlsLiveRuntime) {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5_000, query_timeout: 10_000 })
  const actors: RlsPrincipal[] = []
  const tenantIds = [runtime.first.tenantId, runtime.second.tenantId]
  const cleanup = async () => {
    const failures: unknown[] = []
    const userIds = actors.map((actor) => actor.userId)
    const removals: [string, string[]][] = [
      ['delete from access_logs where tenant_id=any($1::uuid[])', tenantIds],
      ['delete from action_logs where tenant_id=any($1::uuid[])', tenantIds],
      ['delete from sessions where user_id=any($1::uuid[])', userIds],
      ['delete from user_acls where user_id=any($1::uuid[])', userIds],
      ['delete from users where id=any($1::uuid[])', userIds],
      ['delete from customer_people where tenant_id=any($1::uuid[])', tenantIds],
      ['delete from customer_entities where tenant_id=any($1::uuid[]) and id<>all($2::uuid[])', tenantIds],
    ]
    try {
      for (const [query, identifiers] of removals) {
        try {
          await admin.query(query, query.includes('$2') ? [identifiers, [runtime.first.customerId, runtime.second.customerId]] : [identifiers])
        } catch (error) { failures.push(error) }
      }
    } finally { await admin.end() }
    if (failures.length) throw new AggregateError(failures, '[internal] People browser fixture cleanup failed')
  }
  try {
    for (const principal of [runtime.first, runtime.second]) {
      await admin.query('insert into customer_people(id,tenant_id,organization_id,entity_id,first_name,created_at,updated_at) values($1,$2,$3,$4,$5,now(),now())', [randomUUID(), principal.tenantId, principal.orgId, principal.customerId, principal.slug])
      const actor = { ...principal, userId: randomUUID(), sessionId: randomUUID(), token: '' }
      actors.push(actor)
      const email = `${actor.userId}@example.test`
      await admin.query('insert into users(id,tenant_id,organization_id,email,is_confirmed,created_at,updated_at) values($1,$2,$3,$4,true,now(),now())', [actor.userId, actor.tenantId, actor.orgId, email])
      await admin.query(`insert into user_acls(id,user_id,tenant_id,features_json,is_super_admin,organizations_json,created_at,updated_at) values($1,$2,$3,'["customers.*"]'::json,false,null,now(),now())`, [randomUUID(), actor.userId, actor.tenantId])
      await admin.query("insert into sessions(id,user_id,token,expires_at,created_at) values($1,$2,$3,now()+interval '1 hour',now())", [actor.sessionId, actor.userId, randomUUID()])
      actor.token = signJwt({ sub: actor.userId, sid: actor.sessionId, tenantId: actor.tenantId, orgId: actor.orgId, email, roles: [] })
    }
    const persistedPerson = async (id: string) => {
      const result = await admin.query('select entity.id,entity.tenant_id,entity.organization_id,entity.deleted_at,person.last_name from customer_entities entity left join customer_people person on person.entity_id=entity.id where entity.id=$1', [id])
      return result.rows as { id: string; tenant_id: string; organization_id: string; deleted_at: Date | null; last_name: string | null }[]
    }
    const retainedCustomers = async () => (await admin.query('select id,tenant_id,organization_id,display_name,updated_at,deleted_at from customer_entities where id=any($1::uuid[]) order by id', [[runtime.first.customerId, runtime.second.customerId]])).rows as Record<string, unknown>[]
    return { actors, cleanup, persistedPerson, retainedCustomers }
  } catch (error) {
    try { await cleanup() } catch (cleanupError) { throw new AggregateError([error, cleanupError], '[internal] People browser fixture setup and cleanup failed') }
    throw error
  }
}
