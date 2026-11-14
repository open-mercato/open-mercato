import { databaseDeclarations } from '../database'
import { validateDeclaredDatabaseBinding } from '@open-mercato/shared/lib/db/declarations'

jest.mock('@open-mercato/shared/lib/db/declarations', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/db/declarations'), validateDeclaredDatabaseBinding: jest.fn(),
}))
const provider = databaseDeclarations.jobProviders![0]
const tenantId = '11111111-1111-4111-8111-111111111111'
const otherTenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const queue = 'staff-time-reapply-rounding'
const resolve = (payload: unknown, metadata?: Record<string, unknown>) => provider.resolve({ queue, workerIds: [], payload, metadata })

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(validateDeclaredDatabaseBinding).mockResolvedValue(true)
})
it('owns the actual queue and rejects unrelated queues', () => {
  expect(provider.matches({ queue, workerIds: [], payload: {} })).toBe(true)
  expect(provider.matches({ queue: `${queue}-other`, workerIds: [], payload: {} })).toBe(false)
})
it('accepts a nested scope from a manual enqueue after persisted binding validation', async () => {
  await expect(resolve({ scope: { tenantId, organizationId } })).resolves.toMatchObject({ kind: 'tenant', tenantId })
  expect(validateDeclaredDatabaseBinding).toHaveBeenCalledWith({ context: expect.objectContaining({ tenantId }), organization: { id: organizationId } }, { requireValidator: true })
})
it('accepts scheduler top-level identity matching the nested scope', async () => {
  await expect(resolve({ tenantId, scope: { tenantId, organizationId } }, { tenantId })).resolves.toMatchObject({ kind: 'tenant', tenantId })
})
it.each([
  { scope: { tenantId }, tenantId: otherTenantId },
  { scope: { tenantId: 'invalid' } },
  { scope: { tenantId, organizationId: 'invalid' } },
  { scope: { tenantId, organizationId }, organizationId: otherTenantId },
  { maintenance: true },
])('rejects invalid or conflicting identity before binding/container work (%j)', async (payload) => {
  await expect(resolve(payload)).rejects.toThrow()
  expect(validateDeclaredDatabaseBinding).not.toHaveBeenCalled()
})
it('rejects conflicting queue metadata', async () => {
  await expect(resolve({ scope: { tenantId } }, { tenantId: otherTenantId })).rejects.toThrow('conflicting')
  expect(validateDeclaredDatabaseBinding).not.toHaveBeenCalled()
})
it('rejects a removed persisted tenant or organization', async () => {
  jest.mocked(validateDeclaredDatabaseBinding).mockResolvedValue(false)
  await expect(resolve({ scope: { tenantId, organizationId } })).rejects.toThrow('persisted active')
})
