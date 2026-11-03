import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from '../theme-init-script'

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

function runThemeInitScript() {
  new Function(THEME_INIT_SCRIPT)()
}

describe('THEME_INIT_SCRIPT', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
    window.localStorage.clear()
    jest.restoreAllMocks()
  })

  it('applies the dark class when the stored preference is dark', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    mockSystemTheme(false)

    runThemeInitScript()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('keeps the light theme when the stored preference is light, even if the system prefers dark', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    mockSystemTheme(true)

    runThemeInitScript()

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('falls back to the system preference when nothing is stored', () => {
    mockSystemTheme(true)

    runThemeInitScript()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('stays on the light theme when nothing is stored and the system prefers light', () => {
    mockSystemTheme(false)

    runThemeInitScript()

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('degrades gracefully when localStorage is unavailable', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage is blocked')
    })
    mockSystemTheme(true)

    expect(() => runThemeInitScript()).not.toThrow()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
