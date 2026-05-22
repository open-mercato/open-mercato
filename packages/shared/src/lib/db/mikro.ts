import 'dotenv/config'
import 'reflect-metadata'
import { MikroORM } from '@mikro-orm/core'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { PostgreSqlDriver, type EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import { getSslConfig } from './ssl'

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
    console.debug('[Bootstrap] ORM entities re-registered (this may occur during HMR)')
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
  const poolMin = parseInt(process.env.DB_POOL_MIN || '2')
  const poolMax = parseInt(process.env.DB_POOL_MAX || '20')
  const poolIdleTimeout = parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '3000')
  const poolAcquireTimeout = parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT || '6000')
  const idleSessionTimeoutEnv = parseInt(process.env.DB_IDLE_SESSION_TIMEOUT_MS || '')
  const idleInTxTimeoutEnv = parseInt(process.env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS || '')
  const idleSessionTimeoutMs = Number.isFinite(idleSessionTimeoutEnv)
    ? idleSessionTimeoutEnv
    : process.env.NODE_ENV === 'production'
      ? undefined
      : 600_000
  const idleInTransactionTimeoutMs = Number.isFinite(idleInTxTimeoutEnv)
    ? idleInTxTimeoutEnv
    : process.env.NODE_ENV === 'production'
      ? undefined
      : 120_000
  const connectionOptions =
    idleSessionTimeoutMs && idleSessionTimeoutMs > 0
      ? `-c idle_session_timeout=${idleSessionTimeoutMs}`
      : undefined

  const sslConfig = getSslConfig()

  if (process.env.OM_DB_POOL_DEBUG === '1' || process.env.OM_INTEGRATION_TEST === 'true') {
    console.log('[orm] pool config', {
      poolMin,
      poolMax,
      poolIdleTimeout,
      poolAcquireTimeout,
      idleSessionTimeoutMs,
      idleInTransactionTimeoutMs,
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
      options: connectionOptions,
      ssl: sslConfig,
      onPoolCreated: (pool: any) => {
        if (process.env.OM_DB_POOL_DEBUG === '1' || process.env.OM_INTEGRATION_TEST === 'true') {
          console.log('[orm] pg pool created with options', {
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
