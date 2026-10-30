import { flushBeforeExit } from '../flush-before-exit'

describe('flushBeforeExit', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('flushes coalesced broadcasts before telemetry so the final pg_notify is still exported', async () => {
    const order: string[] = []
    await flushBeforeExit({
      flushBroadcasts: async () => { order.push('broadcasts') },
      flushTelemetry: async () => { order.push('telemetry') },
    })
    expect(order).toEqual(['broadcasts', 'telemetry'])
  })

  it('still flushes telemetry, with a warning, when the broadcast flush fails', async () => {
    const flushTelemetry = jest.fn().mockResolvedValue(undefined)
    await expect(flushBeforeExit({
      flushBroadcasts: async () => { throw new Error('connection terminated') },
      flushTelemetry,
    })).resolves.toBeUndefined()
    expect(flushTelemetry).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('connection terminated'))
  })
})
