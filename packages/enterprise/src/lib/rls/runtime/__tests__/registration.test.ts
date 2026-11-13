import { EventEmitter } from 'node:events'

const keys = [
  '@open-mercato/shared.databaseRuntime.v1',
  '@open-mercato/enterprise.tenantBoundaryRegistration.v1',
  '@open-mercato/enterprise.tenantBoundaryScope.v1',
  '@open-mercato/enterprise.tenantBoundaryPools.v1',
]
const globals = globalThis as Record<symbol, unknown>
const previousEnvironment = process.env

beforeEach(() => {
  jest.resetModules()
  for (const key of keys) delete globals[Symbol.for(key)]
  process.env = { ...previousEnvironment }
  delete process.env.OM_TENANT_RLS
  delete process.env.OM_TENANT_RLS_POOL_MODE
})

afterEach(() => {
  process.env = previousEnvironment
  for (const key of keys) delete globals[Symbol.for(key)]
})

it('is synchronous and inert when activation is absent or off', async () => {
  const { registerTenantBoundaryRuntime } = await import('../registration')
  const runtime = await import('@open-mercato/shared/lib/db/runtime')
  const callback = jest.fn(() => 42)
  expect(registerTenantBoundaryRuntime()).toBeUndefined()
  expect(runtime.runWithDatabaseExecutionContext({ kind: 'tenant', tenantId: 'legacy-value', source: 'api' }, callback)).toBe(42)
  expect(callback).toHaveBeenCalledTimes(1)
  expect(runtime.beginDatabaseInitialization()).toBe(false)
})

it('registers before initialization without touching a database and shares state across module instances', async () => {
  process.env.OM_TENANT_RLS = 'on'
  process.env.OM_TENANT_RLS_POOL_MODE = 'direct'
  const { registerTenantBoundaryRuntime } = await import('../registration')
  registerTenantBoundaryRuntime()
  const runtime = await import('@open-mercato/shared/lib/db/runtime')
  expect(runtime.beginDatabaseInitialization()).toBe(true)
  expect(() => registerTenantBoundaryRuntime()).not.toThrow()
  jest.resetModules()
  const duplicate = await import('../registration')
  expect(() => duplicate.registerTenantBoundaryRuntime()).not.toThrow()
  expect(() => runtime.runWithDatabaseExecutionContext({ kind: 'tenant', tenantId: 'invalid', source: 'api' }, () => 42)).toThrow('UUID')
})

it('rejects configuration replacement and disabling an already configured process', async () => {
  process.env.OM_TENANT_RLS = 'on'
  process.env.OM_TENANT_RLS_POOL_MODE = 'direct'
  const { registerTenantBoundaryRuntime } = await import('../registration')
  registerTenantBoundaryRuntime()
  process.env.OM_TENANT_RLS = 'off'
  expect(() => registerTenantBoundaryRuntime()).toThrow('restart')
})

it('rejects activation after an unguarded ORM initialization', async () => {
  const runtime = await import('@open-mercato/shared/lib/db/runtime')
  expect(runtime.beginDatabaseInitialization()).toBe(false)
  process.env.OM_TENANT_RLS = 'on'
  process.env.OM_TENANT_RLS_POOL_MODE = 'session'
  const { registerTenantBoundaryRuntime } = await import('../registration')
  expect(() => registerTenantBoundaryRuntime()).toThrow('before connection pools')
})

it('fails closed on unintegrated pool purposes and undeclared primary metadata', async () => {
  const { createTenantBoundaryAdapter } = await import('../registration')
  const adapter = createTenantBoundaryAdapter({ enabled: true, poolMode: 'direct', schema: 'public' }, {}, 'fixture')
  const connect = jest.fn()
  const pool = Object.assign(new EventEmitter(), { connect, ended: false })
  expect(() => adapter.configurePool(pool, { id: 'transport', purpose: 'transport', tables: [] })).toThrow('explicit execution')
  const lifecycle = adapter.configurePool(pool, { id: 'primary', purpose: 'runtime', tables: 'primary' })
  await expect(lifecycle.ready()).rejects.toThrow('active ORM metadata')
  expect(connect).not.toHaveBeenCalled()
  pool.ended = true
  lifecycle.dispose()
})

it('uses the existing generator bootstrap hook without a new discovery convention', async () => {
  const { generatorPlugins } = await import('../../../../modules/tenant_boundaries/generators')
  const plugin = generatorPlugins[0]
  expect(plugin.conventionFile).toBe('index.ts')
  expect(plugin.buildOutput({ importSection: '', entriesLiteral: '' })).toContain('version: 1')
  expect(plugin.bootstrapRegistration?.buildCall('tenantBoundaryRegistration')).toBe('registerTenantBoundaryRuntime(tenantBoundaryRegistration)')
})
