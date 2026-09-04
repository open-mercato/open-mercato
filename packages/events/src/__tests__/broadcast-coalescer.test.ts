import {
  flushPendingBroadcasts,
  resetBroadcastCoalescerForTests,
  resolveBroadcastCoalesceIntervalMs,
  submitBroadcast,
} from '../broadcast-coalescer'

const INTERVAL_MS = 50

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('broadcast coalescer', () => {
  const originalInterval = process.env.OM_BROADCAST_COALESCE_INTERVAL_MS

  afterEach(() => {
    resetBroadcastCoalescerForTests()
    if (originalInterval === undefined) delete process.env.OM_BROADCAST_COALESCE_INTERVAL_MS
    else process.env.OM_BROADCAST_COALESCE_INTERVAL_MS = originalInterval
  })

  it('collapses a burst to a leading dispatch plus a trailing flush carrying the newest payload', async () => {
    const delivered: number[] = []

    for (let index = 0; index < 50; index += 1) {
      await submitBroadcast('key', async () => { delivered.push(index) }, { intervalMs: INTERVAL_MS })
    }

    // Leading edge only, so far: the other 49 were superseded, not delivered.
    expect(delivered).toEqual([0])

    await wait(INTERVAL_MS * 2)

    // The trailing flush is unconditional, and the survivor is the LAST emit —
    // the property that keeps a DataTable from ending a burst stale.
    expect(delivered).toEqual([0, 49])
  })

  it('never lets one key suppress or impersonate another', async () => {
    const tenantA: string[] = []
    const tenantB: string[] = []

    await submitBroadcast('event::tenant-a::', async () => { tenantA.push('a1') }, { intervalMs: INTERVAL_MS })
    await submitBroadcast('event::tenant-b::', async () => { tenantB.push('b1') }, { intervalMs: INTERVAL_MS })
    await submitBroadcast('event::tenant-a::', async () => { tenantA.push('a2') }, { intervalMs: INTERVAL_MS })
    await submitBroadcast('event::tenant-b::', async () => { tenantB.push('b2') }, { intervalMs: INTERVAL_MS })

    expect(tenantA).toEqual(['a1'])
    expect(tenantB).toEqual(['b1'])

    await wait(INTERVAL_MS * 2)

    expect(tenantA).toEqual(['a1', 'a2'])
    expect(tenantB).toEqual(['b1', 'b2'])
  })

  it('dispatches every submission synchronously when the interval is zero', async () => {
    const delivered: number[] = []

    for (let index = 0; index < 5; index += 1) {
      await submitBroadcast('key', async () => { delivered.push(index) }, { intervalMs: 0 })
    }

    expect(delivered).toEqual([0, 1, 2, 3, 4])
  })

  it('contains a failing deferred dispatch so the next window still delivers', async () => {
    const delivered: string[] = []

    await submitBroadcast('key', async () => { delivered.push('leading') }, { intervalMs: INTERVAL_MS })
    await submitBroadcast('key', async () => { throw new Error('[internal] pg_notify unavailable') }, { intervalMs: INTERVAL_MS })

    await wait(INTERVAL_MS * 2)

    await submitBroadcast('key', async () => { delivered.push('after-failure') }, { intervalMs: INTERVAL_MS })
    await wait(INTERVAL_MS * 2)

    expect(delivered).toContain('leading')
    expect(delivered).toContain('after-failure')
  })

  it('flushes pending survivors on shutdown instead of dropping the tail', async () => {
    const delivered: string[] = []

    await submitBroadcast('key', async () => { delivered.push('leading') }, { intervalMs: 10_000 })
    await submitBroadcast('key', async () => { delivered.push('tail') }, { intervalMs: 10_000 })

    expect(delivered).toEqual(['leading'])

    await flushPendingBroadcasts()

    expect(delivered).toEqual(['leading', 'tail'])
  })

  it('never runs two deliveries of one key concurrently, so an older payload cannot land last', async () => {
    const started: string[] = []
    const finished: string[] = []

    const slowDispatch = (label: string, durationMs: number) => async () => {
      started.push(label)
      await wait(durationMs)
      finished.push(label)
    }

    // Leading edge takes far longer than one window, so a naive re-arm would fire
    // the next flush while it is still in flight.
    await submitBroadcast('key', slowDispatch('first', INTERVAL_MS * 3), { intervalMs: INTERVAL_MS })
    await submitBroadcast('key', slowDispatch('second', 0), { intervalMs: INTERVAL_MS })

    await wait(INTERVAL_MS * 6)

    expect(started).toEqual(['first', 'second'])
    expect(finished).toEqual(['first', 'second'])
    // 'second' must not have started before 'first' completed.
    expect(started.indexOf('second')).toBeGreaterThanOrEqual(0)
    expect(finished.indexOf('first')).toBeLessThan(finished.indexOf('second'))
  })

  it('forgets a key once its burst ends, so pending state stays bounded', async () => {
    const delivered: string[] = []
    await submitBroadcast('key', async () => { delivered.push('first') }, { intervalMs: INTERVAL_MS })
    await wait(INTERVAL_MS * 2)

    // The window closed with nothing superseded, so the next submit is a fresh
    // leading edge rather than a queued survivor.
    await submitBroadcast('key', async () => { delivered.push('second') }, { intervalMs: INTERVAL_MS })

    expect(delivered).toEqual(['first', 'second'])
  })

  describe('interval resolution', () => {
    it('defaults to 250ms and rejects unusable values', () => {
      delete process.env.OM_BROADCAST_COALESCE_INTERVAL_MS
      expect(resolveBroadcastCoalesceIntervalMs()).toBe(250)

      process.env.OM_BROADCAST_COALESCE_INTERVAL_MS = '0'
      expect(resolveBroadcastCoalesceIntervalMs()).toBe(0)

      process.env.OM_BROADCAST_COALESCE_INTERVAL_MS = '1000'
      expect(resolveBroadcastCoalesceIntervalMs()).toBe(1000)

      process.env.OM_BROADCAST_COALESCE_INTERVAL_MS = '-5'
      expect(resolveBroadcastCoalesceIntervalMs()).toBe(250)

      process.env.OM_BROADCAST_COALESCE_INTERVAL_MS = 'soon'
      expect(resolveBroadcastCoalesceIntervalMs()).toBe(250)
    })
  })
})
