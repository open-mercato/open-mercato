import 'dotenv/config'
import 'reflect-metadata'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'

const ORM_STATE_KEY = Symbol.for('open-mercato.shared.db.mikro.state')

type OrmState = {
  instance: MikroORM<PostgreSqlDriver> | null
  initPromise: Promise<MikroORM<PostgreSqlDriver>> | null
  closingPromise: Promise<void> | null
  shutdownRegistered: boolean
}

type GlobalWithOrmState = typeof globalThis & {
  [ORM_STATE_KEY]?: OrmState
}

const globalWithOrmState = globalThis as GlobalWithOrmState

function resolveOrmState(): OrmState {
  const existing = globalWithOrmState[ORM_STATE_KEY]
  if (existing) {
    return existing
  }

  const initialState: OrmState = {
    instance: null,
    initPromise: null,
    closingPromise: null,
    shutdownRegistered: false,
  }

  globalWithOrmState[ORM_STATE_KEY] = initialState
  return initialState
}

async function initOrm() {
  const { entities } = await import('@/generated/entities.generated')
  const clientUrl = process.env.DATABASE_URL
  if (!clientUrl) throw new Error('DATABASE_URL is not set')

  const poolMin = parseInt(process.env.DB_POOL_MIN || '2', 10)
  const poolMax = parseInt(process.env.DB_POOL_MAX || '10', 10)
  const poolIdleTimeout = parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10)
  const poolAcquireTimeout = parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT || '60000', 10)

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

function registerShutdownHooks(state: OrmState) {
  if (state.shutdownRegistered) return

  if (typeof process === 'undefined' || typeof process.once !== 'function') {
    state.shutdownRegistered = true
    return
  }

  const handleTermination = async (code?: number) => {
    try {
      await closeOrm()
    } catch {
      // ignore shutdown errors
    } finally {
      if (typeof code === 'number') {
        process.exit(code)
      }
    }
  }

  process.once('beforeExit', () => {
    void closeOrm()
  })

  process.once('SIGINT', () => {
    void handleTermination(0)
  })

  process.once('SIGTERM', () => {
    void handleTermination(0)
  })

  state.shutdownRegistered = true
}

export async function getOrm(): Promise<MikroORM<PostgreSqlDriver>> {
  const state = resolveOrmState()
  registerShutdownHooks(state)

  if (state.closingPromise) {
    await state.closingPromise
  }

  if (state.instance) {
    return state.instance
  }

  if (state.initPromise) {
    return state.initPromise
  }

  const initPromise = initOrm()
    .then((orm) => {
      state.instance = orm
      state.initPromise = null
      return orm
    })
    .catch((error) => {
      state.initPromise = null
      throw error
    })

  state.initPromise = initPromise
  return initPromise
}

export async function getEm() {
  const orm = await getOrm()
  return orm.em.fork({ clear: true })
}

export async function closeOrm(): Promise<void> {
  const state = resolveOrmState()

  if (state.closingPromise) {
    await state.closingPromise
    return
  }

  if (!state.instance && !state.initPromise) {
    return
  }

  const closing = (async () => {
    try {
      const instance =
        state.instance ?? (await state.initPromise?.catch(() => null)) ?? null
      if (instance) {
        await instance.close(true)
      }
    } finally {
      state.instance = null
      state.initPromise = null
      state.closingPromise = null
    }
  })()

  state.closingPromise = closing
  await closing
}
