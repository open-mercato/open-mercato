import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueuedJob } from '@open-mercato/queue'
import handler, { metadata } from '../webhook-delivery'
import { WEBHOOK_DELIVERIES_QUEUE } from '../../lib/queue'
import type { WebhookDeliveryJob } from '../../lib/delivery'

const mockProcessWebhookDeliveryJob = jest.fn()
const mockLoggerError = jest.fn()

jest.mock('../../lib/delivery', () => ({
  processWebhookDeliveryJob: (...args: unknown[]) => mockProcessWebhookDeliveryJob(...args),
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

function makeCtx(em: EntityManager) {
  return {
    resolve: <T,>(name: string): T => {
      if (name === 'em') return em as T
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }
}

describe('webhooks delivery worker', () => {
  const payload: WebhookDeliveryJob = {
    deliveryId: 'delivery-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  }

  const job: QueuedJob<WebhookDeliveryJob> = {
    id: 'job-1',
    payload,
    createdAt: '2026-10-07T00:00:00.000Z',
  }

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('consumes the queue the dispatcher publishes to', () => {
    expect(metadata.queue).toBe(WEBHOOK_DELIVERIES_QUEUE)
    expect(metadata.id).toBe('webhooks:delivery-worker')
    expect(metadata.concurrency).toBe(10)
  })

  it('reads the job payload off the queue envelope and forks the em', async () => {
    const { em, forked } = makeEm()
    mockProcessWebhookDeliveryJob.mockResolvedValue(null)

    await handler(job, makeCtx(em))

    expect(em.fork).toHaveBeenCalledTimes(1)
    expect(mockProcessWebhookDeliveryJob).toHaveBeenCalledWith(
      forked,
      payload,
      expect.objectContaining({ resolver: expect.any(Function) }),
    )
  })

  it('re-throws the original error so the queue can retry', async () => {
    const { em } = makeEm()
    mockProcessWebhookDeliveryJob.mockRejectedValue(new Error('DB connection lost'))

    await expect(handler(job, makeCtx(em))).rejects.toThrow('DB connection lost')
  })

  it('logs the failing job identifiers instead of masking the error', async () => {
    const { em } = makeEm()
    const cause = new Error('delivery blew up')
    mockProcessWebhookDeliveryJob.mockRejectedValue(cause)

    await expect(handler(job, makeCtx(em))).rejects.toBe(cause)

    expect(mockLoggerError).toHaveBeenCalledWith(
      'Job processing failed',
      expect.objectContaining({
        deliveryId: 'delivery-1',
        tenantId: 'tenant-1',
        err: cause,
      }),
    )
  })
})
