import { dayKey, SNAPSHOT_RETENTION_DAYS } from '../segment-snapshots'

describe('dayKey', () => {
  it('is the UTC calendar day', () => {
    expect(dayKey(new Date('2026-09-29T23:59:59.000Z'))).toBe('2026-09-29')
    expect(dayKey(new Date('2026-09-30T00:00:01.000Z'))).toBe('2026-09-30')
  })

  it('does not drift with the machine timezone', () => {
    // The key is what the unique index enforces one-per-day on, so it must not depend on where the worker
    // happens to run — two workers in different zones would otherwise both write "today".
    const instant = new Date('2026-09-29T01:30:00.000Z')
    expect(dayKey(instant)).toBe('2026-09-29')
  })
})

describe('retention', () => {
  it('keeps a quarter of history', () => {
    // Enough to see a trend and to compare with last month; not so much that a chart becomes a table.
    expect(SNAPSHOT_RETENTION_DAYS).toBe(120)
  })
})
