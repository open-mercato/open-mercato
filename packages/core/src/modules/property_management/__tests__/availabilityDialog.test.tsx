/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AvailabilityDialog } from '../components/availability/AvailabilityDialog'
import type { UnavailabilityPreview } from '../components/availability/availabilityModel'

type CallResult = { ok: boolean; status: number; result: unknown }
type Deferred = { promise: Promise<CallResult>; resolve: (value: CallResult) => void }

const mockApiCall = jest.fn<Promise<CallResult>, [string, RequestInit?, unknown?]>()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (url: string, init?: RequestInit, options?: unknown) => mockApiCall(url, init, options),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))

const SUBJECT = { type: 'space' as const, id: 'space-1', name: 'Atrium' }
const REASONS_URL = '/api/property_management/unavailability-reasons'

const PREVIEW: UnavailabilityPreview = {
  unitCount: 1,
  bookingsToCancel: [],
  bookingCount: 0,
  leasesToFlag: [],
  leaseCount: 0,
  previewToken: 'token-1',
}

function deferred(): Deferred {
  let resolve: (value: CallResult) => void = () => undefined
  const promise = new Promise<CallResult>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function respondWith(handlers: { reasons: () => Promise<CallResult>; preview: () => Promise<CallResult> }) {
  mockApiCall.mockImplementation((url) => (url === REASONS_URL ? handlers.reasons() : handlers.preview()))
}

const ok = (result: unknown): CallResult => ({ ok: true, status: 200, result })
const failed = (): CallResult => ({ ok: false, status: 500, result: {} })

function renderDialog() {
  return renderWithProviders(<AvailabilityDialog subject={SUBJECT} onClose={jest.fn()} onDone={jest.fn()} />)
}

describe('AvailabilityDialog retry focus', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it('keeps focus off the page body when the reasons reload succeeds after a retry', async () => {
    const reload = deferred()
    let reasonCalls = 0
    respondWith({
      reasons: () => {
        reasonCalls += 1
        return reasonCalls === 1 ? Promise.resolve(failed()) : reload.promise
      },
      preview: () => Promise.resolve(ok(PREVIEW)),
    })
    renderDialog()
    const retry = await screen.findByTestId('pm-availability-reasons-retry')
    act(() => retry.focus())
    fireEvent.click(retry)

    await waitFor(() => expect(reasonCalls).toBe(2))
    expect(screen.getByTestId('pm-availability-reasons-retry')).toBe(retry)
    expect(retry).toHaveAttribute('aria-disabled', 'true')
    expect(retry).toHaveFocus()

    await act(async () => {
      reload.resolve(ok({ items: [{ id: 'reason-1', label: 'Renovation' }] }))
      await reload.promise
    })
    expect(screen.queryByTestId('pm-availability-reasons-retry')).not.toBeInTheDocument()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.getElementById('pm-availability-reason-entry')).toHaveFocus()
  })

  it('keeps focus on the retry button while the reasons reload fails again', async () => {
    respondWith({
      reasons: () => Promise.resolve(failed()),
      preview: () => Promise.resolve(ok(PREVIEW)),
    })
    renderDialog()
    const retry = await screen.findByTestId('pm-availability-reasons-retry')
    act(() => retry.focus())
    fireEvent.click(retry)

    await waitFor(() => expect(mockApiCall.mock.calls.filter(([url]) => url === REASONS_URL)).toHaveLength(2))
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled'))
    expect(screen.getByTestId('pm-availability-reasons-retry')).toBe(retry)
    expect(retry).toHaveFocus()
  })

  it('moves focus to the preview once a retried preview loads', async () => {
    const reload = deferred()
    let previewCalls = 0
    respondWith({
      reasons: () => Promise.resolve(ok({ items: [] })),
      preview: () => {
        previewCalls += 1
        return previewCalls === 1 ? Promise.resolve(failed()) : reload.promise
      },
    })
    renderDialog()
    const retry = await screen.findByTestId('pm-availability-preview-retry')
    act(() => retry.focus())
    fireEvent.click(retry)

    expect(screen.getByTestId('pm-availability-preview-retry')).toBe(retry)
    expect(retry).toHaveAttribute('aria-disabled', 'true')
    expect(retry).toHaveFocus()
    await waitFor(() => expect(previewCalls).toBe(2))

    await act(async () => {
      reload.resolve(ok(PREVIEW))
      await reload.promise
    })
    expect(screen.queryByTestId('pm-availability-preview-retry')).not.toBeInTheDocument()
    expect(document.activeElement).not.toBe(document.body)
    expect(screen.getByTestId('pm-availability-preview')).toHaveFocus()
  })
})
