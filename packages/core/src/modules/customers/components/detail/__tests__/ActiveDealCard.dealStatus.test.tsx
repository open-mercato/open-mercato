/**
 * @jest-environment jsdom
 */
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { DealSummary } from '../../formConfig'

const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

import { ActiveDealCard } from '../ActiveDealCard'

// Regression for issue #4667: the card highlighted the highest-value deal among those it
// considered active. It tested for `won` / `lost` / `closed`, so the biggest deal already
// closed through useDealClosure (`status: 'win'`) was still presented as the active one.

const CLOSED_WON_DEAL: DealSummary = {
  id: 'deal-won',
  title: 'Closed through useDealClosure',
  status: 'win',
  closureOutcome: 'won',
  valueAmount: 9000,
  valueCurrency: 'PLN',
  createdAt: '2026-01-10T10:00:00.000Z',
}

const CLOSED_LOST_DEAL: DealSummary = {
  id: 'deal-lost',
  title: 'Lost through useDealClosure',
  status: 'loose',
  valueAmount: 8000,
  valueCurrency: 'PLN',
  createdAt: '2026-01-11T10:00:00.000Z',
}

const OPEN_DEAL: DealSummary = {
  id: 'deal-open',
  title: 'Still negotiating',
  status: 'negotiations',
  valueAmount: 1000,
  valueCurrency: 'PLN',
  createdAt: '2026-01-12T10:00:00.000Z',
}

describe('ActiveDealCard — deal status vocabulary (#4667)', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue({ items: [] })
  })

  it('skips the bigger win deal and highlights the open one', () => {
    renderWithProviders(<ActiveDealCard deals={[CLOSED_WON_DEAL, OPEN_DEAL]} />)

    expect(screen.getByText('Still negotiating')).toBeInTheDocument()
    expect(screen.queryByText('Closed through useDealClosure')).not.toBeInTheDocument()
  })

  it('renders the empty state when every deal was closed through the UI', () => {
    renderWithProviders(<ActiveDealCard deals={[CLOSED_WON_DEAL, CLOSED_LOST_DEAL]} />)

    expect(screen.getByText('No active deals')).toBeInTheDocument()
  })
})
