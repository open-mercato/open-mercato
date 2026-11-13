import { createHash } from 'node:crypto'
import {
  registerDatabaseRuntimeAdapter,
  type DatabasePoolDescriptor,
  type DatabaseRuntimeAdapter,
} from '@open-mercato/shared/lib/db/runtime'
import { readTenantBoundaryConfiguration, resolveTenantMaintenanceUrl, type TenantBoundaryConfiguration } from './config'
import { assertTenantOrmInventory, loadTenantTableManifest } from './manifest'
import { installTenantPoolBoundary, type BoundaryPool } from './pool'
import { verifyTenantTablePolicies } from './policies'
import { verifyRuntimeDatabaseRole } from './roles'
import { currentTenantBoundaryScope, runWithTenantBoundary } from './scope'
import { registerTenantBoundaryRequestResolver } from './requests'

const registrationKey = Symbol.for('@open-mercato/enterprise.tenantBoundaryRegistration.v1')
type RegistrationState = { configurationKey: string }

function supportedPool(value: object): BoundaryPool {
  if (!('connect' in value) || typeof value.connect !== 'function') {
    throw new Error('[internal] Tenant boundary requires a supported PostgreSQL pool')
  }
  return value as BoundaryPool
}

export function createTenantBoundaryAdapter(
  configuration: Extract<TenantBoundaryConfiguration, { enabled: true }>,
  env: Readonly<NodeJS.ProcessEnv>,
  configurationKey: string,
): DatabaseRuntimeAdapter {
  let reviewedManifest: ReturnType<typeof loadTenantTableManifest> | undefined
  const manifest = () => reviewedManifest ??= loadTenantTableManifest(configuration)
  return Object.freeze({
    id: 'enterprise.tenant-boundaries', version: '1', configurationKey,
    run: runWithTenantBoundary,
    currentContext: () => currentTenantBoundaryScope()?.context,
    connectionUrl: (purpose, defaultUrl) => purpose === 'maintenance'
      ? resolveTenantMaintenanceUrl(env, defaultUrl) : defaultUrl,
    configurePool: (value: object, descriptor: DatabasePoolDescriptor) => {
      if (descriptor.purpose !== 'runtime') {
        throw new Error('[internal] Tenant boundary pool purpose requires its explicit execution integration')
      }
      const pool = supportedPool(value)
      return installTenantPoolBoundary(pool, {
        configurationKey: `${configurationKey}:${descriptor.id}`,
        initializeClient: async (client) => { await verifyRuntimeDatabaseRole(client, [configuration.schema]) },
        verifyPool: async (guarded) => {
          const reviewed = await manifest()
          if (descriptor.tables === 'primary') {
            const metadata = descriptor.metadata?.()
            if (!metadata) throw new Error('[internal] Tenant boundary primary pool requires active ORM metadata before readiness')
            assertTenantOrmInventory(reviewed, metadata)
          } else {
            const known = new Set(reviewed.tables.map((table) => `${table.schema}.${table.table}`))
            if (descriptor.tables.some((table) => !known.has(table))) {
              throw new Error('[internal] Tenant boundary pool declares an unclassified table')
            }
          }
          const client = await guarded.connect()
          try { await verifyTenantTablePolicies(client, reviewed) } finally { client.release() }
        },
      })
    },
  })
}

export function registerTenantBoundaryRuntime(registration: Readonly<{ version: 1 }> = { version: 1 }): void {
  if (registration.version !== 1) throw new Error('[internal] Unsupported tenant boundary bootstrap registration')
  const configuration = readTenantBoundaryConfiguration()
  const env = Object.freeze({ ...process.env })
  const configurationKey = createHash('sha256').update(JSON.stringify({
    configuration, database: env.DATABASE_URL, maintenance: env.OM_TENANT_RLS_MAINTENANCE_DATABASE_URL,
  })).digest('hex')
  const globals = globalThis as typeof globalThis & { [registrationKey]?: RegistrationState }
  const previous = globals[registrationKey]
  if (previous && previous.configurationKey !== configurationKey) {
    throw new Error('[internal] Tenant boundary bootstrap configuration changed; drain pools and restart')
  }
  if (configuration.enabled) {
    registerDatabaseRuntimeAdapter(createTenantBoundaryAdapter(configuration, env, configurationKey))
    registerTenantBoundaryRequestResolver()
  }
  globals[registrationKey] ??= { configurationKey }
}
