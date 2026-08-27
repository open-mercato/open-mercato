import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DevRuntimeDiagnosticsBanner } from '../dev/DevRuntimeDiagnosticsBanner'
import {
  DEV_RUNTIME_BANNER_META_NAME,
  DEV_RUNTIME_LOGS_URL_META_NAME,
  DEV_RUNTIME_TOKEN_HEADER,
  DEV_RUNTIME_TOKEN_META_NAME,
  type RuntimeIssue,
  type RuntimeStatus,
} from '@open-mercato/shared/lib/dev-runtime/types'

const TOKEN = 'banner-token-fixture'

function setMeta(name: string, content: string): void {
  const element = document.createElement('meta')
  element.setAttribute('name', name)
  element.setAttribute('content', content)
  document.head.appendChild(element)
}

function enableBanner({ logsUrl }: { logsUrl?: string } = {}): void {
  setMeta(DEV_RUNTIME_TOKEN_META_NAME, TOKEN)
  setMeta(DEV_RUNTIME_BANNER_META_NAME, '1')
  if (logsUrl) setMeta(DEV_RUNTIME_LOGS_URL_META_NAME, logsUrl)
}

function createIssue(overrides: Partial<RuntimeIssue> = {}): RuntimeIssue {
  return {
    id: '1-1',
    fingerprint: 'fingerprint-a',
    code: 'db_relation_missing',
    source: 'log',
    severity: 'error',
    title: 'Database schema mismatch',
    detail: 'Relation `sandboxs` is missing',
    firstSeenAt: '2026-08-18T10:00:00.000Z',
    lastSeenAt: '2026-08-18T10:00:05.000Z',
    occurrences: 3,
    generation: 1,
    recovery: 'migrate',
    ...overrides,
  }
}

function createStatus(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  const issue = overrides.issueSummary === undefined ? createIssue() : overrides.issueSummary
  return {
    schemaVersion: 1,
    generation: 1,
    health: 'degraded',
    ready: true,
    failed: false,
    updatedAt: '2026-08-18T10:00:05.000Z',
    upstream: { configuredPort: 3000, publicUrl: 'http://localhost:3000' },
    incidents: issue ? [issue] : [],
    legacy: { failureLines: [] },
    ...overrides,
    issueSummary: issue,
  }
}

let fetchMock: jest.Mock

let actionResponse: Response | (() => Response) = new Response(JSON.stringify({ accepted: true }), { status: 202 })
let logsSnapshot: unknown = {
  generation: 1,
  nextCursor: 2,
  lines: [
    { seq: 1, at: '2026-08-18T10:00:01.000Z', generation: 1, source: 'log', text: 'Relation `sandboxs` is missing' },
    { seq: 2, at: '2026-08-18T10:00:02.000Z', generation: 1, source: 'process', text: 'migration check failed' },
  ],
}

function mockStatusResponses(...statuses: Array<RuntimeStatus | null>): void {
  let index = 0
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return typeof actionResponse === 'function' ? actionResponse() : actionResponse.clone()
    }
    if (String(url).startsWith('/api/dev-runtime/logs')) {
      return new Response(JSON.stringify(logsSnapshot), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const status = statuses[Math.min(index, statuses.length - 1)]
    index += 1
    if (!status) return new Response(null, { status: 404 })
    return new Response(JSON.stringify(status), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

// The banner ships inside AppProviders in the real app, so the provider is the
// realistic default; the provider-less path is covered explicitly below.
function renderBanner() {
  return render(
    <I18nProvider locale="en" dict={{}}>
      <DevRuntimeDiagnosticsBanner />
    </I18nProvider>,
  )
}

function actionCalls(): Array<[string, RequestInit]> {
  return fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST') as Array<[string, RequestInit]>
}

// jsdom does not implement <dialog>.showModal, which ConfirmDialog relies on.
function installDialogPolyfill() {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute('open', '') },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute('open') },
  })
}

beforeEach(() => {
  installDialogPolyfill()
  document.head.innerHTML = ''
  actionResponse = new Response(JSON.stringify({ accepted: true }), { status: 202 })
  logsSnapshot = {
    generation: 1,
    nextCursor: 2,
    lines: [
      { seq: 1, at: '2026-08-18T10:00:01.000Z', generation: 1, source: 'log', text: 'Relation `sandboxs` is missing' },
      { seq: 2, at: '2026-08-18T10:00:02.000Z', generation: 1, source: 'process', text: 'migration check failed' },
    ],
  }
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  jest.useRealTimers()
})

describe('DevRuntimeDiagnosticsBanner', () => {
  it('renders nothing when the banner meta is absent', async () => {
    renderBanner()
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled())
    expect(screen.queryByTestId('dev-runtime-diagnostics-banner')).toBeNull()
  })

  it('sends the per-run token with the status request', async () => {
    enableBanner()
    mockStatusResponses(createStatus())
    renderBanner()

    await screen.findByTestId('dev-runtime-diagnostics-banner')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/dev-runtime/status')
    expect(fetchMock.mock.calls[0][1].headers[DEV_RUNTIME_TOKEN_HEADER]).toBe(TOKEN)
  })

  it('shows the localized headline and the concise incident detail', async () => {
    enableBanner()
    mockStatusResponses(createStatus())
    renderBanner()

    const banner = await screen.findByTestId('dev-runtime-diagnostics-banner')
    expect(banner).toHaveAttribute('data-health', 'degraded')
    expect(banner.textContent).toContain('Runtime degraded')
    expect(banner.textContent).toContain('Database schema mismatch')
    expect(banner.textContent).toContain('Relation `sandboxs` is missing')
  })

  it('uses a polite status role while degraded and an alert while unavailable', async () => {
    enableBanner()
    mockStatusResponses(createStatus())
    const { unmount } = renderBanner()
    const degraded = await screen.findByTestId('dev-runtime-diagnostics-banner')
    expect(degraded).toHaveAttribute('role', 'status')
    expect(degraded).toHaveAttribute('aria-live', 'polite')
    unmount()

    mockStatusResponses(createStatus({ health: 'unavailable', ready: false, failed: true }))
    renderBanner()
    const unavailable = await screen.findByTestId('dev-runtime-diagnostics-banner')
    expect(unavailable).toHaveAttribute('role', 'alert')
    expect(unavailable).toHaveAttribute('aria-live', 'assertive')
  })

  it('stays hidden while the runtime is ready', async () => {
    enableBanner()
    mockStatusResponses(createStatus({ health: 'ready', issueSummary: undefined, incidents: [] }))
    renderBanner()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByTestId('dev-runtime-diagnostics-banner')).toBeNull()
  })

  it('renders during startup and while recovering', async () => {
    enableBanner()
    mockStatusResponses(createStatus({ health: 'starting', ready: false }))
    const { unmount } = renderBanner()
    expect((await screen.findByTestId('dev-runtime-diagnostics-banner')).textContent).toContain('Runtime starting')
    unmount()

    mockStatusResponses(createStatus({
      health: 'recovering',
      ready: false,
      recovery: { action: 'migrate', startedAt: '2026-08-18T10:00:00.000Z', busy: true },
    }))
    renderBanner()
    expect((await screen.findByTestId('dev-runtime-diagnostics-banner')).textContent).toContain('Runtime recovering')
  })

  it('hides the retry control while a recovery action is busy', async () => {
    enableBanner()
    mockStatusResponses(createStatus({
      health: 'recovering',
      ready: false,
      recovery: { action: 'migrate', startedAt: '2026-08-18T10:00:00.000Z', busy: true },
    }))
    renderBanner()

    await screen.findByTestId('dev-runtime-diagnostics-banner')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('expands technical details on demand and hides them again', async () => {
    enableBanner()
    mockStatusResponses(createStatus({ issueSummary: createIssue({ path: '/backend/example' }) }))
    renderBanner()

    await screen.findByTestId('dev-runtime-diagnostics-banner')
    expect(screen.queryByText('db_relation_missing')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Show details/ }))
    expect(screen.getByText('db_relation_missing')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('/backend/example')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Hide details/ }))
    expect(screen.queryByText('db_relation_missing')).toBeNull()
  })

  it('shows the log tail inline instead of navigating to the splash port', async () => {
    enableBanner()
    mockStatusResponses(createStatus())
    renderBanner()

    await screen.findByTestId('dev-runtime-diagnostics-banner')
    // No cross-port link as the primary affordance.
    expect(screen.queryByRole('link', { name: /View logs/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /View logs/ }))
    expect(await screen.findByText(/migration check failed/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/dev-runtime/logs'))).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Hide logs/ }))
    expect(screen.queryByText(/migration check failed/)).toBeNull()
  })

  it('reports an empty log tail rather than rendering a blank panel', async () => {
    enableBanner()
    mockStatusResponses(createStatus())
    logsSnapshot = { generation: 1, nextCursor: 0, lines: [] }
    renderBanner()

    await screen.findByTestId('dev-runtime-diagnostics-banner')
    fireEvent.click(screen.getByRole('button', { name: /View logs/ }))
    expect(await screen.findByText('No diagnostic lines yet.')).toBeInTheDocument()
  })

  it('still links the standalone splash as a secondary affordance when available', async () => {
    enableBanner({ logsUrl: 'http://localhost:4000' })
    mockStatusResponses(createStatus())
    renderBanner()

    await screen.findByTestId('dev-runtime-diagnostics-banner')
    fireEvent.click(screen.getByRole('button', { name: /View logs/ }))
    expect(await screen.findByRole('link', { name: 'http://localhost:4000' })).toBeInTheDocument()
  })

  it('dismisses the current incident without changing runtime state', async () => {
    enableBanner()
    mockStatusResponses(createStatus())
    renderBanner()

    await screen.findByTestId('dev-runtime-diagnostics-banner')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('dev-runtime-diagnostics-banner')).toBeNull()

    // Only the browser view is dismissed; the collector keeps reporting it.
    const calls = fetchMock.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === undefined)).toBe(true)
  })

  it('reappears for a new fingerprint after a dismissal', async () => {
    jest.useFakeTimers()
    enableBanner()
    mockStatusResponses(
      createStatus(),
      createStatus(),
      createStatus({ issueSummary: createIssue({ fingerprint: 'fingerprint-b', title: 'Bundler crashed' }) }),
    )
    renderBanner()

    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('dev-runtime-diagnostics-banner')).toBeNull()

    await act(async () => {
      jest.advanceTimersByTime(2000)
      await Promise.resolve()
    })
    await act(async () => {
      jest.advanceTimersByTime(2000)
      await Promise.resolve()
    })

    expect(screen.getByTestId('dev-runtime-diagnostics-banner').textContent).toContain('Bundler crashed')
  })

  it('keeps the page usable when the status bridge is unavailable', async () => {
    enableBanner()
    fetchMock.mockRejectedValue(new Error('bridge down'))
    renderBanner()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByTestId('dev-runtime-diagnostics-banner')).toBeNull()
  })

  it('renders nothing when the bridge returns 404', async () => {
    enableBanner()
    mockStatusResponses(null)
    renderBanner()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByTestId('dev-runtime-diagnostics-banner')).toBeNull()
  })

  it('lets the action row wrap instead of scrolling on narrow viewports', async () => {
    enableBanner({ logsUrl: 'http://localhost:4000' })
    mockStatusResponses(createStatus())
    renderBanner()

    const banner = await screen.findByTestId('dev-runtime-diagnostics-banner')
    const actionRow = banner.querySelector('.flex.flex-wrap.items-center')
    // Wraps rather than scrolls, and labels never break mid-word when it does.
    expect(actionRow?.className).toContain('flex-wrap')
    expect(screen.getByRole('button', { name: /Restart runtime/ }).className).toContain('whitespace-nowrap')
    // Dismiss is pinned to the header corner, not part of the wrapping action
    // row — otherwise it orphans onto a line of its own once actions wrap.
    const dismiss = screen.getByRole('button', { name: 'Dismiss' })
    expect(actionRow?.contains(dismiss)).toBe(false)
  })

  // The app shell's sidebar toggle and the toast stack own fixed slots at the
  // top of the viewport, so a top-anchored banner is overlapped by them.
  it('floats at the bottom above app chrome instead of sitting in page flow', async () => {
    enableBanner()
    mockStatusResponses(createStatus())
    renderBanner()

    const banner = await screen.findByTestId('dev-runtime-diagnostics-banner')
    expect(banner.className).toContain('fixed')
    expect(banner.className).toContain('z-banner')
    // Bottom-right, but lifted clear of the support-chat launcher that lives in
    // that corner with its own very high third-party z-index.
    expect(banner.className).toContain('sm:right-4')
    expect(banner.className).toContain('bottom-20')
    expect(banner.className).not.toContain('sm:left-4')
    expect(banner.className).not.toContain('bottom-3')
    // Never a full-bleed top bar: that is what collided with the shell chrome.
    expect(banner.className).not.toContain('border-b')
    expect(banner.className).not.toContain('top-0')
  })

  it('offers restart plus the classifier-justified action only', async () => {
    enableBanner()
    mockStatusResponses(createStatus())
    renderBanner()

    await screen.findByTestId('dev-runtime-diagnostics-banner')
    expect(screen.getByRole('button', { name: /Run migrations/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Restart runtime/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Run generators/ })).toBeNull()
  })

  it('offers only restart when the incident has no justified recovery', async () => {
    enableBanner()
    mockStatusResponses(createStatus({ issueSummary: createIssue({ recovery: undefined }) }))
    renderBanner()

    await screen.findByTestId('dev-runtime-diagnostics-banner')
    expect(screen.getByRole('button', { name: /Restart runtime/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Run migrations/ })).toBeNull()
  })

  it('posts restart to the allowlisted action endpoint with the run token', async () => {
    enableBanner()
    mockStatusResponses(createStatus())
    renderBanner()

    await screen.findByTestId('dev-runtime-diagnostics-banner')
    fireEvent.click(screen.getByRole('button', { name: /Restart runtime/ }))

    await waitFor(() => expect(actionCalls()).toHaveLength(1))
    const [url, init] = actionCalls()[0]
    expect(url).toBe('/api/dev-runtime/actions/restart')
    expect(init.headers).toMatchObject({ [DEV_RUNTIME_TOKEN_HEADER]: TOKEN })
  })

  it('requires confirmation before running migrations and can be cancelled', async () => {
    enableBanner()
    mockStatusResponses(createStatus())
    renderBanner()

    await screen.findByTestId('dev-runtime-diagnostics-banner')
    fireEvent.click(screen.getByRole('button', { name: /Run migrations/ }))

    const dialogText = await screen.findByText(/not automatically reversible/i)
    expect(dialogText).toBeInTheDocument()
    expect(actionCalls()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }))
    await waitFor(() => expect(actionCalls()).toHaveLength(0))
  })

  it('runs migrations once the confirmation is accepted', async () => {
    enableBanner()
    mockStatusResponses(createStatus())
    renderBanner()

    await screen.findByTestId('dev-runtime-diagnostics-banner')
    fireEvent.click(screen.getByRole('button', { name: /Run migrations/ }))
    await screen.findByText(/not automatically reversible/i)

    const dialogConfirm = screen.getAllByRole('button', { name: /Run migrations/ }).at(-1)!
    fireEvent.click(dialogConfirm)

    await waitFor(() => expect(actionCalls()).toHaveLength(1))
    expect(actionCalls()[0][0]).toBe('/api/dev-runtime/actions/migrate')
  })

  it('surfaces a rejected action instead of failing silently', async () => {
    enableBanner()
    mockStatusResponses(createStatus())
    actionResponse = () => new Response(
      JSON.stringify({ error: { code: 'action_busy', message: 'The "generate" action is still running.' } }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )
    renderBanner()

    await screen.findByTestId('dev-runtime-diagnostics-banner')
    fireEvent.click(screen.getByRole('button', { name: /Restart runtime/ }))

    expect(await screen.findByText('The "generate" action is still running.')).toBeInTheDocument()
  })

  it('hides recovery controls while an action is already running', async () => {
    enableBanner()
    mockStatusResponses(createStatus({
      health: 'recovering',
      ready: false,
      recovery: { action: 'migrate', startedAt: '2026-08-18T10:00:00.000Z', busy: true },
    }))
    renderBanner()

    await screen.findByTestId('dev-runtime-diagnostics-banner')
    expect(screen.queryByRole('button', { name: /Restart runtime/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Run migrations/ })).toBeNull()
  })
})
