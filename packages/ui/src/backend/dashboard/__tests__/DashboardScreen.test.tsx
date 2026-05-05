/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DashboardScreen } from '../DashboardScreen'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { getDashboardWidgets, loadDashboardWidgetModule } from '../widgetRegistry'

jest.setTimeout(20000)

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('../widgetRegistry', () => ({
  getDashboardWidgets: jest.fn(),
  loadDashboardWidgetModule: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
  }),
}))

const createMockResponse = (status: number): Response => ({ status } as Response)

const dict = {
  'dashboard.loadError': 'Failed to load dashboard',
  'dashboard.empty.noWidgets.title': 'No dashboard widgets yet',
  'dashboard.empty.noWidgets.description': 'Dashboard widgets will appear here after you add a module.',
  'dashboard.widgets.foo.title': 'Widget Foo',
  'dashboard.widgets.foo.description': 'Widget description',
}

const widgetResponse = {
  layout: { items: [{ id: 'item-1', widgetId: 'foo', order: 0, size: 'md' }] },
  widgets: [
    {
      id: 'foo',
      title: 'Widget Foo',
      description: 'Widget description',
      defaultSize: 'md',
      defaultEnabled: true,
      defaultSettings: null,
      features: [],
      moduleId: 'example',
      icon: null,
      loaderKey: 'foo.loader',
      supportsRefresh: false,
    },
  ],
  allowedWidgetIds: ['foo'],
  canConfigure: true,
  context: {
    userId: 'user',
    tenantId: null,
    organizationId: null,
    userName: 'Demo',
    userEmail: 'demo@example.com',
    userLabel: 'Demo User',
  },
}

function MockWidget() {
  return <div>Widget body</div>
}

describe('DashboardScreen', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(getDashboardWidgets as jest.Mock).mockReturnValue([{ key: 'foo.loader', loader: jest.fn() }])
    ;(loadDashboardWidgetModule as jest.Mock).mockResolvedValue({
      Widget: MockWidget,
      hydrateSettings: (value: unknown) => value,
      dehydrateSettings: (value: unknown) => value,
    })
  })

  it('renders widget cards when layout loads successfully', async () => {
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      result: widgetResponse,
      response: createMockResponse(200),
    })

    renderWithProviders(<DashboardScreen />, { dict })

    // Wait for the layout to load first
    expect(await screen.findByText('Widget Foo')).toBeInTheDocument()
    // Then wait for the widget module to load
    expect(await screen.findByText('Widget body')).toBeInTheDocument()
  })

  it('shows an error when the layout request fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      result: null,
      response: createMockResponse(500),
    })

    renderWithProviders(<DashboardScreen />, { dict })

    await waitFor(() => {
      expect(screen.getByText('Failed to load dashboard')).toBeInTheDocument()
    })

    errorSpy.mockRestore()
  })

  it('shows an informational empty state when no dashboard widgets are registered', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(getDashboardWidgets as jest.Mock).mockReturnValue([])
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      result: null,
      response: createMockResponse(500),
    })

    renderWithProviders(<DashboardScreen />, { dict })

    expect(await screen.findByText('No dashboard widgets yet')).toBeInTheDocument()
    expect(screen.getByText('Dashboard widgets will appear here after you add a module.')).toBeInTheDocument()
    expect(screen.queryByText('Failed to load dashboard')).not.toBeInTheDocument()

    errorSpy.mockRestore()
  })
})
