/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { EmailAttachmentsDialog } from '../attachments/EmailAttachmentsDialog'
import { DeleteEmailDialog } from '../emails/DeleteEmailDialog'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => Promise<unknown>) => operation(),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))
// The real dialog keeps its content mounted while the close animation runs, which jsdom does not
// play; this stand-in keeps it mounted after close, so the test sees what that animation shows.
jest.mock('@open-mercato/ui/primitives/dialog', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return {
    Dialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) => <div data-open={String(open)}>{children}</div>,
    DialogContent: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
  }
})

beforeEach(() => {
  apiCallMock.mockReset()
  apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items: [] } })
})

describe('dialogs during their close animation', () => {
  it('EmailAttachmentsDialog keeps the last email subject and list instead of the fallback', async () => {
    const onClose = jest.fn()
    const { rerender } = renderWithProviders(<EmailAttachmentsDialog email={{ id: 'email-1', subject: 'Offer 42' }} onClose={onClose} />)
    expect(screen.getByText('Offer 42')).toBeTruthy()
    rerender(<EmailAttachmentsDialog email={null} onClose={onClose} />)
    expect(screen.getByText('Offer 42')).toBeTruthy()
    expect(screen.queryByText('Files received with this email')).toBeNull()
    expect(apiCallMock).toHaveBeenCalledTimes(1)
  })

  it('DeleteEmailDialog keeps the last email subject instead of "Untitled email"', () => {
    const props = { onClose: jest.fn(), onDeleted: jest.fn() }
    const { rerender } = renderWithProviders(<DeleteEmailDialog email={{ id: 'email-1', subject: 'Offer 42', updatedAt: null }} {...props} />)
    expect(screen.getByText(/"Offer 42"/)).toBeTruthy()
    rerender(<DeleteEmailDialog email={null} {...props} />)
    expect(screen.getByText(/"Offer 42"/)).toBeTruthy()
    expect(screen.queryByText(/Untitled email/)).toBeNull()
  })
})
