/** @jest-environment jsdom */

import * as React from 'react'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import type {
  LoadedInjectionDataWidget,
  LoadedInjectionWidget,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import type { LoadedInjectionSpotWidget } from '../InjectionSpot'

const loadInjectionWidgetsForSpotMock = jest.fn()
const loadInjectionDataWidgetsForSpotMock = jest.fn()
const onLoadVisibleMock = jest.fn()
const onLoadHiddenMock = jest.fn()

let backendChromePayload: { grantedFeatures: string[] } | null = {
  grantedFeatures: [],
}
let backendChromeReady = true

jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  subscribeToInjectionRegistryChanges: () => () => {},
  loadInjectionWidgetsForSpot: (...args: unknown[]) => loadInjectionWidgetsForSpotMock(...args),
  loadInjectionDataWidgetsForSpot: (...args: unknown[]) => loadInjectionDataWidgetsForSpotMock(...args),
}))

jest.mock('../../BackendChromeProvider', () => ({
  useBackendChrome: () => ({
    payload: backendChromePayload,
    isLoading: !backendChromeReady,
    isReady: backendChromeReady,
    refresh: jest.fn(),
  }),
}))

jest.mock('../WidgetSharedState', () => ({
  getWidgetSharedState: () => ({}),
}))

import { InjectionSpot, useInjectionSpotEvents } from '../InjectionSpot'
import { useInjectionDataWidgets } from '../useInjectionDataWidgets'

const SPOT_ID = 'data-table:test.widgets:toolbar'

function setGrantedFeatures(features: string[]) {
  backendChromePayload = { grantedFeatures: features }
  backendChromeReady = true
}

function setBackendChromeLoading() {
  backendChromePayload = null
  backendChromeReady = false
}

function visualWidget(
  id: string,
  features: string[] | undefined,
  onLoad: () => void,
): LoadedInjectionWidget {
  return {
    metadata: { id, features },
    moduleId: 'test_module',
    key: id,
    Widget: () => <div data-testid={id}>{id}</div>,
    eventHandlers: {
      onLoad: async () => {
        onLoad()
      },
    },
  }
}

function lifecycleWidget(
  id: string,
  features: string[] | undefined,
  onBeforeSave: () => void,
): LoadedInjectionWidget {
  return {
    metadata: { id, features },
    moduleId: 'test_module',
    key: id,
    Widget: () => <div data-testid={id}>{id}</div>,
    eventHandlers: {
      onBeforeSave: async () => {
        onBeforeSave()
        return false
      },
    },
  }
}

function loadedSpotWidget(widget: LoadedInjectionWidget): LoadedInjectionSpotWidget {
  return {
    widgetId: widget.metadata.id,
    module: widget,
    moduleId: widget.moduleId,
    key: widget.key,
  }
}

function dataWidget(id: string, features?: string[]): LoadedInjectionDataWidget {
  return {
    metadata: { id, features },
    moduleId: 'test_module',
    key: id,
    columns: [],
  }
}

describe('Injection widget feature gating', () => {
  beforeEach(() => {
    setGrantedFeatures([])
    loadInjectionWidgetsForSpotMock.mockReset()
    loadInjectionDataWidgetsForSpotMock.mockReset()
    onLoadVisibleMock.mockReset()
    onLoadHiddenMock.mockReset()
  })

  it('does not render or load component widgets when metadata features are missing', async () => {
    loadInjectionWidgetsForSpotMock.mockResolvedValueOnce([
      visualWidget('visible-widget', ['widgets.view'], onLoadVisibleMock),
      visualWidget('hidden-widget', ['widgets.manage'], onLoadHiddenMock),
    ])
    setGrantedFeatures(['widgets.view'])

    const { findByTestId, queryByTestId } = render(
      <InjectionSpot spotId={SPOT_ID} context={{}} />,
    )

    await findByTestId('visible-widget')
    expect(queryByTestId('hidden-widget')).toBeNull()
    expect(onLoadVisibleMock).toHaveBeenCalledTimes(1)
    expect(onLoadHiddenMock).not.toHaveBeenCalled()
  })

  it('filters component widget overrides by metadata features', () => {
    const hiddenWidget = visualWidget('hidden-override-widget', ['widgets.manage'], onLoadHiddenMock)
    setGrantedFeatures(['widgets.view'])

    const { queryByTestId } = render(
      <InjectionSpot
        spotId={SPOT_ID}
        context={{}}
        widgetsOverride={[loadedSpotWidget(hiddenWidget)]}
      />,
    )

    expect(queryByTestId('hidden-override-widget')).toBeNull()
  })

  it('filters headless data widgets by metadata features', async () => {
    loadInjectionDataWidgetsForSpotMock.mockResolvedValueOnce([
      dataWidget('always-visible'),
      dataWidget('visible-data-widget', ['widgets.view']),
      dataWidget('hidden-data-widget', ['widgets.manage']),
    ])
    setGrantedFeatures(['widgets.view'])

    const { result } = renderHook(() => useInjectionDataWidgets(SPOT_ID))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.widgets.map((widget) => widget.metadata.id)).toEqual([
      'always-visible',
      'visible-data-widget',
    ])
  })

  it('does not reload raw lifecycle widgets when the prefetched feature-filtered list is empty', async () => {
    const onBeforeSaveHiddenMock = jest.fn()
    loadInjectionWidgetsForSpotMock.mockResolvedValueOnce([
      lifecycleWidget('hidden-lifecycle-widget', ['widgets.manage'], onBeforeSaveHiddenMock),
    ])
    setGrantedFeatures(['widgets.view'])

    const { result } = renderHook(() =>
      useInjectionSpotEvents<Record<string, unknown>, Record<string, unknown>>(SPOT_ID, [])
    )

    await act(async () => {
      await Promise.resolve()
    })
    expect(loadInjectionWidgetsForSpotMock).not.toHaveBeenCalled()

    const beforeSaveResult = await result.current.triggerEvent('onBeforeSave', {}, {})

    expect(beforeSaveResult).toEqual({ ok: true })
    expect(onBeforeSaveHiddenMock).not.toHaveBeenCalled()
  })

  it('does not execute prefetched lifecycle widgets while backend chrome is loading', async () => {
    const onBeforeSaveHiddenMock = jest.fn()
    const hiddenWidget = lifecycleWidget('hidden-loading-widget', ['widgets.manage'], onBeforeSaveHiddenMock)
    setBackendChromeLoading()

    const { result } = renderHook(() =>
      useInjectionSpotEvents<Record<string, unknown>, Record<string, unknown>>(
        SPOT_ID,
        [loadedSpotWidget(hiddenWidget)],
      )
    )

    await act(async () => {
      await Promise.resolve()
    })

    const beforeSaveResult = await result.current.triggerEvent('onBeforeSave', {}, {})

    expect(beforeSaveResult).toEqual({ ok: true })
    expect(onBeforeSaveHiddenMock).not.toHaveBeenCalled()
  })

  it('filters lifecycle widgets loaded directly by metadata features', async () => {
    const onBeforeSaveHiddenMock = jest.fn()
    let resolveWidgets: (widgets: LoadedInjectionWidget[]) => void = () => {}
    const loadedWidgets = new Promise<LoadedInjectionWidget[]>((resolve) => {
      resolveWidgets = resolve
    })
    loadInjectionWidgetsForSpotMock.mockReturnValueOnce(loadedWidgets)
    setGrantedFeatures(['widgets.view'])

    const { result } = renderHook(() =>
      useInjectionSpotEvents<Record<string, unknown>, Record<string, unknown>>(SPOT_ID)
    )

    await act(async () => {
      resolveWidgets([
        lifecycleWidget('hidden-lifecycle-widget', ['widgets.manage'], onBeforeSaveHiddenMock),
      ])
      await loadedWidgets
    })
    await waitFor(() => expect(loadInjectionWidgetsForSpotMock).toHaveBeenCalledTimes(1))

    const beforeSaveResult = await result.current.triggerEvent('onBeforeSave', {}, {})

    expect(beforeSaveResult).toEqual({ ok: true })
    expect(onBeforeSaveHiddenMock).not.toHaveBeenCalled()
    expect(result.current.widgets).toEqual([])
  })
})
