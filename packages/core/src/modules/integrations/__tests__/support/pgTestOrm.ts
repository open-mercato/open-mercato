import { randomBytes } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { generateDek } from '@open-mercato/shared/lib/encryption/aes'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { createKmsService, type KmsService, type TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import { registerTenantEncryptionSubscriber } from '@open-mercato/shared/lib/encryption/subscriber'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { EncryptionMap } from '../../../entities/data/entities'
import { upsertCanonicalEncryptionMap } from '../../../entities/lib/encryption-maps'
import { IntegrationCredentials, IntegrationLog, IntegrationState } from '../../data/entities'
import { defaultEncryptionMaps } from '../../encryption'

export type PgTestOrmInstance = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

/** A second ORM with its own connection pool on the same database, carrying the same field-encryption setup. */
export type PgTestPool = {
  orm: PgTestOrmInstance
  em: EntityManager
  close(): Promise<void>
}

/**
 * A real Postgres 16 with the integrations credential, log and state tables and the encryption maps.
 * `em` is the ORM's root EntityManager, carrying the tenant field-encryption subscriber; tests fork it.
 * `setKms(kms)` makes every `createKmsService()` (a Jest module mock the test file declares) and the
 * field-level layer use `kms`, and drops the DEKs the static field-level cache holds for every tenant
 * seen so far, so no key carries over between cases. `openPool(options)` opens another pool (its own
 * size, acquire timeout or `idle_in_transaction_session_timeout`) on the same database; `close()`
 * closes the pools it opened.
 */
export type PgTestOrm = {
  orm: PgTestOrmInstance
  em: EntityManager
  encryption: TenantDataEncryptionService
  setKms(kms: KmsService): void
  openPool(options?: PgTestOrmOptions): Promise<PgTestPool>
  close(): Promise<void>
}

export type PgTestOrmOptions = {
  poolMax?: number
  acquireTimeoutMs?: number
  idleInTransactionTimeoutMs?: number
}

/** `serve`: random DEK per tenant, created on demand; `no_dek`: never a key; `fail`: every call throws. */
export type TestKmsBehavior = 'serve' | 'no_dek' | 'fail'

export type TestKms = KmsService & {
  readonly deks: Map<string, string>
  readonly calls: { getTenantDek: number; createTenantDek: number }
  behavior: TestKmsBehavior
  stallMs: number
}

const DATABASE_NAME = 'integrations_pg_test'
const DATABASE_USER = 'integrations_pg_test'
const DATABASE_PASSWORD = 'integrations_pg_test'
const CREDENTIALS_ENTITY_ID = 'integrations:integration_credentials'
const DEFAULT_POOL_MAX = 4
const DEFAULT_ACQUIRE_TIMEOUT_MS = 1000

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export function createTestKms(options: { behavior?: TestKmsBehavior; deks?: Map<string, string> } = {}): TestKms {
  const deks = options.deks ?? new Map<string, string>()
  const calls = { getTenantDek: 0, createTenantDek: 0 }
  const kms: TestKms = {
    deks,
    calls,
    behavior: options.behavior ?? 'serve',
    stallMs: 0,
    isHealthy: () => true,
    async getTenantDek(tenantId: string): Promise<TenantDek | null> {
      calls.getTenantDek += 1
      if (kms.stallMs > 0) await sleep(kms.stallMs)
      if (kms.behavior === 'fail') throw new Error('[internal] test KMS failure')
      const key = kms.behavior === 'serve' ? deks.get(tenantId) : undefined
      return key ? { tenantId, key, fetchedAt: Date.now() } : null
    },
    async createTenantDek(tenantId: string): Promise<TenantDek | null> {
      calls.createTenantDek += 1
      if (kms.stallMs > 0) await sleep(kms.stallMs)
      if (kms.behavior === 'fail') throw new Error('[internal] test KMS failure')
      if (kms.behavior !== 'serve') return null
      const key = deks.get(tenantId) ?? generateDek()
      deks.set(tenantId, key)
      return { tenantId, key, fetchedAt: Date.now() }
    },
  }
  return kms
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function ignorePoolError(): void {
  return undefined
}

type PooledClient = {
  on(event: 'error', listener: () => void): unknown
  release?: (error?: Error) => void
}

type ObservedPool = {
  on(event: 'error', listener: () => void): unknown
  on(event: 'connect' | 'acquire', listener: (client: PooledClient) => void): unknown
  on(event: 'release', listener: (error: Error | undefined, client: PooledClient) => void): unknown
}

type TrackedOrm = { orm: PgTestOrmInstance; checkedOut: Set<PooledClient> }

/**
 * Tracks the clients each pool has checked out, because a transaction whose connection died never
 * gives its client back (Kysely's `rollback()` skips `release()` when the rollback itself fails), and
 * `pool.end()` would wait for it forever.
 */
async function initPgTestOrm(postgres: StartedTestContainer, options: PgTestOrmOptions): Promise<TrackedOrm> {
  const checkedOut = new Set<PooledClient>()
  const orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
    driver: PostgreSqlDriver,
    host: postgres.getHost(),
    port: postgres.getMappedPort(5432),
    dbName: DATABASE_NAME,
    user: DATABASE_USER,
    password: DATABASE_PASSWORD,
    entities: [IntegrationCredentials, IntegrationLog, IntegrationState, EncryptionMap],
    debug: false,
    pool: { min: 0, max: options.poolMax ?? DEFAULT_POOL_MAX },
    driverOptions: {
      connectionTimeoutMillis: options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS,
      ...(options.idleInTransactionTimeoutMs === undefined
        ? {}
        : { idle_in_transaction_session_timeout: options.idleInTransactionTimeoutMs }),
      onPoolCreated: (pool: ObservedPool) => {
        pool.on('error', ignorePoolError)
        pool.on('connect', (client) => {
          client.on('error', ignorePoolError)
        })
        pool.on('acquire', (client) => {
          checkedOut.add(client)
        })
        pool.on('release', (_error, client) => {
          checkedOut.delete(client)
        })
      },
    },
  })
  return { orm, checkedOut }
}

async function closeTrackedOrm(tracked: TrackedOrm): Promise<void> {
  for (const client of [...tracked.checkedOut]) client.release?.(new Error('[internal] closing the test pool'))
  tracked.checkedOut.clear()
  await Promise.allSettled([tracked.orm.close(true)])
}

/**
 * Starts the container and the ORM. The test file MUST declare
 * `jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({ ...jest.requireActual(...), createKmsService: jest.fn() }))`.
 * `testcontainers` is imported here, so call this from `beforeAll` only.
 */
export async function startPgTestOrm(options: PgTestOrmOptions = {}): Promise<PgTestOrm> {
  if (!jest.isMockFunction(createKmsService)) {
    throw new Error('[internal] startPgTestOrm needs a jest.mock of createKmsService in the test file')
  }
  const mockedCreateKmsService = createKmsService as jest.MockedFunction<typeof createKmsService>
  const previousToggle = process.env.TENANT_DATA_ENCRYPTION
  const previousFallbackKey = process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY
  process.env.TENANT_DATA_ENCRYPTION = 'yes'
  process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY = randomBytes(32).toString('base64')

  let active: KmsService = createTestKms()
  const seenTenantIds = new Set<string>()
  const kmsSwitch: KmsService = {
    isHealthy: () => active.isHealthy(),
    getTenantDek: (tenantId) => {
      seenTenantIds.add(tenantId)
      return active.getTenantDek(tenantId)
    },
    createTenantDek: (tenantId) => {
      seenTenantIds.add(tenantId)
      return active.createTenantDek(tenantId)
    },
  }
  mockedCreateKmsService.mockReturnValue(kmsSwitch)
  registerEntityIds({ integrations: { integration_credentials: CREDENTIALS_ENTITY_ID } })

  let postgres: StartedTestContainer | null = null
  let tracked: TrackedOrm | null = null
  try {
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
    tracked = await initPgTestOrm(postgres, options)
    await tracked.orm.schema.create()
    for (const map of defaultEncryptionMaps) {
      await upsertCanonicalEncryptionMap(tracked.orm.em.fork(), {
        entityId: map.entityId,
        tenantId: null,
        organizationId: null,
        fields: map.fields,
        isActive: true,
      })
    }
  } catch (error) {
    if (tracked) await closeTrackedOrm(tracked)
    await Promise.allSettled([postgres?.stop()])
    restoreEnv('TENANT_DATA_ENCRYPTION', previousToggle)
    restoreEnv('TENANT_DATA_ENCRYPTION_FALLBACK_KEY', previousFallbackKey)
    throw error
  }

  const startedTracked = tracked
  const startedOrm = tracked.orm
  const startedPostgres = postgres
  const encryption = new TenantDataEncryptionService(startedOrm.em, { kms: kmsSwitch })
  registerTenantEncryptionSubscriber(startedOrm.em, encryption)
  const openedPools = new Set<TrackedOrm>()

  return {
    orm: startedOrm,
    em: startedOrm.em,
    encryption,
    setKms(kms: KmsService) {
      active = kms
      mockedCreateKmsService.mockReturnValue(kmsSwitch)
      for (const tenantId of seenTenantIds) encryption.invalidateDek(tenantId)
    },
    async openPool(poolOptions: PgTestOrmOptions = {}) {
      const pooled = await initPgTestOrm(startedPostgres, poolOptions)
      openedPools.add(pooled)
      registerTenantEncryptionSubscriber(pooled.orm.em, new TenantDataEncryptionService(pooled.orm.em, { kms: kmsSwitch }))
      return {
        orm: pooled.orm,
        em: pooled.orm.em,
        async close() {
          openedPools.delete(pooled)
          await closeTrackedOrm(pooled)
        },
      }
    },
    async close() {
      await Promise.allSettled([...openedPools].map((pooled) => closeTrackedOrm(pooled)))
      openedPools.clear()
      await closeTrackedOrm(startedTracked)
      await Promise.allSettled([startedPostgres.stop()])
      restoreEnv('TENANT_DATA_ENCRYPTION', previousToggle)
      restoreEnv('TENANT_DATA_ENCRYPTION_FALLBACK_KEY', previousFallbackKey)
    },
  }
}
