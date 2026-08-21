/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
const routerReplaceMock = jest.fn()
const mockConfirm = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: async <T,>(_headers: Record<string, string>, operation: () => Promise<T>) => operation(),
}))

const portalAuthState = { auth: { user: { id: 'customer-user-1' }, loading: false } }

jest.mock('@open-mercato/ui/portal/PortalContext', () => ({
  usePortalContext: () => portalAuthState,
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async <T,>({ operation }: { operation: () => Promise<T> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: mockConfirm, ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

import enDict from '../i18n/en.json'
import WarrantyClaimPortalDetailPage from '../frontend/[orgSlug]/portal/claims/[id]/page'

function buildClaim(overrides: Record<string, unknown> = {}) {
  return {
    id: 'claim-1',
    claimNumber: 'WTY-000042',
    claimType: 'warranty',
    status: 'in_review',
    priority: 'normal',
    orderId: 'order-1',
    orderNumber: 'SO-10231',
    reasonCode: 'buckle_failure',
    rejectionReasonCode: null,
    resolutionSummary: null,
    submittedAt: '2026-06-15T10:00:00.000Z',
    resolvedAt: null,
    closedAt: null,
    createdAt: '2026-06-15T09:00:00.000Z',
    updatedAt: '2026-06-16T10:00:00.000Z',
    lines: [
      {
        id: 'line-1',
        lineNo: 1,
        sku: 'TM-45-BLK',
        productName: 'TrailMaster 45L Backpack',
        serialNumber: null,
        faultCode: null,
        faultDescription: null,
        qtyClaimed: '1',
        qtyApproved: null,
        lineStatus: 'approved',
        disposition: null,
        creditAmount: null,
      },
    ],
    ...overrides,
  }
}

function mockClaimResponses(claim: Record<string, unknown>) {
  apiCallMock.mockImplementation(async (url: string, options?: { method?: string }) => {
    if (url.startsWith('/api/warranty_claims/portal/claims/')) {
      return { ok: true, status: 200, result: { item: claim } }
    }
    if (url.startsWith('/api/warranty_claims/portal/events')) {
      return {
        ok: true,
        status: 200,
        result: {
          items: [
            {
              id: 'event-1',
              kind: 'comment',
              body: 'Please send a photo of the damaged buckle.',
              payload: null,
              actorCustomerId: null,
              createdAt: '2026-06-16T09:00:00.000Z',
            },
          ],
        },
      }
    }
    if (url.startsWith('/api/warranty_claims/portal/attachments')) {
      if (options?.method === 'DELETE') {
        return { ok: true, status: 200, result: { ok: true } }
      }
      return {
        ok: true,
        status: 200,
        result: {
          items: [
            {
              id: 'attachment-1',
              url: '/files/receipt.pdf',
              downloadUrl: '/files/receipt.pdf?download=1',
              fileName: 'receipt.pdf',
              fileSize: 1024,
              mimeType: 'application/pdf',
              thumbnailUrl: '',
              createdAt: '2026-06-16T08:00:00.000Z',
            },
          ],
        },
      }
    }
    throw new Error(`[internal] Unexpected apiCall in test: ${url}`)
  })
}

describe('WarrantyClaimPortalDetailPage (portal claim tracker)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockConfirm.mockResolvedValue(true)
  })

  it('renders the tracker card for an in-review claim', async () => {
    mockClaimResponses(buildClaim())

    const view = renderWithProviders(
      <WarrantyClaimPortalDetailPage params={{ orgSlug: 'acme-corp', id: 'claim-1' }} />,
      { dict: enDict },
    )

    await waitFor(() => expect(view.getByText('WTY-000042')).toBeTruthy())

    expect(view.getByRole('heading', { level: 1 }).textContent).toContain('buckle_failure')
    expect(view.getByText(/Submitted .* from your order SO-10231/)).toBeTruthy()
    expect(view.getByText('We are reviewing your claim. You will hear from us soon. No action is needed right now.')).toBeTruthy()

    expect(view.getByText('Claim received')).toBeTruthy()
    expect(view.getByText('Decision')).toBeTruthy()
    expect(view.getByText('Ship items back')).toBeTruthy()
    expect(view.getByText('Resolved')).toBeTruthy()
    expect(view.getByText('Now')).toBeTruthy()

    expect(view.getByText('Your items')).toBeTruthy()
    expect(view.getByText('TrailMaster 45L Backpack')).toBeTruthy()
    expect(view.getByText('TM-45-BLK, Qty 1')).toBeTruthy()
    expect(view.getByText('Approved')).toBeTruthy()

    expect(view.getByText('Activity')).toBeTruthy()
    expect(view.getByText('Our team replied')).toBeTruthy()
    expect(view.getByText('Please send a photo of the damaged buckle.')).toBeTruthy()
    expect(view.getByText('You added an attachment')).toBeTruthy()
    expect(view.getByText('receipt.pdf').closest('a')?.getAttribute('href')).toBe('/files/receipt.pdf?download=1')
    expect(view.getByRole('button', { name: 'Replace receipt.pdf' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Delete receipt.pdf' })).toBeTruthy()

    expect(view.getByText('Message support')).toBeTruthy()
    expect(view.getByPlaceholderText('Write a message to our support team…')).toBeTruthy()
    expect(view.getByText('Attach files')).toBeTruthy()
    expect(view.getByText('Send')).toBeTruthy()

    expect(view.queryByText('Withdraw claim')).toBeNull()
    expect(view.queryByText('Submit claim')).toBeNull()
  })

  it('deletes a persisted portal attachment after confirmation', async () => {
    mockClaimResponses(buildClaim())

    const view = renderWithProviders(
      <WarrantyClaimPortalDetailPage params={{ orgSlug: 'acme-corp', id: 'claim-1' }} />,
      { dict: enDict },
    )

    await waitFor(() => expect(view.getByText('receipt.pdf')).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'Delete receipt.pdf' }))

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith(
      '/api/warranty_claims/portal/attachments?attachmentId=attachment-1',
      { method: 'DELETE', credentials: 'include' },
    ))
  })

  it('shows submit and withdraw actions with the draft banner for draft claims', async () => {
    mockClaimResponses(buildClaim({ status: 'draft', submittedAt: null }))

    const view = renderWithProviders(
      <WarrantyClaimPortalDetailPage params={{ orgSlug: 'acme-corp', id: 'claim-1' }} />,
      { dict: enDict },
    )

    await waitFor(() => expect(view.getByText('WTY-000042')).toBeTruthy())

    expect(view.getByText('Submit claim')).toBeTruthy()
    expect(view.getByText('Withdraw claim')).toBeTruthy()
    expect(view.getByText('This claim is a draft. Submit it when you are ready so our team can review it.')).toBeTruthy()
  })

  it.each([
    ['resolved', { resolvedAt: '2026-07-05T10:00:00.000Z' }],
    ['closed', { resolvedAt: '2026-07-04T10:00:00.000Z', closedAt: '2026-07-06T10:00:00.000Z' }],
  ])('marks the final tracker step complete for %s claims', async (status, dates) => {
    mockClaimResponses(buildClaim({ status, ...dates }))

    const view = renderWithProviders(
      <WarrantyClaimPortalDetailPage params={{ orgSlug: 'acme-corp', id: 'claim-1' }} />,
      { dict: enDict },
    )

    await waitFor(() => expect(view.getByText('WTY-000042')).toBeTruthy())
    expect(view.queryByText('Now')).toBeNull()
    expect(view.getByText(status === 'closed' ? 'Jul 6' : 'Jul 5')).toBeTruthy()
  })
})
