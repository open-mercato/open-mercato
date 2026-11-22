/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivityHistorySection } from '../ActivityHistorySection'

const readApiResultOrThrowMock = jest.fn()

let mockCanDeleteActivity = true

jest.mock('../hooks/useActivityDeleteAccess', () => ({
  useActivityDeleteAccess: () => () => mockCanDeleteActivity,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('../ActivityCard', () => ({
  ActivityCard: ({ activity }: { activity: { title: string } }) => <div>{activity.title}</div>,
}))

function interactionsRequest(): Promise<URLSearchParams> {
  return waitFor(() => {
    const call = readApiResultOrThrowMock.mock.calls.find(
      ([url]) => typeof url === 'string' && url.startsWith('/api/customers/interactions?'),
    )
    expect(call).toBeDefined()
    return new URL(call?.[0], 'http://localhost').searchParams
  })
}

describe('ActivityHistorySection', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-16T12:00:00.000Z'))
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/interactions/counts?')) {
        return Promise.resolve({
          result: { call: 0, email: 0, meeting: 0, note: 0, total: 0 },
        })
      }
      if (url.startsWith('/api/customers/interactions?')) {
        return Promise.resolve({ items: [] })
      }
      if (url.startsWith('/api/customers/activities?')) {
        return Promise.resolve({ items: [] })
      }
      return Promise.resolve({})
    })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('loads history without a default type filter and with the broader default date range', async () => {
    await act(async () => {
      renderWithProviders(<ActivityHistorySection entityId="company-123" />)
      await Promise.resolve()
    })

    const params = await interactionsRequest()
    const from = params.get('from')

    expect(params.get('entityId')).toBe('company-123')
    expect(params.get('status')).toBeNull()
    expect(params.get('excludeInteractionType')).toBe('task')
    expect(params.get('type')).toBeNull()
    expect(from).not.toBeNull()

    const rangeStart = new Date(from ?? '')
    const now = new Date('2026-04-16T12:00:00.000Z')
    const diffDays = Math.round((now.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24))

    expect(diffDays).toBeGreaterThanOrEqual(89)
    expect(diffDays).toBeLessThanOrEqual(91)
  })

  it('hides the configured type instead when overridden', async () => {
    renderWithProviders(<ActivityHistorySection entityId="company-123" excludeInteractionType="note" />)
    expect((await interactionsRequest()).get('excludeInteractionType')).toBe('note')
  })

  it.each([null, ''])('disables exclusion when the prop is %p', async (excludeInteractionType) => {
    renderWithProviders(<ActivityHistorySection entityId="company-123" excludeInteractionType={excludeInteractionType} />)
    expect((await interactionsRequest()).has('excludeInteractionType')).toBe(false)
  })

  it('lifts the exclusion while the configured type filter is active', async () => {
    renderWithProviders(<ActivityHistorySection entityId="company-123" excludeInteractionType="note" />)
    expect((await interactionsRequest()).get('excludeInteractionType')).toBe('note')
    const chip = screen.getByRole('button', { name: /^Note\b/ })

    readApiResultOrThrowMock.mockClear()
    fireEvent.click(chip)
    const filteredParams = await interactionsRequest()
    expect(filteredParams.get('type')).toBe('note')
    expect(filteredParams.has('excludeInteractionType')).toBe(false)

    readApiResultOrThrowMock.mockClear()
    fireEvent.click(chip)
    const resetParams = await interactionsRequest()
    expect(resetParams.has('type')).toBe(false)
    expect(resetParams.get('excludeInteractionType')).toBe('note')
  })

  it('fetches legacy fallback pages in parallel rather than one at a time', async () => {
    jest.useRealTimers()
    let legacyInFlight = 0
    let legacyMaxInFlight = 0
    const legacyPagesRequested: number[] = []
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/interactions/counts?')) {
        return Promise.resolve({ result: { call: 0, email: 0, meeting: 0, note: 0, task: 0, total: 0 } })
      }
      if (url.startsWith('/api/customers/interactions?')) {
        if (url.includes('cursor=cursor-2')) {
          return Promise.resolve({ items: [] })
        }
        return Promise.resolve({
          items: [
            {
              id: 'canonical-1',
              interactionType: 'call',
              status: 'done',
              occurredAt: '2026-04-10T09:00:00.000Z',
              scheduledAt: null,
              createdAt: '2026-04-10T09:00:00.000Z',
              updatedAt: '2026-04-10T09:00:00.000Z',
            },
          ],
          nextCursor: 'cursor-2',
        })
      }
      if (url.startsWith('/api/customers/activities?')) {
        const page = Number(new URL(url, 'http://localhost').searchParams.get('page'))
        legacyPagesRequested.push(page)
        legacyInFlight += 1
        legacyMaxInFlight = Math.max(legacyMaxInFlight, legacyInFlight)
        return Promise.resolve({ items: [], totalPages: 5 }).finally(() => {
          legacyInFlight -= 1
        })
      }
      return Promise.resolve({})
    })

    renderWithProviders(<ActivityHistorySection entityId="company-123" />)

    // First load (loadedPages=1) must finish and reveal the "Load more" control.
    const loadMore = await screen.findByRole('button', { name: 'Load more' })
    fireEvent.click(loadMore)

    // Loading a second page requests legacy page 2 in both the old and new code…
    await waitFor(() => {
      expect(legacyPagesRequested.filter((page) => page === 2)).toHaveLength(1)
    })
    // …but the two legacy page fetches must overlap (parallel), not run one-at-a-time.
    expect(legacyMaxInFlight).toBeGreaterThanOrEqual(2)
  })
})

describe('ActivityHistorySection unknown dates', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockImplementation(async (url: string) => url.startsWith('/api/customers/interactions?') ? { items: [
      { id: 'undated-a', title: 'Undated A', occurredAt: null, scheduledAt: null, createdAt: '2035-01-01T12:00:00.000Z', status: 'done' },
      { id: 'dated', title: 'Dated', occurredAt: '2020-01-01T12:00:00.000Z', scheduledAt: null, createdAt: '2035-01-01T12:00:00.000Z', status: 'done' },
      { id: 'undated-z', title: 'Undated Z', occurredAt: null, scheduledAt: null, createdAt: '2010-01-01T12:00:00.000Z', status: 'done' },
    ] } : { result: {}, items: [] })
  })

  it('sorts undated company history last using ids and omits creation-year separators', async () => {
    renderWithProviders(<ActivityHistorySection entityId="company-1" useCanonicalInteractions />)
    await screen.findByText('Undated A')
    const dated = screen.getByText('Dated')
    const undatedZ = screen.getByText('Undated Z')
    const undatedA = screen.getByText('Undated A')
    expect(dated.compareDocumentPosition(undatedZ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(undatedZ.compareDocumentPosition(undatedA) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('2035')).not.toBeInTheDocument()
    expect(screen.queryByText('2010')).not.toBeInTheDocument()
  })
})
