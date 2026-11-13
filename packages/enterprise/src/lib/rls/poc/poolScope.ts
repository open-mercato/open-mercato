import { AsyncLocalStorage } from 'node:async_hooks'
import { z } from 'zod'

export type ScopeClient = {
  query(text: string, values: string[]): Promise<unknown>
  release(error?: Error | boolean): void
}

export type ScopeConnectCallback = (
  error: Error | undefined,
  client: ScopeClient | undefined,
  release: (error?: Error | boolean) => void,
) => void

export type ScopeConnect = {
  (): Promise<ScopeClient>
  (callback: ScopeConnectCallback): void
}

export type ScopePool = { connect: ScopeConnect }

type TenantScope = Readonly<{ tenantId: string }>

const tenantScope = new AsyncLocalStorage<TenantScope>()
const tenantIdSchema = z.string().uuid()
const installedPools = new WeakMap<ScopePool, () => void>()
const setTenantSql = "select set_config('app.current_tenant_id', $1, false)"

export function runWithRlsTenant<Result>(tenantId: string, fn: () => Result): Result {
  const parsed = tenantIdSchema.safeParse(tenantId)
  if (!parsed.success) throw new Error('[internal] RLS tenant must be a UUID')
  const normalizedTenantId = parsed.data.toLowerCase()
  const current = tenantScope.getStore()
  if (current && current.tenantId !== normalizedTenantId) {
    throw new Error('[internal] Cannot change RLS tenant inside an active tenant scope')
  }
  return tenantScope.run(Object.freeze({ tenantId: normalizedTenantId }), fn)
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('[internal] RLS connection setup failed', { cause: error })
}

export function installRlsPoolScope(pool: ScopePool): () => void {
  const existing = installedPools.get(pool)
  if (existing) return existing
  const originalConnect = pool.connect

  async function acquireScopedClient(receiver: ScopePool, tenantId: string): Promise<ScopeClient> {
    const client = await (originalConnect as () => Promise<ScopeClient>).call(receiver)
    try {
      await client.query(setTenantSql, [tenantId])
      return client
    } catch (error) {
      client.release(asError(error))
      throw error
    }
  }

  const scopedConnect = function (
    this: ScopePool,
    callback?: ScopeConnectCallback,
  ): Promise<ScopeClient> | void {
    const clientPromise = acquireScopedClient(this, tenantScope.getStore()?.tenantId ?? '')
    if (!callback) return clientPromise
    void clientPromise.then(
      (client) => callback(undefined, client, client.release.bind(client)),
      (error: unknown) => callback(asError(error), undefined, () => undefined),
    )
  } as ScopeConnect

  pool.connect = scopedConnect
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    if (pool.connect === scopedConnect) pool.connect = originalConnect
    installedPools.delete(pool)
  }
  installedPools.set(pool, dispose)
  return dispose
}
