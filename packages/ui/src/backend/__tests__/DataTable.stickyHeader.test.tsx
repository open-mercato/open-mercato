/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '../DataTable'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

let mockInjectedColumnsLoading = false

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: (spotId: string) => ({
    widgets: [],
    isLoading: mockInjectedColumnsLoading && spotId.endsWith(':columns'),
  }),
}))

const columns = [{ accessorKey: 'title', header: 'Title' }]
const data = [{ id: '1', title: 'First record' }]

function renderTable({ embedded = false, virtualized = false, nested = false } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        <div data-testid="scroll-parent" style={nested ? { overflowY: 'auto' } : undefined}>
          <DataTable columns={columns} data={data} embedded={embedded} virtualized={virtualized} />
        </div>
      </I18nProvider>
    </QueryClientProvider>,
  )
  const header = result.container.querySelector('thead')!
  const wrapper = result.container.querySelector('table')!.parentElement!
  const scrollParent = result.getByTestId('scroll-parent')
  return { ...result, header, wrapper, scrollParent, queryClient }
}

function setTop(element: HTMLElement, top: number) {
  jest.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top, bottom: top + 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: top,
    toJSON: () => ({}),
  })
}

function scroll(element: Window | HTMLElement = window) {
  act(() => {
    fireEvent.scroll(element)
    jest.advanceTimersByTime(20)
  })
}

describe('DataTable sticky column header', () => {
  const nativeGetComputedStyle = window.getComputedStyle

  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = nativeGetComputedStyle(element)
      if (element.classList.contains('overflow-auto')) style.overflowY = 'auto'
      style.setProperty('--topbar-height', '61px')
      return style
    })
  })

  afterEach(() => {
    mockInjectedColumnsLoading = false
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('keeps one opaque sticky header above pinned body cells in a virtualized viewport', () => {
    const { container, header, wrapper, queryClient } = renderTable({ virtualized: true })
    try {
      expect(container.querySelectorAll('thead')).toHaveLength(1)
      expect(header.className.split(/\s+/)).toEqual(expect.arrayContaining([
        'sticky', 'top-0', 'z-30', 'bg-card', '[&_tr]:bg-muted/40',
      ]))
      expect(wrapper.classList.contains('isolate')).toBe(true)
      expect(wrapper.style.overflow).toBe('auto')
      expect(wrapper.style.maxHeight).not.toBe('')
      setTop(wrapper, 200)
      scroll(wrapper)
      expect(header.style.top).toBe('0px')
    } finally {
      queryClient.clear()
    }
  })

  it('follows page scrolling beneath the app bar without adding a vertical viewport', () => {
    const { header, wrapper, queryClient } = renderTable()
    try {
      expect(wrapper.style.maxHeight).toBe('')
      setTop(wrapper, -240)
      scroll()
      expect(header.style.top).toBe('301px')
      setTop(wrapper, 180)
      scroll()
      expect(header.style.top).toBe('0px')
    } finally {
      queryClient.clear()
    }
  })

  it.each(['data', 'extensions'] as const)('attaches the header offset after initial %s loading finishes', (loadingSource) => {
    mockInjectedColumnsLoading = loadingSource === 'extensions'
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    const tableView = (isLoading: boolean) => (
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="en" dict={{}}>
          <DataTable
            columns={columns}
            data={data}
            isLoading={loadingSource === 'data' && isLoading}
            extensionTableId={loadingSource === 'extensions' ? 'sticky-header.test' : undefined}
          />
        </I18nProvider>
      </QueryClientProvider>
    )
    const view = render(tableView(true))
    try {
      expect(view.container.querySelector('thead')).toBeNull()
      const wrapper = view.container.querySelector('.overflow-auto') as HTMLElement
      setTop(wrapper, -240)
      mockInjectedColumnsLoading = false
      view.rerender(tableView(false))
      const header = view.container.querySelector('thead')!
      expect(view.container.querySelector('table')!.parentElement).toBe(wrapper)
      scroll()
      expect(header.style.top).toBe('301px')
      setTop(wrapper, 180)
      scroll()
      expect(header.style.top).toBe('0px')
    } finally {
      queryClient.clear()
    }
  })

  it('uses viewport coordinates for embedded tables without a scroll ancestor', () => {
    const { header, wrapper, queryClient } = renderTable({ embedded: true })
    try {
      setTop(wrapper, -240)
      scroll()
      expect(header.style.top).toBe('61px')
    } finally {
      queryClient.clear()
    }
  })

  it('uses the actual scroll ancestor for embedded tables in a scrolling panel', () => {
    const { header, wrapper, scrollParent, queryClient } = renderTable({ embedded: true, nested: true })
    try {
      setTop(scrollParent, 120)
      setTop(wrapper, -240)
      scroll(scrollParent)
      expect(header.style.top).toBe('0px')
      setTop(scrollParent, -100)
      scroll()
      expect(header.style.top).toBe('161px')
    } finally {
      queryClient.clear()
    }
  })

  it('compensates for a padded scroll panel before and after page scrolling', () => {
    const { header, scrollParent, queryClient } = renderTable({ embedded: true, nested: true })
    try {
      scrollParent.style.paddingTop = '16px'
      setTop(scrollParent, 120)
      scroll(scrollParent)
      expect(header.style.top).toBe('-16px')
      setTop(scrollParent, -100)
      scroll()
      expect(header.style.top).toBe('145px')
    } finally {
      queryClient.clear()
    }
  })

  it('coalesces scroll events and cancels pending work on unmount', () => {
    const { unmount, header, queryClient } = renderTable()
    const requestFrame = jest.spyOn(window, 'requestAnimationFrame')
    const cancelFrame = jest.spyOn(window, 'cancelAnimationFrame')
    try {
      fireEvent.scroll(window)
      fireEvent.scroll(window)
      expect(requestFrame).toHaveBeenCalledTimes(1)
      unmount()
      expect(cancelFrame).toHaveBeenCalledTimes(1)
      expect(header.style.top).toBe('')
      fireEvent.scroll(window)
      expect(requestFrame).toHaveBeenCalledTimes(1)
    } finally {
      queryClient.clear()
    }
  })
})
