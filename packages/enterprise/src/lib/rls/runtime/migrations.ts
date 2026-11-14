import { Pool } from 'pg'
import { configureDatabasePool, type DatabasePoolLifecycle } from '@open-mercato/shared/lib/db/runtime'
import { getSslConfig } from '@open-mercato/shared/lib/db/ssl'
import { provisionDeclaredDatabaseStorage } from '@open-mercato/shared/lib/db/declarations'
import { resolveTenantMaintenanceUrl, type TenantBoundaryConfiguration } from './config'
import { assertTenantTableInventory, readTenantCatalog, type TenantTableManifest } from './manifest'
import { reconcileTenantTablePolicies, rollbackTenantTablePolicies } from './policies'
import { verifyMaintenanceDatabaseRole, verifyRuntimeDatabaseRole } from './roles'
import { runWithTenantBoundary } from './scope'
import type { BoundaryClient } from './pool'

type ActiveConfiguration = Extract<TenantBoundaryConfiguration, { enabled: true }>

export function createTenantMigrationHooks(
  configuration: ActiveConfiguration,
  env: Readonly<NodeJS.ProcessEnv>,
  manifest: () => Promise<TenantTableManifest>,
): Readonly<{ beforeMigrate(): Promise<void>; afterMigrate(): Promise<void>; rollbackPolicies(): Promise<void> }> {
  async function withMaintenance(operation: string, callback: (client: BoundaryClient, runtimeRole: string) => Promise<void>): Promise<void> {
    const maintenanceUrl = resolveTenantMaintenanceUrl(env)
    const expectedMaintenanceRole = decodeURIComponent(new URL(maintenanceUrl).username)
    const runtimeUrl = env.DATABASE_URL!
    const expectedRuntimeRole = decodeURIComponent(new URL(runtimeUrl).username)
    const poolOptions = { max: 1, connectionTimeoutMillis: 5000, statement_timeout: 30000, ssl: getSslConfig() }
    const maintenancePool = new Pool({ ...poolOptions, connectionString: maintenanceUrl })
    const runtimePool = new Pool({ ...poolOptions, connectionString: runtimeUrl })
    let lifecycle: DatabasePoolLifecycle | undefined
    try {
      lifecycle = configureDatabasePool(maintenancePool, { id: 'migration-maintenance', purpose: 'maintenance', tables: [] })
      await runWithTenantBoundary({ kind: 'maintenance', tenantId: null, source: 'maintenance', operation }, async () => {
        await lifecycle!.ready()
        const maintenanceClient = await maintenancePool.connect()
        try {
          await verifyMaintenanceDatabaseRole(maintenanceClient, expectedMaintenanceRole)
          const runtimeClient = await runtimePool.connect()
          try {
            const actual = await verifyRuntimeDatabaseRole(runtimeClient, [configuration.schema])
            if (actual.current_role !== expectedRuntimeRole) throw new Error('[internal] Migration runtime connection has an unexpected role')
          } finally { runtimeClient.release() }
          await callback(maintenanceClient, expectedRuntimeRole)
        } finally { maintenanceClient.release() }
      })
    } finally {
      try { await Promise.all([maintenancePool.end(), runtimePool.end()]) } finally { lifecycle?.dispose() }
    }
  }

  return Object.freeze({
    beforeMigrate: () => withMaintenance('db:migrate:preflight', async (client) => {
      assertTenantTableInventory(await manifest(), await readTenantCatalog(client), 'preflight')
    }),
    afterMigrate: () => withMaintenance('db:migrate:reconcile', async (client, runtimeRole) => {
      await reconcileTenantTablePolicies(client, await manifest(), runtimeRole, () => provisionDeclaredDatabaseStorage({ query: async (text, values) => client.query(text, values) }))
    }),
    rollbackPolicies: () => withMaintenance('db:migrate:rollback-policy', async (client, runtimeRole) => {
      await rollbackTenantTablePolicies(client, await manifest(), runtimeRole)
    }),
  })
}
