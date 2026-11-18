/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AvailabilityDialog } from '../components/availability/AvailabilityDialog'
import type { UnavailabilityPreview } from '../components/availability/availabilityModel'

type CallResult = { ok: boolean; status: number; result: unknown }

const mockApiCall = jest.fn<Promise<CallResult>, [string, RequestInit?, unknown?]>()
const mockApiCallOrThrow = jest.fn<Promise<CallResult>, [string, RequestInit?, unknown?]>()
const mockGuardOptions: Array<{ blockedMessage?: string }> = []

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (url: string, init?: RequestInit, options?: unknown) => mockApiCall(url, init, options),
  apiCallOrThrow: (url: string, init?: RequestInit, options?: unknown) => mockApiCallOrThrow(url, init, options),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: (options: { blockedMessage?: string }) => {
    mockGuardOptions.push(options)
    return {
      runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
      retryLastMutation: jest.fn(),
    }
  },
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

function httpError(message: string, extras: Record<string, unknown>): Error {
  return Object.assign(new Error(message), extras)
}

async function renderReady(onDone: jest.Mock) {
  mockApiCall.mockImplementation(async (url) => (url === REASONS_URL
    ? { ok: true, status: 200, result: { items: [] } }
    : { ok: true, status: 200, result: PREVIEW }))
  renderWithProviders(<AvailabilityDialog subject={SUBJECT} onClose={jest.fn()} onDone={onDone} />)
  await screen.findByTestId('pm-availability-preview')
  fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Water damage' } })
  const confirm = screen.getByTestId('pm-availability-confirm')
  await waitFor(() => expect(confirm).not.toBeDisabled())
  return confirm
}

describe('AvailabilityDialog confirm', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockApiCallOrThrow.mockReset()
    mockGuardOptions.length = 0
  })

  it('passes a translated blocked message to the mutation guard', async () => {
    await renderReady(jest.fn())
    expect(mockGuardOptions[0]?.blockedMessage).toBe('The change was blocked.')
  })

  it('does not finish when the server refuses the change', async () => {
    const onDone = jest.fn()
    mockApiCallOrThrow.mockRejectedValue(httpError('Building not found.', { status: 404 }))
    const confirm = await renderReady(onDone)
    fireEvent.click(confirm)
    expect(await screen.findByText('Building not found.')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('asks for a new preview when the preview went stale', async () => {
    const onDone = jest.fn()
    mockApiCallOrThrow.mockRejectedValue(httpError('stale', { status: 409, code: 'preview_stale' }))
    const confirm = await renderReady(onDone)
    const previewCalls = mockApiCall.mock.calls.filter(([url]) => url !== REASONS_URL).length
    fireEvent.click(confirm)
    expect(await screen.findByText(/changed meanwhile/)).toBeTruthy()
    await waitFor(() => expect(mockApiCall.mock.calls.filter(([url]) => url !== REASONS_URL).length).toBeGreaterThan(previewCalls))
    expect(onDone).not.toHaveBeenCalled()
  })

  it('finishes when the server accepts the change', async () => {
    const onDone = jest.fn()
    mockApiCallOrThrow.mockResolvedValue({ ok: true, status: 200, result: { queuedBookings: 0 } })
    const confirm = await renderReady(onDone)
    fireEvent.click(confirm)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})
