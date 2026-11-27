import type { EntityManager } from '@mikro-orm/postgresql'
import { registerDatabaseRuntimeAdapter } from '@open-mercato/shared/lib/db/runtime'
import { registerDatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import { databaseDeclarations } from '@open-mercato/core/modules/directory/database'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { currentTenantBoundaryScope, runWithTenantBoundary, runWithFreshTenantBoundary } from '../lib/rls/runtime/scope'
import { hasPersistedWorkspace, runOnboardingIdentity } from '../../../onboarding/src/modules/onboarding/lib/tenant-continuation'
import type { OnboardingRequest } from '../../../onboarding/src/modules/onboarding/data/entities'

const mockDispose = jest.fn(async () => {
  await Promise.resolve()
  expect(currentTenantBoundaryScope()?.context).toMatchObject({ kind: 'identity', tenantId })
})
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => ({}), dispose: mockDispose }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const findOne = jest.mocked(findOneWithDecryption)

beforeEach(() => {
  jest.clearAllMocks()
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('@open-mercato/shared.databaseRuntime.v1')]
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('@open-mercato/shared.databaseModuleDeclarations.v1')]
  registerDatabaseRuntimeAdapter({
    id: 'onboarding-binding', version: '1', configurationKey: 'test',
    configurePool: () => ({ ready: async () => undefined, dispose: () => undefined }),
    run: runWithTenantBoundary, runFresh: runWithFreshTenantBoundary,
    currentContext: () => currentTenantBoundaryScope()?.context,
  })
  registerDatabaseModuleDeclarations([{ moduleId: 'directory', declarations: databaseDeclarations }])
})

test.each(['valid', 'inactive tenant', 'foreign organization'])('real directory binding handles %s inside onboarding identity', async (mode) => {
  findOne.mockImplementation(async (_em, entity, where) => {
    expect(currentTenantBoundaryScope()?.context).toMatchObject({ kind: 'identity', tenantId })
    expect(currentTenantBoundaryScope()?.invocation.isActive()).toBe(true)
    if (entity.name === 'Tenant') {
      expect(where).toEqual({ id: tenantId, isActive: true, deletedAt: null })
      return mode === 'inactive tenant' ? null : { id: tenantId }
    }
    expect(where).toEqual({ id: organizationId, tenant: tenantId, isActive: true, deletedAt: null })
    return mode === 'foreign organization' ? null : { id: organizationId }
  })
  await runOnboardingIdentity(async () => {
    const parent = currentTenantBoundaryScope()
    const request = { tenantId, organizationId } as OnboardingRequest
    await expect(hasPersistedWorkspace({} as EntityManager, request)).resolves.toBe(mode === 'valid')
    expect(currentTenantBoundaryScope()).toBe(parent)
    expect(parent?.context.tenantId).toBeNull()
    expect(parent?.invocation.isActive()).toBe(true)
  })
  expect(mockDispose).toHaveBeenCalledTimes(1)
})

test('direct identity rebinding remains forbidden', () => {
  expect(() => runOnboardingIdentity(() => runWithTenantBoundary({ kind: 'identity', tenantId, source: 'identity', operation: 'nested' }, () => undefined)))
    .toThrow('Cannot change tenant boundary identity inside an active invocation')
})
