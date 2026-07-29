/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import RevenueKpiWidget from '../revenue-kpi/widget.client'
import { DEFAULT_SETTINGS as REVENUE_SETTINGS } from '../revenue-kpi/config'
import TopCustomersWidget from '../top-customers/widget.client'
import { DEFAULT_SETTINGS as TOP_CUSTOMERS_SETTINGS } from '../top-customers/config'

const fetchWidgetDataMock = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({
    child: () => ({ error: jest.fn() }),
  }),
}))

jest.mock('@open-mercato/ui/backend/dashboard/widgetData', () => ({
  useWidgetData: () => fetchWidgetDataMock,
}))

jest.mock('@open-mercato/ui/backend/date-range', () => ({
  DateRangeSelect: () => null,
  InlineDateRangeSelect: () => null,
  getComparisonLabelKey: () => ({ key: 'comparison', fallback: 'Previous period' }),
  isValidDateRangePreset: () => true,
}))

jest.mock('@open-mercato/ui/backend/charts', () => {
  const ReactModule = jest.requireActual<typeof React>('react')
  return {
    KpiCard: ({
      value,
      formatValue,
    }: {
      value: number | null
      formatValue?: (value: number) => string
    }) =>
      ReactModule.createElement(
        'div',
        { 'data-testid': 'kpi-value' },
        value !== null && formatValue ? formatValue(value) : '',
      ),
    TopNTable: ({
      data,
      columns,
    }: {
      data: Array<{ revenue: number }>
      columns: Array<{ key: string; formatter?: (value: unknown) => string }>
    }) => {
      const revenueColumn = columns.find((column) => column.key === 'revenue')
      const value = data[0]?.revenue
      return ReactModule.createElement(
        'div',
        { 'data-testid': 'table-value' },
        value !== undefined && revenueColumn?.formatter ? revenueColumn.formatter(value) : '',
      )
    },
  }
})

function widgetProps<TSettings>(
  widgetId: string,
  settings: TSettings,
): DashboardWidgetComponentProps<TSettings> {
  return {
    mode: 'view',
    layout: { id: `${widgetId}-layout`, widgetId, order: 0 },
    settings,
    context: { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' },
    onSettingsChange: jest.fn(),
    refreshToken: 0,
  }
}

describe('dashboard analytics widget currency formatting', () => {
  beforeEach(() => {
    fetchWidgetDataMock.mockReset()
  })

  test('revenue KPI formats a value with response metadata currency', async () => {
    fetchWidgetDataMock.mockResolvedValue({
      value: 1234,
      data: [],
      metadata: {
        fetchedAt: '2026-07-29T00:00:00.000Z',
        recordCount: 1,
        currency: 'PLN',
      },
    })

    render(
      <RevenueKpiWidget
        {...widgetProps('dashboards.analytics.revenueKpi', REVENUE_SETTINGS)}
      />,
    )

    const renderedValue = screen.getByTestId('kpi-value')
    await waitFor(() => expect(renderedValue.textContent).toMatch(/PLN|zł/))
    expect(renderedValue.textContent).toMatch(/PLN|zł/)
    expect(renderedValue.textContent).not.toMatch(/USD|\$/)
  })

  test('top customers formats revenue with response metadata currency', async () => {
    fetchWidgetDataMock.mockResolvedValue({
      value: 1234,
      data: [{ groupKey: 'customer-1', groupLabel: 'Customer One', value: 1234 }],
      metadata: {
        fetchedAt: '2026-07-29T00:00:00.000Z',
        recordCount: 1,
        currency: 'PLN',
      },
    })

    render(
      <TopCustomersWidget
        {...widgetProps('dashboards.analytics.topCustomers', TOP_CUSTOMERS_SETTINGS)}
      />,
    )

    const renderedValue = screen.getByTestId('table-value')
    await waitFor(() => expect(renderedValue.textContent).toMatch(/PLN|zł/))
    expect(renderedValue.textContent).toMatch(/PLN|zł/)
    expect(renderedValue.textContent).not.toMatch(/USD|\$/)
  })
})
