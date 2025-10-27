import 'dotenv/config'
import 'reflect-metadata'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'

let ormInstance: MikroORM<PostgreSqlDriver> | null = null
let ormInitPromise: Promise<MikroORM<PostgreSqlDriver>> | null = null

type GlobalOrmCache = typeof globalThis & {
  __openMercatoOrmInstance?: MikroORM<PostgreSqlDriver>
  __openMercatoOrmPromise?: Promise<MikroORM<PostgreSqlDriver>>
}

const globalOrm = globalThis as GlobalOrmCache

export async function getOrm() {
  if (process.env.NODE_ENV !== 'production') {
    if (globalOrm.__openMercatoOrmInstance) {
      ormInstance = globalOrm.__openMercatoOrmInstance
      return ormInstance
    }
    if (globalOrm.__openMercatoOrmPromise) {
      ormInitPromise = globalOrm.__openMercatoOrmPromise
      return ormInitPromise
    }
  }

  if (ormInstance) return ormInstance
  if (ormInitPromise) return ormInitPromise

  const { entities } = await import('@/generated/entities.generated')
  const clientUrl = process.env.DATABASE_URL
  if (!clientUrl) throw new Error('DATABASE_URL is not set')
  
  // Parse connection pool settings from environment
  const poolMin = parseInt(process.env.DB_POOL_MIN || '2')
  const poolMax = parseInt(process.env.DB_POOL_MAX || '10')
  const poolIdleTimeout = parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000')
  const poolAcquireTimeout = parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT || '60000')
  
  ormInitPromise = MikroORM.init<PostgreSqlDriver>({
    driver: PostgreSqlDriver,
    clientUrl,
    entities,
    debug: false,
    // Connection pooling configuration
    pool: {
      min: poolMin,
      max: poolMax,
      idleTimeoutMillis: poolIdleTimeout,
      acquireTimeoutMillis: poolAcquireTimeout,
      // Close idle connections after 30 seconds
      destroyTimeoutMillis: 30000,
    },
    // Connection options
    driverOptions: {
      // Enable connection pooling
      connection: {
        // Maximum number of connections in the pool
        max: poolMax,
        // Minimum number of connections in the pool
        min: poolMin,
        // Close connections after this many milliseconds of inactivity
        idleTimeoutMillis: poolIdleTimeout,
        // Maximum time to wait for a connection from the pool
        acquireTimeoutMillis: poolAcquireTimeout,
      },
    },
  })
  if (process.env.NODE_ENV !== 'production') {
    globalOrm.__openMercatoOrmPromise = ormInitPromise
  }
  ormInstance = await ormInitPromise

  if (process.env.NODE_ENV !== 'production') {
    globalOrm.__openMercatoOrmInstance = ormInstance
    delete globalOrm.__openMercatoOrmPromise
  }

  ormInitPromise = null
  return ormInstance
}

export async function getEm() {
  const orm = await getOrm()
  return orm.em.fork({ clear: true })
}
