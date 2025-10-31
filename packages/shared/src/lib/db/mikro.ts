import 'dotenv/config'
import 'reflect-metadata'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'

let ormInstance: MikroORM<PostgreSqlDriver> | null = null

export async function getOrm() {
  if (ormInstance) {
    return ormInstance
  }
  const { entities } = await import('@/generated/entities.generated')
  const clientUrl = process.env.DATABASE_URL
  if (!clientUrl) throw new Error('DATABASE_URL is not set')
  
  // Parse connection pool settings from environment
  const poolMin = parseInt(process.env.DB_POOL_MIN || '2')
  const poolMax = parseInt(process.env.DB_POOL_MAX || '10')
  const poolIdleTimeout = parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000')
  const poolAcquireTimeout = parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT || '60000')
  
  ormInstance = await MikroORM.init<PostgreSqlDriver>({
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
  return ormInstance
}

export async function getEm() {
  const orm = await getOrm()
  return orm.em.fork({ clear: true })
}

export async function closeOrm() {
  if (ormInstance) {
    await ormInstance.close(true)
    ormInstance = null
  }
}

// In dev mode, handle reloads cleanly
if (process.env.NODE_ENV !== 'production') {
  if (ormInstance) {
    await ormInstance.close(true);
  }
}