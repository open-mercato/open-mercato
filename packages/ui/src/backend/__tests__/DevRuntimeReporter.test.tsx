import * as React from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'

import { DevRuntimeReporter } from '../dev/DevRuntimeReporter'
import {
  reportDevRuntimeError,
  resetDevRuntimeReporterForTests,
} from '@open-mercato/shared/lib/dev-runtime/report'
import { DEV_RUNTIME_TOKEN_HEADER, DEV_RUNTIME_TOKEN_META_NAME } from '@open-mercato/shared/lib/dev-runtime/types'

const TOKEN = 'reporter-token-fixture'

function enableCollector(): void {
  const element = document.createElement('meta')
  element.setAttribute('name', DEV_RUNTIME_TOKEN_META_NAME)
  element.setAttribute('content', TOKEN)
  document.head.appendChild(element)
}

function sentReports(fetchMock: jest.Mock): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.map((call) => JSON.parse(String(call[1].body)) as Record<string, unknown>)
}

let fetchMock: jest.Mock

beforeEach(() => {
  document.head.innerHTML = ''
  resetDevRuntimeReporterForTests()
  fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 202 }))
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(cleanup)

describe('reportDevRuntimeError', () => {
  it('stays silent without a collector token', () => {
    reportDevRuntimeError({ kind: 'global-error', error: new Error('boom') })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts a bounded report with the per-run token', () => {
    enableCollector()
    reportDevRuntimeError({ kind: 'global-error', error: Object.assign(new TypeError('boom'), { digest: 'abc123' }) })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/dev-runtime/diagnostics')
    expect(init.method).toBe('POST')
    expect(init.headers[DEV_RUNTIME_TOKEN_HEADER]).toBe(TOKEN)
    expect(sentReports(fetchMock)[0]).toMatchObject({
      kind: 'global-error',
      message: 'TypeError: boom',
      digest: 'abc123',
      path: '/',
    })
  })

  it('bounds an over-long stack', () => {
    enableCollector()
    const error = new Error('boom')
    error.stack = 'y'.repeat(5000)
    reportDevRuntimeError({ kind: 'global-error', error })

    expect(String(sentReports(fetchMock)[0].stack).length).toBeLessThanOrEqual(2000)
  })

  it('reports the same failure only once per page', () => {
    enableCollector()
    const error = new Error('boom')
    reportDevRuntimeError({ kind: 'global-error', error })
    reportDevRuntimeError({ kind: 'global-error', error })
    reportDevRuntimeError({ kind: 'global-error', error })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caps the number of distinct reports per page', () => {
    enableCollector()
    for (let index = 0; index < 30; index += 1) {
      reportDevRuntimeError({ kind: 'window-error', message: `boom ${index}` })
    }
    expect(fetchMock).toHaveBeenCalledTimes(20)
  })

  it('never throws when the collector rejects the request', () => {
    enableCollector()
    fetchMock.mockImplementation(() => { throw new Error('network down') })
    expect(() => reportDevRuntimeError({ kind: 'global-error', message: 'boom' })).not.toThrow()
  })

  it('ignores a report without a usable message', () => {
    enableCollector()
    reportDevRuntimeError({ kind: 'window-error', message: '   ' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('DevRuntimeReporter', () => {
  it('forwards an uncaught window error', async () => {
    enableCollector()
    render(<DevRuntimeReporter />)

    window.dispatchEvent(new ErrorEvent('error', { message: 'TypeError: boom', error: new TypeError('boom') }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sentReports(fetchMock)[0]).toMatchObject({ kind: 'window-error' })
  })

  it('classifies a chunk load failure separately', async () => {
    enableCollector()
    render(<DevRuntimeReporter />)

    window.dispatchEvent(new ErrorEvent('error', { message: 'ChunkLoadError: Loading chunk 42 failed' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sentReports(fetchMock)[0]).toMatchObject({ kind: 'chunk-load-error' })
  })

  it('forwards an unhandled promise rejection', async () => {
    enableCollector()
    render(<DevRuntimeReporter />)

    const event = new Event('unhandledrejection') as Event & { reason?: unknown }
    event.reason = new Error('rejected')
    window.dispatchEvent(event)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sentReports(fetchMock)[0]).toMatchObject({ kind: 'unhandled-rejection', message: 'Error: rejected' })
  })

  it('stops listening after unmount', async () => {
    enableCollector()
    const { unmount } = render(<DevRuntimeReporter />)
    unmount()

    window.dispatchEvent(new ErrorEvent('error', { message: 'TypeError: boom' }))
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled())
  })

  it('renders nothing', () => {
    enableCollector()
    const { container } = render(<DevRuntimeReporter />)
    expect(container.innerHTML).toBe('')
  })
})
