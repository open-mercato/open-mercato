import { loadClaimLines } from '../backend/components/claimLines'

const readPageMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readPageMock(...args),
}))

const errorMessage = 'Unable to load claim lines'

describe('claim desk line pagination', () => {
  beforeEach(() => {
    readPageMock.mockReset()
  })

  it.each([0, 1, 100, 101, 200, 201])('loads every line of a %i-line claim', async (lineCount) => {
    const lines = Array.from({ length: lineCount }, (_, index) => ({
      id: `line-${index + 1}`,
      lineNo: index + 1,
      updatedAt: `version-${index + 1}`,
    }))
    const totalPages = Math.ceil(lineCount / 100)
    readPageMock.mockImplementation(async (url: string) => {
      const query = new URL(String(url), 'http://localhost').searchParams
      expect(query.get('claimId')).toBe('claim/with scope')
      expect(query.get('pageSize')).toBe('100')
      expect(query.get('sortField')).toBe('lineNo')
      expect(query.get('sortDir')).toBe('asc')
      const offset = (Number(query.get('page')) - 1) * 100
      return { items: lines.slice(offset, offset + 100), totalPages }
    })

    await expect(loadClaimLines('claim/with scope', errorMessage)).resolves.toEqual({ items: lines })
    expect(readPageMock).toHaveBeenCalledTimes(Math.max(1, totalPages))
    expect(readPageMock.mock.calls.map(([url]) => new URL(String(url), 'http://localhost').searchParams.get('page')))
      .toEqual(Array.from({ length: Math.max(1, totalPages) }, (_, index) => String(index + 1)))
    expect(readPageMock).toHaveBeenLastCalledWith(expect.any(String), undefined, {
      fallback: { items: [] }, errorMessage,
    })
  })

  it('keeps the walk bounded by the first response when later page counts change', async () => {
    readPageMock
      .mockResolvedValueOnce({ items: [{ id: 'line-1' }], totalPages: 2 })
      .mockResolvedValueOnce({ items: [{ id: 'line-101' }], totalPages: 3 })

    await expect(loadClaimLines('claim-1', errorMessage)).resolves.toEqual({
      items: [{ id: 'line-1' }, { id: 'line-101' }],
    })
    expect(readPageMock).toHaveBeenCalledTimes(2)
  })

  it.each([1, 2])('rejects a failed page %i instead of publishing a partial collection', async (failedPage) => {
    if (failedPage === 2) {
      readPageMock.mockResolvedValueOnce({ items: [{ id: 'line-1' }], totalPages: 2 })
    }
    const failure = new Error(errorMessage)
    readPageMock.mockRejectedValueOnce(failure)

    await expect(loadClaimLines('claim-1', errorMessage)).rejects.toBe(failure)
    expect(readPageMock).toHaveBeenCalledTimes(failedPage)
  })
})
