/** @jest-environment node */
/**
 * Real-PostgreSQL coverage for #9210 with the `progress` module disabled.
 *
 * TC-TT-032 (Playwright) stubs the `reapply-rounding` route entirely, so it never
 * exercises the real worker, the real rounding command, or a locked entry — it only
 * proves the settings page reads a stubbed 202. This file drives the actual worker
 * handler end to end against real `staff_time_entries` rows with
 * `progressJobId: null` and no `progressService` registered (the real shape of a
 * queued job once `progress` is off), then separately proves the masked-settings
 * batch write (`ModuleConfigService.setTenantValues` / the batched `getRecords`
 * read) keeps two tenants' rows isolated.
 *
 * OM_PG_INTEGRATION=1 provisions a disposable PostgreSQL container in the core CI job.
 */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { StartedTestContainer } from 'testcontainers'
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import { createModuleConfigService } from '../../configs/lib/module-config-service'
import { ModuleConfig } from '../../configs/data/entities'
import { StaffTimeEntry } from '../data/entities'
import { readTimeTrackingSettings, STAFF_TIME_TRACKING_MODULE_ID } from '../lib/time-tracking/settings'
import type { ReapplyRoundingJobPayload } from '../lib/time-tracking/reapplyRounding'
// Side effect only: registers the built-in rounding recalculation hook the worker
// resolves through `recalculationRunner.ts` -> `recalculations.ts`.
import '../lib/time-tracking/reapplyRounding'
import handle from '../workers/timesheets-reapply-rounding'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'staff_reapply_rounding_test'
const DATABASE_USER = 'staff_reapply_rounding'
const DATABASE_PASSWORD = 'staff_reapply_rounding'
const CASE_TIMEOUT_MS = 30_000

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

let currentContainer: AwilixContainer | null = null

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => {
    if (!currentContainer) throw new Error('[internal] no container configured for this case')
    return currentContainer
  }),
}))

function job(payload: ReapplyRoundingJobPayload): QueuedJob<ReapplyRoundingJobPayload> {
  return { id: 'queued-1', payload, createdAt: new Date().toISOString() }
}

describeWithPostgres('staff reapply-rounding with the progress module disabled on real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null
  const dataEngine = {
    markOrmEntityChange: () => undefined,
    flushOrmEntityChanges: async () => undefined,
  }

  function rootEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not started')
    return orm.em.fork()
  }

  function createRealModuleConfigService(em: EntityManager) {
    return createModuleConfigService({
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`[internal] unexpected resolve ${name}`)
      },
    } as unknown as AwilixContainer)
  }

  /** No `progressService`: the realistic shape once the progress module is disabled. */
  function buildContainer(): AwilixContainer {
    const em = rootEm()
    const commandBus = new CommandBus()
    const moduleConfigService = createRealModuleConfigService(em)
    return {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'commandBus') return commandBus
        if (name === 'dataEngine') return dataEngine
        if (name === 'moduleConfigService') return moduleConfigService
        throw new Error(`[internal] staff reapply-rounding test container has no ${name} — progress is disabled`)
      },
    } as unknown as AwilixContainer
  }

  async function seedEntry(options: {
    tenantId: string
    organizationId: string
    durationMinutes: number
    roundedMinutes: number
    lockedReportId?: string | null
  }): Promise<string> {
    const em = rootEm()
    const id = randomUUID()
    em.create(StaffTimeEntry, {
      id,
      tenantId: options.tenantId,
      organizationId: options.organizationId,
      staffMemberId: randomUUID(),
      date: new Date('2026-11-01'),
      durationMinutes: options.durationMinutes,
      roundedMinutes: options.roundedMinutes,
      lockedReportId: options.lockedReportId ?? null,
    })
    await em.flush()
    return id
  }

  async function readRoundedMinutes(id: string): Promise<number | null> {
    const [row] = await rootEm().execute<Array<{ rounded_minutes: number | null }>>(
      'select rounded_minutes from staff_time_entries where id = ?',
      [id],
    )
    return row.rounded_minutes
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
      entities: [StaffTimeEntry, ModuleConfig],
      debug: false,
      pool: { min: 0, max: 8 },
    })
    await orm.schema.create()
  }, 120_000)

  afterEach(() => {
    currentContainer = null
  })

  afterAll(async () => {
    await Promise.allSettled([orm?.close(true)])
    await Promise.allSettled([postgres?.stop()])
  }, 30_000)

  it('reapplies rounding to eligible entries and leaves a locked entry untouched when Progress is disabled', async () => {
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const eligibleId = await seedEntry({ tenantId, organizationId, durationMinutes: 60, roundedMinutes: 999 })
    const lockedId = await seedEntry({
      tenantId,
      organizationId,
      durationMinutes: 60,
      roundedMinutes: 999,
      lockedReportId: randomUUID(),
    })

    currentContainer = buildContainer()
    await handle(
      job({ progressJobId: null, scope: { tenantId, organizationIds: [organizationId] } }),
      {} as JobContext,
    )

    // Default rounding (unitMinutes 0) rounds a 60-minute entry back to 60, so a
    // stale 999 proves the real command actually ran — not a no-op.
    expect(await readRoundedMinutes(eligibleId)).toBe(60)
    expect(await readRoundedMinutes(lockedId)).toBe(999)
  }, CASE_TIMEOUT_MS)

  it('rethrows and skips failJob when the recalculation fails with Progress disabled', async () => {
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    // No `staff_time_entries` row makes `countReapplyRoundingCandidates` return 0, so
    // force a failure downstream instead: an unresolvable `commandBus` surfaces the
    // same "no progress job, no progress service" path the real worker catch uses.
    currentContainer = {
      resolve: (name: string) => {
        if (name === 'em') return rootEm()
        if (name === 'commandBus') throw new Error('[internal] commandBus unavailable for this case')
        if (name === 'dataEngine') return dataEngine
        if (name === 'moduleConfigService') return createRealModuleConfigService(rootEm())
        throw new Error(`[internal] unexpected resolve ${name}`)
      },
    } as unknown as AwilixContainer

    await seedEntry({ tenantId, organizationId, durationMinutes: 60, roundedMinutes: 999 })

    await expect(
      handle(job({ progressJobId: null, scope: { tenantId, organizationIds: [organizationId] } }), {} as JobContext),
    ).rejects.toThrow('commandBus unavailable')
  }, CASE_TIMEOUT_MS)

  it('keeps a masked settings batch write isolated between tenants', async () => {
    const em = rootEm()
    const moduleConfigService = createRealModuleConfigService(em)
    const tenantA = randomUUID()
    const tenantB = randomUUID()

    await moduleConfigService.setTenantValues!(STAFF_TIME_TRACKING_MODULE_ID, { 'targets.dailyHours': 5 }, tenantA)
    await moduleConfigService.setTenantValues!(STAFF_TIME_TRACKING_MODULE_ID, { 'targets.dailyHours': 9 }, tenantB)

    const [settingsA, settingsB] = await Promise.all([
      readTimeTrackingSettings(moduleConfigService, { tenantId: tenantA }),
      readTimeTrackingSettings(moduleConfigService, { tenantId: tenantB }),
    ])
    expect(settingsA.targets.dailyHours).toBe(5)
    expect(settingsB.targets.dailyHours).toBe(9)

    const rows = await em
      .getRepository(ModuleConfig)
      .find({ moduleId: STAFF_TIME_TRACKING_MODULE_ID, name: 'targets.dailyHours' })
    const byTenant = new Map(rows.map((row) => [row.tenantId, row.valueJson]))
    expect(byTenant.get(tenantA)).toBe(5)
    expect(byTenant.get(tenantB)).toBe(9)
  })
})
