/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PORTAL_EVENT_DOM_NAME } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'

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

function mockClaimResponses(
  claim: Record<string, unknown>,
  commentBody = 'Please send a photo of the damaged buckle.',
) {
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
              body: commentBody,
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

function dispatchPortalEvent(id: string, claimId: string) {
  fireEvent(window, new CustomEvent(PORTAL_EVENT_DOM_NAME, {
    detail: {
      id,
      payload: { claimId },
      timestamp: Date.now(),
      organizationId: 'organization-1',
    },
  }))
}

function deferResponse<Response>() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((complete) => { resolve = complete })
  return { promise, resolve }
}

describe('WarrantyClaimPortalDetailPage (portal claim tracker)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockReset()
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

  it('refreshes a matching status change while keeping the draft mounted and editable', async () => {
    mockClaimResponses(buildClaim())
    const view = renderWithProviders(
      <WarrantyClaimPortalDetailPage params={{ orgSlug: 'acme-corp', id: 'claim-1' }} />,
      { dict: enDict },
    )
    const textarea = await view.findByPlaceholderText('Write a message to our support team…')
    fireEvent.change(textarea, { target: { value: 'My unfinished reply' } })
    textarea.focus()

    const updatedClaim = buildClaim({
      status: 'resolved',
      resolutionSummary: 'Your replacement has shipped.',
      resolvedAt: '2026-07-05T10:00:00.000Z',
      updatedAt: '2026-07-05T10:00:00.000Z',
    })
    mockClaimResponses(updatedClaim, 'We have completed the review.')
    const response = { ok: true, status: 200, result: { item: updatedClaim } }
    let finishRefresh: (() => void) | undefined
    const pendingDetail = new Promise<typeof response>((resolve) => {
      finishRefresh = () => resolve(response)
    })
    apiCallMock.mockImplementationOnce(() => pendingDetail)
    apiCallMock.mockClear()

    dispatchPortalEvent('warranty_claims.claim.portal_status_changed', 'claim-1')

    expect(apiCallMock).toHaveBeenCalledWith('/api/warranty_claims/portal/claims/claim-1')
    expect(view.getByPlaceholderText('Write a message to our support team…')).toBe(textarea)
    expect(document.activeElement).toBe(textarea)
    expect((textarea as HTMLTextAreaElement).value).toBe('My unfinished reply')
    fireEvent.change(textarea, { target: { value: 'My unfinished reply with more detail' } })

    await act(async () => { finishRefresh?.() })

    expect(await view.findByText('Your replacement has shipped.')).toBeTruthy()
    expect(await view.findByText('We have completed the review.')).toBeTruthy()
    expect(view.getByPlaceholderText('Write a message to our support team…')).toBe(textarea)
    expect((textarea as HTMLTextAreaElement).value).toBe('My unfinished reply with more detail')
    expect(document.activeElement).toBe(textarea)
    expect(apiCallMock.mock.calls.filter(([url]) => url === '/api/warranty_claims/portal/claims/claim-1')).toHaveLength(1)
    expect(apiCallMock.mock.calls.filter(([url]) => url === '/api/warranty_claims/portal/events?claimId=claim-1')).toHaveLength(1)
  })

  it('refreshes only the timeline for a matching staff reply and preserves the comment draft', async () => {
    mockClaimResponses(buildClaim())
    const view = renderWithProviders(
      <WarrantyClaimPortalDetailPage params={{ orgSlug: 'acme-corp', id: 'claim-1' }} />,
      { dict: enDict },
    )
    const textarea = await view.findByPlaceholderText('Write a message to our support team…')
    fireEvent.change(textarea, { target: { value: 'Still writing my reply' } })
    mockClaimResponses(buildClaim(), 'Thank you, we received your photo.')
    apiCallMock.mockClear()

    dispatchPortalEvent('warranty_claims.claim.comment_added', 'claim-1')

    expect(await view.findByText('Thank you, we received your photo.')).toBeTruthy()
    expect(apiCallMock).toHaveBeenCalledTimes(1)
    expect(apiCallMock).toHaveBeenCalledWith('/api/warranty_claims/portal/events?claimId=claim-1')
    expect(view.getByPlaceholderText('Write a message to our support team…')).toBe(textarea)
    expect((textarea as HTMLTextAreaElement).value).toBe('Still writing my reply')
  })

  it('keeps the prior claim and usable draft visible when a background refresh fails', async () => {
    mockClaimResponses(buildClaim())
    const view = renderWithProviders(
      <WarrantyClaimPortalDetailPage params={{ orgSlug: 'acme-corp', id: 'claim-1' }} />,
      { dict: enDict },
    )
    const textarea = await view.findByPlaceholderText('Write a message to our support team…')
    fireEvent.change(textarea, { target: { value: 'My reply before the refresh failed' } })
    apiCallMock.mockResolvedValueOnce({ ok: false, status: 500, result: null })

    dispatchPortalEvent('warranty_claims.claim.portal_status_changed', 'claim-1')

    expect(await view.findByText('Claim details could not be loaded.')).toBeTruthy()
    expect(view.getByText('WTY-000042')).toBeTruthy()
    expect(view.getByText('We are reviewing your claim. You will hear from us soon. No action is needed right now.')).toBeTruthy()
    expect(view.getByPlaceholderText('Write a message to our support team…')).toBe(textarea)
    expect((textarea as HTMLTextAreaElement).value).toBe('My reply before the refresh failed')
    expect((textarea as HTMLTextAreaElement).disabled).toBe(false)
    fireEvent.change(textarea, { target: { value: 'My reply remains editable' } })
    expect((textarea as HTMLTextAreaElement).value).toBe('My reply remains editable')
  })

  it('keeps the newest status when an older refresh finishes last', async () => {
    mockClaimResponses(buildClaim())
    const view = renderWithProviders(
      <WarrantyClaimPortalDetailPage params={{ orgSlug: 'acme-corp', id: 'claim-1' }} />,
      { dict: enDict },
    )
    await view.findByPlaceholderText('Write a message to our support team…')
    const newestResponse = {
      ok: true,
      status: 200,
      result: {
        item: buildClaim({ status: 'resolved', resolutionSummary: 'Final resolution confirmed.' }),
      },
    }
    const olderResponse = {
      ...newestResponse,
      result: { item: buildClaim({ status: 'info_requested' }) },
    }
    mockClaimResponses(newestResponse.result.item, 'Final review completed.')
    const olderRefresh = deferResponse<typeof olderResponse>()
    const newestRefresh = deferResponse<typeof newestResponse>()
    apiCallMock.mockReturnValueOnce(olderRefresh.promise).mockReturnValueOnce(newestRefresh.promise)
    apiCallMock.mockClear()

    dispatchPortalEvent('warranty_claims.claim.portal_status_changed', 'claim-1')
    dispatchPortalEvent('warranty_claims.claim.portal_status_changed', 'claim-1')
    expect(apiCallMock).toHaveBeenCalledTimes(2)

    await act(async () => { newestRefresh.resolve(newestResponse) })
    expect(await view.findByText('Final resolution confirmed.')).toBeTruthy()
    expect(await view.findByText('Final review completed.')).toBeTruthy()

    await act(async () => { olderRefresh.resolve(olderResponse) })
    expect(view.getByText('Final resolution confirmed.')).toBeTruthy()
    expect(view.getByText('Final review completed.')).toBeTruthy()
    expect(apiCallMock.mock.calls.filter(([url]) => url === '/api/warranty_claims/portal/events?claimId=claim-1')).toHaveLength(1)
  })

  it('keeps the newest timeline when an older comment refresh finishes last', async () => {
    mockClaimResponses(buildClaim())
    const view = renderWithProviders(
      <WarrantyClaimPortalDetailPage params={{ orgSlug: 'acme-corp', id: 'claim-1' }} />,
      { dict: enDict },
    )
    await view.findByPlaceholderText('Write a message to our support team…')
    const newestResponse = {
      ok: true,
      status: 200,
      result: {
        items: [{
          id: 'event-2',
          kind: 'comment',
          body: 'The latest staff reply.',
          payload: null,
          actorCustomerId: null,
          createdAt: '2026-07-05T10:00:00.000Z',
        }],
      },
    }
    const olderResponse = {
      ...newestResponse,
      result: { items: [{ ...newestResponse.result.items[0], id: 'event-1', body: 'An earlier staff reply.' }] },
    }
    const olderRefresh = deferResponse<typeof olderResponse>()
    const newestRefresh = deferResponse<typeof newestResponse>()
    apiCallMock.mockReturnValueOnce(olderRefresh.promise).mockReturnValueOnce(newestRefresh.promise)
    apiCallMock.mockClear()

    dispatchPortalEvent('warranty_claims.claim.comment_added', 'claim-1')
    dispatchPortalEvent('warranty_claims.claim.comment_added', 'claim-1')
    expect(apiCallMock).toHaveBeenCalledTimes(2)

    await act(async () => { newestRefresh.resolve(newestResponse) })
    expect(await view.findByText('The latest staff reply.')).toBeTruthy()

    await act(async () => { olderRefresh.resolve(olderResponse) })
    expect(view.getByText('The latest staff reply.')).toBeTruthy()
    expect(view.queryByText('An earlier staff reply.')).toBeNull()
  })

  it('ignores unrelated portal events and removes its subscriptions on unmount', async () => {
    mockClaimResponses(buildClaim())
    const view = renderWithProviders(
      <WarrantyClaimPortalDetailPage params={{ orgSlug: 'acme-corp', id: 'claim-1' }} />,
      { dict: enDict },
    )
    await view.findByPlaceholderText('Write a message to our support team…')
    apiCallMock.mockClear()

    dispatchPortalEvent('warranty_claims.claim.portal_status_changed', 'claim-2')
    dispatchPortalEvent('warranty_claims.claim.comment_added', 'claim-2')
    dispatchPortalEvent('warranty_claims.claim.status_changed', 'claim-1')
    dispatchPortalEvent('sales.order.status_changed', 'claim-1')
    expect(apiCallMock).not.toHaveBeenCalled()

    view.unmount()
    dispatchPortalEvent('warranty_claims.claim.portal_status_changed', 'claim-1')
    dispatchPortalEvent('warranty_claims.claim.comment_added', 'claim-1')
    expect(apiCallMock).not.toHaveBeenCalled()
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
