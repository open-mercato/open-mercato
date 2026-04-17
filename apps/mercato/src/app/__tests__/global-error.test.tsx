/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

jest.mock('../global-error-reload', () => ({
  reloadPage: jest.fn(),
}))

import GlobalError, { isNetworkError } from '../global-error'
import { reloadPage } from '../global-error-reload'

const reloadMock = reloadPage as jest.MockedFunction<typeof reloadPage>

describe('isNetworkError', () => {
  it('returns false for nullish input', () => {
    expect(isNetworkError(null)).toBe(false)
    expect(isNetworkError(undefined)).toBe(false)
  })

  it('detects ChunkLoadError by name', () => {
    const err = Object.assign(new Error('whatever'), { name: 'ChunkLoadError' })
    expect(isNetworkError(err)).toBe(true)
  })

  it('detects "Loading chunk" messages', () => {
    expect(isNetworkError(new Error('Loading chunk 42 failed'))).toBe(true)
    expect(isNetworkError(new Error('Loading CSS chunk 7 failed'))).toBe(true)
  })

  it('detects fetch/network failures', () => {
    expect(isNetworkError(new Error('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new Error('NetworkError when attempting to fetch resource'))).toBe(true)
    expect(isNetworkError(new Error('Network request failed'))).toBe(true)
  })

  it('detects browser network error codes', () => {
    expect(isNetworkError({ code: 'ERR_INTERNET_DISCONNECTED' })).toBe(true)
    expect(isNetworkError({ message: 'net::ERR_NETWORK_CHANGED' })).toBe(true)
  })

  it('returns false for unrelated application errors', () => {
    expect(isNetworkError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isNetworkError(new Error('Validation failed'))).toBe(false)
  })
})

describe('GlobalError component', () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, 'onLine')

  function setOnLine(value: boolean) {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => value,
    })
  }

  beforeEach(() => {
    reloadMock.mockClear()
  })

  afterEach(() => {
    if (originalOnLine) {
      Object.defineProperty(window.navigator, 'onLine', originalOnLine)
    }
  })

  it('renders generic crash UI for non-network errors', () => {
    setOnLine(true)
    const reset = jest.fn()
    const err = Object.assign(new Error('boom'), { name: 'TypeError' })
    render(<GlobalError error={err} reset={reset} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Something went wrong')
    expect(screen.getByText(/unexpected error occurred/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(reset).toHaveBeenCalledTimes(1)
    expect(reloadMock).not.toHaveBeenCalled()
  })

  it('renders offline UI for ChunkLoadError even when navigator reports online', () => {
    setOnLine(true)
    const reset = jest.fn()
    const err = Object.assign(new Error('Loading chunk 3 failed'), { name: 'ChunkLoadError' })
    render(<GlobalError error={err} reset={reset} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/offline/i)
    expect(screen.getByText(/check your internet connection/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry now/i })).toBeInTheDocument()
  })

  it('renders offline UI when navigator reports offline, even without a network-typed error', () => {
    setOnLine(false)
    const reset = jest.fn()
    render(<GlobalError error={new Error('boom')} reset={reset} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/offline/i)
  })

  it('retry button reloads the page in offline mode and does not call reset', () => {
    setOnLine(true)
    const reset = jest.fn()
    const err = Object.assign(new Error('Failed to fetch'), { name: 'TypeError' })
    render(<GlobalError error={err} reset={reset} />)
    fireEvent.click(screen.getByRole('button', { name: /retry now/i }))
    expect(reloadMock).toHaveBeenCalledTimes(1)
    expect(reset).not.toHaveBeenCalled()
  })

  it('auto-reloads the page when the browser regains connectivity after a network error', () => {
    setOnLine(false)
    const reset = jest.fn()
    const err = Object.assign(new Error('Loading chunk 3 failed'), { name: 'ChunkLoadError' })
    render(<GlobalError error={err} reset={reset} />)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(reloadMock).toHaveBeenCalledTimes(1)
  })

  it('does not auto-reload on "online" event when the original error was not a network error', () => {
    setOnLine(false)
    const reset = jest.fn()
    const err = Object.assign(new Error('application crashed'), { name: 'TypeError' })
    render(<GlobalError error={err} reset={reset} />)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(reloadMock).not.toHaveBeenCalled()
  })
})
