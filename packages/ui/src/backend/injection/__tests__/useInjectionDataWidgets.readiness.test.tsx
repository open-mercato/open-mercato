/** @jest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  registerCoreInjectionWidgets,
  registerCoreInjectionTables,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import type { InjectionDataWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { useInjectionDataWidgets } from '../useInjectionDataWidgets'

const COLUMN_SPOT = 'data-table:registry.payments:columns'

describe('data widget registry readiness', () => {
  beforeEach(() => {
    registerCoreInjectionWidgets([])
    registerCoreInjectionTables([])
  })

  it('finishes loading when the registered widget and table registries are empty', async () => {
    const { result } = renderHook(() => useInjectionDataWidgets(COLUMN_SPOT))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.widgets).toEqual([])
  })

  it('finishes loading when a registered widget module fails to load', async () => {
    const loadWidget = jest.fn(async () => { throw new Error('[internal] Widget module failed to load') })
    registerCoreInjectionWidgets([{
      key: 'example:failed-column',
      moduleId: 'example',
      source: 'app',
      widgetId: 'example.failed-column',
      loader: loadWidget,
    }])
    registerCoreInjectionTables([{
      moduleId: 'example',
      table: { [COLUMN_SPOT]: ['example.failed-column'] },
    }])
    const { result } = renderHook(() => useInjectionDataWidgets(COLUMN_SPOT))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(loadWidget).toHaveBeenCalled()
    expect(result.current.widgets).toEqual([])
  })

  it('does not load disabled spots even when a wildcard contributor would match', async () => {
    const loadWidget = jest.fn(async (): Promise<InjectionDataWidgetModule> => ({
      metadata: { id: 'example.wildcard-column' },
      columns: [],
    }))
    registerCoreInjectionWidgets([{
      key: 'example:wildcard-column',
      moduleId: 'example',
      source: 'app',
      widgetId: 'example.wildcard-column',
      loader: loadWidget,
    }])
    registerCoreInjectionTables([{ moduleId: 'example', table: { '*': ['example.wildcard-column'] } }])
    const { result } = renderHook(() => useInjectionDataWidgets('__disabled__:columns'))

    await act(async () => { await Promise.resolve() })
    expect(result.current).toEqual({ widgets: [], isLoading: false, error: null })
    expect(loadWidget).not.toHaveBeenCalled()
  })
})
