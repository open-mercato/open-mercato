import { runPendingActionCleanup } from '../ai-pending-action-cleanup'
import prune from '../ai-token-usage-prune'
import { runAiMaintenanceTenant } from '../../database'
import { AiPendingActionRepository } from '../../data/repositories/AiPendingActionRepository'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob } from '@open-mercato/queue'

jest.mock('../../database', () => ({ runAiMaintenanceTenant: jest.fn() }))
jest.mock('@open-mercato/shared/lib/db/runtime', () => ({ isDatabaseRuntimeEnabled: () => true }))
jest.mock('../../data/repositories/AiPendingActionRepository', () => ({ AiPendingActionRepository: jest.fn() }))
jest.mock('../../events', () => ({ emitAiAssistantEvent: jest.fn() }))
const scopes = [{ tenantId: 'tenant-a', organizationId: null }, { tenantId: 'tenant-b', organizationId: null }]
const execute = jest.fn(async () => [])
const tenantEm = { getConnection: () => ({ execute }) } as unknown as EntityManager
const maintenanceExecute = jest.fn(async () => scopes.map(({ tenantId }) => ({ tenant_id: tenantId })))
const maintenanceEm = { getConnection: () => ({ execute: maintenanceExecute }) } as unknown as EntityManager

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(runAiMaintenanceTenant).mockImplementation(async (_scope, _fallback, callback) => callback(tenantEm))
})

it('constructs each cleanup repository inside the tenant continuation rather than with the maintenance manager', async () => {
  const listExpired = jest.fn(async () => [])
  jest.mocked(AiPendingActionRepository).mockImplementation(() => ({ listExpired }) as unknown as AiPendingActionRepository)
  await runPendingActionCleanup({ em: maintenanceEm, discoverTenants: async () => scopes })
  expect(jest.mocked(runAiMaintenanceTenant).mock.calls.map(([scope]) => scope)).toEqual(scopes)
  expect(jest.mocked(AiPendingActionRepository).mock.calls).toEqual([[tenantEm], [tenantEm]])
  expect(listExpired).toHaveBeenCalledTimes(2)
})

it('discovers usage tenants with maintenance and prunes/reconciles with scoped SQL only', async () => {
  await prune({ payload: {} } as QueuedJob, { resolve: () => maintenanceEm } as unknown as JobContext & { resolve: <T = unknown>(name: string) => T })
  expect(maintenanceExecute).toHaveBeenCalledTimes(1)
  expect(jest.mocked(runAiMaintenanceTenant).mock.calls.map(([scope]) => scope)).toEqual(scopes.map(({ tenantId }) => ({ tenantId })))
  expect(execute).toHaveBeenCalledTimes(4)
  const calls = execute.mock.calls as unknown as Array<[string, unknown[]]>
  expect(calls[0][0]).toContain('and tenant_id = ?')
  expect(calls[0][1][1]).toBe('tenant-a')
  expect(calls[1][0]).toContain('and d.tenant_id = ?')
  expect(calls[2][1][1]).toBe('tenant-b')
})
