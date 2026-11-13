import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import type { RlsLiveRuntime } from './liveRuntime'

export async function createCrudContractFixtures(runtime: RlsLiveRuntime) {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5_000, query_timeout: 10_000 })
  const tenantIds = [runtime.first.tenantId, runtime.second.tenantId]
  const key = `rls_contract_${randomUUID().replaceAll('-', '')}`
  const secretKey = `${key}_secret`
  const entityId = 'customers:customer_person_profile'
  const cleanup = async () => {
    const failures: unknown[] = []
    try {
      for (const table of ['custom_field_values', 'custom_field_defs', 'access_logs', 'action_logs', 'customer_people']) {
        try { await admin.query(`delete from ${table} where tenant_id=any($1::uuid[])`, [tenantIds]) } catch (error) { failures.push(error) }
      }
      try {
        await admin.query('delete from customer_entities where tenant_id=any($1::uuid[]) and id<>all($2::uuid[])', [tenantIds, [runtime.first.customerId, runtime.second.customerId]])
      } catch (error) { failures.push(error) }
    } finally { await admin.end() }
    if (failures.length) throw new AggregateError(failures, '[internal] CRUD contract cleanup failed')
  }
  try {
    for (const actor of [runtime.first, runtime.second]) {
      for (const [fieldKey, encrypted] of [[key, false], [secretKey, true]] as const) {
        await admin.query(`insert into custom_field_defs
          (id,entity_id,tenant_id,organization_id,key,kind,config_json,is_active,created_at,updated_at)
          values($1,$2,$3,$4,$5,'text',$6::jsonb,true,now(),now())`,
        [randomUUID(), entityId, actor.tenantId, actor.orgId, fieldKey, JSON.stringify({ label: fieldKey, encrypted })])
      }
    }
    return {
      key, secretKey, cleanup,
      definitions: async () => (await admin.query('select tenant_id,organization_id,key,config_json from custom_field_defs where tenant_id=any($1::uuid[]) and key=any($2::text[]) order by tenant_id,key', [tenantIds, [key, secretKey]])).rows,
      values: async (tenantId: string) => (await admin.query<{ field_key: string; value_text: string; tenant_id: string; organization_id: string }>('select field_key,value_text,tenant_id,organization_id from custom_field_values where tenant_id=$1 and entity_id=$2 and field_key=any($3::text[]) and deleted_at is null order by field_key', [tenantId, entityId, [key, secretKey]])).rows,
      person: async (id: string) => (await admin.query('select id,tenant_id,organization_id,display_name,updated_at,deleted_at from customer_entities where id=$1', [id])).rows,
      commands: async (tenantId: string, id: string) => (await admin.query<{ command_id: string; actor_user_id: string; execution_state: string }>('select command_id,actor_user_id,execution_state from action_logs where tenant_id=$1 and resource_id=$2 order by created_at', [tenantId, id])).rows,
    }
  } catch (error) {
    try { await cleanup() } catch (cleanupError) { throw new AggregateError([error, cleanupError], '[internal] CRUD fixture setup and cleanup failed') }
    throw error
  }
}
