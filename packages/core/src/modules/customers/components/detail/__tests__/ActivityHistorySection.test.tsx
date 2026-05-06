/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, waitFor } from '@testing-library/react'
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

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/customers/interactions?'),
      )
    })

    const interactionsCall = readApiResultOrThrowMock.mock.calls.find(
      ([url]) => typeof url === 'string' && url.startsWith('/api/customers/interactions?'),
    )?.[0] as string | undefined

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
