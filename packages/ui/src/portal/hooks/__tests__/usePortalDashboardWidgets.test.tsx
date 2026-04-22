/** @jest-environment jsdom */
import * as React from 'react'
import { renderHook, waitFor } from '@testing-library/react'

const loadInjectionWidgetsForSpotMock = jest.fn()
const apiCallMock = jest.fn()

jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  loadInjectionWidgetsForSpot: (...args: unknown[]) => loadInjectionWidgetsForSpotMock(...args),
}))

jest.mock('../../../backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

import { usePortalDashboardWidgets } from '../usePortalDashboardWidgets'

function widget(id: string, features?: string[]) {
  return {
    moduleId: 'test',
    spotId: 'portal:dashboard:sections',
    widgetId: id,
    Widget: () => null,
    metadata: { id, features },
  }
}

function mockFeatureCheckGranted(granted: string[]) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url === '/api/customer_accounts/portal/feature-check') {
      return { ok: true, result: { ok: true, granted } }
    }
    throw new Error(`unexpected apiCall: ${url}`)
  })
}

describe('usePortalDashboardWidgets — feature gating (Phase 1 regression)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns widgets without required features regardless of grants', async () => {
    loadInjectionWidgetsForSpotMock.mockResolvedValueOnce([widget('always-visible')])
    // No features required → hook should skip the feature-check entirely

    const { result } = renderHook(() => usePortalDashboardWidgets('portal:dashboard:sections' as any))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.widgets).toHaveLength(1)
    expect(result.current.widgets[0].widgetId).toBe('always-visible')
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('filters out widgets whose required feature the user lacks', async () => {
    loadInjectionWidgetsForSpotMock.mockResolvedValueOnce([
      widget('visible', ['portal.orders.view']),
      widget('hidden', ['portal.billing.manage']),
    ])
    mockFeatureCheckGranted(['portal.orders.view'])

    const { result } = renderHook(() => usePortalDashboardWidgets('portal:dashboard:sections' as any))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const ids = result.current.widgets.map((w) => w.widgetId)
    expect(ids).toEqual(['visible'])
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/customer_accounts/portal/feature-check',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('resolves wildcard grants through the shared matcher', async () => {
    loadInjectionWidgetsForSpotMock.mockResolvedValueOnce([
      widget('orders-view', ['portal.orders.view']),
      widget('orders-create', ['portal.orders.create']),
      widget('billing', ['portal.billing.manage']),
    ])
    // Grant is a wildcard — server returns the concrete grants it matched.
    mockFeatureCheckGranted(['portal.orders.view', 'portal.orders.create'])

    const { result } = renderHook(() => usePortalDashboardWidgets('portal:dashboard:sections' as any))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const ids = result.current.widgets.map((w) => w.widgetId).sort()
    expect(ids).toEqual(['orders-create', 'orders-view'])
  })

  it('excludes all gated widgets when feature-check fails', async () => {
    loadInjectionWidgetsForSpotMock.mockResolvedValueOnce([
      widget('ungated'),
      widget('gated', ['portal.orders.view']),
    ])
    apiCallMock.mockRejectedValueOnce(new Error('network down'))

    const { result } = renderHook(() => usePortalDashboardWidgets('portal:dashboard:sections' as any))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const ids = result.current.widgets.map((w) => w.widgetId)
    // Ungated widget stays; gated widget is filtered because granted set is empty.
    expect(ids).toEqual(['ungated'])
  })

  it('excludes widgets without a Widget component', async () => {
    const noWidget = {
      moduleId: 'test',
      spotId: 'portal:dashboard:sections',
      widgetId: 'data-only',
      metadata: { id: 'data-only' },
    } as any
    loadInjectionWidgetsForSpotMock.mockResolvedValueOnce([widget('real'), noWidget])

    const { result } = renderHook(() => usePortalDashboardWidgets('portal:dashboard:sections' as any))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.widgets.map((w) => w.widgetId)).toEqual(['real'])
  })
})
