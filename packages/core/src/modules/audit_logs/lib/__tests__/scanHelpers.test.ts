import {
  ACTION_LOG_SCAN_DEFAULT_MAX_BYTES,
  ACTION_LOG_SCAN_MAX_LIMIT,
  clampScanLimit,
  isValidScanCursor,
  isValidStateChangeCursor,
  takeWithinByteBudget,
} from '../fieldHistory'

const LOG_ID = '20000000-0000-4000-8000-000000000001'

describe('action log scan constants', () => {
  it('caps a scan page at 500 rows and 8 MiB of payload by default', () => {
    expect(ACTION_LOG_SCAN_MAX_LIMIT).toBe(500)
    expect(ACTION_LOG_SCAN_DEFAULT_MAX_BYTES).toBe(8 * 1024 * 1024)
  })
})

describe('takeWithinByteBudget', () => {
  it('takes nothing from an empty list', () => {
    expect(takeWithinByteBudget([], 100)).toBe(0)
    expect(takeWithinByteBudget([], 0)).toBe(0)
  })

  it('takes the longest prefix whose total stays within the budget', () => {
    expect(takeWithinByteBudget([5, 5, 50], 12)).toBe(2)
    expect(takeWithinByteBudget([5, 5, 50], 60)).toBe(3)
    expect(takeWithinByteBudget([5, 5, 50], 59)).toBe(2)
  })

  it('treats the budget as inclusive', () => {
    expect(takeWithinByteBudget([4, 4, 4], 12)).toBe(3)
    expect(takeWithinByteBudget([4, 4, 4], 11)).toBe(2)
  })

  it('always takes the first entry so a single oversized row still makes progress', () => {
    expect(takeWithinByteBudget([100], 12)).toBe(1)
    expect(takeWithinByteBudget([100, 1], 12)).toBe(1)
    expect(takeWithinByteBudget([100, 1], 0)).toBe(1)
  })

  it('stops at the first entry that overflows even when later ones would fit', () => {
    expect(takeWithinByteBudget([5, 50, 1, 1], 12)).toBe(1)
  })

  it('counts negative sizes as zero', () => {
    expect(takeWithinByteBudget([-10, 5, 5], 10)).toBe(3)
    expect(takeWithinByteBudget([-10, 5, 6], 10)).toBe(2)
  })

  it('takes zero-sized entries within a zero budget', () => {
    expect(takeWithinByteBudget([0, 0, 0], 0)).toBe(3)
  })
})

describe('clampScanLimit', () => {
  it.each([
    [1, 1],
    [250, 250],
    [500, 500],
    [501, 500],
    [10_000, 500],
    [0, 1],
    [-7, 1],
    [7.9, 7],
    [0.5, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    [Number.NEGATIVE_INFINITY, 1],
  ])('clamps %p to %p', (limit, expected) => {
    expect(clampScanLimit(limit)).toBe(expected)
  })
})

describe('isValidScanCursor', () => {
  it.each([
    ['2026-10-08T10:00:00Z', true],
    ['2026-10-08T10:00:00.1Z', true],
    ['2026-10-08T10:00:00.123456Z', true],
    ['2028-02-29T00:00:00Z', true],
    ['2026-10-08T10:00:00.1234567Z', false],
    ['2026-02-31T00:00:00Z', false],
    ['2026-10-08T24:00:00Z', false],
    ['2026-10-08 10:00:00Z', false],
    ['2026-10-08T10:00:00+02:00', false],
    ['2026-10-08', false],
    ['', false],
  ])('accepts only a real UTC created_at instant: %s', (createdAt, valid) => {
    expect(isValidScanCursor({ createdAt, id: LOG_ID })).toBe(valid)
  })

  it('rejects a missing cursor or a non-uuid id', () => {
    expect(isValidScanCursor(null)).toBe(false)
    expect(isValidScanCursor(undefined)).toBe(false)
    expect(isValidScanCursor({ createdAt: '2026-10-08T10:00:00Z', id: 'not-a-uuid' })).toBe(false)
    expect(isValidScanCursor({ createdAt: '2026-10-08T10:00:00Z', id: '' })).toBe(false)
  })
})

describe('isValidStateChangeCursor', () => {
  it.each([
    ['2026-10-08T10:00:00Z', true],
    ['2026-10-08T10:00:00.123456Z', true],
    ['2026-10-08T10:00:00.1234567Z', false],
    ['2026-02-29T00:00:00Z', false],
    ['2026-13-01T00:00:00Z', false],
    ['yesterday', false],
  ])('accepts only a real UTC updated_at instant: %s', (updatedAt, valid) => {
    expect(isValidStateChangeCursor({ updatedAt, id: LOG_ID })).toBe(valid)
  })

  it('rejects a missing cursor or a non-uuid id', () => {
    expect(isValidStateChangeCursor(null)).toBe(false)
    expect(isValidStateChangeCursor(undefined)).toBe(false)
    expect(isValidStateChangeCursor({ updatedAt: '2026-10-08T10:00:00Z', id: 'not-a-uuid' })).toBe(false)
  })
})
