import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueuedJob } from '@open-mercato/queue'
import handler, { metadata } from '../inbound-dispatch'
import { WEBHOOK_INBOUND_DISPATCH_QUEUE } from '../../lib/queue'
import type { InboundDispatchJob } from '../../lib/inbound-dispatch'

const mockProcessInboundDispatchJob = jest.fn()
const mockLoggerError = jest.fn()

jest.mock('../../lib/inbound-dispatch', () => ({
  processInboundDispatchJob: (...args: unknown[]) => mockProcessInboundDispatchJob(...args),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
    child: () => mocked,
  }
  return { createLogger: () => mocked }
})

function makeEm() {
  const forked = { id: 'forked-em' } as unknown as EntityManager
  const em = { fork: jest.fn(() => forked) } as unknown as EntityManager
  return { em, forked }
}

describe('webhooks inbound dispatch worker', () => {
  const payload: InboundDispatchJob = {
    ingestionId: 'ingestion-1',
    sourceKey: 'stripe',
    eventType: 'payment.succeeded',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  }

  const job: QueuedJob<InboundDispatchJob> = {
    id: 'job-1',
    payload,
    createdAt: '2026-10-07T00:00:00.000Z',
  }

  function makeCtx(em: EntityManager) {
    return {
      resolve: jest.fn(<T,>(name: string): T => (name === 'em' ? em : (`resolved:${name}` as T))),
    }
  }

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('consumes the queue the dispatcher publishes to', () => {
    expect(metadata.queue).toBe(WEBHOOK_INBOUND_DISPATCH_QUEUE)
    expect(metadata.id).toBe('webhooks:inbound-dispatch-worker')
    expect(metadata.concurrency).toBe(5)
  })

  it('reads the job payload off the queue envelope and forks the em', async () => {
    const { em, forked } = makeEm()
    mockProcessInboundDispatchJob.mockResolvedValue(null)

    await handler(job, makeCtx(em))

    expect(em.fork).toHaveBeenCalledTimes(1)
    expect(mockProcessInboundDispatchJob).toHaveBeenCalledWith(
      forked,
      payload,
      expect.objectContaining({ resolve: expect.any(Function) }),
    )
  })

  it('hands the handler a resolver that delegates to the worker context', async () => {
    const { em } = makeEm()
    const ctx = makeCtx(em)
    mockProcessInboundDispatchJob.mockResolvedValue(null)

    await handler(job, ctx)

    const [, , deps] = mockProcessInboundDispatchJob.mock.calls[0]
    expect(deps.resolve('eventBus')).toBe('resolved:eventBus')
    expect(ctx.resolve).toHaveBeenCalledWith('eventBus')
  })

  it('re-throws the original error so the queue can retry', async () => {
    const { em } = makeEm()
    mockProcessInboundDispatchJob.mockRejectedValue(new Error('DB connection lost'))

    await expect(handler(job, makeCtx(em))).rejects.toThrow('DB connection lost')
  })

  it('logs the failing job identifiers instead of masking the error', async () => {
    const { em } = makeEm()
    const cause = new Error('handler blew up')
    mockProcessInboundDispatchJob.mockRejectedValue(cause)

    await expect(handler(job, makeCtx(em))).rejects.toBe(cause)

    expect(mockLoggerError).toHaveBeenCalledWith(
      'Inbound dispatch job processing failed',
      expect.objectContaining({
        ingestionId: 'ingestion-1',
        sourceKey: 'stripe',
        tenantId: 'tenant-1',
        err: cause,
      }),
    )
  })
})
