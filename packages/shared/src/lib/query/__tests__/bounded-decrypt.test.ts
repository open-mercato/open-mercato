import { mapWithConcurrency } from '../bounded-decrypt'

describe('mapWithConcurrency', () => {
  test('preserves input order regardless of resolution order', async () => {
    const items = [1, 2, 3, 4, 5]
    const delays = [50, 10, 30, 5, 20]
    const result = await mapWithConcurrency(items, 2, (item, index) =>
      new Promise<number>((resolve) => setTimeout(() => resolve(item * 10), delays[index])),
    )
    expect(result).toEqual([10, 20, 30, 40, 50])
  })

  test('never runs more than `concurrency` mappers at once', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i)
    let inFlight = 0
    let maxInFlight = 0
    await mapWithConcurrency(items, 3, async (item) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return item
    })
    expect(maxInFlight).toBeLessThanOrEqual(3)
  })

  test('behaves like Promise.all when concurrency <= 0', async () => {
    const items = [1, 2, 3]
    const result = await mapWithConcurrency(items, 0, async (item) => item * 2)
    expect(result).toEqual([2, 4, 6])
  })

  test('behaves like Promise.all when concurrency >= items.length', async () => {
    const items = [1, 2, 3]
    const result = await mapWithConcurrency(items, 10, async (item) => item * 2)
    expect(result).toEqual([2, 4, 6])
  })

  test('returns an empty array for empty input', async () => {
    const result = await mapWithConcurrency([], 4, async (item) => item)
    expect(result).toEqual([])
  })

  test('passes the index to the mapper', async () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    const result = await mapWithConcurrency(items, 2, async (item, index) => `${item}-${index}`)
    expect(result).toEqual(['a-0', 'b-1', 'c-2', 'd-3', 'e-4'])
  })
})
