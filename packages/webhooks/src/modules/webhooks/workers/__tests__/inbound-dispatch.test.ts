import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueuedJob } from '@open-mercato/queue'
import handler from '../inbound-dispatch'
import type { InboundDispatchJob } from '../../lib/inbound-dispatch'

const mockProcessInboundDispatchJob = jest.fn()
const mockLoggerError = jest.fn()

jest.mock('../../lib/inbound-dispatch', () => ({
  processInboundDispatchJob: (...args: unknown[]) => mockProcessInboundDispatchJob(...args),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({
    error: (...args: unknown[]) => mockLoggerError(...args),
    child: () => ({ error: (...args: unknown[]) => mockLoggerError(...args) }),
  }),
}))

function makeCtx(em: EntityManager) {
  return {
    resolve: <T,>(name: string): T => {
      if (name === 'em') return em as T
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }
}

describe('webhooks inbound dispatch worker', () => {
  const payload: InboundDispatchJob = {
    ingestionId: 'ingestion-1',
    sourceKey: 'stripe',
    eventType: 'payment.succeeded',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  }

  // The queue hands the handler the QueuedJob envelope, not the bare payload.
  const job: QueuedJob<InboundDispatchJob> = {
    id: 'job-1',
    payload,
    createdAt: '2026-10-07T00:00:00.000Z',
  }

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('reads the job payload off the queue envelope', async () => {
    const em = { fork: jest.fn().mockReturnThis() } as unknown as EntityManager
    mockProcessInboundDispatchJob.mockResolvedValue(null)

    await handler(job, makeCtx(em))

    expect(mockProcessInboundDispatchJob).toHaveBeenCalledWith(
      em,
      payload,
      expect.objectContaining({ resolve: expect.any(Function) }),
    )
  })

  it('re-throws the original error so the queue can retry', async () => {
    const em = { fork: jest.fn().mockReturnThis() } as unknown as EntityManager
    mockProcessInboundDispatchJob.mockRejectedValue(new Error('DB connection lost'))

    await expect(handler(job, makeCtx(em))).rejects.toThrow('DB connection lost')
  })

  it('logs the failing job identifiers instead of masking the error', async () => {
    const em = { fork: jest.fn().mockReturnThis() } as unknown as EntityManager
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
