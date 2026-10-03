import { drainSyncQueue } from '../../__integration__/helpers/syncQueueDrain'

describe('example customer sync queue consumption', () => {
  it.each(['true', '1', 'on', ' TRUE ', '', 'invalid'])('leaves jobs to background workers when AUTO_SPAWN_WORKERS is %p', async (value) => {
    const drain = jest.fn<Promise<number>, [string]>().mockResolvedValue(3)

    await expect(drainSyncQueue('events', drain, { AUTO_SPAWN_WORKERS: value })).resolves.toBe(0)
    expect(drain).not.toHaveBeenCalled()
  })

  it('leaves jobs to background workers when AUTO_SPAWN_WORKERS is unset', async () => {
    const drain = jest.fn<Promise<number>, [string]>().mockResolvedValue(3)

    await expect(drainSyncQueue('events', drain, {})).resolves.toBe(0)
    expect(drain).not.toHaveBeenCalled()
  })

  it.each(['false', '0', 'off', ' FALSE '])('drains jobs when AUTO_SPAWN_WORKERS is %p', async (value) => {
    const drain = jest.fn<Promise<number>, [string]>().mockResolvedValue(3)

    await expect(drainSyncQueue('example-customers-sync-inbound', drain, { AUTO_SPAWN_WORKERS: value })).resolves.toBe(3)
    expect(drain).toHaveBeenCalledTimes(1)
    expect(drain).toHaveBeenCalledWith('example-customers-sync-inbound')
  })

  it('propagates manual drain failures', async () => {
    const failure = new Error('Queue worker failed')
    const drain = jest.fn<Promise<number>, [string]>().mockRejectedValue(failure)

    await expect(drainSyncQueue('example-customers-sync-outbound', drain, { AUTO_SPAWN_WORKERS: 'false' })).rejects.toBe(failure)
  })

  it('honors the worker alias when the legacy flag is unset', async () => {
    const drain = jest.fn<Promise<number>, [string]>().mockResolvedValue(3)

    await expect(drainSyncQueue('events', drain, { OM_AUTO_SPAWN_WORKERS: 'false' })).resolves.toBe(3)
    expect(drain).toHaveBeenCalledWith('events')
  })

  it('gives the legacy flag precedence over the worker alias', async () => {
    const drain = jest.fn<Promise<number>, [string]>().mockResolvedValue(3)

    await expect(drainSyncQueue('events', drain, {
      AUTO_SPAWN_WORKERS: 'true',
      OM_AUTO_SPAWN_WORKERS: 'false',
    })).resolves.toBe(0)
    expect(drain).not.toHaveBeenCalled()
  })
})
