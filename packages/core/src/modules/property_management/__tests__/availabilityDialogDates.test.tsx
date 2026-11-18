/** @jest-environment jsdom */
import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AvailabilityDialog } from '../components/availability/AvailabilityDialog'

type PickerProps = { minDate?: Date; value?: Date | null; onChange?: (value: Date | null) => void; 'aria-label'?: string; 'aria-describedby'?: string }
type CallResult = { ok: boolean; status: number; result: unknown }

const mockPickerProps: PickerProps[] = []
const mockApiCall = jest.fn<Promise<CallResult>, [string, RequestInit?, unknown?]>()

jest.mock('@open-mercato/ui/primitives/date-picker', () => ({
  DatePicker: (props: PickerProps) => {
    mockPickerProps.push(props)
    return <div data-testid={`picker-${props['aria-label'] ?? ''}`} />
  },
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (url: string, init?: RequestInit, options?: unknown) => mockApiCall(url, init, options),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))

const REASONS_URL = '/api/property_management/unavailability-reasons'
const PREVIEW = { unitCount: 1, bookingsToCancel: [], bookingCount: 0, leasesToFlag: [], leaseCount: 0, previewToken: 'token-1' }

function lastFromPicker(): PickerProps | undefined {
  return mockPickerProps.filter((props) => props['aria-label'] === 'From').at(-1)
}

function lastUntilPicker(): PickerProps | undefined {
  return mockPickerProps.filter((props) => props['aria-label'] === 'Until').at(-1)
}

function previewBodies(): Array<{ startsAt?: string; endsAt?: string | null }> {
  return mockApiCall.mock.calls
    .filter(([url]) => url !== REASONS_URL)
    .map(([, init]) => JSON.parse(String(init?.body ?? '{}')) as { startsAt?: string; endsAt?: string | null })
}

function renderDialog(dict: Record<string, string> = {}) {
  return renderWithProviders(<AvailabilityDialog subject={{ type: 'unit', id: 'unit-1', name: 'Studio' }} onClose={jest.fn()} onDone={jest.fn()} />, { dict })
}

describe('AvailabilityDialog dates', () => {
  beforeEach(() => {
    mockPickerProps.length = 0
    mockApiCall.mockReset()
  })

  it('falls back to the browser day while the server day is unknown', async () => {
    mockApiCall.mockImplementation(async (url) => (url === REASONS_URL ? { ok: true, status: 200, result: { items: [] } } : { ok: true, status: 200, result: PREVIEW }))
    renderDialog()
    await screen.findByTestId('picker-From')
    const today = new Date()
    expect(lastFromPicker()?.minDate).toEqual(new Date(today.getFullYear(), today.getMonth(), today.getDate()))
  })

  it('starts on and limits From to the deployment-local day from the server', async () => {
    mockApiCall.mockImplementation(async (url) =>
      url === REASONS_URL ? { ok: true, status: 200, result: { items: [], today: '2099-03-04' } } : { ok: true, status: 200, result: PREVIEW },
    )
    renderDialog()
    await waitFor(() => expect(lastFromPicker()?.minDate).toEqual(new Date(2099, 2, 4)))
    expect(lastFromPicker()?.value).toEqual(new Date(2099, 2, 4))
    await waitFor(() => expect(previewBodies().at(-1)?.startsAt?.slice(0, 10)).toBe('2099-03-04'))
  })

  it('clears a preview error as soon as the range changes', async () => {
    let previews = 0
    mockApiCall.mockImplementation(async (url) => {
      if (url === REASONS_URL) return { ok: true, status: 200, result: { items: [], today: '2099-03-04' } }
      previews += 1
      return previews === 1 ? { ok: false, status: 422, result: { error: 'Preview failed' } } : new Promise<CallResult>(() => undefined)
    })
    renderDialog()
    expect(await screen.findByText('Preview failed')).toBeTruthy()
    act(() => lastFromPicker()?.onChange?.(new Date(2099, 2, 10)))
    expect(screen.queryByText('Preview failed')).toBeNull()
  })

  it('moves Until to the new From when From is picked past it', async () => {
    mockApiCall.mockImplementation(async (url) =>
      url === REASONS_URL ? { ok: true, status: 200, result: { items: [], today: '2099-03-04' } } : { ok: true, status: 200, result: PREVIEW },
    )
    renderDialog()
    await waitFor(() => expect(lastFromPicker()?.minDate).toEqual(new Date(2099, 2, 4)))
    act(() => lastUntilPicker()?.onChange?.(new Date(2099, 2, 6)))
    act(() => lastFromPicker()?.onChange?.(new Date(2099, 2, 10)))
    expect(lastUntilPicker()?.value).toEqual(new Date(2099, 2, 10))
    await waitFor(() => expect(previewBodies().at(-1)).toEqual(expect.objectContaining({ startsAt: '2099-03-10T00:00', endsAt: '2099-03-11T00:00' })))
  })

  it('shows a range field error on the field instead of a retryable generic error', async () => {
    mockApiCall.mockImplementation(async (url) =>
      url === REASONS_URL
        ? { ok: true, status: 200, result: { items: [], today: '2099-03-04' } }
        : { ok: false, status: 422, result: { error: 'Invalid input', fieldErrors: { endsAt: 'The end must be after the start.' } } },
    )
    renderDialog()
    expect(await screen.findByText('The end must be after the start.')).toBeTruthy()
    expect(screen.queryByText('Invalid input')).toBeNull()
    expect(screen.queryByTestId('pm-availability-preview-retry')).toBeNull()
    expect(lastUntilPicker()?.['aria-describedby']).toBe('pm-availability-until-error')
  })

  it('translates a key-shaped range field error from a domain refusal', async () => {
    const key = 'property_management.errors.unavailabilityStartInPast'
    mockApiCall.mockImplementation(async (url) =>
      url === REASONS_URL
        ? { ok: true, status: 200, result: { items: [], today: '2099-03-04' } }
        : { ok: false, status: 422, result: { error: 'The unavailable period cannot start before today.', code: 'unavailability_start_in_past', fieldErrors: { startsAt: key } } },
    )
    renderDialog({ [key]: 'Start date is before today.' })
    expect(await screen.findByText('Start date is before today.')).toBeTruthy()
    expect(screen.queryByText(key)).toBeNull()
    expect(lastFromPicker()?.['aria-describedby']).toBe('pm-availability-from-error')
  })

  it('keeps the generic retryable error when the failure is not about the range', async () => {
    mockApiCall.mockImplementation(async (url) =>
      url === REASONS_URL
        ? { ok: true, status: 200, result: { items: [], today: '2099-03-04' } }
        : { ok: false, status: 422, result: { error: 'Invalid input', fieldErrors: { subjectId: 'Invalid input' } } },
    )
    renderDialog()
    expect(await screen.findByText('Invalid input')).toBeTruthy()
    expect(screen.getByTestId('pm-availability-preview-retry')).toBeTruthy()
  })
})
