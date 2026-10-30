/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { LockMode, MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { StartedTestContainer } from 'testcontainers'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import {
  StaffSupportRoutingRule,
  StaffSupportTicket,
  StaffTeamMember,
  StaffTimeProject,
  StaffTimeTask,
  StaffTimeTaskStatus,
} from '../data/entities'
import '../commands/timesheets-tasks'
import '../commands/support-routing-rules'
import '../commands/support-tickets'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((em: { find: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.find(...args.slice(0, 3))),
  findOneWithDecryption: jest.fn((em: { findOne: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.findOne(...args.slice(0, 3))),
}))

jest.mock('../events', () => ({
  emitStaffEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../lib/support/dictionaries', () => ({
  findSupportTicketCategory: jest.fn(async () => ({ value: 'billing', label: 'Billing' })),
}))

const mockRouteProjectIds = new Map<string, string>()

jest.mock('../lib/support/routing', () => ({
  resolveSupportRoute: jest.fn(async (_em: unknown, scope: { organizationId: string }) => {
    const timeProjectId = mockRouteProjectIds.get(scope.organizationId)
    return timeProjectId ? { timeProjectId, via: 'fallback' } : null
  }),
}))

jest.mock('../lib/time-tracking/projectAssignment', () => ({
  resolveAssignmentGraceDaysFromContainer: jest.fn(async () => 0),
  resolveUsableDefaultAssignee: jest.fn(async () => null),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'staff_fallback_lock_test'
const DATABASE_USER = 'staff_fallback_lock'
const DATABASE_PASSWORD = 'staff_fallback_lock'
const CASE_TIMEOUT_MS = 30_000
const WAITER_POLL_MS = 25
const WAITER_TIMEOUT_MS = 10_000

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type Deferred = { promise: Promise<void>; resolve: () => void }

type GatedMethod = 'findOne' | 'find' | 'count'

type GateSpec = {
  method: GatedMethod
  entity: string
  lockMode?: LockMode
}

type Gate = GateSpec & { fired: boolean; reached: Deferred; release: Deferred }

type CommandError = { status?: number; body?: { code?: string; fieldErrors?: Record<string, string> } }

type Outcome<T> = { ok: true; value: T } | { ok: false; error: CommandError }

type Handler = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
  undo: (args: { logEntry: unknown; ctx: unknown }) => Promise<void>
  prepare?: (input: unknown, ctx: unknown) => Promise<Record<string, unknown>>
  buildLog?: (args: { snapshots?: unknown; result?: unknown; ctx?: unknown }) => Promise<{ payload: unknown } | null>
}

type Seed = {
  tenantId: string
  organizationId: string
  userId: string
  projectId: string
  statusId: string
  ruleId: string
  otherProjectId: string
}

type ChangeRecord = { action: string; entityType: string }

function createDeferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((resolveDeferred) => {
    resolve = resolveDeferred
  })
  return { promise, resolve }
}

function createGate(spec: GateSpec): Gate {
  return { ...spec, fired: false, reached: createDeferred(), release: createDeferred() }
}

function entityNameOf(value: unknown): string | null {
  if (typeof value === 'function') return value.name
  return null
}

function gateMatches(gate: Gate, method: string, args: unknown[]): boolean {
  if (gate.fired || gate.method !== method) return false
  if (entityNameOf(args[0]) !== gate.entity) return false
  if (gate.method !== 'findOne') return true
  const options = args[2] as { lockMode?: LockMode } | undefined
  return (options?.lockMode ?? null) === (gate.lockMode ?? null)
}

function gatedFork(root: EntityManager, gate: Gate | null): EntityManager {
  const target = root.fork()
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object)
      if (typeof value !== 'function') return value
      const bound = (value as (...args: unknown[]) => unknown).bind(object)
      if (!gate || property !== gate.method) return bound
      return async (...args: unknown[]) => {
        const matched = gateMatches(gate, property, args)
        const result = await bound(...args)
        if (matched) {
          gate.fired = true
          gate.reached.resolve()
          await gate.release.promise
        }
        return result
      }
    },
  })
}

async function settle<T>(promise: Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await promise }
  } catch (error) {
    return { ok: false, error: error as CommandError }
  }
}

function handler(id: string): Handler {
  const registered = commandRegistry.get(id) as unknown as Handler | undefined
  if (!registered) throw new Error(`[internal] command ${id} is not registered`)
  return registered
}

describeWithPostgres('staff fallback-project undo against concurrent task writers on real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null
  const changes: ChangeRecord[] = []
  const dataEngine = {
    markOrmEntityChange: (change: { action: string; indexer?: { entityType: string } }) => {
      changes.push({ action: change.action, entityType: change.indexer?.entityType ?? 'unknown' })
    },
  }

  function rootEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not started')
    return orm.em.fork()
  }

  function staffCtx(seed: Seed, gate: Gate | null = null) {
    const root = rootEm()
    return {
      auth: { sub: seed.userId, tenantId: seed.tenantId, orgId: seed.organizationId, roles: [], isSuperAdmin: false },
      selectedOrganizationId: seed.organizationId,
      container: {
        resolve: (name: string) => {
          if (name === 'em') {
            return new Proxy(root, {
              get(object, property) {
                if (property === 'fork') return () => gatedFork(root, gate)
                const value = Reflect.get(object, property, object)
                return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(object) : value
              },
            })
          }
          if (name === 'dataEngine') return dataEngine
          throw new Error(`[internal] unexpected resolve ${name}`)
        },
      } as unknown as AwilixContainer,
    }
  }

  async function seedFallback(options: { ruleTargetsOtherProject?: boolean } = {}): Promise<Seed> {
    const seed: Seed = {
      tenantId: randomUUID(),
      organizationId: randomUUID(),
      userId: randomUUID(),
      projectId: randomUUID(),
      statusId: randomUUID(),
      ruleId: randomUUID(),
      otherProjectId: randomUUID(),
    }
    const scope = { tenantId: seed.tenantId, organizationId: seed.organizationId }
    const em = rootEm()
    em.create(StaffTimeProject, { ...scope, id: seed.projectId, name: 'Customer support', code: 'SUP' })
    em.create(StaffTimeTaskStatus, { ...scope, id: seed.statusId, timeProjectId: seed.projectId, name: 'New', slug: 'new', isDefault: true, position: 1000 })
    em.create(StaffTimeProject, { ...scope, id: seed.otherProjectId, name: 'Escalations', code: 'ESC' })
    em.create(StaffTimeTaskStatus, { ...scope, timeProjectId: seed.otherProjectId, id: randomUUID(), name: 'New', slug: 'new', isDefault: true, position: 1000 })
    em.create(StaffSupportRoutingRule, {
      ...scope,
      id: seed.ruleId,
      categoryValue: null,
      timeProjectId: options.ruleTargetsOtherProject ? seed.otherProjectId : seed.projectId,
    })
    await em.flush()
    mockRouteProjectIds.set(seed.organizationId, seed.projectId)
    return seed
  }

  function fallbackUndoEntry(seed: Seed) {
    return {
      commandPayload: {
        undo: {
          ruleId: seed.ruleId,
          timeProjectId: seed.projectId,
          taskStatusIds: [seed.statusId],
          tenantId: seed.tenantId,
          organizationId: seed.organizationId,
        },
      },
    }
  }

  function createTaskInput(seed: Seed) {
    return { tenantId: seed.tenantId, organizationId: seed.organizationId, timeProjectId: seed.projectId, title: 'Internal follow-up' }
  }

  function intakeInput(seed: Seed) {
    return {
      tenantId: seed.tenantId,
      organizationId: seed.organizationId,
      customerId: randomUUID(),
      customerUserId: randomUUID(),
      categoryValue: 'billing',
      subject: 'Invoice question',
      description: 'The last invoice is missing a line.',
    }
  }

  async function waitForLockWaiters(count: number): Promise<void> {
    const deadline = Date.now() + WAITER_TIMEOUT_MS
    while (Date.now() < deadline) {
      const rows = await rootEm().execute<Array<{ waiting: number }>>(
        `select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      )
      if (rows[0].waiting >= count) return
      await new Promise((resolve) => setTimeout(resolve, WAITER_POLL_MS))
    }
    throw new Error(`[internal] no transaction started waiting on a row lock within ${WAITER_TIMEOUT_MS}ms`)
  }

  async function readState(seed: Seed) {
    const em = rootEm()
    const [project] = await em.execute<Array<{ deleted_at: Date | null }>>(
      'select deleted_at from staff_time_projects where id = ?',
      [seed.projectId],
    )
    const [rule] = await em.execute<Array<{ deleted_at: Date | null; time_project_id: string }>>(
      'select deleted_at, time_project_id from staff_support_routing_rules where id = ?',
      [seed.ruleId],
    )
    const [tasks] = await em.execute<Array<{ live: number }>>(
      'select count(*)::int as live from staff_time_tasks where time_project_id = ? and deleted_at is null',
      [seed.projectId],
    )
    const [orphans] = await em.execute<Array<{ orphaned: number }>>(
      `select count(*)::int as orphaned
         from staff_time_tasks task
         join staff_time_projects project on project.id = task.time_project_id
        where task.organization_id = ? and task.deleted_at is null and project.deleted_at is not null`,
      [seed.organizationId],
    )
    const [rules] = await em.execute<Array<{ orphaned: number }>>(
      `select count(*)::int as orphaned
         from staff_support_routing_rules rule
         join staff_time_projects project on project.id = rule.time_project_id
        where rule.organization_id = ? and rule.deleted_at is null and project.deleted_at is not null`,
      [seed.organizationId],
    )
    expect(rules.orphaned).toBe(0)
    return {
      projectDeleted: project.deleted_at !== null,
      ruleDeleted: rule.deleted_at !== null,
      ruleProjectId: rule.time_project_id,
      liveTasks: tasks.live,
      orphanedTasks: orphans.orphaned,
    }
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: DATABASE_NAME,
        POSTGRES_USER: DATABASE_USER,
        POSTGRES_PASSWORD: DATABASE_PASSWORD,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      entities: [StaffTimeProject, StaffTimeTaskStatus, StaffTimeTask, StaffSupportRoutingRule, StaffSupportTicket, StaffTeamMember],
      debug: false,
      pool: { min: 0, max: 8 },
    })
    await orm.schema.create()
  }, 120_000)

  beforeEach(() => {
    changes.length = 0
  })

  afterAll(async () => {
    await Promise.allSettled([orm?.close(true)])
    await Promise.allSettled([postgres?.stop()])
  }, 30_000)

  describe('staff task create', () => {
    it('create holding the shared project lock commits first and the undo then refuses', async () => {
      const seed = await seedFallback()
      const gate = createGate({ method: 'findOne', entity: 'StaffTimeProject', lockMode: LockMode.PESSIMISTIC_READ })

      const creating = settle(handler('staff.timesheets.tasks.create').execute(createTaskInput(seed), staffCtx(seed, gate)))
      await gate.reached.promise
      const undoing = settle(handler('staff.support.routing_rules.create_fallback_project').undo({ logEntry: fallbackUndoEntry(seed), ctx: staffCtx(seed) }))
      await waitForLockWaiters(1)
      gate.release.resolve()
      const [created, undone] = await Promise.all([creating, undoing])

      expect(created.ok).toBe(true)
      expect(undone.ok).toBe(false)
      if (!undone.ok) {
        expect(undone.error.status).toBe(409)
        expect(undone.error.body?.code).toBe('support_fallback_project_in_use')
      }
      expect(await readState(seed)).toEqual({
        projectDeleted: false,
        ruleDeleted: false,
        ruleProjectId: seed.projectId,
        liveTasks: 1,
        orphanedTasks: 0,
      })
    }, CASE_TIMEOUT_MS)

    it('undo holding the exclusive project lock commits first and the create then refuses', async () => {
      const seed = await seedFallback()
      const gate = createGate({ method: 'count', entity: 'StaffTimeTask' })

      const undoing = settle(handler('staff.support.routing_rules.create_fallback_project').undo({ logEntry: fallbackUndoEntry(seed), ctx: staffCtx(seed, gate) }))
      await gate.reached.promise
      const creating = settle(handler('staff.timesheets.tasks.create').execute(createTaskInput(seed), staffCtx(seed)))
      await waitForLockWaiters(1)
      gate.release.resolve()
      const [undone, created] = await Promise.all([undoing, creating])

      expect(undone.ok).toBe(true)
      expect(created.ok).toBe(false)
      if (!created.ok) {
        expect(created.error.status).toBe(422)
        expect(created.error.body?.fieldErrors?.timeProjectId).toBeTruthy()
      }
      expect(await readState(seed)).toEqual({
        projectDeleted: true,
        ruleDeleted: true,
        ruleProjectId: seed.projectId,
        liveTasks: 0,
        orphanedTasks: 0,
      })
    }, CASE_TIMEOUT_MS)
  })

  describe('undo of a task delete (restore)', () => {
    async function deletedTaskLog(seed: Seed): Promise<unknown> {
      const created = (await handler('staff.timesheets.tasks.create').execute(createTaskInput(seed), staffCtx(seed))) as { taskId: string }
      const command = handler('staff.timesheets.tasks.delete')
      const ctx = staffCtx(seed)
      const before = await command.prepare!({ id: created.taskId }, ctx)
      const result = await command.execute({ id: created.taskId }, ctx)
      const log = await command.buildLog!({ snapshots: before, result, ctx })
      return { commandPayload: log?.payload }
    }

    it('restore holding the shared project lock commits first and the undo then refuses', async () => {
      const seed = await seedFallback()
      const logEntry = await deletedTaskLog(seed)
      const gate = createGate({ method: 'findOne', entity: 'StaffTimeProject', lockMode: LockMode.PESSIMISTIC_READ })

      const restoring = settle(handler('staff.timesheets.tasks.delete').undo({ logEntry, ctx: staffCtx(seed, gate) }))
      await gate.reached.promise
      const undoing = settle(handler('staff.support.routing_rules.create_fallback_project').undo({ logEntry: fallbackUndoEntry(seed), ctx: staffCtx(seed) }))
      await waitForLockWaiters(1)
      gate.release.resolve()
      const [restored, undone] = await Promise.all([restoring, undoing])

      expect(restored.ok).toBe(true)
      expect(undone.ok).toBe(false)
      if (!undone.ok) expect(undone.error.status).toBe(409)
      expect(await readState(seed)).toEqual(expect.objectContaining({ projectDeleted: false, liveTasks: 1, orphanedTasks: 0 }))
    }, CASE_TIMEOUT_MS)

    it('undo holding the exclusive project lock commits first and the restore then refuses', async () => {
      const seed = await seedFallback()
      const logEntry = await deletedTaskLog(seed)
      const gate = createGate({ method: 'count', entity: 'StaffTimeTask' })

      const undoing = settle(handler('staff.support.routing_rules.create_fallback_project').undo({ logEntry: fallbackUndoEntry(seed), ctx: staffCtx(seed, gate) }))
      await gate.reached.promise
      const restoring = settle(handler('staff.timesheets.tasks.delete').undo({ logEntry, ctx: staffCtx(seed) }))
      await waitForLockWaiters(1)
      gate.release.resolve()
      const [undone, restored] = await Promise.all([undoing, restoring])

      expect(undone.ok).toBe(true)
      expect(restored.ok).toBe(false)
      if (!restored.ok) expect(restored.error.status).toBe(422)
      expect(await readState(seed)).toEqual(expect.objectContaining({ projectDeleted: true, liveTasks: 0, orphanedTasks: 0 }))
    }, CASE_TIMEOUT_MS)
  })

  describe('portal ticket intake', () => {
    it('intake holding the shared project lock commits first and the undo then refuses', async () => {
      const seed = await seedFallback()
      const gate = createGate({ method: 'findOne', entity: 'StaffTimeProject', lockMode: LockMode.PESSIMISTIC_READ })

      const filing = settle(handler('staff.support_tickets.create_from_portal').execute(intakeInput(seed), staffCtx(seed, gate)))
      await gate.reached.promise
      const undoing = settle(handler('staff.support.routing_rules.create_fallback_project').undo({ logEntry: fallbackUndoEntry(seed), ctx: staffCtx(seed) }))
      await waitForLockWaiters(1)
      gate.release.resolve()
      const [filed, undone] = await Promise.all([filing, undoing])

      expect(filed.ok).toBe(true)
      expect(undone.ok).toBe(false)
      if (!undone.ok) expect(undone.error.status).toBe(409)
      expect(await readState(seed)).toEqual(expect.objectContaining({ projectDeleted: false, ruleDeleted: false, liveTasks: 1, orphanedTasks: 0 }))
    }, CASE_TIMEOUT_MS)

    it('undo holding the exclusive project lock commits first and the intake then refuses', async () => {
      const seed = await seedFallback()
      const gate = createGate({ method: 'count', entity: 'StaffTimeTask' })

      const undoing = settle(handler('staff.support.routing_rules.create_fallback_project').undo({ logEntry: fallbackUndoEntry(seed), ctx: staffCtx(seed, gate) }))
      await gate.reached.promise
      const filing = settle(handler('staff.support_tickets.create_from_portal').execute(intakeInput(seed), staffCtx(seed)))
      await waitForLockWaiters(1)
      gate.release.resolve()
      const [undone, filed] = await Promise.all([undoing, filing])

      expect(undone.ok).toBe(true)
      expect(filed.ok).toBe(false)
      if (!filed.ok) {
        expect(filed.error.status).toBe(422)
        expect(filed.error.body?.code).toBe('support_category_unavailable')
      }
      expect(await readState(seed)).toEqual(expect.objectContaining({ projectDeleted: true, liveTasks: 0, orphanedTasks: 0 }))
    }, CASE_TIMEOUT_MS)
  })

  describe('fallback rule repoint', () => {
    function repointInput(seed: Seed) {
      return { id: seed.ruleId, timeProjectId: seed.otherProjectId }
    }

    it('keeps a rule repointed after the undo read its rows and before it wrote', async () => {
      const seed = await seedFallback()
      const gate = createGate({ method: 'find', entity: 'StaffTimeTaskStatus' })

      const undoing = settle(handler('staff.support.routing_rules.create_fallback_project').undo({ logEntry: fallbackUndoEntry(seed), ctx: staffCtx(seed, gate) }))
      await gate.reached.promise
      const repointed = await settle(handler('staff.support.routing_rules.update').execute(repointInput(seed), staffCtx(seed)))
      gate.release.resolve()
      const undone = await undoing

      expect(repointed.ok).toBe(true)
      expect(undone.ok).toBe(true)
      expect(await readState(seed)).toEqual({
        projectDeleted: true,
        ruleDeleted: false,
        ruleProjectId: seed.otherProjectId,
        liveTasks: 0,
        orphanedTasks: 0,
      })
      expect(changes.filter((change) => change.action === 'deleted').map((change) => change.entityType)).toEqual(['staff:staff_time_project'])
    }, CASE_TIMEOUT_MS)

    it('keeps a rule whose repoint holds the row lock while the undo tries to delete it', async () => {
      const seed = await seedFallback()
      const gate = createGate({ method: 'findOne', entity: 'StaffSupportRoutingRule', lockMode: LockMode.PESSIMISTIC_WRITE })

      const repointing = settle(handler('staff.support.routing_rules.update').execute(repointInput(seed), staffCtx(seed, gate)))
      await gate.reached.promise
      const undoing = settle(handler('staff.support.routing_rules.create_fallback_project').undo({ logEntry: fallbackUndoEntry(seed), ctx: staffCtx(seed) }))
      await waitForLockWaiters(1)
      gate.release.resolve()
      const [repointed, undone] = await Promise.all([repointing, undoing])

      expect(repointed.ok).toBe(true)
      expect(undone.ok).toBe(true)
      expect(await readState(seed)).toEqual(expect.objectContaining({ projectDeleted: true, ruleDeleted: false, ruleProjectId: seed.otherProjectId }))
      expect(changes.filter((change) => change.action === 'deleted').map((change) => change.entityType)).toEqual(['staff:staff_time_project'])
    }, CASE_TIMEOUT_MS)

    it('refuses a repoint whose rule the undo deleted after the repoint first read it', async () => {
      const seed = await seedFallback()
      const gate = createGate({ method: 'findOne', entity: 'StaffSupportRoutingRule' })

      const repointing = settle(handler('staff.support.routing_rules.update').execute(repointInput(seed), staffCtx(seed, gate)))
      await gate.reached.promise
      const undone = await settle(handler('staff.support.routing_rules.create_fallback_project').undo({ logEntry: fallbackUndoEntry(seed), ctx: staffCtx(seed) }))
      gate.release.resolve()
      const repointed = await repointing

      expect(undone.ok).toBe(true)
      expect(repointed.ok).toBe(false)
      if (!repointed.ok) expect(repointed.error.status).toBe(404)
      expect(await readState(seed)).toEqual(expect.objectContaining({ projectDeleted: true, ruleDeleted: true, ruleProjectId: seed.projectId }))
    }, CASE_TIMEOUT_MS)

    it('repoint to the undone project holding the shared project lock commits first and the undo then removes both', async () => {
      const seed = await seedFallback({ ruleTargetsOtherProject: true })
      const gate = createGate({ method: 'findOne', entity: 'StaffTimeProject', lockMode: LockMode.PESSIMISTIC_READ })

      const repointing = settle(handler('staff.support.routing_rules.update').execute({ id: seed.ruleId, timeProjectId: seed.projectId }, staffCtx(seed, gate)))
      await gate.reached.promise
      const undoing = settle(handler('staff.support.routing_rules.create_fallback_project').undo({ logEntry: fallbackUndoEntry(seed), ctx: staffCtx(seed) }))
      await waitForLockWaiters(1)
      gate.release.resolve()
      const [repointed, undone] = await Promise.all([repointing, undoing])

      expect(repointed.ok).toBe(true)
      expect(undone.ok).toBe(true)
      expect(await readState(seed)).toEqual({
        projectDeleted: true,
        ruleDeleted: true,
        ruleProjectId: seed.projectId,
        liveTasks: 0,
        orphanedTasks: 0,
      })
    }, CASE_TIMEOUT_MS)

    it('refuses an update to the current target once a concurrent repoint and undo removed that target', async () => {
      const seed = await seedFallback()
      const gate = createGate({ method: 'findOne', entity: 'StaffSupportRoutingRule' })

      const updating = settle(handler('staff.support.routing_rules.update').execute({ id: seed.ruleId, timeProjectId: seed.projectId }, staffCtx(seed, gate)))
      await gate.reached.promise
      const repointed = await settle(handler('staff.support.routing_rules.update').execute(repointInput(seed), staffCtx(seed)))
      const undone = await settle(handler('staff.support.routing_rules.create_fallback_project').undo({ logEntry: fallbackUndoEntry(seed), ctx: staffCtx(seed) }))
      gate.release.resolve()
      const updated = await updating

      expect(repointed.ok).toBe(true)
      expect(undone.ok).toBe(true)
      expect(updated.ok).toBe(false)
      if (!updated.ok) {
        expect(updated.error.status).toBe(422)
        expect(updated.error.body?.code).toBe('support_project_not_found')
      }
      expect(await readState(seed)).toEqual({
        projectDeleted: true,
        ruleDeleted: false,
        ruleProjectId: seed.otherProjectId,
        liveTasks: 0,
        orphanedTasks: 0,
      })
    }, CASE_TIMEOUT_MS)

    it('undo holding the exclusive project lock commits first and a repoint to that project then refuses', async () => {
      const seed = await seedFallback({ ruleTargetsOtherProject: true })
      const gate = createGate({ method: 'count', entity: 'StaffTimeTask' })

      const undoing = settle(handler('staff.support.routing_rules.create_fallback_project').undo({ logEntry: fallbackUndoEntry(seed), ctx: staffCtx(seed, gate) }))
      await gate.reached.promise
      const repointing = settle(handler('staff.support.routing_rules.update').execute({ id: seed.ruleId, timeProjectId: seed.projectId }, staffCtx(seed)))
      await waitForLockWaiters(1)
      gate.release.resolve()
      const [undone, repointed] = await Promise.all([undoing, repointing])

      expect(undone.ok).toBe(true)
      expect(repointed.ok).toBe(false)
      if (!repointed.ok) {
        expect(repointed.error.status).toBe(422)
        expect(repointed.error.body?.code).toBe('support_project_not_found')
      }
      expect(await readState(seed)).toEqual({
        projectDeleted: true,
        ruleDeleted: false,
        ruleProjectId: seed.otherProjectId,
        liveTasks: 0,
        orphanedTasks: 0,
      })
    }, CASE_TIMEOUT_MS)
  })
})
