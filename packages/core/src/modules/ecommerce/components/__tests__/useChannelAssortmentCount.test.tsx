/** @jest-environment jsdom */
import { renderHook, waitFor } from '@testing-library/react'
import { useChannelAssortmentCount } from '../useChannelAssortmentCount'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

function countResult(count: number) {
  return {
    ok: true,
    result: { count, countWithoutAuthentication: count, requireAuthentication: false, reducedByAuthentication: false, unindexedCount: 0 },
  }
}

describe('useChannelAssortmentCount', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it('refetches the saved count when the binding refresh key changes', async () => {
    mockApiCall.mockResolvedValueOnce(countResult(1200)).mockResolvedValueOnce(countResult(40))
    const { result, rerender } = renderHook(
      ({ refreshKey }: { refreshKey: string }) => useChannelAssortmentCount('binding-1', null, 0, refreshKey),
      { initialProps: { refreshKey: '2026-10-08T08:00:00.000Z' } },
    )
    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', result: { count: 1200 } }))

    rerender({ refreshKey: '2026-10-08T09:00:00.000Z' })

    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', result: { count: 40 } }))
    expect(mockApiCall).toHaveBeenCalledTimes(2)
    expect(mockApiCall.mock.calls[0][0]).toBe(mockApiCall.mock.calls[1][0])
  })
})
