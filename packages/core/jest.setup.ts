import '@testing-library/jest-dom'

// Web Streams polyfill for jsdom — `eventsource-parser/stream` (loaded
// transitively through `ai` -> `@ai-sdk/*` whenever a test file imports
// `@open-mercato/ui/ai/useAiChat` or any UI component that touches it)
// references TransformStream/ReadableStream/WritableStream at module
// load time. jsdom doesn't ship those globals, so the import throws
// before the test body runs. Pull them from `node:stream/web` (Node 18+).
import { ReadableStream, WritableStream, TransformStream } from 'node:stream/web'

if (typeof globalThis.TransformStream === 'undefined') {
  ;(globalThis as any).TransformStream = TransformStream
}
if (typeof globalThis.ReadableStream === 'undefined') {
  ;(globalThis as any).ReadableStream = ReadableStream
}
if (typeof globalThis.WritableStream === 'undefined') {
  ;(globalThis as any).WritableStream = WritableStream
}

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: unknown }) => children ?? null,
}))

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

  clone() {
    const cloned = new MockResponse(this.body, { status: this.status })
    cloned.headers = new Map(this.headers)
    return cloned
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
