import handle from '../ai-token-usage-prune'
import { registerDatabaseRuntimeAdapter } from '@open-mercato/shared/lib/db/runtime'
import { registerDatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { currentTenantBoundaryScope, runWithFreshTenantBoundary, runWithTenantBoundary } from '../../../../../../enterprise/src/lib/rls/runtime/scope'
import type { QueuedJob } from '@open-mercato/queue'

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

const execute = jest.fn(async (_sql: string, params: unknown[]) => {
  expect(currentTenantBoundaryScope()?.context).toMatchObject({ kind: 'tenant', tenantId: activeTenant })
  expect(params).toContain(activeTenant)
  expect(params).not.toContain(inactiveTenant)
  return []
})
const discovery = jest.fn(async () => {
  expect(currentTenantBoundaryScope()?.context.kind).toBe('maintenance')
  return [{ tenant_id: inactiveTenant }, { tenant_id: activeTenant }]
})
const fallback = { resolve: () => ({ getConnection: () => ({ execute: discovery }) }) }

beforeEach(() => {
  jest.mocked(createRequestContainer).mockImplementation(async () => {
    expect(currentTenantBoundaryScope()?.context).toMatchObject({ kind: 'tenant', tenantId: activeTenant })
    return { resolve: () => ({ getConnection: () => ({ execute }) }), dispose } as never
  })
})

it.each(['inactive', 'binding error'])('skips %s A and prunes active B through the real helper and scope', async (failure) => {
  if (failure === 'binding error') validateBinding.mockImplementation(async (tenantId) => {
    if (tenantId === inactiveTenant) throw new Error('Binding lookup failed')
    return true
  })
  await runWithTenantBoundary({ kind: 'maintenance', tenantId: null, source: 'maintenance', operation: 'usage-discovery' }, () =>
    handle({ payload: {} } as QueuedJob, fallback as unknown as Parameters<typeof handle>[1]))
  expect(validateBinding.mock.calls.map(([tenantId]) => tenantId)).toEqual([inactiveTenant, activeTenant])
  expect(createRequestContainer).toHaveBeenCalledTimes(1)
  expect(execute).toHaveBeenCalledTimes(2)
  expect(discovery).toHaveBeenCalledTimes(1)
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(mockReportError).toHaveBeenCalledTimes(1)
  expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
    module: 'ai_assistant', code: 'ai_assistant.usage_tenant_maintenance_failed',
  })
  expect(currentTenantBoundaryScope()).toBeUndefined()
})

it('continues after an owned tenant container fails during disposal', async () => {
  discovery.mockResolvedValueOnce([{ tenant_id: activeTenant }, { tenant_id: activeTenant }])
  dispose.mockRejectedValueOnce(new Error('Disposal failed'))
  await runWithTenantBoundary({ kind: 'maintenance', tenantId: null, source: 'maintenance', operation: 'usage-discovery' }, () =>
    handle({ payload: {} } as QueuedJob, fallback as unknown as Parameters<typeof handle>[1]))
  expect(execute).toHaveBeenCalledTimes(4)
  expect(createRequestContainer).toHaveBeenCalledTimes(2)
  expect(dispose).toHaveBeenCalledTimes(2)
  expect(mockReportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Disposal failed' }), {
    module: 'ai_assistant', code: 'ai_assistant.usage_tenant_maintenance_failed',
  })
})
