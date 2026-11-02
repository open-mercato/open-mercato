import { randomUUID } from 'node:crypto'
import { LockMode, MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { StartedTestContainer } from 'testcontainers'
import { WarrantyClaim, WarrantyClaimEvent, WarrantyClaimLine } from '../data/entities'
import { updateClaimLineCommand } from '../commands/claim-lines'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (em: EntityManager, ...args: Parameters<EntityManager['findOne']>) => em.findOne(...args),
  findWithDecryption: (em: EntityManager, ...args: Parameters<EntityManager['find']>) => em.find(...args),
}))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: async () => undefined,
}))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: async () => undefined,
  emitCrudUndoSideEffects: async () => undefined,
}))
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({ invalidateCrudCache: async () => undefined }))
jest.mock('../events', () => ({ emitWarrantyClaimsEvent: async () => undefined }))

const describePostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

type Deferred = { promise: Promise<void>; resolve: () => void }
type Gate = { reached: Deferred; release: Deferred; fired: boolean }
type Seed = { tenantId: string; organizationId: string; claimId: string; firstLineId: string; siblingLineId: string; orderLineId: string }
type Outcome = { ok: true } | { ok: false; status?: number; code?: string }

function deferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { promise, resolve }
}

async function outcome(operation: Promise<unknown>): Promise<Outcome> {
  try {
    await operation
    return { ok: true }
  } catch (error) {
    const failure = error as { status?: number; code?: string; body?: { code?: string } }
    return { ok: false, status: failure.status, code: failure.body?.code ?? failure.code }
  }
}

describePostgres('claim line undo quantity transaction serialization', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>> | undefined

  function root(): EntityManager<PostgreSqlDriver> {
    if (!orm) throw new Error('[internal] PostgreSQL fixture is not ready')
    return orm.em.fork()
  }

  function gatedFork(gate?: Gate): EntityManager {
    const target = root()
    return new Proxy(target, {
      get(object, property) {
        const value = Reflect.get(object, property, object)
        if (typeof value !== 'function') return value
        const bound = (value as (...args: unknown[]) => unknown).bind(object)
        if (property !== 'findOne' || !gate) return bound
        return async (...args: unknown[]) => {
          const options = args[2] as { lockMode?: LockMode } | undefined
          const matches = !gate.fired && args[0] === WarrantyClaim && options?.lockMode === LockMode.PESSIMISTIC_WRITE
          const result = await bound(...args)
          if (matches) {
            gate.fired = true
            gate.reached.resolve()
            await gate.release.promise
          }
          return result
        }
      },
    })
  }

  function context(seed: Seed, gate?: Gate): CommandRuntimeContext {
    return {
      container: {
        resolve: (key: string) => {
          if (key === 'em') return { fork: () => gatedFork(gate) }
          if (key === 'dataEngine') return { markOrmEntityChange: async () => undefined }
          throw new Error(`[internal] unexpected test dependency ${key}`)
        },
      },
      auth: { tenantId: seed.tenantId, orgId: seed.organizationId, isSuperAdmin: true, sub: randomUUID() },
      selectedOrganizationId: seed.organizationId,
      organizationIds: [seed.organizationId],
      organizationScope: null,
    } as unknown as CommandRuntimeContext
  }

  async function seedClaim(): Promise<Seed> {
    const seed: Seed = {
      tenantId: randomUUID(), organizationId: randomUUID(), claimId: randomUUID(),
      firstLineId: randomUUID(), siblingLineId: randomUUID(), orderLineId: randomUUID(),
    }
    const em = root()
    const claim = em.create(WarrantyClaim, {
      id: seed.claimId, tenantId: seed.tenantId, organizationId: seed.organizationId,
      claimNumber: `UNDO-${randomUUID()}`, claimType: 'warranty', currencyCode: 'USD',
    })
    for (const [lineId, lineNo, qtyClaimed] of [[seed.firstLineId, 1, '3'], [seed.siblingLineId, 2, '1']] as const) {
      em.create(WarrantyClaimLine, {
        id: lineId, claim, tenantId: seed.tenantId, organizationId: seed.organizationId,
        lineNo, qtyClaimed, orderLineId: seed.orderLineId, creditAmount: '10',
      })
    }
    await em.flush()
    await em.execute('insert into sales_order_lines (id, quantity, tenant_id, organization_id) values (?, 5, ?, ?)', [seed.orderLineId, seed.tenantId, seed.organizationId])
    return seed
  }

  async function waitForContender(): Promise<void> {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const rows = await root().execute<Array<{ waiting: number }>>("select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'")
      if (rows[0]?.waiting) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('[internal] undo contender never waited for a database lock')
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    const password = randomUUID()
    postgres = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({ POSTGRES_DB: 'warranty_undo_test', POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: password })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver, entities: [WarrantyClaim, WarrantyClaimLine, WarrantyClaimEvent],
      host: postgres.getHost(), port: postgres.getMappedPort(5432), dbName: 'warranty_undo_test',
      user: 'postgres', password, pool: { min: 0, max: 8 }, debug: false,
    })
    await orm.schema.create()
    await root().execute('create table sales_order_lines (id uuid primary key, order_id uuid, quantity numeric, tenant_id uuid, organization_id uuid, deleted_at timestamptz)')
  })

  afterAll(async () => {
    await Promise.allSettled([orm?.close(true)])
    await Promise.allSettled([postgres?.stop()])
  })

  test('serializes an undo behind a competing update and permits the same undo after capacity is freed', async () => {
    const seed = await seedClaim()
    const ctx = context(seed)
    const input = { id: seed.firstLineId, qtyClaimed: 1 }
    const prepared = await updateClaimLineCommand.prepare!(input, ctx)
    const result = await updateClaimLineCommand.execute(input, ctx)
    const after = await updateClaimLineCommand.captureAfter!(input, result, ctx)
    const logEntry = await updateClaimLineCommand.buildLog!({ input, result, ctx, snapshots: { before: prepared?.before, after } })
    const undo = () => updateClaimLineCommand.undo!({ input, logEntry: logEntry as never, ctx })
    const gate: Gate = { reached: deferred(), release: deferred(), fired: false }
    const updating = outcome(updateClaimLineCommand.execute({ id: seed.siblingLineId, qtyClaimed: 3 }, context(seed, gate)))
    let restoring: Promise<Outcome> | undefined
    try {
      await Promise.race([gate.reached.promise, updating.then((value) => { throw new Error(`[internal] contender finished before the parent-lock gate: ${JSON.stringify(value)}`) })])
      restoring = outcome(undo())
      await waitForContender()
    } finally {
      gate.release.resolve()
    }
    expect(await updating).toEqual({ ok: true })
    expect(await restoring).toEqual({ ok: false, status: 409, code: 'warranty_claims.errors.qtyExceedsOrdered' })
    const beforeRetry = await root().find(WarrantyClaimLine, { claim: seed.claimId }, { orderBy: { lineNo: 'asc' } })
    expect(beforeRetry.map((line) => Number(line.qtyClaimed))).toEqual([1, 3])
    const claimAfterRefusal = await root().findOneOrFail(WarrantyClaim, { id: seed.claimId })
    expect(Number(claimAfterRefusal.totalClaimedAmount)).toBe(20)
    await updateClaimLineCommand.execute({ id: seed.siblingLineId, qtyClaimed: 1 }, ctx)
    await expect(undo()).resolves.toBeUndefined()
    const restored = await root().find(WarrantyClaimLine, { claim: seed.claimId }, { orderBy: { lineNo: 'asc' } })
    expect(restored.map((line) => Number(line.qtyClaimed))).toEqual([3, 1])
    expect(restored.reduce((total, line) => total + Number(line.qtyClaimed), 0)).toBeLessThanOrEqual(5)
  })
})
