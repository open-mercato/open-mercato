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
})

describe('ActivityHistorySection legacy fallback parallelization', () => {
  beforeEach(() => {
    jest.useRealTimers()
    readApiResultOrThrowMock.mockReset()
  })

  it('dispatches legacy fallback pages in parallel once the page count is known', async () => {
    const legacyDispatchedPages: string[] = []
    let firstLegacyPageResolved = false
    readApiResultOrThrowMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/interactions/counts?')) {
        return Promise.resolve({ result: { call: 0, email: 0, meeting: 0, note: 0, task: 0, total: 0 } })
      }
      if (url.startsWith('/api/customers/interactions?')) {
        return Promise.resolve({
          items: [
            {
              id: 'canon-1',
              interactionType: 'note',
              status: 'done',
              occurredAt: '2026-06-15T10:00:00.000Z',
              scheduledAt: null,
              createdAt: '2026-06-15T10:00:00.000Z',
              updatedAt: '2026-06-15T10:00:00.000Z',
            },
          ],
        })
      }
      if (url.startsWith('/api/customers/activities?')) {
        const page = new URL(url, 'http://localhost').searchParams.get('page') ?? ''
        legacyDispatchedPages.push(page)
        // First page-1 fetch resolves so a second page exists ("Load more" appears);
        // every later legacy fetch hangs so sequential code would block before page 2.
        if (page === '1' && !firstLegacyPageResolved) {
          firstLegacyPageResolved = true
          return Promise.resolve({ items: [], totalPages: 3 })
        }
        return new Promise(() => {})
      }
      return Promise.resolve({})
    })

    renderWithProviders(<ActivityHistorySection entityId="company-123" />)

    const loadMore = await screen.findByRole('button', { name: 'Load more' })
    legacyDispatchedPages.length = 0
    fireEvent.click(loadMore)

    // After "Load more" the component fetches legacy pages 1 and 2. With a parallel
    // dispatch both are requested even though page 1 is still pending; sequential code
    // would await the hanging page-1 fetch and never reach page 2.
    await waitFor(() => {
      expect(legacyDispatchedPages).toContain('2')
    })
    expect(legacyDispatchedPages).toContain('1')
  })
})
