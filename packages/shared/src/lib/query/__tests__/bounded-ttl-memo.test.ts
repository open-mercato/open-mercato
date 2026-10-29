import { createBoundedTtlMemo } from '../bounded-ttl-memo'

describe('createBoundedTtlMemo', () => {
  const TTL_ENV = 'TEST_BOUNDED_TTL_MEMO_MS'
  const MAX_ENTRIES_ENV = 'TEST_BOUNDED_TTL_MEMO_MAX_ENTRIES'
  const originalTtl = process.env[TTL_ENV]
  const originalMaxEntries = process.env[MAX_ENTRIES_ENV]

  afterEach(() => {
    if (originalTtl === undefined) delete process.env[TTL_ENV]
    else process.env[TTL_ENV] = originalTtl
    if (originalMaxEntries === undefined) delete process.env[MAX_ENTRIES_ENV]
    else process.env[MAX_ENTRIES_ENV] = originalMaxEntries
    jest.restoreAllMocks()
  })

  function buildMemo<V>() {
    return createBoundedTtlMemo<V>({
      ttlEnv: TTL_ENV,
      maxEntriesEnv: MAX_ENTRIES_ENV,
      defaultTtlMs: 1_000,
      defaultMaxEntries: 3,
    })
  }

  test('a stored value is returned until it expires', () => {
    const now = 1_700_000_000_000
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now)
    const memo = buildMemo<string>()

    memo.set('key', 'value')
    expect(memo.get('key')).toBe('value')

    nowSpy.mockReturnValue(now + 999)
    expect(memo.get('key')).toBe('value')

    nowSpy.mockReturnValue(now + 1_001)
    expect(memo.get('key')).toBeUndefined()
  })

  test('overflow sweeps expired entries first, then clears wholesale only if still over the cap', () => {
    const now = 1_700_000_000_000
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now)
    process.env[MAX_ENTRIES_ENV] = '2'
    const memo = buildMemo<number>()

    memo.set('a', 1)
    nowSpy.mockReturnValue(now + 1_001)
    memo.set('b', 2)
    expect(memo.get('a')).toBeUndefined()

    nowSpy.mockReturnValue(now + 1_002)
    memo.set('c', 3)
    expect(memo.size()).toBeLessThanOrEqual(2)
    expect(memo.get('b')).toBe(2)
    expect(memo.get('c')).toBe(3)
  })

  test('the cache stays bounded under sustained distinct-key pressure', () => {
    process.env[MAX_ENTRIES_ENV] = '4'
    const memo = buildMemo<number>()

    for (let index = 0; index < 50; index += 1) {
      memo.set(`key-${index}`, index)
      expect(memo.size()).toBeLessThanOrEqual(4)
    }
  })

  test('TTL=0 disables storage entirely', () => {
    process.env[TTL_ENV] = '0'
    const memo = buildMemo<string>()

    memo.set('key', 'value')
    expect(memo.get('key')).toBeUndefined()
    expect(memo.size()).toBe(0)
  })

  test('clear() empties the memo', () => {
    const memo = buildMemo<string>()
    memo.set('key', 'value')
    expect(memo.size()).toBe(1)
    memo.clear()
    expect(memo.size()).toBe(0)
    expect(memo.get('key')).toBeUndefined()
  })
})
