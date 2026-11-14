import verify from '../domainVerificationWorker'
import retry, { __testing__ } from '../domainTlsRetryWorker'
import { runCustomerMaintenanceTenant } from '../../database'
import type { QueuedJob, JobContext } from '@open-mercato/queue'

jest.mock('../../database', () => ({ runCustomerMaintenanceTenant: jest.fn() }))
const mappings = [
  { id: 'domain-a', tenantId: 'tenant-a', organizationId: 'org-a' },
  { id: 'domain-b', tenantId: 'tenant-b', organizationId: 'org-b' },
]
const maintenance = { findPendingVerification: jest.fn(async () => mappings), findPendingTls: jest.fn(async () => mappings), verify: jest.fn(), healthCheck: jest.fn() }
const tenantVerify = jest.fn(async () => ({ domainMapping: { status: 'verified' } }))
const tenantHealth = jest.fn(async () => ({ status: 'active' }))
const ctx = { resolve: () => maintenance } as unknown as JobContext & { resolve: <T = unknown>(name: string) => T }
const job = { payload: {} } as QueuedJob

beforeEach(() => {
  jest.clearAllMocks()
  __testing__.reset()
  jest.mocked(runCustomerMaintenanceTenant).mockImplementation(async (_scope, _fallback, callback) => callback({ resolve: () => ({ verify: tenantVerify, healthCheck: tenantHealth }) } as never))
})

it('keeps verification and follow-up TLS work inside each discovered tenant continuation', async () => {
  await verify(job, ctx)
  expect(jest.mocked(runCustomerMaintenanceTenant).mock.calls.map(([scope]) => scope)).toEqual(mappings)
  expect(tenantVerify.mock.calls).toHaveLength(2)
  expect(tenantHealth.mock.calls).toHaveLength(2)
  expect(maintenance.verify).not.toHaveBeenCalled()
  expect(maintenance.healthCheck).not.toHaveBeenCalled()
})

it('continues with the next persisted tenant when a binding or tenant operation fails', async () => {
  jest.mocked(runCustomerMaintenanceTenant).mockRejectedValueOnce(new Error('binding rejected'))
  await verify(job, ctx)
  expect(runCustomerMaintenanceTenant).toHaveBeenCalledTimes(2)
  expect(tenantVerify).toHaveBeenCalledTimes(1)
})

it('runs each TLS retry through the bounded tenant container', async () => {
  await retry(job, ctx)
  expect(jest.mocked(runCustomerMaintenanceTenant).mock.calls.map(([scope]) => scope)).toEqual(mappings)
  expect(tenantHealth).toHaveBeenCalledTimes(2)
  expect(maintenance.healthCheck).not.toHaveBeenCalled()
})
