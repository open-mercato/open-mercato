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
let portalContextValue: { auth: { resolvedFeatures: string[]; loading: boolean } } | null = null

jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  getInjectionRegistryError: () => null,
  isInjectionRegistryReady: () => true,
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

jest.mock('../../../portal/PortalContext', () => ({
  useOptionalPortalContext: () => portalContextValue,
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

// Mirrors `useBackendChrome()`'s default outside a `BackendChromeProvider` — e.g. every
// customer-portal page, which never mounts one. `isReady` is hardcoded `true` there, unlike
// the "still loading" case above where `isReady` is `false`.
function setNoBackendChromeProvider() {
  backendChromePayload = null
  backendChromeReady = true
}

function setPortalSession(resolvedFeatures: string[], loading = false) {
  setNoBackendChromeProvider()
  portalContextValue = { auth: { resolvedFeatures, loading } }
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
    portalContextValue = null
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

  it('dispatches a newly prefetched lifecycle widget in the same layout commit', async () => {
    const onBeforeSaveMock = jest.fn()
    const prefetchedWidget = loadedSpotWidget(
      lifecycleWidget('visible-lifecycle-widget', undefined, onBeforeSaveMock),
    )
    let layoutDispatches = 0

    function Harness({ prefetched }: { prefetched: LoadedInjectionSpotWidget[] }) {
      const { triggerEvent } = useInjectionSpotEvents<Record<string, unknown>, Record<string, unknown>>(
        SPOT_ID,
        prefetched,
      )
      React.useLayoutEffect(() => {
        layoutDispatches += 1
        void triggerEvent('onBeforeSave', {}, {})
      }, [prefetched, triggerEvent])
      return null
    }

    const rendered = render(<Harness prefetched={[]} />)
    rendered.rerender(<Harness prefetched={[prefetchedWidget]} />)

    await waitFor(() => expect(onBeforeSaveMock).toHaveBeenCalledTimes(1))
    expect(layoutDispatches).toBe(2)
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

  it('excludes feature-gated lifecycle widgets outside a BackendChromeProvider (e.g. the portal), but still runs unguarded ones', async () => {
    const onBeforeSaveStaffOnlyMock = jest.fn()
    const onBeforeSaveUnguardedMock = jest.fn()
    setNoBackendChromeProvider()
    // Hoisted outside the hook callback so re-renders see stable widget/module identities —
    // constructing these inline would hand `useInjectionSpotEvents` a new `prefetchedWidgets`
    // array (and new widget objects) on every render, defeating its reference-equality bailout
    // and causing an infinite re-render loop.
    const prefetched = [
      loadedSpotWidget(lifecycleWidget('staff-only-lifecycle-widget', ['record_locks.view'], onBeforeSaveStaffOnlyMock)),
      loadedSpotWidget(lifecycleWidget('unguarded-lifecycle-widget', undefined, onBeforeSaveUnguardedMock)),
    ]

    const { result } = renderHook(() =>
      useInjectionSpotEvents<Record<string, unknown>, Record<string, unknown>>(SPOT_ID, prefetched)
    )

    await act(async () => {
      await Promise.resolve()
    })

    await result.current.triggerEvent('onBeforeSave', {}, {})

    expect(onBeforeSaveStaffOnlyMock).not.toHaveBeenCalled()
    expect(onBeforeSaveUnguardedMock).toHaveBeenCalledTimes(1)
  })

  it('excludes feature-gated data widgets outside a BackendChromeProvider, but keeps unguarded ones', async () => {
    loadInjectionDataWidgetsForSpotMock.mockResolvedValueOnce([
      dataWidget('always-visible'),
      dataWidget('staff-only-data-widget', ['record_locks.view']),
    ])
    setNoBackendChromeProvider()

    const { result } = renderHook(() => useInjectionDataWidgets(SPOT_ID))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.widgets.map((widget) => widget.metadata.id)).toEqual(['always-visible'])
  })

  it('renders portal-feature-gated component widgets for a portal session holding the grant, but never staff-gated ones', async () => {
    loadInjectionWidgetsForSpotMock.mockResolvedValueOnce([
      visualWidget('portal-granted-widget', ['portal.account.manage'], onLoadVisibleMock),
      visualWidget('staff-only-widget', ['record_locks.view'], onLoadHiddenMock),
    ])
    setPortalSession(['portal.account.manage'])

    const { findByTestId, queryByTestId } = render(
      <InjectionSpot spotId={SPOT_ID} context={{}} />,
    )

    await findByTestId('portal-granted-widget')
    expect(queryByTestId('staff-only-widget')).toBeNull()
    expect(onLoadVisibleMock).toHaveBeenCalledTimes(1)
    expect(onLoadHiddenMock).not.toHaveBeenCalled()
  })

  it('excludes portal-feature-gated component widgets for a portal session without the grant', async () => {
    loadInjectionWidgetsForSpotMock.mockResolvedValueOnce([
      visualWidget('unguarded-widget', undefined, onLoadVisibleMock),
      visualWidget('portal-gated-widget', ['portal.account.manage'], onLoadHiddenMock),
    ])
    setPortalSession(['portal.orders.view'])

    const { findByTestId, queryByTestId } = render(
      <InjectionSpot spotId={SPOT_ID} context={{}} />,
    )

    await findByTestId('unguarded-widget')
    expect(queryByTestId('portal-gated-widget')).toBeNull()
    expect(onLoadHiddenMock).not.toHaveBeenCalled()
  })

  it('honours portal wildcard grants but never lets a bare "*" portal grant satisfy a staff feature', async () => {
    loadInjectionDataWidgetsForSpotMock.mockResolvedValueOnce([
      dataWidget('portal-wildcard-data-widget', ['portal.account.manage']),
      dataWidget('staff-only-data-widget', ['record_locks.view']),
    ])
    setPortalSession(['portal.*', '*'])

    const { result } = renderHook(() => useInjectionDataWidgets(SPOT_ID))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.widgets.map((widget) => widget.metadata.id)).toEqual(['portal-wildcard-data-widget'])
  })

  it('excludes staff-gated lifecycle widgets inside a portal session', async () => {
    const onBeforeSaveStaffOnlyMock = jest.fn()
    const onBeforeSavePortalMock = jest.fn()
    setPortalSession(['portal.account.manage'])
    const prefetched = [
      loadedSpotWidget(lifecycleWidget('staff-only-lifecycle-widget', ['record_locks.view'], onBeforeSaveStaffOnlyMock)),
      loadedSpotWidget(lifecycleWidget('portal-lifecycle-widget', ['portal.account.manage'], onBeforeSavePortalMock)),
    ]

    const { result } = renderHook(() =>
      useInjectionSpotEvents<Record<string, unknown>, Record<string, unknown>>(SPOT_ID, prefetched)
    )

    await act(async () => {
      await Promise.resolve()
    })

    await result.current.triggerEvent('onBeforeSave', {}, {})

    expect(onBeforeSaveStaffOnlyMock).not.toHaveBeenCalled()
    expect(onBeforeSavePortalMock).toHaveBeenCalledTimes(1)
  })

  it('holds portal-gated data widgets while the portal session is still loading', async () => {
    loadInjectionDataWidgetsForSpotMock.mockResolvedValue([dataWidget('portal-data-widget', ['portal.account.manage'])])
    setPortalSession([], true)

    const { result, rerender } = renderHook(() => useInjectionDataWidgets(SPOT_ID))

    expect(result.current.isLoading).toBe(true)
    expect(loadInjectionDataWidgetsForSpotMock).not.toHaveBeenCalled()

    setPortalSession(['portal.account.manage'])
    rerender()

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.widgets.map((widget) => widget.metadata.id)).toEqual(['portal-data-widget'])
  })
})


it('preserves rendered widget modules and typed custom-context participants in the public event hook', async () => {
  setGrantedFeatures([])
  const Widget = () => <div>Full widget</div>
  const prefetched = [{ widgetId: 'typed', moduleId: 'test', key: 'typed', module: {
    metadata: { id: 'typed' }, Widget,
    eventHandlers: { onLoad: (context: { customerId: string }) => { expect(context.customerId).toBe('customer-1') } },
  } }]
  const custom = renderHook(() => useInjectionSpotEvents('typed', prefetched, { context: { customerId: 'customer-1' }, triggerOnLoad: true }))
  expect(custom.result.current.widgets[0].module.Widget).toBe(Widget)
  const fullWidgets: LoadedInjectionSpotWidget[] = custom.result.current.widgets
  expect(fullWidgets).toHaveLength(1)
  const loaded = visualWidget('loaded', undefined, jest.fn())
  loadInjectionWidgetsForSpotMock.mockResolvedValue([loaded])
  const discovered = renderHook(() => useInjectionSpotEvents('discovered'))
  await waitFor(() => expect(discovered.result.current.widgets[0].module.Widget).toBe(loaded.Widget))
})
