import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import {
  AccessibilityProvider,
  __resetAccessibilityStoreForTests,
} from '../AccessibilityProvider'
import {
  ACCESSIBILITY_PREFERENCES_CHANGED_EVENT,
  applyAccessibilityPreferences,
} from '../accessibility'

const mockReadApiResultOrThrow = jest.fn()

jest.mock('../utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
}))

describe('AccessibilityProvider', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    document.documentElement.className = ''
    document.documentElement.removeAttribute('style')
    mockReadApiResultOrThrow.mockReset()
    __resetAccessibilityStoreForTests()
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
    }) as unknown as typeof window.matchMedia
  })

  afterAll(() => {
    window.matchMedia = originalMatchMedia
  })

  it('hydrates html classes and variables from the profile response', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({
      accessibilityPreferences: {
        highContrast: true,
        fontSize: 'xl',
        reducedMotion: true,
      },
    })

    render(<AccessibilityProvider />)

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.25')
    })
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true)
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true)
  })

  it('keeps defaults when the profile request fails', async () => {
    mockReadApiResultOrThrow.mockRejectedValue(new Error('Unauthorized'))

    render(<AccessibilityProvider />)

    await waitFor(() => {
      expect(mockReadApiResultOrThrow).toHaveBeenCalled()
    })
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false)
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('')
  })

  it('retries the profile request in the same session after a failed initial load', async () => {
    mockReadApiResultOrThrow
      .mockRejectedValueOnce(new Error('Unauthorized'))
      .mockResolvedValueOnce({
        accessibilityPreferences: {
          highContrast: true,
          fontSize: 'lg',
          reducedMotion: false,
        },
      })

    const { unmount } = render(<AccessibilityProvider />)

    await waitFor(() => {
      expect(mockReadApiResultOrThrow).toHaveBeenCalledTimes(1)
    })
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false)

    unmount()

    render(<AccessibilityProvider />)

    await waitFor(() => {
      expect(mockReadApiResultOrThrow).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(document.documentElement.classList.contains('high-contrast')).toBe(true)
    })
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.125')
  })

  it('reacts to the accessibility preferences event without reload', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({
      accessibilityPreferences: null,
    })

    render(<AccessibilityProvider />)

    await waitFor(() => {
      expect(mockReadApiResultOrThrow).toHaveBeenCalled()
    })

    window.dispatchEvent(new CustomEvent(ACCESSIBILITY_PREFERENCES_CHANGED_EVENT, {
      detail: {
        highContrast: true,
        fontSize: 'lg',
        reducedMotion: false,
      },
    }))

    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.125')
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true)
  })

  it('applies reduced motion when the system preference requires it', () => {
    applyAccessibilityPreferences(null, {
      root: document.documentElement,
      systemReducedMotion: true,
    })

    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1')
  })
})
