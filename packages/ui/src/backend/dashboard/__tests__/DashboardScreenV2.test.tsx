/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { getDashboardWidgets, loadDashboardWidgetModule } from '../widgetRegistry'
import { DashboardHeader } from '../v2/DashboardHeader'
import { DashboardScreenV2, reorderLayoutItems } from '../v2/DashboardScreenV2'
import { sizeToSpanClass } from '../v2/GridLayout'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('../../injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
}))

jest.mock('../widgetRegistry', () => ({
  getDashboardWidgets: jest.fn(),
  loadDashboardWidgetModule: jest.fn(),
}))

let mockOrganizationScopeVersion = 0

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => mockOrganizationScopeVersion,
}))

const dict = {
  'dashboard.v2.greeting.morning': 'Morning {name}',
  'dashboard.v2.greeting.afternoon': 'Afternoon {name}',
  'dashboard.v2.greeting.evening': 'Evening {name}',
  'dashboard.v2.customize': 'Customize',
  'dashboard.v2.done': 'Done',
  'dashboard.v2.refreshAll': 'Refresh all',
  'dashboard.v2.addWidget': 'Add widget',
  'dashboard.v2.resetLayout': 'Reset layout',
  'dashboard.v2.legacyLink': 'Switch to legacy dashboard',
  'dashboard.v2.emptyTitle': 'No widgets',
  'dashboard.v2.emptyCta': 'Add widgets',
  'dashboard.v2.removeWidget': 'Remove widget',
  'dashboard.v2.widgetSettings': 'Widget settings',
  'dashboard.v2.sizeLabel': 'Size',
  'dashboard.v2.saveFailed': 'Save failed',
  'dashboard.v2.dateRange.preset.last_30_days': 'Last 30 days',
  'dashboard.widgets.foo.title': 'Widget Foo',
}

const range = {
  preset: 'custom' as const,
  from: '2026-06-01',
  to: '2026-06-30',
  compare: 'previous_year' as const,
}

const layoutResponse = {
  layout: {
    items: [{ id: 'item-1', widgetId: 'foo', order: 0, size: 'md' }],
    preferences: { dateRange: range },
  },
  widgets: [{
    id: 'foo',
    title: 'Widget Foo',
    description: null,
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: null,
    features: [],
    moduleId: 'example',
    icon: null,
    loaderKey: 'foo.loader',
    supportsRefresh: false,
  }],
  allowedWidgetIds: ['foo'],
  canConfigure: true,
  context: {
    userId: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userName: 'Ada',
    userEmail: 'ada@example.com',
    userLabel: 'Ada Lovelace',
  },
}

describe('DashboardScreenV2', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    jest.useRealTimers()
    mockOrganizationScopeVersion = 0
    ;(getDashboardWidgets as jest.Mock).mockReturnValue([{ key: 'foo.loader', loader: jest.fn() }])
  })

  it('maps dashboard widget sizes to static grid spans', () => {
    expect(sizeToSpanClass('sm')).toBe('md:col-span-3 xl:col-span-3')
    expect(sizeToSpanClass('md')).toBe('md:col-span-6 xl:col-span-6')
    expect(sizeToSpanClass('lg')).toBe('md:col-span-6 xl:col-span-9')
    expect(sizeToSpanClass('full')).toBe('md:col-span-6 xl:col-span-12')
  })

  it('renders mocked registry widgets with the active global date range in context', async () => {
    const seenRanges: unknown[] = []
    function MockWidget(props: DashboardWidgetComponentProps) {
      seenRanges.push(props.context.dateRange)
      return <div data-testid="widget-range">{props.context.dateRange?.from}</div>
    }
    ;(apiCall as jest.Mock).mockResolvedValue({ ok: true, status: 200, result: layoutResponse })
    ;(loadDashboardWidgetModule as jest.Mock).mockResolvedValue({
      metadata: { id: 'foo', title: 'Widget Foo' },
      Widget: MockWidget,
    })

    renderWithProviders(<DashboardScreenV2 />, { dict })

    expect(await screen.findByText('Widget Foo')).toBeInTheDocument()
    expect(await screen.findByTestId('widget-range')).toHaveTextContent('2026-06-01')
    await waitFor(() => {
      expect(seenRanges).toContainEqual(range)
    })
  })

  it.each([
    [9, 'Morning Ada'],
    [13, 'Afternoon Ada'],
    [19, 'Evening Ada'],
  ])('selects the greeting key for local hour %i', (hour, expected) => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 2, hour))
    renderWithProviders(
      <DashboardHeader
        context={layoutResponse.context}
        dateRange={{ ...range }}
        canConfigure
        editing={false}
        presets={[]}
        activePresetId={null}
        maxPresets={12}
        onSelectPreset={jest.fn()}
        onSavePreset={jest.fn()}
        onDeletePreset={jest.fn()}
        onDateRangeChange={jest.fn()}
        onRefreshAll={jest.fn()}
        onResetLayout={jest.fn()}
        onToggleCustomize={jest.fn()}
      />,
      { dict },
    )

    expect(screen.getByText(expected)).toBeInTheDocument()
    jest.useRealTimers()
  })
})

describe('reorderLayoutItems', () => {
  const items = [
    { id: 'a', widgetId: 'w.a', order: 0, priority: 0 },
    { id: 'b', widgetId: 'w.b', order: 1, priority: 1 },
    { id: 'c', widgetId: 'w.c', order: 2, priority: 2 },
  ]

  it('moves the active item to the over position and reindexes order/priority', () => {
    const next = reorderLayoutItems(items, 'a', 'b')
    expect(next.map((item) => item.id)).toEqual(['b', 'a', 'c'])
    expect(next.map((item) => item.order)).toEqual([0, 1, 2])
    expect(next.map((item) => item.priority)).toEqual([0, 1, 2])
  })

  it('survives the order-based re-sort applied by updateLayout', () => {
    const next = reorderLayoutItems(items, 'a', 'c')
    const resorted = [...next].sort((x, y) => (x.order ?? 0) - (y.order ?? 0))
    expect(resorted.map((item) => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('returns the input untouched when either id is unknown', () => {
    expect(reorderLayoutItems(items, 'a', 'missing')).toBe(items)
    expect(reorderLayoutItems(items, 'missing', 'b')).toBe(items)
  })
})
