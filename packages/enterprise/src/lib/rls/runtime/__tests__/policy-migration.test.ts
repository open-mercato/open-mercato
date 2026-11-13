import { Migration20261113160000 } from '../../../../modules/tenant_boundaries/migrations/Migration20261113160000'
import { createTenantMigrationHooks } from '../migrations'
import { loadTenantTableManifest } from '../manifest'

const mockRollback = jest.fn(async () => undefined)
jest.mock('@mikro-orm/migrations', () => ({ Migration: class {} }))
jest.mock('../migrations', () => ({ createTenantMigrationHooks: jest.fn(() => ({ rollbackPolicies: mockRollback })) }))
jest.mock('../manifest', () => ({ loadTenantTableManifest: jest.fn(async () => ({ version: 1, tables: [] })) }))
const previousEnvironment = process.env
beforeEach(() => { jest.clearAllMocks(); process.env = { ...previousEnvironment }; delete process.env.OM_TENANT_RLS })
afterEach(() => { process.env = previousEnvironment })
function migration(): Migration20261113160000 { return Object.create(Migration20261113160000.prototype) }

it('records the lifecycle marker without activating policies before other modules finish', async () => {
  await migration().up()
  process.env.OM_TENANT_RLS = 'on'
  await migration().up()
  expect(createTenantMigrationHooks).not.toHaveBeenCalled()
})

it('requires explicit enabled maintenance configuration for rollback', async () => {
  await expect(migration().down()).rejects.toThrow('maintenance configuration')
  expect(mockRollback).not.toHaveBeenCalled()
})

it('rolls back through the same exact-version verified hook and propagates failure', async () => {
  process.env.OM_TENANT_RLS = 'on'
  process.env.OM_TENANT_RLS_POOL_MODE = 'direct'
  await migration().down()
  expect(mockRollback).toHaveBeenCalledTimes(1)
  const [configuration, env, manifest] = jest.mocked(createTenantMigrationHooks).mock.calls[0]
  expect(configuration).toMatchObject({ enabled: true, schema: 'public' })
  expect(env).not.toBe(process.env)
  await manifest()
  expect(loadTenantTableManifest).toHaveBeenCalledWith(configuration)
  mockRollback.mockRejectedValueOnce(new Error('[internal] policy drift'))
  await expect(migration().down()).rejects.toThrow('policy drift')
})
