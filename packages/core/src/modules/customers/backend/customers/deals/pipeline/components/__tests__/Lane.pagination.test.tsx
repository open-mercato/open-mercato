/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Lane, type LaneAggregateProp } from '../Lane'
import type { DealCardData } from '../DealCard'

jest.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: jest.fn(), isOver: false }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

jest.mock('../DealCard', () => ({
  DealCard: ({ deal }: { deal: DealCardData }) => <div>{deal.title}</div>,
}))

const aggregate: LaneAggregateProp = {
  count: 60,
  totalInBaseCurrency: 6100,
  byCurrency: [
    { currency: 'USD', total: 5000, count: 50 },
    { currency: 'EUR', total: 1000, count: 10 },
  ],
  baseCurrencyCode: 'USD',
  convertedAll: true,
  missingRateCurrencies: [],
}

function buildDeals(count: number): DealCardData[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `deal-${index}`,
    title: `Deal ${index}`,
    valueAmount: 100,
    valueCurrency: 'USD',
    status: 'open',
    probability: null,
    expectedCloseAt: null,
    createdAt: null,
    updatedAt: null,
    owner: null,
    primaryCompany: null,
    pipelineState: {
      openActivitiesCount: 0,
      daysInCurrentStage: 0,
      isStuck: false,
      isOverdue: false,
    },
  }))
}

function buildProps(dealCount: number, paginationTotal?: number): React.ComponentProps<typeof Lane> {
  return {
    stage: { id: 'stage-1', label: 'Qualified', tone: null },
    deals: buildDeals(dealCount),
    aggregate,
    paginationTotal,
    selectedDealIds: new Set<string>(),
    buildMenuItems: () => [],
    onToggleSelect: jest.fn(),
    onComposeActivity: jest.fn(),
    onOpenDetail: jest.fn(),
    onQuickAddClick: jest.fn(),
    onLoadMore: jest.fn(),
  }
}

const loadMoreName = 'Load more deals in Qualified'

describe('Lane filtered pagination', () => {
  it.each([0, 1, 25, 26, 50])('stops when all %i matching deals are loaded', (matchingCount) => {
    render(<Lane {...buildProps(matchingCount, matchingCount)} />)

    expect(screen.queryByRole('button', { name: loadMoreName })).not.toBeInTheDocument()
    expect(screen.getByText('60')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show per-currency breakdown (2 currencies)' })).toBeInTheDocument()
  })

  it.each([
    [25, 26, 1],
    [25, 50, 25],
    [50, 51, 1],
  ])('shows the filtered remainder after %i of %i deals', (loadedCount, matchingCount, remainingCount) => {
    const props = buildProps(loadedCount, matchingCount)
    render(<Lane {...props} />)

    const button = screen.getByRole('button', { name: loadMoreName })
    expect(button).toHaveTextContent(`Show more (${remainingCount})`)
    fireEvent.click(button)
    expect(props.onLoadMore).toHaveBeenCalledWith('stage-1')
  })

  it.each([26, 50])('hides Show more after loading the last page of %i matches', (matchingCount) => {
    const props = buildProps(25, matchingCount)
    const { rerender } = render(<Lane {...props} />)
    expect(screen.getByRole('button', { name: loadMoreName })).toBeInTheDocument()

    rerender(<Lane {...props} deals={buildDeals(matchingCount)} />)

    expect(screen.queryByRole('button', { name: loadMoreName })).not.toBeInTheDocument()
  })

  it('updates availability when only the filtered total changes', () => {
    const props = buildProps(25, 26)
    const { rerender } = render(<Lane {...props} />)
    expect(screen.getByRole('button', { name: loadMoreName })).toBeInTheDocument()

    rerender(<Lane {...props} paginationTotal={25} />)
    expect(screen.queryByRole('button', { name: loadMoreName })).not.toBeInTheDocument()

    rerender(<Lane {...props} paginationTotal={27} />)
    expect(screen.getByRole('button', { name: loadMoreName })).toHaveTextContent('Show more (2)')
  })

  it('keeps the complete currency breakdown after filtered pagination ends', () => {
    render(<Lane {...buildProps(1, 1)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show per-currency breakdown (2 currencies)' }))

    expect(screen.getAllByText('USD')).toHaveLength(2)
    expect(screen.getByText('EUR')).toBeInTheDocument()
    expect(screen.getByText('QUALIFIED (60 deals)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: loadMoreName })).not.toBeInTheDocument()
  })

  it('retains aggregate-based pagination when no filtered total is supplied', () => {
    render(<Lane {...buildProps(25)} />)

    expect(screen.getByRole('button', { name: loadMoreName })).toHaveTextContent('Show more (35)')
  })
})
