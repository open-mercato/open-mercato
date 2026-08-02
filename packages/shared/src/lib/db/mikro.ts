import 'dotenv/config'
import 'reflect-metadata'
import { MikroORM } from '@mikro-orm/core'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { PostgreSqlDriver, type EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import { getSslConfig } from './ssl'
import { createLogger } from '../logger'

const logger = createLogger('shared').child({ component: 'orm' })

export type AppMikroORM = MikroORM<PostgreSqlDriver, PostgreSqlEntityManager<PostgreSqlDriver>>

let ormInstance: AppMikroORM | null = null

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
      onPoolCreated: (pool: any) => {
        // node-postgres re-emits errors from IDLE pooled clients on the pool's
        // 'error' event. Postgres terminates idle sessions on its own (admin
        // termination, network drop, and — most relevantly for long-running
        // daemons like the scheduler — `idle_in_transaction_session_timeout`,
        // which defaults to 120s above). Without a listener here, such a
        // termination surfaces as an unhandled 'error' event and crashes the
        // whole process (e.g. "Scheduler polling engine exited unexpectedly
        // with exit code 1"). Swallow it: the pool discards the dead client and
        // opens a fresh connection on the next acquire.
        pool.on('error', (err: unknown) => {
          logger.warn('Idle pg pool client error (connection reaped/terminated)', { err })
        })
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
    await ormInstance.close(true)
    ormInstance = null
  }
}

// In dev mode, handle reloads cleanly without leaving dangling connections.
if (process.env.NODE_ENV !== 'production') {
  void closeOrmIfLoaded()
}
