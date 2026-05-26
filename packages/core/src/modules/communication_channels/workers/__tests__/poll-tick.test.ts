import handler, { metadata, type PollTickPayload } from '../poll-tick'
import type { QueuedJob } from '@open-mercato/queue'

const enqueueMock = jest.fn(async () => 'next-job')
jest.mock('../../lib/queue', () => {
  const actual = jest.requireActual('../../lib/queue')
  return {
    ...actual,
    getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: enqueueMock })),
  }
})

describe('poll-tick worker metadata', () => {
  it('targets the poll-tick queue with concurrency 1 (single-flight)', () => {
    expect(metadata.queue).toBe('communication-channels-poll-tick')
    expect(metadata.id).toBe('communication_channels:poll-tick')
    expect(metadata.concurrency).toBe(1)
  })
})

describe('poll-tick worker enumeration', () => {
  beforeEach(() => enqueueMock.mockClear())

  function makeJob(): QueuedJob<PollTickPayload> {
    return {
      id: 'tick-1',
      createdAt: new Date().toISOString(),
      payload: {
        scope: {
          tenantId: '22222222-2222-2222-2222-222222222222',
          organizationId: '33333333-3333-3333-3333-333333333333',
        },
      },
    }
  }

  function makeCtx(channels: any[]) {
    const em = {
      find: jest.fn(async () => channels),
    }
    return {
      jobId: 'tick-1',
      attemptNumber: 1,
      queueName: 'communication-channels-poll-tick',
      resolve: ((name: string) => {
        if (name === 'em') return { fork: () => em }
        return null
      }) as <T>(name: string) => T,
    }
  }

  it('enqueues a job for each due channel', async () => {
    const now = Date.now()
    const channels = [
      // Due — last polled 5 minutes ago, interval 60s.
      {
        id: 'c1',
        pollIntervalSeconds: 60,
        lastPolledAt: new Date(now - 5 * 60 * 1000),
        tenantId: 't',
        organizationId: 'o',
      },
      // Due — never polled.
      {
        id: 'c2',
        pollIntervalSeconds: 60,
        lastPolledAt: null,
        tenantId: 't',
        organizationId: 'o',
      },
    ]
    await handler(makeJob(), makeCtx(channels))
    expect(enqueueMock).toHaveBeenCalledTimes(2)
  })

  it('skips channels not yet due', async () => {
    const now = Date.now()
    const channels = [
      // Polled 5s ago with 60s interval — not yet due.
      {
        id: 'c1',
        pollIntervalSeconds: 60,
        lastPolledAt: new Date(now - 5 * 1000),
        tenantId: 't',
      },
    ]
    await handler(makeJob(), makeCtx(channels))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips channels with null or zero poll interval (push-only)', async () => {
    const channels = [
      { id: 'c1', pollIntervalSeconds: null, lastPolledAt: null, tenantId: 't' },
      { id: 'c2', pollIntervalSeconds: 0, lastPolledAt: null, tenantId: 't' },
    ]
    await handler(makeJob(), makeCtx(channels))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('does not throw when no channels are due (no-op tick)', async () => {
    await expect(handler(makeJob(), makeCtx([]))).resolves.toBeUndefined()
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
