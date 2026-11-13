import { randomUUID, createHash } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Pool, type PoolClient } from 'pg'
import { signAudienceJwt, signJwt } from '@open-mercato/shared/lib/auth/jwt'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'
import { quoteBoundaryIdentifier } from '../../../../lib/rls/runtime/config'
import { loadTenantTableManifest } from '../../../../lib/rls/runtime/manifest'
import { reconcileTenantTablePolicies, rollbackTenantTablePolicies } from '../../../../lib/rls/runtime/policies'
import type { BoundaryClient } from '../../../../lib/rls/runtime/pool'

export type RlsPrincipal = { tenantId: string; orgId: string; userId: string; sessionId: string; customerId: string; slug: string; token: string }
export type RlsLiveRuntime = {
  baseUrl: string; evidenceFile: string; first: RlsPrincipal; second: RlsPrincipal; selectedAdmin: RlsPrincipal;
  customerToken: string; serverLog(): Promise<string>; stop(): Promise<void>
}

function pinned(client: PoolClient): BoundaryClient {
  return { query: (...arguments_: unknown[]) => Reflect.apply(client.query, client, arguments_), release: client.release.bind(client) }
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('[internal] No local test port')
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

function principal(suffix: string): RlsPrincipal {
  return { tenantId: randomUUID(), orgId: randomUUID(), userId: randomUUID(), sessionId: randomUUID(), customerId: randomUUID(), slug: `rls-${suffix}`, token: '' }
}

export async function startRlsLiveRuntime(): Promise<RlsLiveRuntime> {
  if (!parseBooleanWithDefault(process.env.OM_INTEGRATION_TEST, false) || !process.env.DATABASE_URL || !process.env.JWT_SECRET) {
    throw new Error('[internal] RLS live fixture requires the repository native disposable integration runner')
  }
  const suffix = randomUUID().replaceAll('-', '')
  const role = `rls_live_${suffix}`
  const password = randomUUID()
  const directory = await mkdtemp(path.join(tmpdir(), 'om-rls-live-'))
  const evidenceFile = path.join(directory, 'render-evidence.jsonl')
  const logFile = path.join(directory, 'server.log')
  const log = await open(logFile, 'a')
  const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5_000, query_timeout: 10_000 })
  const first = principal(`a-${suffix}`)
  const second = principal(`b-${suffix}`)
  const selectedAdmin = { ...principal(`admin-${suffix}`), tenantId: first.tenantId, orgId: first.orgId }
  const customerUserId = randomUUID()
  const customerSessionId = randomUUID()
  const manifest = await loadTenantTableManifest({ schema: 'public' })
  let application: ChildProcess | undefined
  let roleCreated = false
  let policiesInstalled = false
  let restorePublicTemp = false
  let database = ''
  let stopped = false

  const serverLog = async () => (await readFile(logFile, 'utf8')).replaceAll(password, '[test credential]').replace(/postgres(?:ql)?:\/\/\S+/g, '[test database URL]')
  const stop = async () => {
    if (stopped) return
    stopped = true
    const failures: unknown[] = []
    if (application?.pid) {
      const pid = application.pid
      try { process.kill(-pid, 'SIGTERM') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failures.push(error) }
      const deadline = Date.now() + 5_000
      while (application.exitCode === null && application.signalCode === null && Date.now() < deadline) await delay(50)
      if (application.exitCode === null && application.signalCode === null) {
        try { process.kill(-pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failures.push(error) }
      }
    }
    try {
      if (policiesInstalled) {
        const client = await admin.connect()
        try { await rollbackTenantTablePolicies(pinned(client), manifest, role) } finally { client.release() }
      }
      await admin.query('delete from customer_user_sessions where user_id=$1', [customerUserId])
      await admin.query('delete from customer_user_acls where user_id=$1', [customerUserId])
      await admin.query('delete from customer_users where id=$1', [customerUserId])
      const userIds = [first.userId, second.userId, selectedAdmin.userId]
      await admin.query('delete from sessions where user_id=any($1::uuid[])', [userIds])
      await admin.query('delete from user_acls where user_id=any($1::uuid[])', [userIds])
      await admin.query('delete from users where id=any($1::uuid[])', [userIds])
      await admin.query('delete from customer_entities where id=any($1::uuid[])', [[first.customerId, second.customerId]])
      await admin.query('delete from organizations where id=any($1::uuid[])', [[first.orgId, second.orgId]])
      await admin.query('delete from tenants where id=any($1::uuid[])', [[first.tenantId, second.tenantId]])
      if (roleCreated) {
        await admin.query(`drop owned by ${quoteBoundaryIdentifier(role)}`)
        await admin.query(`drop role ${quoteBoundaryIdentifier(role)}`)
      }
      if (restorePublicTemp) await admin.query(`grant temporary on database ${quoteBoundaryIdentifier(database)} to public`)
    } catch (error) { failures.push(error) } finally { await admin.end(); await log.close() }
    if (!failures.length) await rm(directory, { recursive: true, force: true })
    if (failures.length) throw new AggregateError(failures, '[internal] RLS live fixture cleanup failed; private evidence retained')
  }

  try {
    const existing = await admin.query('select count(*)::integer as count from pg_policy where polrelid=$1::regclass', ['public.customer_entities'])
    if (existing.rows[0].count !== 0) throw new Error('[internal] Live RLS fixture refuses an already-enrolled canary')
    for (const actor of [first, second]) {
      await admin.query('insert into tenants(id,name,is_active,created_at,updated_at) values($1,$2,true,now(),now())', [actor.tenantId, actor.slug])
      await admin.query("insert into organizations(id,tenant_id,name,slug,is_active,ancestor_ids,child_ids,descendant_ids,depth,created_at,updated_at) values($1,$2,$3,$3,true,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,0,now(),now())", [actor.orgId, actor.tenantId, actor.slug])
      await admin.query("insert into customer_entities(id,tenant_id,organization_id,kind,display_name,is_active,created_at,updated_at) values($1,$2,$3,'person',$4,true,now(),now())", [actor.customerId, actor.tenantId, actor.orgId, actor.slug])
    }
    for (const actor of [first, second, selectedAdmin]) {
      const email = `${actor.userId}@example.test`
      await admin.query('insert into users(id,tenant_id,organization_id,email,is_confirmed,created_at,updated_at) values($1,$2,$3,$4,true,now(),now())', [actor.userId, actor.tenantId, actor.orgId, email])
      await admin.query("insert into user_acls(id,user_id,tenant_id,features_json,is_super_admin,organizations_json,created_at,updated_at) values($1,$2,$3,'[\"customers.*\"]'::json,$4,null,now(),now())", [randomUUID(), actor.userId, actor.tenantId, actor === selectedAdmin])
      await admin.query("insert into sessions(id,user_id,token,expires_at,created_at) values($1,$2,$3,now()+interval '1 hour',now())", [actor.sessionId, actor.userId, randomUUID()])
      actor.token = signJwt({ sub: actor.userId, sid: actor.sessionId, tenantId: actor.tenantId, orgId: actor.orgId, email, roles: [] })
    }
    await admin.query('insert into customer_users(id,tenant_id,organization_id,email,email_hash,display_name,is_active,created_at,updated_at) values($1,$2,$3,$4,$5,$6,true,now(),now())', [customerUserId, second.tenantId, second.orgId, `${customerUserId}@example.test`, createHash('sha256').update(customerUserId).digest('hex'), 'RLS fixture'])
    await admin.query("insert into customer_user_acls(id,user_id,tenant_id,features_json,is_portal_admin,created_at,updated_at) values($1,$2,$3,'[\"portal.*\"]'::json,true,now(),now())", [randomUUID(), customerUserId, second.tenantId])
    await admin.query("insert into customer_user_sessions(id,user_id,token_hash,expires_at,created_at) values($1,$2,$3,now()+interval '1 hour',now())", [customerSessionId, customerUserId, createHash('sha256').update(randomUUID()).digest('hex')])
    const customerToken = signAudienceJwt('customer', { sub: customerUserId, sid: customerSessionId, type: 'customer', tenantId: second.tenantId, orgId: second.orgId, email: `${customerUserId}@example.test`, displayName: 'RLS fixture', resolvedFeatures: [] }, 3600)
    const details = await admin.query("select current_database() as name, exists(select 1 from pg_database db cross join lateral aclexplode(coalesce(db.datacl,acldefault('d',db.datdba))) acl where db.datname=current_database() and acl.grantee=0 and acl.privilege_type='TEMPORARY') as public_temp")
    database = details.rows[0].name
    restorePublicTemp = details.rows[0].public_temp
    await admin.query(`revoke temporary on database ${quoteBoundaryIdentifier(database)} from public`)
    await admin.query(`create role ${quoteBoundaryIdentifier(role)} login password '${password}' nosuperuser nobypassrls nocreaterole nocreatedb noreplication noinherit`)
    roleCreated = true
    await admin.query(`grant usage on schema public to ${quoteBoundaryIdentifier(role)}`)
    await admin.query(`grant select,insert,update,delete on all tables in schema public to ${quoteBoundaryIdentifier(role)}`)
    await admin.query(`grant usage,select on all sequences in schema public to ${quoteBoundaryIdentifier(role)}`)
    const client = await admin.connect()
    try { await reconcileTenantTablePolicies(pinned(client), manifest, role); policiesInstalled = true } finally { client.release() }
    const runtimeUrl = new URL(process.env.DATABASE_URL)
    runtimeUrl.username = role
    runtimeUrl.password = password
    const port = await freePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const runtimeEnvironment = {
      ...process.env, DATABASE_URL: runtimeUrl.toString(), OM_TENANT_RLS: 'on', OM_TENANT_RLS_POOL_MODE: 'direct',
      OM_ENABLE_ENTERPRISE_MODULES: 'true', OM_INTEGRATION_TEST: '1', OM_RLS_PROBE_EVIDENCE_FILE: evidenceFile,
      AUTO_SPAWN_WORKERS: 'false', CACHE_STRATEGY: 'memory', QUEUE_BASE_DIR: path.join(directory, 'queue'), DB_POOL_MAX: '1',
      PLATFORM_DOMAINS: 'localhost,127.0.0.1', BASE_URL: baseUrl, APP_URL: baseUrl, NEXT_PUBLIC_APP_URL: baseUrl,
    }
    delete (runtimeEnvironment as NodeJS.ProcessEnv).OM_TENANT_RLS_MAINTENANCE_DATABASE_URL
    const nextExecutable = createRequire(path.join(resolveAppRoot(), 'package.json')).resolve('next/dist/bin/next')
    application = spawn(process.execPath, [nextExecutable, 'start', '--port', String(port), '--hostname', '127.0.0.1'], {
      cwd: resolveAppRoot(), env: runtimeEnvironment, detached: true, stdio: ['ignore', log.fd, log.fd], timeout: 300_000,
    })
    const deadline = Date.now() + 15_000
    let ready = false
    while (Date.now() < deadline && application.exitCode === null) {
      try {
        const response = await fetch(baseUrl + '/login', { signal: AbortSignal.timeout(500) })
        if (response.status === 200) { ready = true; break }
      } catch {}
      await delay(100)
    }
    if (!ready) throw new Error('[internal] Restricted RLS app did not become ready: ' + await serverLog())
    return { baseUrl, evidenceFile, first, second, selectedAdmin, customerToken, serverLog, stop }
  } catch (error) {
    try { await stop() } catch (cleanupError) { throw new AggregateError([error, cleanupError], '[internal] RLS fixture setup and cleanup failed') }
    throw error
  }
}
