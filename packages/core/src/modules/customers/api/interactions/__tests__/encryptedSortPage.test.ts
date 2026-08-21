import { resolveEncryptedSortPage } from '../encryptedSortPage'

const namesById: Record<string, string> = {
  '1': 'cipher-a', '2': 'cipher-b', '3': 'cipher-c', '4': 'cipher-d', '5': 'cipher-e',
}
const plaintextById: Record<string, string> = {
  '1': 'Alice', '2': 'Bob', '3': 'Charlie', '4': 'Dave', '5': 'Eve',
}

function makeCandidates() {
  return [
    { id: '3', title: namesById['3'] },
    { id: '1', title: namesById['1'] },
    { id: '5', title: namesById['5'] },
    { id: '2', title: namesById['2'] },
    { id: '4', title: namesById['4'] },
  ]
}

async function decryptRow<T extends { id: string }>(row: T): Promise<T> {
  return { ...row, title: plaintextById[row.id] }
}

describe('resolveEncryptedSortPage', () => {
  test('sorts by decrypted plaintext, not ciphertext, on page 1', async () => {
    const { pageIds, hasMore } = await resolveEncryptedSortPage({
      candidates: makeCandidates(),
      decryptRow,
      sortField: 'title',
      sortDir: 'asc',
      cursorId: null,
      limit: 2,
    })
    // Alphabetical by plaintext: Alice(1), Bob(2), Charlie(3), Dave(4), Eve(5)
    expect(pageIds).toEqual(['1', '2'])
    expect(hasMore).toBe(true)
  })

  test('resumes correctly at the tail page via cursorId', async () => {
    const { pageIds, hasMore } = await resolveEncryptedSortPage({
      candidates: makeCandidates(),
      decryptRow,
      sortField: 'title',
      sortDir: 'asc',
      cursorId: '4', // after Dave -> only Eve left
      limit: 2,
    })
    expect(pageIds).toEqual(['5'])
    expect(hasMore).toBe(false)
  })

  test('walks every page without skipping or duplicating rows', async () => {
    const seen: string[] = []
    let cursorId: string | null = null
    for (let i = 0; i < 10; i++) {
      const { pageIds, hasMore } = await resolveEncryptedSortPage({
        candidates: makeCandidates(),
        decryptRow,
        sortField: 'title',
        sortDir: 'asc',
        cursorId,
        limit: 2,
      })
      seen.push(...pageIds)
      if (!hasMore) break
      cursorId = pageIds[pageIds.length - 1]
    }
    expect(seen).toEqual(['1', '2', '3', '4', '5'])
  })

  test('respects descending sort direction', async () => {
    const { pageIds } = await resolveEncryptedSortPage({
      candidates: makeCandidates(),
      decryptRow,
      sortField: 'title',
      sortDir: 'desc',
      cursorId: null,
      limit: 2,
    })
    expect(pageIds).toEqual(['5', '4']) // Eve, Dave
  })

  test('falls back to page 1 when the cursor id is not found among candidates', async () => {
    const { pageIds } = await resolveEncryptedSortPage({
      candidates: makeCandidates(),
      decryptRow,
      sortField: 'title',
      sortDir: 'asc',
      cursorId: 'does-not-exist',
      limit: 2,
    })
    expect(pageIds).toEqual(['1', '2'])
  })

  test('never decrypts more than 8 candidates concurrently', async () => {
    const candidates = Array.from({ length: 20 }, (_, i) => ({ id: String(i), title: `cipher-${i}` }))
    let inFlight = 0
    let maxInFlight = 0
    await resolveEncryptedSortPage({
      candidates,
      decryptRow: async (row) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 1))
        inFlight -= 1
        return { ...row, title: `plain-${row.id}` }
      },
      sortField: 'title',
      sortDir: 'asc',
      cursorId: null,
      limit: 5,
    })
    expect(maxInFlight).toBeLessThanOrEqual(8)
  })

  test('returns no ids and hasMore=false for an empty candidate set', async () => {
    const { pageIds, hasMore } = await resolveEncryptedSortPage({
      candidates: [],
      decryptRow,
      sortField: 'title',
      sortDir: 'asc',
      cursorId: null,
      limit: 2,
    })
    expect(pageIds).toEqual([])
    expect(hasMore).toBe(false)
  })
})
