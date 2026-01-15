import '@testing-library/jest-dom'

// Mock Response/Request/Headers for tests that need them in jsdom environment
class MockResponse {
  body: string
  status: number
  ok: boolean
  headers: Map<string, string>

  constructor(body: string = '', init: { status?: number; headers?: Record<string, string> } = {}) {
    this.body = body
    this.status = init.status ?? 200
    this.ok = this.status >= 200 && this.status < 300
    this.headers = new Map(Object.entries(init.headers ?? {}))
  }

  async json() {
    return JSON.parse(this.body)
  }

  async text() {
    return this.body
  }
}

if (typeof globalThis.Response === 'undefined') {
  (globalThis as any).Response = MockResponse
}

// Mock window.location.reload globally for all tests
if (typeof window !== 'undefined' && window.location) {
  try {
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
    try {
      (window.location as any).reload = jest.fn()
    } catch (innerError) {
      // If all else fails, silently ignore
    }
  }
}
