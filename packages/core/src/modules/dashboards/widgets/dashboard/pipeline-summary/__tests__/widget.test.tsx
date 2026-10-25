/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import PipelineSummaryWidget from '../widget.client'
import { DEFAULT_SETTINGS } from '../config'

const mockFetchWidgetData = jest.fn()
const mockTranslate = (_key: string, fallback: string) => fallback
let mockVocabularyState = {
  vocabulary: { won: ['signed'], lost: ['declined'], closed: ['archived'] },
  isLoading: false, isError: false,
}

jest.mock('@open-mercato/core/modules/customers/components/hooks/useDealStatusVocabulary', () => ({
  useDealStatusVocabulary: () => mockVocabularyState,
}))
jest.mock('@open-mercato/ui/backend/dashboard/widgetData', () => ({ useWidgetData: () => mockFetchWidgetData }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate, useLocale: () => 'en-US' }))
jest.mock('@open-mercato/ui/backend/charts', () => ({
  BarChart: ({ loading, error }: { loading: boolean; error: string | null }) => <div data-testid="chart" data-loading={loading}>{error}</div>,
}))
jest.mock('@open-mercato/ui/backend/date-range', () => ({
  isValidDateRangePreset: () => true, DateRangeSelect: () => null, InlineDateRangeSelect: () => null,
}))

const props = {
  mode: 'view' as const,
  layout: { id: 'pipeline', widgetId: 'dashboards.analytics.pipelineSummary', order: 0 },
  context: { userId: 'user', tenantId: 'tenant', organizationId: 'organization' },
  settings: DEFAULT_SETTINGS,
  onSettingsChange: jest.fn(),
}

beforeEach(() => {
  mockFetchWidgetData.mockReset().mockResolvedValue({ data: [], metadata: { currency: 'PLN' } })
  mockVocabularyState = { ...mockVocabularyState, isLoading: false, isError: false }
})

it('uses the scoped vocabulary in its actual analytics request', async () => {
  render(<PipelineSummaryWidget {...props} />)
  await waitFor(() => expect(mockFetchWidgetData).toHaveBeenCalledWith(expect.objectContaining({
    filters: expect.arrayContaining([
      { field: 'status', operator: 'neq', value: 'archived' },
      { field: 'status', operator: 'neq', value: 'signed' },
      { field: 'closureOutcome', operator: 'is_null' },
    ]),
  })))
  await waitFor(() => expect(screen.getByTestId('chart')).toHaveAttribute('data-loading', 'false'))
})

it('waits for vocabulary and surfaces failure without requesting default-only totals', () => {
  mockVocabularyState = { ...mockVocabularyState, isLoading: true }
  const view = render(<PipelineSummaryWidget {...props} />)
  expect(mockFetchWidgetData).not.toHaveBeenCalled()
  expect(screen.getByTestId('chart')).toHaveAttribute('data-loading', 'true')
  mockVocabularyState = { ...mockVocabularyState, isLoading: false, isError: true }
  view.rerender(<PipelineSummaryWidget {...props} />)
  expect(mockFetchWidgetData).not.toHaveBeenCalled()
  expect(screen.getByTestId('chart')).toHaveTextContent('Failed to load deal status vocabulary.')
  expect(screen.getByTestId('chart')).toHaveAttribute('data-loading', 'false')
})
