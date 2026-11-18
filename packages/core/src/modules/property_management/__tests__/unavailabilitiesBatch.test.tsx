/** @jest-environment jsdom */
import { renderHook, waitFor } from '@testing-library/react'
import { chunkIds, useUnavailabilities, type UnavailabilityQuery } from '../components/availability/useUnavailabilities'
import type { UnavailabilityRow } from '../components/availability/availabilityModel'

type CallResult = { ok: boolean; status: number; result: unknown }
const mockApiCall = jest.fn<Promise<CallResult>, [string, RequestInit?, unknown?]>()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (url: string, init?: RequestInit, options?: unknown) => mockApiCall(url, init, options),
}))

function closure(id: string, subjectId: string): UnavailabilityRow {
  return {
    id,
    buildingId: 'building-1',
    subjectType: 'unit',
    subjectId,
    reasonLabel: null,
    reasonText: 'Renovation',
    startsAt: '2026-01-01T00:00',
    endsAt: null,
    effectiveEndsAt: null,
    inEffect: true,
    applyStatus: 'applied',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as UnavailabilityRow
}

function subjectIdsOf(url: string): string[] {
  const value = new URL(url, 'http://localhost').searchParams.get('subjectIds')
  return value ? value.split(',') : []
}

describe('chunkIds', () => {
  it('drops duplicates and splits into batches the list route accepts', () => {
    const ids = Array.from({ length: 205 }, (_, index) => `id-${index}`)
    const chunks = chunkIds([...ids, 'id-0', ''])
    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 5])
  })
})

describe('useUnavailabilities with a truncated building list', () => {
  beforeEach(() => mockApiCall.mockReset())

  it('loads the on-screen subjects in one batched follow-up instead of per row', async () => {
    const onScreen = Array.from({ length: 150 }, (_, index) => `unit-${index}`)
    mockApiCall.mockImplementation(async (url) => {
      const ids = subjectIdsOf(url)
      if (!ids.length) return { ok: true, status: 200, result: { items: [closure('broad', 'unit-999')], truncated: true } }
      return { ok: true, status: 200, result: { items: ids.includes('unit-140') ? [closure('exact', 'unit-140')] : [], truncated: false } }
    })
    const query: UnavailabilityQuery = { buildingIds: ['building-1'], exactSubjectIds: onScreen }
    const { result } = renderHook(() => useUnavailabilities(query))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.truncated).toBe(false)
    expect(result.current.error).toBe(false)
    expect(result.current.rows.map((row) => row.id)).toEqual(['exact'])
    const followUps = mockApiCall.mock.calls.map(([url]) => subjectIdsOf(url)).filter((ids) => ids.length > 0)
    expect(followUps.map((ids) => ids.length)).toEqual([100, 50])
  })

  it('stays loading until the follow-up arrives and reports its failure', async () => {
    mockApiCall.mockImplementation(async (url) => {
      if (!subjectIdsOf(url).length) return { ok: true, status: 200, result: { items: [], truncated: true } }
      return { ok: false, status: 500, result: {} }
    })
    const query: UnavailabilityQuery = { buildingIds: ['building-1'], exactSubjectIds: ['unit-1'] }
    const { result } = renderHook(() => useUnavailabilities(query))
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.loading).toBe(false)
  })

  it('keeps the truncated flag for callers that do not list their subjects', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { items: [], truncated: true } })
    const query: UnavailabilityQuery = { buildingIds: ['building-1'] }
    const { result } = renderHook(() => useUnavailabilities(query))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.truncated).toBe(true)
    expect(mockApiCall).toHaveBeenCalledTimes(1)
  })

  it('does not fetch again when the building list is complete', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { items: [closure('broad', 'unit-1')], truncated: false } })
    const query: UnavailabilityQuery = { buildingIds: ['building-1'], exactSubjectIds: ['unit-1'] }
    const { result } = renderHook(() => useUnavailabilities(query))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.rows.map((row) => row.id)).toEqual(['broad'])
    expect(mockApiCall).toHaveBeenCalledTimes(1)
  })
})
