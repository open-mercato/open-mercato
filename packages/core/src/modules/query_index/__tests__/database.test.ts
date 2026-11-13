import { databaseDeclarations } from '../database'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveQueryIndexSourceMetadata } from '../lib/subscriber-scope'

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('../lib/subscriber-scope', () => ({
  ...jest.requireActual('../lib/subscriber-scope'), resolveQueryIndexSourceMetadata: jest.fn(),
}))
const provider = databaseDeclarations.jobProviders![0]
const dispose = jest.fn()
const tenantId = '11111111-1111-4111-8111-111111111111'
const resolve = (payload: unknown, metadata?: Record<string, unknown>) => provider.resolve({ queue: 'event:query_index.reindex', workerIds: [], payload, metadata })

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(createRequestContainer).mockResolvedValue({ resolve: jest.fn(), dispose } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
  jest.mocked(resolveQueryIndexSourceMetadata).mockReturnValue({ table: 'customer_entities', tenantColumn: 'tenant_id', organizationColumn: 'organization_id' })
})

it('owns only the exact reindex event', () => {
  expect(provider.matches({ queue: 'event:query_index.reindex', workerIds: [], payload: {} })).toBe(true)
  expect(provider.matches({ queue: 'event:query_index.reindex.other', workerIds: [], payload: {} })).toBe(false)
})
it('classifies registered tenant rows for bounded maintenance', async () => {
  await expect(resolve({ entityType: 'customers:customer_entity', allowAllTenants: true })).resolves.toMatchObject({ kind: 'maintenance' })
  expect(dispose).toHaveBeenCalledTimes(1)
})
it('keeps tenant jobs tenant scoped', async () => {
  await expect(resolve({ entityType: 'customers:customer_entity', tenantId })).resolves.toMatchObject({ kind: 'tenant', tenantId })
})
it('preserves declared tenant-global catalogs', async () => {
  jest.mocked(resolveQueryIndexSourceMetadata).mockReturnValue({ table: 'feature_toggles', tenantColumn: null, organizationColumn: null })
  await expect(resolve({ entityType: 'feature_toggles:feature_toggle', tenantId: null })).resolves.toMatchObject({ kind: 'maintenance' })
})
it.each([null, 'organization_id'])('refuses undeclared tenantless targets regardless of flags (%s)', async (organizationColumn) => {
  jest.mocked(resolveQueryIndexSourceMetadata).mockReturnValue({ table: 'private', tenantColumn: null, organizationColumn })
  await expect(resolve({ entityType: 'auth:session', tenantId: null, maintenance: true, allowAllTenants: true })).rejects.toThrow('no declared')
  expect(dispose).toHaveBeenCalledTimes(1)
})
it('rejects unregistered metadata and disposes the classification container', async () => {
  jest.mocked(resolveQueryIndexSourceMetadata).mockImplementation(() => { throw new Error('not registered') })
  await expect(resolve({ entityType: 'unknown:entity', allowAllTenants: true })).rejects.toThrow('not registered')
  expect(dispose).toHaveBeenCalledTimes(1)
})
it.each([
  { payload: { entityType: 'customers:customer_entity', tenantId: 'bad' } },
  { payload: { entityType: 'customers:customer_entity', tenantId }, metadata: { tenantId: '22222222-2222-4222-8222-222222222222' } },
  { payload: { entityType: 'customers:customer_entity', allowAllTenants: true, organizationId: 'bad' } },
  { payload: { entityType: 'customers:customer_entity', maintenance: true } },
])('rejects invalid scope before a container ($payload)', async ({ payload, metadata }) => {
  await expect(resolve(payload, metadata)).rejects.toThrow()
  expect(createRequestContainer).not.toHaveBeenCalled()
})
