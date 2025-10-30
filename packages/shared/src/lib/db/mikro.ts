import 'dotenv/config'
import 'reflect-metadata'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'

type OrmGlobals = typeof globalThis & {
  __omOrmInstance?: MikroORM<PostgreSqlDriver> | null
  __omOrmInitPromise?: Promise<MikroORM<PostgreSqlDriver>> | null
}

const ormGlobals = globalThis as OrmGlobals

if (process.env.NODE_ENV !== 'production') {
  const existing = ormGlobals.__omOrmInstance
  if (existing) {
    void existing.close(true).catch(() => undefined)
  }
  ormGlobals.__omOrmInstance = null
  ormGlobals.__omOrmInitPromise = null
}

async function initOrm() {
  const { entities } = await import('@/generated/entities.generated')
  const clientUrl = process.env.DATABASE_URL
  if (!clientUrl) throw new Error('DATABASE_URL is not set')

  const poolMin = parseInt(process.env.DB_POOL_MIN || '2')
  const poolMax = parseInt(process.env.DB_POOL_MAX || '10')
  const poolIdleTimeout = parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000')
  const poolAcquireTimeout = parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT || '60000')

  return MikroORM.init<PostgreSqlDriver>({
    driver: PostgreSqlDriver,
    clientUrl,
    entities,
    debug: false,
    pool: {
      min: poolMin,
      max: poolMax,
      idleTimeoutMillis: poolIdleTimeout,
      acquireTimeoutMillis: poolAcquireTimeout,
      destroyTimeoutMillis: 30000,
    },
    driverOptions: {
      connection: {
        max: poolMax,
        min: poolMin,
        idleTimeoutMillis: poolIdleTimeout,
        acquireTimeoutMillis: poolAcquireTimeout,
      },
    },
  })
}

export async function getOrm() {
  if (ormGlobals.__omOrmInstance) {
    return ormGlobals.__omOrmInstance
  }

  if (!ormGlobals.__omOrmInitPromise) {
    ormGlobals.__omOrmInitPromise = initOrm()
  }

  const orm = await ormGlobals.__omOrmInitPromise
  ormGlobals.__omOrmInstance = orm
  ormGlobals.__omOrmInitPromise = null
  return orm
}

export async function getEm() {
  const orm = await getOrm()
  return orm.em.fork({ clear: true })
}

export async function closeOrm() {
  const orm = ormGlobals.__omOrmInstance ?? (await ormGlobals.__omOrmInitPromise?.catch(() => null))
  if (!orm) return

  await orm.close(true)
  ormGlobals.__omOrmInstance = null
  ormGlobals.__omOrmInitPromise = null
}
