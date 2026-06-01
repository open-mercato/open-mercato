/**
 * @jest-environment node
 */
import {
  createWidgetDataBatcher,
  type WidgetDataBatchRequestEntry,
  type WidgetDataBatchResultEntry,
} from '../widgetDataBatcher'

describe('createWidgetDataBatcher', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  test('coalesces requests fired within the window into a single send', async () => {
    const send = jest.fn(async (entries: WidgetDataBatchRequestEntry[]) =>
      entries.map((entry): WidgetDataBatchResultEntry => ({ id: entry.id, ok: true, data: entry.request })),
    )
    const batcher = createWidgetDataBatcher({ send, windowMs: 16 })

    const p1 = batcher.fetch<{ widget: number }>({ widget: 1 })
    const p2 = batcher.fetch<{ widget: number }>({ widget: 2 })
    const p3 = batcher.fetch<{ widget: number }>({ widget: 3 })

    expect(send).not.toHaveBeenCalled()
    jest.advanceTimersByTime(16)

    await expect(p1).resolves.toEqual({ widget: 1 })
    await expect(p2).resolves.toEqual({ widget: 2 })
    await expect(p3).resolves.toEqual({ widget: 3 })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toHaveLength(3)
  })

  test('rejects only the failing widget and resolves the rest', async () => {
    const send = jest.fn(async (entries: WidgetDataBatchRequestEntry[]) =>
      entries.map((entry, index): WidgetDataBatchResultEntry =>
        index === 1
          ? { id: entry.id, ok: false, error: 'boom' }
          : { id: entry.id, ok: true, data: entry.request },
      ),
    )
    const batcher = createWidgetDataBatcher({ send, windowMs: 16 })

    const ok = batcher.fetch({ widget: 'a' })
    const bad = batcher.fetch({ widget: 'b' })
    jest.advanceTimersByTime(16)

    await expect(ok).resolves.toEqual({ widget: 'a' })
    await expect(bad).rejects.toThrow('boom')
  })

  test('rejects a caller whose id is missing from the response', async () => {
    const send = jest.fn(async () => [] as WidgetDataBatchResultEntry[])
    const batcher = createWidgetDataBatcher({ send, windowMs: 16 })

    const p = batcher.fetch({ widget: 1 })
    jest.advanceTimersByTime(16)

    await expect(p).rejects.toThrow('No result returned for widget')
  })

  test('rejects all callers when the batch send fails', async () => {
    const send = jest.fn(async () => {
      throw new Error('network down')
    })
    const batcher = createWidgetDataBatcher({ send, windowMs: 16 })

    const p1 = batcher.fetch({ widget: 1 })
    const p2 = batcher.fetch({ widget: 2 })
    jest.advanceTimersByTime(16)

    await expect(p1).rejects.toThrow('network down')
    await expect(p2).rejects.toThrow('network down')
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('splits queues larger than maxBatchSize into multiple sends', async () => {
    const send = jest.fn(async (entries: WidgetDataBatchRequestEntry[]) =>
      entries.map((entry): WidgetDataBatchResultEntry => ({ id: entry.id, ok: true, data: entry.request })),
    )
    const batcher = createWidgetDataBatcher({ send, windowMs: 16, maxBatchSize: 2 })

    const promises = [1, 2, 3, 4, 5].map((widget) => batcher.fetch({ widget }))
    jest.advanceTimersByTime(16)

    await Promise.all(promises)
    expect(send).toHaveBeenCalledTimes(3)
    expect(send.mock.calls[0][0]).toHaveLength(2)
    expect(send.mock.calls[1][0]).toHaveLength(2)
    expect(send.mock.calls[2][0]).toHaveLength(1)
  })
})
