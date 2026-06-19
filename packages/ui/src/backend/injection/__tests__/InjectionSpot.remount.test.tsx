/** @jest-environment jsdom */

import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'

const mockState: { registryVersion: number; listener: null | (() => void) } = {
  registryVersion: 0,
  listener: null,
}
const mockLoadSpy = jest.fn()

jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => mockState.registryVersion,
  subscribeToInjectionRegistryChanges: (listener: () => void) => {
    mockState.listener = listener
    return () => {
      mockState.listener = null
    }
  },
  loadInjectionWidgetsForSpot: (...args: unknown[]) => mockLoadSpy(...args),
}))

jest.mock('../WidgetSharedState', () => ({
  getWidgetSharedState: () => ({}),
}))

import { InjectionSpot } from '../InjectionSpot'

const SPOT_ID = 'data-table:test.products:toolbar'
const widgetMountSpy = jest.fn()
const onLoadSpy = jest.fn()

function makeWidget(id: string) {
  return {
    metadata: { id },
    moduleId: 'test_module',
    key: id,
    placement: undefined,
    eventHandlers: { onLoad: onLoadSpy },
    Widget: ({ context }: { context: unknown }) => {
      React.useEffect(() => {
        widgetMountSpy()
      }, [])
      const label = (context as { label?: string } | null)?.label ?? ''
      return <div data-testid="injected-widget">{label}</div>
    },
  }
}

function Harness({ tick, onEvent }: { tick: number; onEvent?: (event: 'onLoad', id: string) => void }) {
  // Fresh context identity on every render — mirrors hosts that feed a useMemo/closure
  // context whose identity changes on routine interactions (e.g. row-selection toggles).
  const context = { label: 'ctx', tick }
  return <InjectionSpot spotId={SPOT_ID} context={context} onEvent={onEvent} />
}

describe('InjectionSpot — context identity changes do not remount injected widgets', () => {
  beforeEach(() => {
    mockState.registryVersion = 0
    mockState.listener = null
    mockLoadSpy.mockReset()
    mockLoadSpy.mockResolvedValue([makeWidget('test_module:hello')])
    widgetMountSpy.mockClear()
    onLoadSpy.mockClear()
  })

  it('renders the injected widget and loads the spot exactly once', async () => {
    const { findByTestId } = render(<Harness tick={0} />)
    await findByTestId('injected-widget')
    expect(mockLoadSpy).toHaveBeenCalledTimes(1)
    expect(widgetMountSpy).toHaveBeenCalledTimes(1)
    expect(onLoadSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT reload or remount when only the context identity changes', async () => {
    const { rerender, findByTestId } = render(<Harness tick={0} />)
    await findByTestId('injected-widget')
    expect(mockLoadSpy).toHaveBeenCalledTimes(1)
    expect(widgetMountSpy).toHaveBeenCalledTimes(1)

    for (let next = 1; next <= 3; next += 1) {
      rerender(<Harness tick={next} />)
      // flush effects for this render
      await act(async () => {})
    }

    expect(mockLoadSpy).toHaveBeenCalledTimes(1)
    expect(widgetMountSpy).toHaveBeenCalledTimes(1)
    expect(onLoadSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT reload when a fresh onEvent closure is passed on every render', async () => {
    const { rerender, findByTestId } = render(<Harness tick={0} onEvent={() => {}} />)
    await findByTestId('injected-widget')
    expect(mockLoadSpy).toHaveBeenCalledTimes(1)

    rerender(<Harness tick={1} onEvent={() => {}} />)
    await act(async () => {})

    expect(mockLoadSpy).toHaveBeenCalledTimes(1)
    expect(widgetMountSpy).toHaveBeenCalledTimes(1)
  })

  it('DOES reload when the injection registry version actually bumps', async () => {
    const { findByTestId } = render(<Harness tick={0} />)
    await findByTestId('injected-widget')
    expect(mockLoadSpy).toHaveBeenCalledTimes(1)

    await act(async () => {
      mockState.registryVersion += 1
      mockState.listener?.()
    })

    await waitFor(() => expect(mockLoadSpy).toHaveBeenCalledTimes(2))
  })

  it('keeps the previously-rendered widget mounted during a registry reload', async () => {
    const { findByTestId } = render(<Harness tick={0} />)
    await findByTestId('injected-widget')

    let resolveReload: (value: ReturnType<typeof makeWidget>[]) => void = () => {}
    mockLoadSpy.mockImplementationOnce(
      () => new Promise((resolve) => { resolveReload = resolve }),
    )

    await act(async () => {
      mockState.registryVersion += 1
      mockState.listener?.()
    })

    // Reload is in-flight (loading === true) but the existing widget stays mounted.
    expect(await findByTestId('injected-widget')).toBeTruthy()

    await act(async () => {
      resolveReload([makeWidget('test_module:hello')])
    })

    await findByTestId('injected-widget')
  })
})
