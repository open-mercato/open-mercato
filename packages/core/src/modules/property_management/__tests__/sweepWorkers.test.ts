/** @jest-environment node */
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { registerTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('../lib/leaseSweep', () => {
  const actual = jest.requireActual('../lib/leaseSweep')
  return { ...actual, runLeaseSweep: jest.fn(async () => ({ ended: 0, expired: 0, reminded: 0, reenqueued: 0 })) }
})
jest.mock('../lib/bookingSweep', () => ({
  runBookingSweep: jest.fn(async () => ({ completed: 0, reenqueued: 0, resumedClosures: 0 })),
}))

import leaseSweepWorker from '../workers/lease-sweep'
import bookingSweepWorker from '../workers/booking-sweep'
import { runLeaseSweep } from '../lib/leaseSweep'
import { runBookingSweep } from '../lib/bookingSweep'

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT = '33333333-3333-4333-8333-333333333333'
const ORG = '22222222-2222-4222-8222-222222222222'

function seeded(): FakeEm {
  const em = new FakeEm()
  em.seed(Organization, { id: ORG, tenant: TENANT, name: 'Harbor', deletedAt: null } as never)
  return em
}

function jobContext(em: FakeEm) {
  const resolve = <T,>(name: string): T => {
    if (name === 'em') return em as unknown as T
    throw new Error(`[internal] unexpected ${name}`)
  }
  return { resolve, jobId: 'job-1', attemptNumber: 1, queueName: 'test' } as never
}

function job(scope: { tenantId?: string | null; organizationId?: string | null }) {
  return { id: 'job-1', payload: { scope }, createdAt: new Date().toISOString() } as never
}

const workers = [
  { name: 'lease sweep', handle: leaseSweepWorker, run: runLeaseSweep as jest.Mock },
  { name: 'booking sweep', handle: bookingSweepWorker, run: runBookingSweep as jest.Mock },
]

beforeEach(() => jest.clearAllMocks())

describe.each(workers)('$name worker scope', ({ handle, run }) => {
  it('runs for an organization of the job tenant', async () => {
    await handle(job({ tenantId: TENANT, organizationId: ORG }), jobContext(seeded()))
    expect(run).toHaveBeenCalledWith(expect.anything(), { tenantId: TENANT, organizationId: ORG })
  })

  it('skips and reports a job whose organization belongs to another tenant', async () => {
    const reportError = jest.fn()
    const unregister = registerTelemetryRuntime({ reportError } as never)
    try {
      await handle(job({ tenantId: OTHER_TENANT, organizationId: ORG }), jobContext(seeded()))
    } finally {
      unregister?.()
    }
    expect(run).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ module: 'property_management', code: 'property_management.sweep_scope_rejected' }),
    )
  })

  it('skips a job for a deleted or unknown organization', async () => {
    const em = seeded()
    ;(em.rows(Organization)[0] as { deletedAt: Date | null }).deletedAt = new Date()
    await handle(job({ tenantId: TENANT, organizationId: ORG }), jobContext(em))
    await handle(job({ tenantId: TENANT, organizationId: '44444444-4444-4444-8444-444444444444' }), jobContext(seeded()))
    expect(run).not.toHaveBeenCalled()
  })

  it('ignores a job without a complete scope', async () => {
    await handle(job({ tenantId: TENANT, organizationId: null }), jobContext(seeded()))
    expect(run).not.toHaveBeenCalled()
  })
})
