import '@testing-library/jest-dom'

// Mock window.location.reload globally for all tests
if (typeof window !== 'undefined' && window.location) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window.location as any).reload
  } catch (e) {
    // Ignore if property can't be deleted
  }

  try {
    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    })
  } catch (e) {
    // If we still can't define it, try direct assignment
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.location as any).reload = jest.fn()
    } catch (innerError) {
      // If all else fails, silently ignore - window.location.reload is completely locked
    }
  }
}
