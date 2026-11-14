import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Pool } from 'pg'
import { Queue as BullQueue } from 'bullmq'
import { parseRedisUrl } from '@open-mercato/shared/lib/redis/connection'
import { MikroORM } from '@mikro-orm/postgresql'
import { Entity, PrimaryKey, Property, ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { createQueue, type Queue, type JobHandler } from '../../../queue/src/index'
import { createPerJobWorkerHandler } from '../../../cli/src/lib/worker-job-handler'
import { createEventBus } from '../../../events/src/bus'
import eventsWorker from '../../../events/src/modules/events/workers/events.worker'
import { databaseDeclarations as eventsDatabase } from '../../../events/src/modules/events/database'
import { databaseDeclarations as nestedDatabase } from '../../../core/src/modules/data_sync/database'
import { databaseDeclarations as schedulerDatabase } from '../../../scheduler/src/modules/scheduler/database'
import { ScheduledJob } from '../../../scheduler/src/modules/scheduler/data/entities'
import schedulerWorker from '../../../scheduler/src/modules/scheduler/workers/execute-schedule.worker'
import { BullMQSchedulerService } from '../../../scheduler/src/modules/scheduler/services/bullmqSchedulerService'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { registerOrmEntities, getOrm } from '@open-mercato/shared/lib/db/mikro'
import { registerDatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import { registerDatabaseRuntimeAdapter, runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { createTenantBoundaryAdapter } from '../../src/lib/rls/runtime/registration'
import { currentTenantBoundaryScope } from '../../src/lib/rls/runtime/scope'
import { parseTenantTableManifest } from '../../src/lib/rls/runtime/manifest'
import { reconcileTenantTablePolicies } from '../../src/lib/rls/runtime/policies'
import type { BoundaryClient } from '../../src/lib/rls/runtime/pool'

@Entity({ tableName: 'worker_records' })
class WorkerRecord {
  @PrimaryKey({ type: 'uuid' }) id!: string
  @Property({ type: 'uuid', name: 'tenant_id' }) tenantId!: string
  @Property({ type: 'text' }) label!: string
}

const databaseUrl = process.env.OM_RLS_TEST_DATABASE_URL
assert.ok(databaseUrl, 'Disposable database URL required')
assert.ok(process.env.QUEUE_REDIS_URL, 'Disposable Redis URL required')
const admin = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000, query_timeout: 10000 })
const tenantA = randomUUID()
const tenantB = randomUUID()
const role = `runtime_${randomUUID().replaceAll('-', '')}`
const maintenanceRole = `maintenance_${randomUUID().replaceAll('-', '')}`
const password = randomUUID()
const runtimeUrl = new URL(databaseUrl)
runtimeUrl.username = role
runtimeUrl.password = password
const maintenanceUrl = new URL(runtimeUrl)
maintenanceUrl.username = maintenanceRole
const directory = await mkdtemp(path.join(tmpdir(), 'rls-worker-'))
const manifestPath = path.join(directory, 'manifest.json')
const manifest = parseTenantTableManifest({ version: 1, tables: [
  { schema: 'public', table: 'worker_records', owner: 'worker-fixture', classification: 'enforced', reason: 'Restricted SQL oracle', tenantColumn: 'tenant_id', tenantType: 'uuid', tenantNullable: false, policyVersion: 1 },
  { schema: 'public', table: 'scheduled_jobs', owner: 'scheduler', classification: 'mixed', reason: 'Production mixed schedule discovery', tenantColumn: 'tenant_id', tenantType: 'uuid', tenantNullable: true, policyVersion: null },
] })
const queues: Queue[] = []
const scopes: NonNullable<ReturnType<typeof currentTenantBoundaryScope>>[] = []
let disposals = 0
let active = 0
let maxActive = 0
let runtimeOrm: Awaited<ReturnType<typeof getOrm>> | undefined
let maintenanceOrm: Awaited<ReturnType<typeof getOrm>> | undefined
let scheduler: BullMQSchedulerService | undefined
const failures: Error[] = []
const attempts: number[] = []
const deliveries: string[] = []

function queue(name: string, retries = 1): Queue {
  const result = createQueue(name, 'async', { connection: { url: process.env.QUEUE_REDIS_URL! }, concurrency: 3, attempts: retries })
  queues.push(result)
  return result
}
async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 15000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${description}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
async function oracle(): Promise<void> {
  const scope = currentTenantBoundaryScope()!
  assert.equal(scope.context.kind, 'tenant')
  const rows = await runtimeOrm!.em.fork().getConnection().execute<{ label: string; actor: string }[]>('select label,current_user as actor from worker_records')
  assert.deepEqual(rows, [{ label: scope.context.tenantId === tenantA ? 'A' : 'B', actor: role }])
  await assert.rejects(runtimeOrm!.em.fork().getConnection().execute('insert into worker_records values (?, ?, ?)', [randomUUID(), scope.context.tenantId === tenantA ? tenantB : tenantA, 'forbidden']), /row.level security/i)
  await assert.rejects(maintenanceOrm!.em.fork().getConnection().execute('select * from worker_records'), /explicit maintenance/)
}
async function factory() {
  const scope = currentTenantBoundaryScope()!
  assert.ok(scope.invocation.isActive())
  scopes.push(scope)
  active += 1
  maxActive = Math.max(maxActive, active)
  const em = (scope.context.kind === 'maintenance' ? maintenanceOrm! : runtimeOrm!).em.fork()
  const bus = createEventBus({ queueStrategy: 'async', resolve: <Result,>() => undefined as Result })
  bus.on('fixture.event', async () => {
    await oracle()
    await new Promise((resolve) => setTimeout(resolve, 50))
    deliveries.push(scope.context.tenantId!)
  }, { persistent: true, id: 'fixture:subscriber' })
  const resolve = <Result,>(name: string): Result => {
    if (name === 'em') return em as Result
    if (name === 'eventBus') return bus as Result
    if (name === 'rbacService') return { tenantHasFeature: async () => true, userHasAllFeatures: async () => true } as Result
    throw new Error('[internal] Unknown fixture service')
  }
  return { resolve, dispose: async () => { assert.equal(currentTenantBoundaryScope(), scope); em.clear(); active -= 1; disposals += 1 } }
}
function worker(name: string, handler: JobHandler): JobHandler {
  return createPerJobWorkerHandler([{ id: `fixture:${name}`, queue: name, concurrency: 3, handler: (job, context) => handler(job as Parameters<JobHandler>[0], context as Parameters<JobHandler>[1]) }], factory)
}
async function observe(handler: JobHandler, job: Parameters<JobHandler>[0], context: Parameters<JobHandler>[1]) {
  try { await handler(job, context) } catch (error) { failures.push(error as Error); throw error }
}

try {
  const setup = await MikroORM.init({ clientUrl: databaseUrl, entities: [WorkerRecord, ScheduledJob], metadataProvider: ReflectMetadataProvider })
  try { await setup.schema.create() } finally { await setup.close(true) }
  await admin.query('revoke temporary on database postgres from public')
  await admin.query(`create role "${role}" login password '${password}' nosuperuser nobypassrls nocreaterole nocreatedb noreplication noinherit`)
  await admin.query(`create role "${maintenanceRole}" login password '${password}' nosuperuser bypassrls nocreaterole nocreatedb noreplication noinherit`)
  await admin.query(`grant usage on schema public to "${role}","${maintenanceRole}"`)
  await admin.query(`grant select,insert,update,delete on all tables in schema public to "${role}","${maintenanceRole}"`)
  await admin.query('insert into worker_records values ($1,$2,$3),($4,$5,$6)', [randomUUID(), tenantA, 'A', randomUUID(), tenantB, 'B'])
  const physical = await admin.connect()
  try { await reconcileTenantTablePolicies(physical as unknown as BoundaryClient, manifest, role) } finally { physical.release() }
  await writeFile(manifestPath, JSON.stringify(manifest))
  process.env.DATABASE_URL = runtimeUrl.toString()
  process.env.OM_TENANT_RLS_MAINTENANCE_DATABASE_URL = maintenanceUrl.toString()
  process.env.DB_POOL_MAX = '5'
  registerOrmEntities([WorkerRecord, ScheduledJob])
  registerDatabaseRuntimeAdapter(createTenantBoundaryAdapter({ enabled: true, poolMode: 'direct', schema: 'public', manifestPath }, process.env, randomUUID()))
  runtimeOrm = await getOrm()
  await runWithFreshDatabaseExecutionContext({ kind: 'maintenance', tenantId: null, source: 'scheduler', operation: 'fixture-setup' }, async () => { maintenanceOrm = await getOrm() })
  registerDatabaseModuleDeclarations([
    { moduleId: 'events', declarations: eventsDatabase }, { moduleId: 'data_sync', declarations: nestedDatabase },
    { moduleId: 'scheduler', declarations: schedulerDatabase },
    { moduleId: 'fixture', declarations: { bindingValidators: [async (identity) => {
      assert.equal(currentTenantBoundaryScope()?.context.kind, 'identity')
      const rows = await runtimeOrm!.em.fork().getConnection().execute<{ count: number }[]>('select count(*)::int as count from worker_records where tenant_id = ?', [identity.context.tenantId])
      return rows[0].count === 1
    }] } },
  ])

  const events = queue('events', 2)
  const eventHandler = worker('events', async (job, context) => {
    attempts.push(context.attemptNumber)
    await eventsWorker(job as Parameters<typeof eventsWorker>[0], context as Parameters<typeof eventsWorker>[1])
    if (context.attemptNumber === 1 && (job.payload as { retry?: boolean }).retry) throw new Error('[internal] deliberate Redis retry')
  })
  await events.process((job, context) => observe(eventHandler, job, context))
  await events.enqueue({ event: 'fixture.event', payload: { tenantId: tenantB }, options: { tenantId: tenantA }, retry: true })
  await events.enqueue({ event: 'fixture.event', payload: { tenantId: tenantA }, options: { tenantId: tenantB } })
  await waitFor(() => deliveries.length === 3 && disposals === 3, 'Redis concurrent event retry')
  assert.ok(maxActive >= 2)
  assert.deepEqual(deliveries.slice().sort(), [tenantA, tenantA, tenantB].sort())
  assert.ok(attempts.includes(2))
  assert.equal(new Set(scopes.map((scope) => scope.invocation.token)).size, 3)
  assert.ok(scopes.every((scope) => !scope.invocation.isActive()))
  process.stdout.write('PASS Redis concurrent A/B event SQL isolation and retry fresh invocation/disposal\n')

  const before = scopes.length
  const nested = queue('data-sync-import')
  const nestedHandler = worker('data-sync-import', async () => { await oracle(); deliveries.push('nested') })
  await nested.process((job, context) => observe(nestedHandler, job, context))
  await nested.enqueue({ scope: { tenantId: tenantA } })
  await waitFor(() => deliveries.includes('nested'), 'nested owner payload')
  assert.equal(scopes.length, before + 1)
  await waitFor(() => active === 0, 'nested container disposal')
  const beforeInvalid = scopes.length
  const job = (payload: unknown, metadata?: Record<string, unknown>) => ({ id: randomUUID(), createdAt: new Date().toISOString(), payload, metadata })
  const context = { queueName: 'events', jobId: 'invalid', attemptNumber: 1 }
  await assert.rejects(async () => eventHandler(job({ event: 'fixture.event', options: { tenantId: tenantA } }, { tenantId: tenantB }), context), /Conflicting/)
  const injector = new BullQueue('events', { connection: parseRedisUrl(process.env.QUEUE_REDIS_URL!) })
  try {
    await injector.add('forged-envelope', job({ event: 'fixture.event', options: { tenantId: tenantA } }, { tenantId: tenantB }), { attempts: 1, removeOnFail: 10 })
  } finally { await injector.close() }
  await events.enqueue({ event: 'fixture.event', payload: { tenantId: tenantA }, options: {} })
  await nested.enqueue({ scope: { tenantId: tenantA }, tenantId: tenantB })
  await nested.enqueue({ scope: { tenantId: randomUUID() } })
  await waitFor(() => failures.length >= 6, 'invalid jobs rejected')
  assert.equal(scopes.length, beforeInvalid)
  for (const pattern of [/Conflicting persisted event/, /Global event requires an explicit maintenance classifier/, /Missing or conflicting worker/, /persisted active tenant binding/]) {
    assert.ok(failures.some((error) => pattern.test(error.message)), `Expected rejection: ${pattern}`)
  }
  process.stdout.write('PASS actual event/nested owner classifiers reject invalid and forged metadata before tenant containers\n')

  registerModules([{ id: 'fixture', workers: [{ id: 'fixture:target', queue: 'fixture-target', concurrency: 2, schedulerSafe: true, handler: async () => {} }] }])
  const target = queue('fixture-target')
  let expectedScheduleKey = ''
  const targetHandler = worker('fixture-target', async (job) => {
    await oracle()
    const payload = job.payload as Record<string, unknown>
    assert.equal(payload.tenantId, tenantA)
    assert.equal(payload.organizationId, null)
    assert.deepEqual(payload.scope, { tenantId: tenantA, organizationId: null })
    assert.equal(payload._jobOrigin, 'scheduler')
    assert.equal(payload._idempotencyKey, expectedScheduleKey)
    deliveries.push('scheduled')
  })
  await target.process((job, context) => observe(targetHandler, job, context))
  const schedule = Object.assign(new ScheduledJob(), {
    id: randomUUID(), name: 'live regression', tenantId: tenantA, organizationId: null, scopeType: 'tenant',
    sourceType: 'module', sourceModule: 'fixture', targetType: 'queue', targetQueue: 'fixture-target',
    targetPayload: { tenantId: tenantB, organizationId: randomUUID(), scope: { tenantId: tenantB }, _idempotencyKey: 'forged', _jobOrigin: 'forged' },
    scheduleType: 'interval', scheduleValue: '1h', timezone: 'UTC', isEnabled: true,
  })
  await runWithFreshDatabaseExecutionContext({ kind: 'maintenance', tenantId: null, source: 'scheduler', operation: 'fixture-schedule' }, async () => {
    const em = maintenanceOrm!.em.fork()
    em.persist(schedule)
    await em.flush()
    assert.equal((await em.getConnection().execute<{ actor: string }[]>('select current_user as actor'))[0].actor, maintenanceRole)
    await assert.rejects(runtimeOrm!.em.fork().getConnection().execute('select * from worker_records'), /cannot borrow a runtime pool/)
  })
  scheduler = new BullMQSchedulerService(() => { throw new Error('[internal] startup EM must not be used') })
  await scheduler.syncAll()
  const scheduleQueue = queue('scheduler-execution')
  const scheduleHandler = worker('scheduler-execution', async (job, context) => {
    assert.equal(currentTenantBoundaryScope()?.context.source, 'scheduler')
    expectedScheduleKey = `scheduler-${schedule.id}-${context.jobId}`
    await schedulerWorker(job as Parameters<typeof schedulerWorker>[0], context as Parameters<typeof schedulerWorker>[1])
  })
  await scheduleQueue.process((job, context) => observe(scheduleHandler, job, context))
  await waitFor(() => deliveries.includes('scheduled'), 'actual BullMQ scheduled dispatch')
  await waitFor(() => active === 0, 'scheduler and target disposal')
  const beforeForged = scopes.length
  await scheduleQueue.enqueue({ scheduleId: schedule.id, scopeType: 'tenant', tenantId: tenantB, organizationId: null })
  await waitFor(() => failures.some((error) => /persisted scope/.test(error.message)), 'persisted schedule binding rejection')
  assert.equal(scopes.length, beforeForged)
  process.stdout.write('PASS production scheduler discovers with maintenance, dispatches canonical binding through Redis and refuses forged persisted scope\n')
  assert.deepEqual(await runtimeOrm.em.fork().getConnection().execute('select * from worker_records'), [])
  assert.equal(new Set(scopes.map((scope) => scope.invocation.token)).size, scopes.length)
  assert.equal(active, 0)
  assert.equal(disposals, scopes.length)
  assert.ok(scopes.every((scope) => !scope.invocation.isActive()))
} finally {
  await scheduler?.destroy()
  for (const owned of queues.reverse()) { await owned.close?.(); await owned.clear(); await owned.close?.() }
  await runtimeOrm?.close(true)
  await maintenanceOrm?.close(true)
  try {
    await admin.query('drop table if exists scheduled_jobs,worker_records cascade')
    await admin.query(`drop owned by "${role}","${maintenanceRole}"`)
    await admin.query(`drop role "${role}","${maintenanceRole}"`)
    const result = await admin.query('select count(*)::int as count from pg_roles where rolname = any($1)', [[role, maintenanceRole]])
    assert.equal(result.rows[0].count, 0)
  } finally { await admin.end(); await rm(directory, { recursive: true, force: true }) }
}
process.stdout.write('PASS Redis and scheduler assertions complete; database fixtures removed\n')
