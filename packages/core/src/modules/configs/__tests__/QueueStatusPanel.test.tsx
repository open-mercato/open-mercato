/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueueStatusPanel } from '../components/QueueStatusPanel'
import type { QueueStatusSnapshot } from '../lib/queue-status.types'

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  // Stable identity, like the real provider's `t` — the panel reloads whenever `t` changes.
  const t = (key: string, fallback?: string, vars?: Record<string, unknown>) => {
    let text = fallback ?? key
    for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(`{{${name}}}`, String(value))
    return text
  }
  return { useT: () => t, useLocale: () => 'en' }
})

const readApiResultOrThrow = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrow(...args),
}))

function snapshot(overrides: Partial<QueueStatusSnapshot['queues'][number]> = {}, canInspectPayloads = true): QueueStatusSnapshot {
  return {
    generatedAt: '2026-10-26T10:00:00.000Z',
    filter: { queue: null, type: null },
    canInspectPayloads,
    queues: [{
      queue: 'q1',
      workerIds: ['mod:worker'],
      concurrency: 1,
      strategy: 'async',
      fidelity: 'exact',
      counts: { waiting: 0, active: 0, completed: 0, failed: 1 },
      failedJobs: [{ id: 'failed-1', queue: 'q1', type: 'index', errorCode: 'queue.handler_error', attemptsMade: 3, failedAt: 1_700_000_000_000 }],
      failedJobsUnavailable: false,
      inFlight: [],
      agedWaiting: [],
      inFlightUnavailable: false,
      ...overrides,
    }],
  }
}

function mockApi(status: QueueStatusSnapshot | Error) {
  readApiResultOrThrow.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/configs/queues-status/jobs')) {
      return {
        crossTenant: false,
        jobs: [{ id: 'failed-1', queue: 'q1', state: 'failed', tenantId: 't1', failedReason: 'boom', data: { ok: true } }],
      }
    }
    if (status instanceof Error) throw status
    return status
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('QueueStatusPanel', () => {
  it('opens the inspector from a failed row with Enter and with Space (default prevented), then closes it with Escape and returns focus', async () => {
    mockApi(snapshot())
    render(<QueueStatusPanel />)

    const row = await screen.findByRole('button', { name: /failed-1/ })
    row.focus()
    // fireEvent returns false when the handler called preventDefault (Space must not scroll the page).
    expect(fireEvent.keyDown(row, { key: ' ' })).toBe(false)
    expect(await screen.findByText('Job Inspector')).toBeTruthy()
    // The failure reason comes through the inspector (redacted server-side).
    expect(await screen.findByText('boom')).toBeTruthy()

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('Job Inspector')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(row))

    fireEvent.keyDown(row, { key: 'Enter' })
    expect(await screen.findByText('Job Inspector')).toBeTruthy()
  })

  it('does not make rows interactive without the inspect_payloads feature', async () => {
    mockApi(snapshot({}, false))
    render(<QueueStatusPanel />)

    await screen.findByText('failed-1')
    expect(screen.queryByRole('button', { name: /failed-1/ })).toBeNull()
  })

  it('shows the safe failure code label, never raw failure text', async () => {
    mockApi(snapshot())
    render(<QueueStatusPanel />)

    expect(await screen.findByText('queue.handler_error')).toBeTruthy()
  })

  it('ends in an error state with a retry — not a permanent spinner — when the status request fails', async () => {
    mockApi(new Error('Request aborted'))
    render(<QueueStatusPanel />)

    expect(await screen.findByText('Request aborted')).toBeTruthy()
    expect(screen.queryByText('Loading queue status…')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('renders the stable per-queue error code as a message, with the queue still on screen', async () => {
    mockApi(snapshot({ error: 'queue_unavailable', failedJobs: undefined, failedJobsUnavailable: true, inFlightUnavailable: true }))
    render(<QueueStatusPanel />)

    expect(await screen.findByRole('heading', { name: 'q1' })).toBeTruthy()
    // The i18n mock returns the fallback, which is the generic read-failure copy.
    expect(await screen.findByText('Queue status could not be read.')).toBeTruthy()
  })
})
