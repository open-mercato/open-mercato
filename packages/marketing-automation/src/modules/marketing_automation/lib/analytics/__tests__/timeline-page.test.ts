import { isOlderThanCursor, pageTimelineEntries, readTimelineCursor } from '../timeline-page.js'

/**
 * The bug this guards: two entries from different sources sharing the exact same instant, split across a
 * page boundary. An instant-only cursor excludes the WHOLE instant on the next request, so whichever of
 * the tied pair did not make the first page is silently never shown — "Show older" looks complete while a
 * row is missing.
 */
describe('timeline pagination tiebreak', () => {
  test('page 1 of a tie keeps only the id that sorts first, and hands back that id as the cursor', () => {
    const entries = [
      { id: 'send:a', at: '2026-10-01T12:00:00.000Z' },
      { id: 'points:b', at: '2026-10-01T12:00:00.000Z' },
    ]
    const page = pageTimelineEntries([...entries], 1)
    expect(page.pageEntries).toHaveLength(1)
    // Descending id for a tie: 'send:a' sorts before 'points:b' ('s' > 'p').
    expect(page.pageEntries[0].id).toBe('send:a')
    expect(page.hasMore).toBe(true)
    expect(page.nextBefore).toBe('2026-10-01T12:00:00.000Z')
    expect(page.nextBeforeId).toBe('send:a')
  })

  test('page 2 of the same tie recovers the entry page 1 did not show, not zero rows', () => {
    const cursor = readTimelineCursor(new URLSearchParams({ before: '2026-10-01T12:00:00.000Z', beforeId: 'send:a' }))
    const remaining = [{ id: 'send:a', at: '2026-10-01T12:00:00.000Z' }, { id: 'points:b', at: '2026-10-01T12:00:00.000Z' }]
      .filter((entry) => isOlderThanCursor(entry, cursor))
    expect(remaining).toEqual([{ id: 'points:b', at: '2026-10-01T12:00:00.000Z' }])
  })

  test('without a beforeId (the pre-fix contract) the whole tied instant is dropped, not recovered', () => {
    const cursor = readTimelineCursor(new URLSearchParams({ before: '2026-10-01T12:00:00.000Z' }))
    const remaining = [{ id: 'send:a', at: '2026-10-01T12:00:00.000Z' }, { id: 'points:b', at: '2026-10-01T12:00:00.000Z' }]
      .filter((entry) => isOlderThanCursor(entry, cursor))
    expect(remaining).toEqual([])
  })

  test('an entry strictly older than the cursor is always kept, and strictly newer always dropped', () => {
    const cursor = readTimelineCursor(new URLSearchParams({ before: '2026-10-01T12:00:00.000Z', beforeId: 'send:a' }))
    expect(isOlderThanCursor({ id: 'z', at: '2026-10-01T11:59:59.000Z' }, cursor)).toBe(true)
    expect(isOlderThanCursor({ id: 'z', at: '2026-10-01T12:00:01.000Z' }, cursor)).toBe(false)
  })

  test('readTimelineCursor returns null for an absent or unparseable before', () => {
    expect(readTimelineCursor(new URLSearchParams())).toBeNull()
    expect(readTimelineCursor(new URLSearchParams({ before: 'not-a-date' }))).toBeNull()
  })

  test('no cursor at all keeps everything, with no false tiebreak exclusion', () => {
    expect(isOlderThanCursor({ id: 'a', at: '2026-10-01T12:00:00.000Z' }, null)).toBe(true)
  })
})
