import { createTenantMigrationHooks } from '../migrations'
import { parseTenantTableManifest } from '../manifest'
import { currentTenantBoundaryScope } from '../scope'

const mockRelease = jest.fn()
const mockQuery = jest.fn(async () => ({ rows: [] }))
const mockConnect = jest.fn(async () => ({ query: mockQuery, release: mockRelease }))
const mockEnd = jest.fn(async () => undefined)
const mockReady = jest.fn(async () => undefined)
const mockDispose = jest.fn()
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({ connect: mockConnect, end: mockEnd })) }))
jest.mock('@open-mercato/shared/lib/db/ssl', () => ({ getSslConfig: () => false }))
jest.mock('@open-mercato/shared/lib/db/runtime', () => ({ configureDatabasePool: jest.fn(() => ({ ready: mockReady, dispose: mockDispose })) }))
jest.mock('../roles', () => ({ verifyMaintenanceDatabaseRole: jest.fn(async () => undefined), verifyRuntimeDatabaseRole: jest.fn(async () => ({ current_role: 'runtime' })) }))
jest.mock('../manifest', () => ({ ...jest.requireActual('../manifest'), readTenantCatalog: jest.fn(async () => []), assertTenantTableInventory: jest.fn() }))
jest.mock('../policies', () => ({ reconcileTenantTablePolicies: jest.fn(), rollbackTenantTablePolicies: jest.fn(async () => undefined) }))
jest.mock('@open-mercato/shared/lib/db/declarations', () => ({ provisionDeclaredDatabaseStorage: jest.fn(async () => undefined) }))

import { configureDatabasePool } from '@open-mercato/shared/lib/db/runtime'
import { provisionDeclaredDatabaseStorage } from '@open-mercato/shared/lib/db/declarations'
import { assertTenantTableInventory } from '../manifest'
import { verifyMaintenanceDatabaseRole, verifyRuntimeDatabaseRole } from '../roles'
import { reconcileTenantTablePolicies, rollbackTenantTablePolicies } from '../policies'

const manifest = parseTenantTableManifest({ version: 1, tables: [{ schema: 'public', table: 'extension_records', owner: 'extension', classification: 'enforced', reason: 'Test owner declaration', tenantColumn: 'tenant_id', tenantType: 'uuid', tenantNullable: false, policyVersion: 1 }] })
const configuration = { enabled: true, schema: 'public', poolMode: 'direct' } as const
const env = { DATABASE_URL: 'postgresql://runtime@localhost/disposable', OM_TENANT_RLS_MAINTENANCE_DATABASE_URL: 'postgresql://maintenance@localhost/disposable' }
const loadManifest = jest.fn(async () => manifest)
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(verifyRuntimeDatabaseRole).mockResolvedValue({ current_role: 'runtime' } as never)
  jest.mocked(reconcileTenantTablePolicies).mockImplementation(async (_client, _manifest, _role, provision) => { await provision?.() })
})

it('checks privileged and restricted role identities before preflight and closes both pools', async () => {
  jest.mocked(verifyMaintenanceDatabaseRole).mockImplementationOnce(async () => {
    expect(currentTenantBoundaryScope()).toMatchObject({ context: { kind: 'maintenance', operation: 'db:migrate:preflight' } })
  })
  await createTenantMigrationHooks(configuration, env, loadManifest).beforeMigrate()
  expect(configureDatabasePool).toHaveBeenCalledWith(expect.anything(), { id: 'migration-maintenance', purpose: 'maintenance', tables: [] })
  expect(verifyMaintenanceDatabaseRole).toHaveBeenCalledWith(expect.anything(), 'maintenance')
  expect(verifyRuntimeDatabaseRole).toHaveBeenCalledWith(expect.anything(), ['public'])
  expect(assertTenantTableInventory).toHaveBeenCalledWith(manifest, [], 'preflight')
  expect(reconcileTenantTablePolicies).not.toHaveBeenCalled()
  expect(mockRelease).toHaveBeenCalledTimes(2)
  expect(mockEnd).toHaveBeenCalledTimes(2)
  expect(mockDispose).toHaveBeenCalledTimes(1)
  expect(currentTenantBoundaryScope()).toBeUndefined()
})

it('provides owner-local storage provisioning inside the policy reconciliation transaction callback', async () => {
  await createTenantMigrationHooks(configuration, env, loadManifest).afterMigrate()
  expect(reconcileTenantTablePolicies).toHaveBeenCalledWith(expect.anything(), manifest, 'runtime', expect.any(Function))
  expect(provisionDeclaredDatabaseStorage).toHaveBeenCalledWith({ query: expect.any(Function) })
})

it('uses the same verified maintenance boundary for exact policy rollback', async () => {
  await createTenantMigrationHooks(configuration, env, loadManifest).rollbackPolicies()
  expect(rollbackTenantTablePolicies).toHaveBeenCalledWith(expect.anything(), manifest, 'runtime')
  expect(provisionDeclaredDatabaseStorage).not.toHaveBeenCalled()
})

it('rejects a different runtime identity before policy or storage changes and releases every connection', async () => {
  jest.mocked(verifyRuntimeDatabaseRole).mockResolvedValueOnce({ current_role: 'unexpected' } as never)
  await expect(createTenantMigrationHooks(configuration, env, loadManifest).afterMigrate()).rejects.toThrow('unexpected role')
  expect(reconcileTenantTablePolicies).not.toHaveBeenCalled()
  expect(provisionDeclaredDatabaseStorage).not.toHaveBeenCalled()
  expect(mockRelease).toHaveBeenCalledTimes(2)
  expect(mockEnd).toHaveBeenCalledTimes(2)
  expect(mockDispose).toHaveBeenCalledTimes(1)
})

it('propagates reconciliation failure and startup failure while disposing pools', async () => {
  jest.mocked(reconcileTenantTablePolicies).mockRejectedValueOnce(new Error('[internal] policy failure'))
  await expect(createTenantMigrationHooks(configuration, env, loadManifest).afterMigrate()).rejects.toThrow('policy failure')
  mockReady.mockRejectedValueOnce(new Error('[internal] readiness failure'))
  await expect(createTenantMigrationHooks(configuration, env, loadManifest).beforeMigrate()).rejects.toThrow('readiness failure')
  expect(mockEnd).toHaveBeenCalledTimes(4)
  expect(mockDispose).toHaveBeenCalledTimes(2)
  expect(mockRelease).toHaveBeenCalledTimes(2)
})
