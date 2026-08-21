/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivityHistorySection } from '../ActivityHistorySection'

const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('../ActivityCard', () => ({
  ActivityCard: () => null,
}))

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

    let interactionsCall: string | undefined
    await waitFor(() => {
      interactionsCall = readApiResultOrThrowMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.startsWith('/api/customers/interactions?'),
      )?.[0] as string | undefined
      expect(interactionsCall).toBeDefined()
    })

    expect(interactionsCall).toBeDefined()

    const url = new URL(interactionsCall ?? '', 'http://localhost')
    const from = url.searchParams.get('from')

    expect(url.searchParams.get('entityId')).toBe('company-123')
    expect(url.searchParams.get('status')).toBeNull()
    expect(url.searchParams.get('excludeInteractionType')).toBe('task')
    expect(url.searchParams.get('type')).toBeNull()
    expect(from).not.toBeNull()

    const rangeStart = new Date(from ?? '')
    const now = new Date('2026-04-16T12:00:00.000Z')
    const diffDays = Math.round((now.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24))

    expect(diffDays).toBeGreaterThanOrEqual(89)
    expect(diffDays).toBeLessThanOrEqual(91)
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
