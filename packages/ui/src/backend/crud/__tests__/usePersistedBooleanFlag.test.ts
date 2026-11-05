/** @jest-environment jsdom */
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { usePersistedBooleanFlag } from '../usePersistedBooleanFlag'

describe('usePersistedBooleanFlag', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns the default value when storage is empty', () => {
    const { result } = renderHook(() => usePersistedBooleanFlag('test:a', true))
    expect(result.current.value).toBe(true)
  })

  it('hydrates from localStorage on mount when a value is saved', () => {
    localStorage.setItem('test:b', JSON.stringify('1'))
    const { result } = renderHook(() => usePersistedBooleanFlag('test:b', false))
    expect(result.current.value).toBe(true)
  })

  it('hydrates "0" as false regardless of default', () => {
    localStorage.setItem('test:c', JSON.stringify('0'))
    const { result } = renderHook(() => usePersistedBooleanFlag('test:c', true))
    expect(result.current.value).toBe(false)
  })

  it('persists toggled value to localStorage', () => {
    const { result } = renderHook(() => usePersistedBooleanFlag('test:d', false))
    act(() => { result.current.toggle() })
    expect(result.current.value).toBe(true)
    expect(localStorage.getItem('test:d')).toBe(JSON.stringify('1'))
  })

  it('persists setValue writes', () => {
    const { result } = renderHook(() => usePersistedBooleanFlag('test:e', false))
    act(() => { result.current.setValue(true) })
    expect(localStorage.getItem('test:e')).toBe(JSON.stringify('1'))
    act(() => { result.current.setValue(false) })
    expect(localStorage.getItem('test:e')).toBe(JSON.stringify('0'))
  })

  it('supports the functional setValue(prev => next) form', () => {
    localStorage.setItem('test:functional', JSON.stringify('1'))
    const { result } = renderHook(() => usePersistedBooleanFlag('test:functional', false))
    act(() => { result.current.setValue((prev) => !prev) })
    expect(result.current.value).toBe(false)
    expect(localStorage.getItem('test:functional')).toBe(JSON.stringify('0'))
  })

  it('does NOT write the default value to storage when nothing was touched', () => {
    renderHook(() => usePersistedBooleanFlag('test:no-write-on-mount', true))
    expect(localStorage.getItem('test:no-write-on-mount')).toBeNull()
  })

  it('reflects stored value on the very first render (no useEffect flicker)', () => {
    localStorage.setItem('test:first-render', JSON.stringify('1'))

    const captured: boolean[] = []
    function Probe() {
      const { value } = usePersistedBooleanFlag('test:first-render', false)
      captured.push(value)
      return null
    }
    render(React.createElement(Probe))

    expect(captured.length).toBeGreaterThanOrEqual(1)
    expect(captured[0]).toBe(true)
    expect(captured.every((v) => v === true)).toBe(true)
  })

  it('keeps SSR markup hidden until the client storage snapshot is known', async () => {
    const storageKey = 'test:ssr-hidden'
    function Probe() {
      const { value, isHydrated } = usePersistedBooleanFlag(storageKey, false)
      return React.createElement(
        'div',
        {
          className: isHydrated ? 'ready' : 'invisible',
          'data-ready': isHydrated ? 'true' : 'false',
          'data-testid': 'probe',
        },
        value ? 'stored' : 'default',
      )
    }

    const html = renderToString(React.createElement(Probe))
    expect(html).toContain('data-ready="false"')
    expect(html).toContain('invisible')

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    localStorage.setItem(storageKey, JSON.stringify('1'))

    let root: ReturnType<typeof hydrateRoot> | null = null
    await act(async () => {
      root = hydrateRoot(container, React.createElement(Probe))
    })

    await waitFor(() => {
      const probe = container.querySelector('[data-testid="probe"]')
      expect(probe?.getAttribute('data-ready')).toBe('true')
      expect(probe?.className).not.toContain('invisible')
      expect(probe?.textContent).toBe('stored')
    })

    await act(async () => {
      root?.unmount()
    })
    container.remove()
  })

  it('re-renders when another instance writes the same key (same-tab sync)', () => {
    const { result: a } = renderHook(() => usePersistedBooleanFlag('test:sync', false))
    const { result: b } = renderHook(() => usePersistedBooleanFlag('test:sync', false))
    expect(a.current.value).toBe(false)
    expect(b.current.value).toBe(false)
    act(() => { a.current.setValue(true) })
    expect(a.current.value).toBe(true)
    expect(b.current.value).toBe(true)
  })
})
