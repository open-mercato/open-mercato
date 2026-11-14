const mockDispose = jest.fn(async () => {})
const mockExecute = jest.fn()
const mockScope = {
  status: 'resolved',
  context: { kind: 'tenant', tenantId: '00000000-0000-4000-8000-000000000001' },
  invocation: { token: {}, isActive: () => true },
}
const mockHeaders = new Map([
  ['x-rls-probe-record-ids', '["00000000-0000-4000-8000-000000000002"]'],
  ['x-rls-probe-id', '00000000-0000-4000-8000-000000000003'],
])
jest.mock('next/headers', () => ({ headers: async () => mockHeaders }))
jest.mock('next/server', () => ({ after: jest.fn() }))
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('not found') } }))
jest.mock('@open-mercato/shared/lib/db/runtime', () => ({ resolveDatabaseExecutionContext: async () => mockScope }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    dispose: mockDispose,
    resolve: () => ({
      getMetadata: () => ({ get: () => ({ schema: 'public', tableName: 'customer_entities' }) }),
      getKysely: () => ({}),
    }),
  }),
}))
jest.mock('kysely', () => ({ sql: Object.assign(() => ({ execute: mockExecute }), { table: jest.fn(), join: jest.fn() }) }))
jest.mock('../../data/entities', () => ({ CustomerEntity: class CustomerEntity {} }))
import { renderTenantBoundaryIntegrationProbe } from '../renderIntegrationProbe'

const previousIntegration = process.env.OM_INTEGRATION_TEST
beforeEach(() => {
  jest.clearAllMocks()
  process.env.OM_INTEGRATION_TEST = 'true'
  mockExecute.mockResolvedValue({ rows: [] })
})
afterAll(() => {
  if (previousIntegration === undefined) delete process.env.OM_INTEGRATION_TEST
  else process.env.OM_INTEGRATION_TEST = previousIntegration
})

it.each([false, true])('disposes its owned render container after a query (failure=%s)', async (fails) => {
  const failure = new Error('query failed')
  if (fails) mockExecute.mockRejectedValueOnce(failure)
  const element = await renderTenantBoundaryIntegrationProbe()
  if (!element || typeof element.type !== 'function') throw new Error('expected deferred component')
  const pending = element.type(element.props)
  if (fails) await expect(pending).rejects.toBe(failure)
  else await expect(pending).resolves.toBeDefined()
  expect(mockDispose).toHaveBeenCalledTimes(1)
  expect(mockExecute.mock.invocationCallOrder[0]).toBeLessThan(mockDispose.mock.invocationCallOrder[0])
})
