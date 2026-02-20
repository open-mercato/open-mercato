import {
  registerTranslationOverlayPlugin,
  getTranslationOverlayPlugin,
} from '../overlay-plugin'

describe('translation overlay plugin', () => {
  it('returns null functions when no plugin registered', () => {
    // Reset by registering nulls
    registerTranslationOverlayPlugin(null, null)
    const plugin = getTranslationOverlayPlugin()
    expect(plugin.overlay).toBeNull()
    expect(plugin.resolveLocale).toBeNull()
  })

  it('returns registered functions after registration', () => {
    const mockOverlay = jest.fn()
    const mockResolve = jest.fn()
    registerTranslationOverlayPlugin(mockOverlay, mockResolve)
    const plugin = getTranslationOverlayPlugin()
    expect(plugin.overlay).toBe(mockOverlay)
    expect(plugin.resolveLocale).toBe(mockResolve)
  })

  it('overwrites previous registration', () => {
    const first = jest.fn()
    const second = jest.fn()
    registerTranslationOverlayPlugin(first, first)
    registerTranslationOverlayPlugin(second, second)
    const plugin = getTranslationOverlayPlugin()
    expect(plugin.overlay).toBe(second)
    expect(plugin.resolveLocale).toBe(second)
  })
})
