/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DealTimelineCellResponse, DealTimelineItem } from '../../../../../../lib/dealsTimelineTypes'
import { TimelineCellPopover } from '../TimelineCellPopover'

const mockReadApiResultOrThrow = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useLocale: () => 'en',
  useT: () => (key: string, fallbackOrParams?: unknown, maybeParams?: Record<string, unknown>) => {
    const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : key
    const params = typeof fallbackOrParams === 'object' && fallbackOrParams ? (fallbackOrParams as Record<string, unknown>) : maybeParams
    return fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))
  },
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
}))

function makeItem(index: number): DealTimelineItem {
  return {
    id: `deal-${index}`,
    title: `Deal ${index}`,
    status: 'open',
    valueAmount: 100,
    valueCurrency: 'USD',
    probability: 50,
    expectedCloseAt: '2026-11-12',
    pipelineId: null,
    pipelineStageId: null,
    pipelineStage: null,
    ownerUserId: null,
    updatedAt: '2026-11-10T10:00:00.000Z',
    primaryCompany: null,
    primaryPerson: null,
  }
}

function makePage(page: number, items: DealTimelineItem[], totalPages: number): DealTimelineCellResponse {
  return { lane: 'lane-1', column: 1, items, total: 51, page, pageSize: 50, totalPages, countsCapped: false }
}

function renderPopover(focusDealId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TimelineCellPopover
        open
        onOpenChange={() => undefined}
        laneKey="lane-1"
        laneLabel="Lane"
        column={1}
        columnLabel="Week 46"
        baseParams="bucket=week"
        todayKey="2026-11-10"
        focusDealId={focusDealId}
        onOpenDeal={() => undefined}
      >
        <button type="button">more</button>
      </TimelineCellPopover>
    </QueryClientProvider>,
  )
}

describe('TimelineCellPopover reveal', () => {
  beforeEach(() => {
    mockReadApiResultOrThrow.mockReset()
  })

  it('loads further pages until the focused deal is found, then focuses it', async () => {
    const firstPage = Array.from({ length: 50 }, (_unused, index) => makeItem(index))
    mockReadApiResultOrThrow.mockImplementation(async (url: string) => {
      const page = Number(new URLSearchParams(url.split('?')[1]).get('page'))
      return page === 1 ? makePage(1, firstPage, 2) : makePage(2, [makeItem(50)], 2)
    })
    renderPopover('deal-50')
    const target = await screen.findByRole('button', { name: /Deal 50/ })
    await waitFor(() => expect(target).toHaveFocus())
    expect(mockReadApiResultOrThrow).toHaveBeenCalledTimes(2)
  })

  it('stops and focuses the list when the deal is not in any page', async () => {
    mockReadApiResultOrThrow.mockImplementation(async () => makePage(1, [makeItem(1)], 1))
    renderPopover('deal-missing')
    await screen.findByRole('button', { name: /Deal 1/ })
    await waitFor(() => expect(document.activeElement?.tagName).toBe('UL'))
    expect(mockReadApiResultOrThrow).toHaveBeenCalledTimes(1)
  })

  it('stops on a failed page and keeps the loaded rows with an error', async () => {
    mockReadApiResultOrThrow.mockImplementation(async (url: string) => {
      const page = Number(new URLSearchParams(url.split('?')[1]).get('page'))
      if (page === 1) return makePage(1, [makeItem(1)], 2)
      throw new Error('[internal] page failed')
    })
    renderPopover('deal-50')
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: /Deal 1/ })).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement?.tagName).toBe('UL'))
    expect(mockReadApiResultOrThrow).toHaveBeenCalledTimes(2)
  })
})
