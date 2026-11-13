import handle from '../status-poller'
import { registerDatabaseRuntimeAdapter } from '@open-mercato/shared/lib/db/runtime'
import { registerDatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { currentTenantBoundaryScope, runWithFreshTenantBoundary, runWithTenantBoundary } from '../../../../../../enterprise/src/lib/rls/runtime/scope'

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/logger', () => ({ createLogger: () => ({ error: jest.fn(), info: jest.fn() }) }))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError: mockReportError }) }))

const inactiveTenant = '12345678-1234-4234-8234-123456789012'
const activeTenant = '12345678-1234-4234-8234-123456789013'
const mockReportError = jest.fn()
const validateBinding = jest.fn(async (tenantId: string | null) => tenantId === activeTenant)
const dispose = jest.fn(async () => {
  expect(currentTenantBoundaryScope()?.context).toMatchObject({ kind: 'tenant', tenantId: activeTenant })
})

beforeAll(() => {
  registerDatabaseRuntimeAdapter({
    id: 'maintenance-composition-test', version: '1', configurationKey: 'test',
    configurePool: () => { throw new Error('No physical pool in this test') },
    run: runWithTenantBoundary, runFresh: runWithFreshTenantBoundary,
    currentContext: () => currentTenantBoundaryScope()?.context,
  })
  registerDatabaseModuleDeclarations([{ moduleId: 'test-binding', declarations: {
    bindingValidators: [async ({ context }) => {
      expect(currentTenantBoundaryScope()?.context).toMatchObject({ kind: 'identity', tenantId: context.tenantId })
      return validateBinding(context.tenantId)
    }],
  } }])
})

beforeEach(() => {
  jest.clearAllMocks()
  validateBinding.mockImplementation(async (tenantId) => tenantId === activeTenant)
  dispose.mockImplementation(async () => {
    expect(currentTenantBoundaryScope()?.context).toMatchObject({ kind: 'tenant', tenantId: activeTenant })
  })
})

const transactions = [inactiveTenant, activeTenant].map((tenantId, index) => ({
  id: `payment-${index}`, tenantId, organizationId: null, providerKey: 'test',
}))
const getPaymentStatus = jest.fn(async () => {
  expect(currentTenantBoundaryScope()?.context).toMatchObject({ kind: 'tenant', tenantId: activeTenant })
})
const write = jest.fn(async () => undefined)
const discovery = jest.fn(async () => {
  expect(currentTenantBoundaryScope()?.context.kind).toBe('maintenance')
  return transactions
})
const fallback = { resolve: () => ({ listTransactionsForStatusPolling: discovery }) }

beforeEach(() => {
  jest.mocked(createRequestContainer).mockImplementation(async () => {
    expect(currentTenantBoundaryScope()?.context).toMatchObject({ kind: 'tenant', tenantId: activeTenant })
    return { resolve: (name: string) => name === 'paymentGatewayService' ? { getPaymentStatus } : { write }, dispose } as never
  })
})

it.each(['inactive', 'binding error'])('skips %s A and polls active B through the real helper and scope', async (failure) => {
  if (failure === 'binding error') validateBinding.mockImplementation(async (tenantId) => {
    if (tenantId === inactiveTenant) throw new Error('Binding lookup failed')
    return true
  })
  await runWithTenantBoundary({ kind: 'maintenance', tenantId: null, source: 'maintenance', operation: 'payment-discovery' }, () =>
    handle({ payload: {} } as Parameters<typeof handle>[0], fallback as unknown as Parameters<typeof handle>[1]))
  expect(validateBinding.mock.calls.map(([tenantId]) => tenantId)).toEqual([inactiveTenant, activeTenant])
  expect(createRequestContainer).toHaveBeenCalledTimes(1)
  expect(getPaymentStatus).toHaveBeenCalledTimes(1)
  expect(getPaymentStatus).toHaveBeenCalledWith('payment-1', { tenantId: activeTenant, organizationId: null })
  expect(write).not.toHaveBeenCalled()
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(mockReportError).toHaveBeenCalledTimes(1)
  expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
    module: 'payment_gateways', code: 'payment_gateways.status_maintenance_failed',
  })
  expect(currentTenantBoundaryScope()).toBeUndefined()
})

it('continues after a tenant payment and its durable error log both fail', async () => {
  discovery.mockResolvedValueOnce(transactions.map((transaction) => ({ ...transaction, tenantId: activeTenant })))
  getPaymentStatus.mockRejectedValueOnce(new Error('Provider unavailable'))
  write.mockRejectedValueOnce(new Error('Log unavailable'))
  await runWithTenantBoundary({ kind: 'maintenance', tenantId: null, source: 'maintenance', operation: 'payment-discovery' }, () =>
    handle({ payload: {} } as Parameters<typeof handle>[0], fallback as unknown as Parameters<typeof handle>[1]))
  expect(getPaymentStatus).toHaveBeenCalledTimes(2)
  expect(getPaymentStatus).toHaveBeenLastCalledWith('payment-1', { tenantId: activeTenant, organizationId: null })
  expect(write).toHaveBeenCalledTimes(1)
  expect(dispose).toHaveBeenCalledTimes(2)
  expect(mockReportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Log unavailable' }), {
    module: 'payment_gateways', code: 'payment_gateways.status_maintenance_failed',
  })
})
