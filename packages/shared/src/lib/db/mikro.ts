import 'dotenv/config'
import 'reflect-metadata'
import { MikroORM, RequestContext } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'

declare global {
  // eslint-disable-next-line no-var
  var __mikroOrm: MikroORM<PostgreSqlDriver> | undefined
  // eslint-disable-next-line no-var
  var __mikroOrmInit: Promise<MikroORM<PostgreSqlDriver>> | undefined
}

const globalOrm = globalThis as typeof globalThis & {
  __mikroOrm?: MikroORM<PostgreSqlDriver>
  __mikroOrmInit?: Promise<MikroORM<PostgreSqlDriver>>
}

const toNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export async function getOrm() {
  if (globalOrm.__mikroOrm) return globalOrm.__mikroOrm
  if (globalOrm.__mikroOrmInit) return globalOrm.__mikroOrmInit

  const poolMin = toNumber(process.env.DB_POOL_MIN, 0)
  const poolMax = toNumber(process.env.DB_POOL_MAX, 5)
  const poolIdleTimeout = toNumber(process.env.DB_POOL_IDLE_TIMEOUT, 30_000)
  const poolAcquireTimeout = toNumber(process.env.DB_POOL_ACQUIRE_TIMEOUT, 10_000)
  const idleSessionTimeoutEnv = Number(process.env.DB_IDLE_SESSION_TIMEOUT_MS)
  const idleInTxTimeoutEnv = Number(process.env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS)
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

  globalOrm.__mikroOrmInit = (async () => {
    try {
      const { entities } = await import('@/generated/entities.generated')
      const clientUrl = process.env.DATABASE_URL
      if (!clientUrl) throw new Error('DATABASE_URL is not set')

      const orm = await MikroORM.init<PostgreSqlDriver>({
        driver: PostgreSqlDriver,
        clientUrl,
        entities,
        debug: false,
        pool: {
          min: poolMin,
          max: poolMax,
          idleTimeoutMillis: poolIdleTimeout,
          acquireTimeoutMillis: poolAcquireTimeout,
        },
        driverOptions: {
          connection: {
            idle_in_transaction_session_timeout: idleInTransactionTimeoutMs,
            options: connectionOptions,
          },
        },
      })

      globalOrm.__mikroOrm = orm
      return orm
    } catch (error) {
      globalOrm.__mikroOrmInit = undefined
      globalOrm.__mikroOrm = undefined
      throw error
    }
  })()

  return globalOrm.__mikroOrmInit
}

export function withOrm<T extends (...args: any[]) => any>(handler: T) {
  return async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    const orm = await getOrm()
    return await RequestContext.create(orm.em, () => handler(...args))
  }
}
