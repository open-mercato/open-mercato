/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../../../../../tests/helpers/renderWithProviders'
import { DashboardScreen } from '../DashboardScreen'
import { apiCall } from '../../utils/apiCall'
import { loadDashboardWidgetModule } from '../widgetRegistry'

jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('../widgetRegistry', () => ({
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

describe('DashboardScreen', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(loadDashboardWidgetModule as jest.Mock).mockResolvedValue({
      Widget: () => <div>Widget body</div>,
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

    await waitFor(() => {
      expect(screen.getByText('Widget Foo')).toBeInTheDocument()
      expect(screen.getByText('Widget body')).toBeInTheDocument()
    })
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
})
