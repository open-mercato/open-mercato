import { readBullmqNextRun } from '../bullmqNextRun'

const mockQueue = {
  getJobScheduler: jest.fn(),
  on: jest.fn(),
  close: jest.fn(),
  disconnect: jest.fn(),
}

let queueWithoutJobSchedulerLookup = false

const mockQueueConstructor = jest.fn(() => (
  queueWithoutJobSchedulerLookup
    ? { on: mockQueue.on, close: mockQueue.close, disconnect: mockQueue.disconnect }
    : mockQueue
))

jest.mock('bullmq', () => ({
  Queue: mockQueueConstructor,
}))

const mockGetRedisUrlOrThrow = jest.fn(() => 'redis://localhost:6379')

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: () => mockGetRedisUrlOrThrow(),
  parseRedisUrl: jest.requireActual('@open-mercato/shared/lib/redis/connection').parseRedisUrl,
}))

const scheduleId = '11111111-1111-4111-8111-111111111111'
const nextMillis = Date.UTC(2030, 0, 1, 6, 0, 0)

describe('readBullmqNextRun', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queueWithoutJobSchedulerLookup = false
    mockQueue.on.mockReset()
    mockQueue.close.mockResolvedValue(undefined)
    mockQueue.disconnect.mockResolvedValue(undefined)
  })

  it('returns the scheduler next slot with its timing configuration and closes the queue', async () => {
    mockQueue.getJobScheduler.mockResolvedValue({
      key: `schedule-${scheduleId}`,
      name: `schedule-${scheduleId}`,
      next: nextMillis,
      pattern: '0 6 * * *',
      tz: 'Europe/Warsaw',
    })

    await expect(readBullmqNextRun(scheduleId)).resolves.toEqual({
      nextRunAt: new Date(nextMillis),
      pattern: '0 6 * * *',
      timezone: 'Europe/Warsaw',
    })

    expect(mockQueueConstructor).toHaveBeenCalledWith('scheduler-execution', expect.objectContaining({
      connection: expect.objectContaining({ host: 'localhost', port: 6379 }),
    }))
    expect(mockQueue.getJobScheduler).toHaveBeenCalledWith(`schedule-${scheduleId}`)
    expect(mockQueue.close).toHaveBeenCalledTimes(1)
    expect(mockQueue.disconnect).not.toHaveBeenCalled()
  })

  it('returns the interval of an every-based scheduler', async () => {
    mockQueue.getJobScheduler.mockResolvedValue({ next: nextMillis, every: 900000, tz: 'UTC' })

    await expect(readBullmqNextRun(scheduleId)).resolves.toEqual({
      nextRunAt: new Date(nextMillis),
      every: 900000,
      timezone: 'UTC',
    })
  })

  it('returns null and still closes the queue when the scheduler does not exist', async () => {
    mockQueue.getJobScheduler.mockResolvedValue(undefined)

    await expect(readBullmqNextRun(scheduleId)).resolves.toBeNull()
    expect(mockQueue.close).toHaveBeenCalledTimes(1)
  })

  it('returns null when the scheduler has no next slot', async () => {
    mockQueue.getJobScheduler.mockResolvedValue({ next: null, pattern: '0 6 * * *' })

    await expect(readBullmqNextRun(scheduleId)).resolves.toBeNull()
    expect(mockQueue.close).toHaveBeenCalledTimes(1)
  })

  it('returns null and closes the queue when the installed BullMQ has no getJobScheduler', async () => {
    queueWithoutJobSchedulerLookup = true

    await expect(readBullmqNextRun(scheduleId)).resolves.toBeNull()
    expect(mockQueue.getJobScheduler).not.toHaveBeenCalled()
    expect(mockQueue.close).toHaveBeenCalledTimes(1)
  })

  it('closes the queue and rethrows when the read fails', async () => {
    mockQueue.getJobScheduler.mockRejectedValue(new Error('redis read failed'))

    await expect(readBullmqNextRun(scheduleId)).rejects.toThrow('redis read failed')
    expect(mockQueue.close).toHaveBeenCalledTimes(1)
    expect(mockQueue.disconnect).not.toHaveBeenCalled()
  })

  it('leaves no timer behind after a completed read', async () => {
    jest.useFakeTimers()
    try {
      mockQueue.getJobScheduler.mockResolvedValue({ next: nextMillis, pattern: '0 6 * * *', tz: 'UTC' })

      await readBullmqNextRun(scheduleId)

      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('rejects at the deadline and disconnects when the read never settles', async () => {
    mockQueue.getJobScheduler.mockReturnValue(new Promise(() => undefined))

    await expect(readBullmqNextRun(scheduleId, 20)).rejects.toThrow('Timed out after 20ms')
    expect(mockQueue.disconnect).toHaveBeenCalledTimes(1)
  })

  it('rejects at the deadline when close hangs after a successful read', async () => {
    mockQueue.getJobScheduler.mockResolvedValue({ next: nextMillis, pattern: '0 6 * * *' })
    mockQueue.close.mockReturnValue(new Promise(() => undefined))

    await expect(readBullmqNextRun(scheduleId, 20)).rejects.toThrow('Timed out after 20ms')
    expect(mockQueue.disconnect).toHaveBeenCalledTimes(1)
  })

  it('keeps the value it read when close fails', async () => {
    mockQueue.getJobScheduler.mockResolvedValue({ next: nextMillis, pattern: '0 6 * * *', tz: 'UTC' })
    mockQueue.close.mockRejectedValue(new Error('close failed'))

    await expect(readBullmqNextRun(scheduleId)).resolves.toEqual({
      nextRunAt: new Date(nextMillis),
      pattern: '0 6 * * *',
      timezone: 'UTC',
    })
  })

  it('rethrows the read error, not the close error, when both fail', async () => {
    mockQueue.getJobScheduler.mockRejectedValue(new Error('redis read failed'))
    mockQueue.close.mockRejectedValue(new Error('close failed'))

    await expect(readBullmqNextRun(scheduleId)).rejects.toThrow('redis read failed')
  })

  it('tears the queue down with both close and disconnect at the deadline and handles their rejections', async () => {
    mockQueue.getJobScheduler.mockReturnValue(new Promise(() => undefined))
    let failClose: (error: Error) => void = () => undefined
    let failDisconnect: (error: Error) => void = () => undefined
    const pendingClose = new Promise<void>((_resolve, reject) => { failClose = reject })
    const pendingDisconnect = new Promise<void>((_resolve, reject) => { failDisconnect = reject })
    const closeHandled = jest.spyOn(pendingClose, 'catch')
    const disconnectHandled = jest.spyOn(pendingDisconnect, 'catch')
    mockQueue.close.mockReturnValue(pendingClose)
    mockQueue.disconnect.mockReturnValue(pendingDisconnect)

    await expect(readBullmqNextRun(scheduleId, 20)).rejects.toThrow('Timed out after 20ms')

    expect(mockQueue.close).toHaveBeenCalledTimes(1)
    expect(mockQueue.disconnect).toHaveBeenCalledTimes(1)
    expect(closeHandled).toHaveBeenCalledTimes(1)
    expect(disconnectHandled).toHaveBeenCalledTimes(1)
    failClose(new Error('close failed'))
    failDisconnect(new Error('disconnect failed'))
  })

  it('attaches the last connection error BullMQ emitted as the cause of the timeout', async () => {
    mockQueue.getJobScheduler.mockReturnValue(new Promise(() => undefined))
    const connectionError = new Error('connect ECONNREFUSED 127.0.0.1:6379')
    mockQueue.on.mockImplementation((_event: string, listener: (error: Error) => void) => {
      listener(connectionError)
    })

    await expect(readBullmqNextRun(scheduleId, 20)).rejects.toMatchObject({
      message: expect.stringContaining('Timed out after 20ms'),
      cause: connectionError,
    })
  })

  it('registers an error listener so BullMQ does not print connection errors itself', async () => {
    mockQueue.getJobScheduler.mockResolvedValue(undefined)

    await readBullmqNextRun(scheduleId)

    expect(mockQueue.on).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('rejects without opening a queue when Redis is not configured', async () => {
    mockGetRedisUrlOrThrow.mockImplementationOnce(() => {
      throw new Error('Redis URL is not configured')
    })

    await expect(readBullmqNextRun(scheduleId)).rejects.toThrow('Redis URL is not configured')
    expect(mockQueueConstructor).not.toHaveBeenCalled()
  })
})
