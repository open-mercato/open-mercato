import { Client, Pool } from 'pg'
import { configureDatabasePool, isDatabaseRuntimeEnabled, resolveDatabaseConnectionUrl, runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { getSslConfig } from '@open-mercato/shared/lib/db/ssl'

export async function createCliMaintenanceClient(connectionString: string | undefined) {
  if (!isDatabaseRuntimeEnabled()) return new Client({ connectionString, ssl: getSslConfig() })
  if (!connectionString) throw new Error('[internal] Database maintenance requires a configured connection')
  const pool = new Pool({ connectionString: resolveDatabaseConnectionUrl('maintenance', connectionString), ssl: getSslConfig(), max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 30_000 })
  const lifecycle = await (async () => {
    try { return configureDatabasePool(pool, { id: 'cli.maintenance', purpose: 'maintenance', tables: [] }) } catch (error) { await pool.end(); throw error }
  })()
  const invoke = <Result>(callback: () => Promise<Result>) => runWithFreshDatabaseExecutionContext({ kind: 'maintenance', tenantId: null, source: 'cli', operation: 'database-maintenance' }, callback)
  return {
    connect: () => invoke(() => lifecycle.ready()),
    query: ((...arguments_: unknown[]) => invoke(async () => {
      await lifecycle.ready()
      return Reflect.apply(pool.query, pool, arguments_)
    })) as Pool['query'],
    end: async () => { try { await pool.end() } finally { lifecycle.dispose() } },
  }
}
