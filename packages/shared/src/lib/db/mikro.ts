import 'dotenv/config'
import 'reflect-metadata'
import { MikroORM } from '@mikro-orm/core'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { PostgreSqlDriver, type EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import { performance } from 'node:perf_hooks'
import { getSslConfig } from './ssl'
import { createLogger } from '../logger'
import {
  recordTelemetryMetric,
  registerTelemetryMetricCollector,
} from '../telemetry/runtime'

const logger = createLogger('shared').child({ component: 'orm' })

export type AppMikroORM = MikroORM<PostgreSqlDriver, PostgreSqlEntityManager<PostgreSqlDriver>>

let ormInstance: AppMikroORM | null = null
let disposePoolInstrumentation: (() => void) | undefined

// Use globalThis so standalone apps survive duplicated shared package module instances.
const GLOBAL_ENTITIES_KEY = '__openMercatoOrmEntities__'

function getRegisteredEntities(): any[] | null {
  return (globalThis as Record<string, unknown>)[GLOBAL_ENTITIES_KEY] as any[] | null ?? null
}

function setRegisteredEntities(entities: any[]): void {
  (globalThis as Record<string, unknown>)[GLOBAL_ENTITIES_KEY] = entities
}

export function registerOrmEntities(entities: any[]) {
  if (getRegisteredEntities() !== null && process.env.NODE_ENV === 'development') {
    logger.debug('ORM entities re-registered (this may occur during HMR)')
  }
  setRegisteredEntities(entities)
}

export function getOrmEntities(): any[] {
  const entities = getRegisteredEntities()
  if (!entities) {
    throw new Error('[Bootstrap] ORM entities not registered. Call registerOrmEntities() at bootstrap.')
  }
  return entities
}

export type ResolvedPoolConfig = {
  poolMin: number
  poolMax: number
  poolIdleTimeout: number
  poolAcquireTimeout: number
  idleSessionTimeoutMs: number | undefined
  idleInTransactionTimeoutMs: number | undefined
  statementTimeoutMs: number | undefined
  lockTimeoutMs: number | undefined
}

// Parse an optional positive-millisecond env var. Returns undefined when unset,
// non-numeric, or non-positive so callers treat "no value" as "no timeout".
function parsePositiveIntEnv(raw: string | undefined): number | undefined {
  const parsed = parseInt(raw || '')
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function resolvePoolConfig(env: NodeJS.ProcessEnv = process.env): ResolvedPoolConfig {
  const idleSessionTimeoutEnv = parseInt(env.DB_IDLE_SESSION_TIMEOUT_MS || '')
  const idleInTxTimeoutEnv = parseInt(env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS || '')
  return {
    poolMin: parseInt(env.DB_POOL_MIN || '2'),
    poolMax: parseInt(env.DB_POOL_MAX || '20'),
    poolIdleTimeout: parseInt(env.DB_POOL_IDLE_TIMEOUT || '3000'),
    poolAcquireTimeout: parseInt(env.DB_POOL_ACQUIRE_TIMEOUT || '6000'),
    idleSessionTimeoutMs: Number.isFinite(idleSessionTimeoutEnv)
      ? idleSessionTimeoutEnv
      : env.NODE_ENV === 'production'
        ? undefined
        : 600_000,
    // Finite default in every environment (including production) so a leaked or idle
    // open transaction cannot pin a pool connection indefinitely and exhaust the pool.
    // Mirrors the long-standing dev value; override (incl. 0 to disable) via env.
    idleInTransactionTimeoutMs: Number.isFinite(idleInTxTimeoutEnv) ? idleInTxTimeoutEnv : 120_000,
    // Opt-in guards against runaway statements and lock waits. No timeout when unset.
    statementTimeoutMs: parsePositiveIntEnv(env.DB_STATEMENT_TIMEOUT_MS),
    lockTimeoutMs: parsePositiveIntEnv(env.DB_LOCK_TIMEOUT_MS),
  }
}

type PoolEventSource = {
  on(event: 'error', listener: (err: unknown) => void): unknown
  on(event: 'connect', listener: (client: { on(event: 'error', listener: (err: unknown) => void): unknown }) => void): unknown
  options?: Record<string, unknown>
}

type PoolRelease = (release?: unknown) => void
type PoolConnectCallback = (
  err: Error | undefined,
  client: unknown,
  done: PoolRelease,
) => void

type PoolConnect = {
  (): Promise<unknown>
  (callback: PoolConnectCallback): void
}
type PromisePoolConnect = () => Promise<unknown>
type CallbackPoolConnect = (callback: PoolConnectCallback) => void

export type ObservablePool = PoolEventSource & {
  totalCount: number
  idleCount: number
  waitingCount: number
  connect: PoolConnect
}

const GLOBAL_PRIMARY_POOL_INSTRUMENTATION_KEY = Symbol.for(
  '@open-mercato/shared.primaryPoolInstrumentation',
)

type PrimaryPoolInstrumentation = {
  dispose(): void
}

type PrimaryPoolInstrumentationStore = {
  active?: PrimaryPoolInstrumentation
}

function primaryPoolInstrumentationStore(): PrimaryPoolInstrumentationStore {
  const globalStore = globalThis as unknown as Record<
    symbol,
    PrimaryPoolInstrumentationStore | undefined
  >
  let current = globalStore[GLOBAL_PRIMARY_POOL_INSTRUMENTATION_KEY]
  if (!current) {
    current = {}
    globalStore[GLOBAL_PRIMARY_POOL_INSTRUMENTATION_KEY] = current
  }
  return current
}

// Postgres can terminate a connection at any moment (admin termination, network
// drop, and — most relevantly for long-running daemons — the
// `idle_in_transaction_session_timeout` configured above, FATAL 25P03). Where
// node-postgres surfaces that depends on the client's state:
// - IDLE (checked into the pool): pg-pool re-emits on the pool's 'error' event.
// - CHECKED OUT (e.g. a connection pinned by an open transaction while the app
//   awaits non-DB work): pg-pool removes its idle listener, so the FATAL emits
//   on the Client itself.
// Either way an unlistened 'error' event crashes the whole process ("Scheduler
// polling engine exited unexpectedly with exit code 1"). Swallow both: the pool
// discards the dead client, and any in-flight transaction still fails normally
// on its next query/commit against the dead connection.
// The per-client listener is deliberately attached once on 'connect' and never
// removed: it is a last-resort sink whose only job is to guarantee the 'error'
// event always has a listener, in every client state. It is not error handling
// and must not be "cleaned up" — removing it reintroduces the process crash.
// A reaped IDLE client therefore logs twice (once here, once via the pool-level
// handler that pg-pool's own idle listener re-emits); the pool-level line is the
// one that identifies the client as idle.
export function attachPoolErrorHandlers(pool: PoolEventSource): void {
  pool.on('error', (err: unknown) => {
    logger.warn('Idle pg pool client error (connection reaped/terminated)', { err })
  })
  pool.on('connect', (client) => {
    client.on('error', (err: unknown) => {
      logger.warn('pg client error (connection reaped/terminated)', { err })
    })
  })
}

function readPoolMaximum(pool: ObservablePool): number | undefined {
  const maximum = pool.options?.max
  return typeof maximum === 'number' && Number.isFinite(maximum)
    ? maximum
    : undefined
}

function recordPoolState(pool: ObservablePool): void {
  const idle = Math.max(0, pool.idleCount)
  const used = Math.max(0, pool.totalCount - idle)
  recordTelemetryMetric({
    kind: 'gauge',
    name: 'db.client.connection.count',
    value: idle,
    labels: { pool: 'primary', state: 'idle' },
    unit: '{connection}',
  })
  recordTelemetryMetric({
    kind: 'gauge',
    name: 'db.client.connection.count',
    value: used,
    labels: { pool: 'primary', state: 'used' },
    unit: '{connection}',
  })
  recordTelemetryMetric({
    kind: 'gauge',
    name: 'db.client.connection.pending_requests',
    value: Math.max(0, pool.waitingCount),
    labels: { pool: 'primary' },
    unit: '{request}',
  })

  const maximum = readPoolMaximum(pool)
  if (maximum !== undefined) {
    recordTelemetryMetric({
      kind: 'gauge',
      name: 'db.client.connection.max',
      value: maximum,
      labels: { pool: 'primary' },
      unit: '{connection}',
    })
  }
}

export function instrumentPrimaryPool(
  pool: ObservablePool,
  now: () => number = () => performance.now(),
): () => void {
  const instrumentationStore = primaryPoolInstrumentationStore()
  instrumentationStore.active?.dispose()
  const originalConnect = pool.connect
  const disposeCollector = registerTelemetryMetricCollector(() => recordPoolState(pool))
  let metricFailureLogged = false

  const recordWait = (startedAt: number) => {
    try {
      recordTelemetryMetric({
        kind: 'histogram',
        name: 'db.client.connection.wait_time',
        value: Math.max(0, now() - startedAt) / 1_000,
        labels: { pool: 'primary' },
        unit: 's',
      })
    } catch (err) {
      if (metricFailureLogged) return
      metricFailureLogged = true
      logger.warn('Failed to record pg pool acquisition wait metric', { err })
    }
  }

  const instrumentedConnect = function (
    this: ObservablePool,
    callback?: PoolConnectCallback,
  ): Promise<unknown> | void {
    const startedAt = now()
    if (typeof callback === 'function') {
      return (originalConnect as CallbackPoolConnect).call(this, (err, client, done) => {
        recordWait(startedAt)
        callback(err, client, done)
      })
    }

    try {
      return (originalConnect as PromisePoolConnect).call(this).then(
        (client: unknown) => {
          recordWait(startedAt)
          return client
        },
        (err: unknown) => {
          recordWait(startedAt)
          throw err
        },
      )
    } catch (err) {
      recordWait(startedAt)
      throw err
    }
  } as PoolConnect

  pool.connect = instrumentedConnect
  let disposed = false
  const instrumentation: PrimaryPoolInstrumentation = { dispose: () => {} }
  const dispose = () => {
    if (disposed) return
    disposed = true
    disposeCollector()
    if (pool.connect === instrumentedConnect) pool.connect = originalConnect
    if (instrumentationStore.active === instrumentation) {
      instrumentationStore.active = undefined
    }
  }
  instrumentation.dispose = dispose
  instrumentationStore.active = instrumentation
  return dispose
}

export async function getOrm() {
  if (ormInstance) {
    return ormInstance
  }

  const entities = getOrmEntities()
  const clientUrl = process.env.DATABASE_URL
  if (!clientUrl) {
    throw new Error('DATABASE_URL is not set')
  }

  // Parse connection pool settings from environment
  const {
    poolMin,
    poolMax,
    poolIdleTimeout,
    poolAcquireTimeout,
    idleSessionTimeoutMs,
    idleInTransactionTimeoutMs,
    statementTimeoutMs,
    lockTimeoutMs,
  } = resolvePoolConfig()
  const connectionOptions =
    idleSessionTimeoutMs && idleSessionTimeoutMs > 0
      ? `-c idle_session_timeout=${idleSessionTimeoutMs}`
      : undefined

  const sslConfig = getSslConfig()

  if (process.env.OM_DB_POOL_DEBUG === '1' || process.env.OM_INTEGRATION_TEST === 'true') {
    logger.info('Pool config', {
      poolMin,
      poolMax,
      poolIdleTimeout,
      poolAcquireTimeout,
      idleSessionTimeoutMs,
      idleInTransactionTimeoutMs,
      statementTimeoutMs,
      lockTimeoutMs,
      nodeEnv: process.env.NODE_ENV,
    })
  }

  ormInstance = await MikroORM.init<PostgreSqlDriver, PostgreSqlEntityManager<PostgreSqlDriver>>({
    driver: PostgreSqlDriver,
    clientUrl,
    entities,
    debug: false,
    // v7 no longer defaults to ReflectMetadataProvider. Entities in this repo use
    // `@mikro-orm/decorators/legacy`, which relies on TypeScript `emitDecoratorMetadata`
    // + reflect-metadata for type inference (nullability, column types). Without this,
    // inferred types are silently wrong at runtime.
    metadataProvider: ReflectMetadataProvider,
    // MikroORM v7 pool shape (min/max/idleTimeoutMillis). Knex-era `acquireTimeoutMillis` /
    // `destroyTimeoutMillis` were removed; acquire wait maps to pg `connectionTimeoutMillis`
    // below under `driverOptions`. Mirror `connectionTimeoutMillis` here too — older Mikro
    // versions read it from `pool`; v7 reads from `driverOptions` but accepting both
    // costs nothing and protects us from upstream config-merge regressions.
    pool: {
      min: poolMin,
      max: poolMax,
      idleTimeoutMillis: poolIdleTimeout,
      acquireTimeoutMillis: poolAcquireTimeout,
    } as any,
    // Driver options are merged into pg.PoolConfig (ClientConfig + pg-pool).
    driverOptions: {
      connectionTimeoutMillis: poolAcquireTimeout,
      idle_in_transaction_session_timeout: idleInTransactionTimeoutMs,
      statement_timeout: statementTimeoutMs,
      lock_timeout: lockTimeoutMs,
      options: connectionOptions,
      ssl: sslConfig,
      onPoolCreated: (pool: ObservablePool) => {
        disposePoolInstrumentation?.()
        attachPoolErrorHandlers(pool)
        disposePoolInstrumentation = instrumentPrimaryPool(pool)
        if (process.env.OM_DB_POOL_DEBUG === '1' || process.env.OM_INTEGRATION_TEST === 'true') {
          logger.info('pg pool created with options', {
            max: pool.options?.max,
            min: pool.options?.min,
            idleTimeoutMillis: pool.options?.idleTimeoutMillis,
            connectionTimeoutMillis: pool.options?.connectionTimeoutMillis,
          })
        }
      },
    },
  })

  return ormInstance
}


async function closeOrmIfLoaded(): Promise<void> {
  if (ormInstance) {
    disposePoolInstrumentation?.()
    disposePoolInstrumentation = undefined
    await ormInstance.close(true)
    ormInstance = null
  }
}

// In dev mode, handle reloads cleanly without leaving dangling connections.
if (process.env.NODE_ENV !== 'production') {
  void closeOrmIfLoaded()
}
