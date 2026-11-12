import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { QueuedJob } from '@open-mercato/queue'
import { AUTOPAY_STATUS_POLLER_BATCH_LIMIT, AUTOPAY_STATUS_POLLER_QUEUE } from '../lib/status-poller-schedule'

const pollPaymentStatuses = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('@open-mercato/core/modules/payment_gateways/workers/status-poller', () => ({
  __esModule: true,
  default: (...args: unknown[]) => pollPaymentStatuses(...args),
}))

type Payload = Record<string, unknown>

function createJob(payload: Payload): QueuedJob<Payload> {
  return {
    id: 'job-1',
    payload,
  } as unknown as QueuedJob<Payload>
}

const ctx = { resolve: jest.fn() } as unknown as Parameters<
  typeof import('../workers/status-poller').default
>[1]

async function runWorker(payload: Payload): Promise<void> {
  const { default: handle } = await import('../workers/status-poller')
  await handle(createJob(payload), ctx)
}

describe('gateway_autopay status poller worker', () => {
  beforeEach(() => {
    pollPaymentStatuses.mockClear()
  })

  it('declares its own queue so a module-authored schedule can dispatch to it', async () => {
    const { metadata } = await import('../workers/status-poller')

    expect(metadata.queue).toBe(AUTOPAY_STATUS_POLLER_QUEUE)
    expect(metadata.id.split(':')[0]).toBe('gateway_autopay')
  })

  it('delegates to the generic poller with the trusted scope narrowed to Autopay', async () => {
    await runWorker({ scope: { tenantId: 'tenant-1', organizationId: 'organization-1' }, limit: 25 })

    expect(pollPaymentStatuses).toHaveBeenCalledTimes(1)
    const [delegatedJob, delegatedCtx] = pollPaymentStatuses.mock.calls[0] as [QueuedJob<Payload>, unknown]
    expect(delegatedJob.payload).toEqual({
      scope: { tenantId: 'tenant-1', organizationId: 'organization-1', providerKey: 'autopay' },
      limit: 25,
    })
    expect(delegatedCtx).toBe(ctx)
  })

  it('ignores a provider key smuggled into the job payload', async () => {
    await runWorker({
      scope: { tenantId: 'tenant-1', organizationId: 'organization-1', providerKey: 'stripe' },
      providerKey: 'stripe',
    })

    const [delegatedJob] = pollPaymentStatuses.mock.calls[0] as [QueuedJob<Payload>]
    expect((delegatedJob.payload.scope as Record<string, unknown>).providerKey).toBe('autopay')
    expect(delegatedJob.payload).not.toHaveProperty('providerKey')
  })

  it('caps the batch at the documented limit and falls back to it when the payload has none', async () => {
    await runWorker({ scope: { tenantId: 'tenant-1', organizationId: 'organization-1' }, limit: 10_000 })
    await runWorker({ scope: { tenantId: 'tenant-1', organizationId: 'organization-1' } })

    const [capped] = pollPaymentStatuses.mock.calls[0] as [QueuedJob<Payload>]
    const [defaulted] = pollPaymentStatuses.mock.calls[1] as [QueuedJob<Payload>]
    expect(capped.payload.limit).toBe(AUTOPAY_STATUS_POLLER_BATCH_LIMIT)
    expect(defaulted.payload.limit).toBe(AUTOPAY_STATUS_POLLER_BATCH_LIMIT)
  })

  it('does nothing without a trusted tenant and organization scope', async () => {
    await runWorker({ limit: 100 })
    await runWorker({ scope: { tenantId: 'tenant-1' } })
    await runWorker({ tenantId: 'tenant-1', organizationId: 'organization-1' })

    expect(pollPaymentStatuses).not.toHaveBeenCalled()
  })
})
