/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import ProposalDetailPage from '../page'

const apiCallMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const pushMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, operation: () => Promise<unknown>) => operation(),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))

const EMAIL = {
  id: 'email-1',
  subject: 'Offer 42',
  forwardedByAddress: 'supplier@example.test',
  status: 'processed',
  receivedAt: '2026-11-08T10:00:00.000Z',
  updatedAt: '2026-11-08T10:01:00.000Z',
  attachmentsStatus: 'completed',
  cleanedText: 'See attached.',
}

function configureApi(granted: string[], email: Record<string, unknown> = EMAIL) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url === '/api/inbox_ops/proposals/proposal-1') {
      return {
        ok: true,
        status: 200,
        result: {
          proposal: { id: 'proposal-1', summary: 'Order from supplier', confidence: '0.9', status: 'pending', participants: [], possiblyIncomplete: false, workingLanguage: 'en', createdAt: '2026-11-08T10:00:00.000Z' },
          actions: [],
          discrepancies: [],
          email,
        },
      }
    }
    if (url === '/api/auth/feature-check') return { ok: true, status: 200, result: { ok: true, granted } }
    if (url === '/api/inbox_ops/emails/email-1/attachments') {
      return { ok: true, status: 200, result: { items: [{ id: 'part-1', partKey: 'resend:a', fileName: 'offer.pdf', mimeType: 'application/pdf', sizeBytes: 10, disposition: 'attachment', status: 'stored', reason: null, attachmentId: 'att-1', url: '/api/attachments/file/att-1' }] } }
    }
    throw new Error(`unexpected request ${url}`)
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('ProposalDetailPage attachments and Delete email', () => {
  it('lists the email attachments and returns to the inbox after deleting the email', async () => {
    configureApi(['inbox_ops.proposals.manage'])
    apiCallOrThrowMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true } })
    renderWithProviders(<ProposalDetailPage params={{ id: 'proposal-1' }} />)

    expect(await screen.findByText('offer.pdf')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete email' }))
    const confirmButton = (await screen.findAllByRole('button', { name: 'Delete email' })).find((button) => button.closest('[role="dialog"]'))
    fireEvent.click(confirmButton as HTMLElement)

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/backend/inbox-ops'))
    expect(apiCallOrThrowMock).toHaveBeenCalledWith('/api/inbox_ops/emails/email-1', expect.objectContaining({ method: 'DELETE' }), expect.any(Object))
  })

  it('hides Delete email without inbox_ops.proposals.manage', async () => {
    configureApi(['inbox_ops.proposals.view'])
    renderWithProviders(<ProposalDetailPage params={{ id: 'proposal-1' }} />)
    expect(await screen.findByText('offer.pdf')).toBeTruthy()
    await waitFor(() => expect(apiCallMock.mock.calls.some(([url]) => url === '/api/auth/feature-check')).toBe(true))
    expect(screen.queryByRole('button', { name: 'Delete email' })).toBeNull()
  })

  it('shows the empty attachments section without a request for an email that recorded no parts', async () => {
    configureApi(['inbox_ops.proposals.view'], { ...EMAIL, attachmentsStatus: null })
    renderWithProviders(<ProposalDetailPage params={{ id: 'proposal-1' }} />)
    expect(await screen.findByText('This email has no attachments.')).toBeTruthy()
    expect(apiCallMock.mock.calls.some(([url]) => String(url).endsWith('/attachments'))).toBe(false)
  })
})
