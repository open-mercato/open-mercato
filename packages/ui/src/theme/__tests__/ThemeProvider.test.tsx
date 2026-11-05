import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { ThemeProvider, useTheme } from '../ThemeProvider'
import { THEME_STORAGE_KEY } from '../theme-init-script'

function mockSystemTheme(prefersDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-color-scheme: dark') ? prefersDark : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
}

let mountCount = 0

function MountCounter() {
  React.useEffect(() => {
    mountCount += 1
  }, [])
  return <div data-testid="child" />
}

function ThemeReadout() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button type="button" onClick={() => setTheme('dark')}>
        go dark
      </button>
    </div>
  )
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    mountCount = 0
    document.documentElement.classList.remove('dark')
    window.localStorage.clear()
    mockSystemTheme(false)
  })

  it('does not remount its subtree when the theme initializes', () => {
    render(
      <ThemeProvider>
        <MountCounter />
      </ThemeProvider>,
    )

    expect(screen.getByTestId('child')).toBeTruthy()
    // A `mounted` gate that swapped a Fragment for the context Provider used to
    // tear this subtree down and rebuild it, losing every child's state.
    expect(mountCount).toBe(1)
  })

  it('keeps children mounted across a theme change', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    render(
      <ThemeProvider>
        <MountCounter />
        <ThemeReadout />
      </ThemeProvider>,
    )

    act(() => {
      screen.getByRole('button', { name: 'go dark' }).click()
    })

    expect(screen.getByTestId('theme').textContent).toBe('dark')
    expect(mountCount).toBe(1)
  })

  it('exposes the stored theme to consumers after initialization', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')

    render(
      <ThemeProvider>
        <ThemeReadout />
      </ThemeProvider>,
    )

    expect(screen.getByTestId('theme').textContent).toBe('dark')
    expect(screen.getByTestId('resolved').textContent).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('resolves the system preference when nothing is stored', () => {
    mockSystemTheme(true)

    render(
      <ThemeProvider>
        <ThemeReadout />
      </ThemeProvider>,
    )

    expect(screen.getByTestId('theme').textContent).toBe('system')
    expect(screen.getByTestId('resolved').textContent).toBe('dark')
  })
})
