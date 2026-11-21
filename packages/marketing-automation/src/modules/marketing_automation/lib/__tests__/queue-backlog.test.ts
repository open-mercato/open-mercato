import { getQueuePendingProbe } from '@open-mercato/queue'
import { loadQueueBacklog } from '../queue-backlog'
import { MARKETING_QUEUES } from '../queues'

jest.mock('@open-mercato/queue', () => ({ getQueuePendingProbe: jest.fn() }))

const mockedProbe = getQueuePendingProbe as jest.Mock

describe('loadQueueBacklog', () => {
  beforeEach(() => mockedProbe.mockReset())

  // The exact case the review caught: a tenant user without the platform feature must see nothing
  // about the shared queue — not an error, not a zeroed-out panel, nothing — because the backlog is
  // not scoped to their tenant and every other tenant's dispatch volume would leak through it.
  test('reports nothing when the caller lacks the platform feature', async () => {
    const entries = await loadQueueBacklog(false)
    expect(entries).toEqual([])
    expect(mockedProbe).not.toHaveBeenCalled()
  })

  test('probes every marketing queue when the caller holds the platform feature', async () => {
    mockedProbe.mockResolvedValue({ error: false, ready: 3, active: 1, delayedFuture: 0 })
    const entries = await loadQueueBacklog(true)
    expect(entries).toHaveLength(MARKETING_QUEUES.length)
    expect(entries.every((entry) => entry.known && entry.ready === 3)).toBe(true)
    expect(mockedProbe).toHaveBeenCalledTimes(MARKETING_QUEUES.length)
  })

  test('reports a probe error as unknown rather than failing', async () => {
    mockedProbe.mockResolvedValue({ error: true })
    const entries = await loadQueueBacklog(true)
    expect(entries.every((entry) => entry.known === false)).toBe(true)
  })

  test('reports a throwing probe as unknown rather than failing', async () => {
    mockedProbe.mockRejectedValue(new Error('connection refused'))
    const entries = await loadQueueBacklog(true)
    expect(entries.every((entry) => entry.known === false)).toBe(true)
  })
})
