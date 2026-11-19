/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import StaffLeaveRequestDetailPage from '../page'

const REQUEST_ID = '11111111-1111-4111-8111-111111111111'

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/i18n/context')
  return { ...actual, useT: () => (key: string, fallback?: string) => fallback ?? key }
})

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => `/backend/staff/leave-requests/${REQUEST_ID}`,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/messages', () => ({ SendObjectMessageDialog: () => null }))

jest.mock('@open-mercato/core/modules/staff/components/LeaveRequestForm', () => ({
  LeaveRequestForm: () => <div data-testid="leave-request-form" />,
  buildLeaveRequestPayload: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return { ...actual, apiCallOrThrow: jest.fn(), readApiResultOrThrow: jest.fn() }
})

const mockReadApiResultOrThrow = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>
const mockApiCallOrThrow = apiCallOrThrow as jest.MockedFunction<typeof apiCallOrThrow>
const mockFlash = flash as jest.MockedFunction<typeof flash>

function buildRecord(status: string) {
  return {
    id: REQUEST_ID,
    status,
    start_date: '2026-12-01',
    end_date: '2026-12-02',
    updated_at: '2026-11-18T10:00:00.000Z',
  }
}

describe('StaffLeaveRequestDetailPage stale decision', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each([
    ['accept', 'Approve', 'Leave request is already finalized.', 'approved'],
    ['reject', 'Reject', 'Leave request not found.', 'rejected'],
  ])('surfaces the API error and reloads the record when %s fails', async (_action, buttonLabel, apiError, currentStatus) => {
    mockReadApiResultOrThrow
      .mockResolvedValueOnce({ items: [buildRecord('pending')] } as never)
      .mockResolvedValueOnce({ items: [buildRecord(currentStatus)] } as never)
    mockApiCallOrThrow.mockRejectedValueOnce(Object.assign(new Error(apiError), { status: 400 }))

    render(<StaffLeaveRequestDetailPage params={{ id: REQUEST_ID }} />)

    fireEvent.click(await screen.findByRole('button', { name: buttonLabel }))

    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith(apiError, 'error'))
    await waitFor(() => expect(mockReadApiResultOrThrow).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('button', { name: buttonLabel })).toBeNull())
    expect(mockFlash).not.toHaveBeenCalledWith(expect.any(String), 'success')
  })

  it('reloads the record after a successful decision', async () => {
    mockReadApiResultOrThrow
      .mockResolvedValueOnce({ items: [buildRecord('pending')] } as never)
      .mockResolvedValueOnce({ items: [buildRecord('approved')] } as never)
    mockApiCallOrThrow.mockResolvedValueOnce({ ok: true, status: 200, result: { ok: true } } as never)

    render(<StaffLeaveRequestDetailPage params={{ id: REQUEST_ID }} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('Leave request approved.', 'success'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull())
  })
})
