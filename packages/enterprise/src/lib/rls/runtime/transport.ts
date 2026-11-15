import type { DatabasePoolLifecycle, DatabaseTransportDescriptor } from '@open-mercato/shared/lib/db/runtime'
import { verifyRuntimeDatabaseRole } from './roles'
import type { BoundaryClient } from './pool'

type TransportConnection = { query: (...arguments_: unknown[]) => unknown; connect?: (...arguments_: unknown[]) => unknown }
type Callback = (error: Error | null, result?: unknown, release?: unknown) => void

export function installDatabaseTransportBoundary(value: object, descriptor: DatabaseTransportDescriptor, schema: string): DatabasePoolLifecycle {
  if (!('query' in value) || typeof value.query !== 'function' || !/^[a-z_][a-z0-9_]*$/i.test(descriptor.channel)) {
    throw new Error('[internal] Invalid database transport connection or channel')
  }
  const connection = value as TransportConnection
  const originalQuery = connection.query
  const originalConnect = connection.connect
  const verified = new WeakSet<object>()
  let disposed = false
  let readiness: Promise<void> | undefined
  let pending = 0
  let leases = 0
  let acquisitions = 0
  const verify = async (client: Pick<BoundaryClient, 'query'>) => { await verifyRuntimeDatabaseRole(client, [schema]) }
  const ready = () => readiness ??= (async () => {
    if (disposed) throw new Error('[internal] Database transport is disposed')
    pending += 1
    try {
      if (descriptor.kind === 'client') return await verify({ query: originalQuery.bind(connection) })
      if (!originalConnect) throw new Error('[internal] Database transport pool requires connect')
      const client = await originalConnect.call(connection) as BoundaryClient
      try { await verify(client); verified.add(client) } finally { client.release() }
    } finally { pending -= 1 }
  })()
  function assertCommand(arguments_: unknown[]): void {
    if (disposed) throw new Error('[internal] Database transport is disposed')
    const [query, parameters] = arguments_
    const notify = descriptor.mode === 'publish' && query === 'SELECT pg_notify($1, $2)'
      && Array.isArray(parameters) && parameters.length === 2 && parameters[0] === descriptor.channel && typeof parameters[1] === 'string'
    const listen = descriptor.mode === 'listen' && query === `LISTEN ${descriptor.channel}` && parameters === undefined
    if (!notify && !listen) throw new Error('[internal] Database transport rejects application SQL')
  }
  function guardedQuery(receiver: object, original: TransportConnection['query'], arguments_: unknown[]): unknown {
    const callback = arguments_.at(-1)
    const inputs = typeof callback === 'function' ? arguments_.slice(0, -1) : arguments_
    const execute = async () => {
      assertCommand(inputs)
      pending += 1
      try { await ready(); assertCommand(inputs); return await original.apply(receiver, inputs) } finally { pending -= 1 }
    }
    if (typeof callback !== 'function') return execute()
    void execute().then((result) => (callback as Callback)(null, result), (error: Error) => (callback as Callback)(error))
    return undefined
  }
  connection.query = function (...arguments_: unknown[]) { return guardedQuery(this, originalQuery, arguments_) }
  if (descriptor.kind === 'pool') {
    connection.connect = function (callback?: unknown): unknown {
      const acquire = async () => {
        acquisitions += 1
        try {
          await ready()
          if (disposed) throw new Error('[internal] Database transport is disposed')
          const client = await originalConnect!.call(connection) as BoundaryClient
          try {
            if (!verified.has(client)) { await verify(client); verified.add(client) }
            leases += 1
            let released = false
            const facade: Record<string, unknown> = {
              query: (...arguments_: unknown[]) => {
                if (released) return Promise.reject(new Error('[internal] Database transport lease is released'))
                return guardedQuery(client, client.query, arguments_)
              },
              release: (error?: Error | boolean) => {
                if (released) throw new Error('[internal] Database transport lease is released')
                released = true
                leases -= 1
                client.release(error)
              },
            }
            for (const name of ['on', 'once', 'removeListener']) {
              const method = (client as unknown as Record<string, unknown>)[name]
              if (typeof method === 'function') facade[name] = (...arguments_: unknown[]) => {
                const result = method.apply(client, arguments_)
                return result === client ? facade : result
              }
            }
            return Object.freeze(facade) as unknown as BoundaryClient
          } catch (error) { client.release(error instanceof Error ? error : true); throw error }
        } finally { acquisitions -= 1 }
      }
      if (typeof callback !== 'function') return acquire()
      void acquire().then((client) => (callback as Callback)(null, client, client.release), (error: Error) => (callback as Callback)(error))
      return undefined
    }
  }
  return Object.freeze({ ready, dispose: () => {
    if (pending || leases || acquisitions) throw new Error('[internal] Database transport must drain before disposal')
    disposed = true
    connection.query = originalQuery
    if (originalConnect) connection.connect = originalConnect
  } })
}
