/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import enDict from '../i18n/en.json'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@open-mercato/ui/ai/AiChat', () => ({
  AiChat: () => null,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ emptyState }: { emptyState?: React.ReactNode }) => emptyState ?? null,
}))

jest.mock('@open-mercato/ui/backend/utils/useCurrentUserId', () => ({
  useCurrentUserId: () => 'claim-viewer',
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async <T,>({ operation }: { operation: () => Promise<T> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

import WarrantyClaimDetailPage from '../backend/warranty_claims/[id]/page'

const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
const CLAIM = {
  id: 'claim-1',
  claimNumber: 'WTY-000042',
  claimType: 'warranty',
  status: 'submitted',
  customerName: 'Claim viewer customer',
  currencyCode: 'USD',
  updatedAt: '2026-10-25T10:00:00.000Z',
}

let grantedFeatures: string[]
let featureResponse: Promise<Response> | null
let attachmentResponse: (recordId: string) => Promise<Response>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function attachmentRequests() {
  return fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/attachments?'))
}

function renderClaim() {
  return renderWithProviders(<WarrantyClaimDetailPage params={{ id: CLAIM.id }} />, { dict: enDict })
}

beforeEach(() => {
  jest.clearAllMocks()
  grantedFeatures = []
  featureResponse = null
  attachmentResponse = async () => jsonResponse({ items: [] })
  window.history.pushState({}, '', `/backend/warranty_claims/${CLAIM.id}`)
  ;(window as unknown as { __omOriginalFetch?: typeof fetch }).__omOriginalFetch = fetchMock
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/auth/feature-check') {
      return featureResponse ?? jsonResponse({ ok: false, granted: grantedFeatures })
    }
    if (url === '/api/warranty_claims/settings-general') return jsonResponse({ result: {} })
    if (url.startsWith('/api/warranty_claims?')) {
      const claimId = new URL(url, window.location.origin).searchParams.get('ids') ?? CLAIM.id
      return jsonResponse({ items: [{
        ...CLAIM,
        id: claimId,
        claimNumber: claimId === CLAIM.id ? CLAIM.claimNumber : 'WTY-000043',
      }] })
    }
    if (url.startsWith('/api/warranty_claims/lines?')) return jsonResponse({ items: [] })
    if (url.startsWith('/api/warranty_claims/events?')) return jsonResponse({ items: [] })
    if (url.startsWith('/api/warranty_claims/risk?')) {
      return jsonResponse({ ok: true, result: { level: 'none', signals: [] } })
    }
    if (url === '/api/warranty_claims/stats') return jsonResponse({ ok: true, result: {} })
    if (url.startsWith('/api/attachments?')) {
      const recordId = new URL(url, window.location.origin).searchParams.get('recordId') ?? ''
      return attachmentResponse(recordId)
    }
    throw new Error(`[internal] Unexpected request: ${url}`)
  })
})

afterEach(() => {
  delete (window as unknown as { __omOriginalFetch?: typeof fetch }).__omOriginalFetch
})

describe('claim detail attachment access (#7846)', () => {
  it('loads a claim for a claim-only viewer without requesting or exposing attachments', async () => {
    renderClaim()

    expect(await screen.findByRole('heading', { name: CLAIM.claimNumber, level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Lines/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /^Attachments/ })).not.toBeInTheDocument()
    expect(attachmentRequests()).toHaveLength(0)
    expect(flash).not.toHaveBeenCalled()

    const featureRequest = fetchMock.mock.calls.find(([input]) => input === '/api/auth/feature-check')
    expect(JSON.parse(String(featureRequest?.[1]?.body)).features).toContain('attachments.view')
  })

  it('keeps attachment loading off until the feature check grants access', async () => {
    const features = deferredResponse()
    featureResponse = features.promise
    renderClaim()

    expect(await screen.findByRole('heading', { name: CLAIM.claimNumber, level: 1 })).toBeInTheDocument()
    expect(attachmentRequests()).toHaveLength(0)
    expect(screen.queryByRole('tab', { name: /^Attachments/ })).not.toBeInTheDocument()

    await act(async () => features.resolve(jsonResponse({ ok: false, granted: ['attachments.view'] })))

    expect(await screen.findByRole('tab', { name: /^Attachments/ })).toBeInTheDocument()
    await waitFor(() => expect(attachmentRequests()).toHaveLength(1))
  })

  it('renders core details while the optional attachment request remains pending', async () => {
    grantedFeatures = ['attachments.view']
    const attachments = deferredResponse()
    attachmentResponse = () => attachments.promise
    renderClaim()

    expect(await screen.findByRole('heading', { name: CLAIM.claimNumber, level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Lines/ })).toBeInTheDocument()
    expect(screen.queryByText('Loading claim...')).not.toBeInTheDocument()
    await waitFor(() => expect(attachmentRequests()).toHaveLength(1))

    await act(async () => attachments.resolve(jsonResponse({ items: [] })))
  })

  it.each(['attachments.view', 'attachments.*', '*'])('loads the count for the %s grant', async (grant) => {
    grantedFeatures = [grant]
    attachmentResponse = async () => jsonResponse({ items: [{ id: 'file-1' }, { id: 'file-2' }] })
    renderClaim()

    expect(await screen.findByRole('heading', { name: CLAIM.claimNumber, level: 1 })).toBeInTheDocument()
    const attachmentTab = await screen.findByRole('tab', { name: /^Attachments/ })
    await waitFor(() => expect(within(attachmentTab).getByText('2')).toBeInTheDocument())
  })

  it('keeps the attachment panel available for an authorized viewer', async () => {
    grantedFeatures = ['attachments.view']
    attachmentResponse = async () => jsonResponse({ items: [{
      id: 'file-1',
      fileName: 'proof.pdf',
      fileSize: 1024,
      url: '/files/proof.pdf',
    }] })
    renderClaim()

    const attachmentTab = await screen.findByRole('tab', { name: /^Attachments/ })
    fireEvent.click(attachmentTab)

    expect(await screen.findByRole('link', { name: 'proof.pdf' })).toHaveAttribute('href', '/files/proof.pdf')
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeDisabled()
    expect(flash).not.toHaveBeenCalled()
  })
  it('ignores a stale attachment count after navigating to another claim', async () => {
    grantedFeatures = ['attachments.view']
    const previousAttachments = deferredResponse()
    attachmentResponse = async (recordId) => recordId === CLAIM.id
      ? previousAttachments.promise
      : jsonResponse({ items: [{ id: 'next-file' }] })
    const view = renderClaim()

    expect(await screen.findByRole('heading', { name: CLAIM.claimNumber, level: 1 })).toBeInTheDocument()
    await waitFor(() => expect(attachmentRequests()).toHaveLength(1))
    view.rerender(<WarrantyClaimDetailPage params={{ id: 'claim-2' }} />)

    expect(await screen.findByRole('heading', { name: 'WTY-000043', level: 1 })).toBeInTheDocument()
    const attachmentTab = await screen.findByRole('tab', { name: /^Attachments/ })
    await waitFor(() => expect(within(attachmentTab).getByText('1')).toBeInTheDocument())
    await act(async () => previousAttachments.resolve(jsonResponse({ items: [
      { id: 'previous-file-1' },
      { id: 'previous-file-2' },
    ] })))

    expect(within(attachmentTab).getByText('1')).toBeInTheDocument()
    expect(within(attachmentTab).queryByText('2')).not.toBeInTheDocument()
  })
  it.each(['forbidden', 'network'])('isolates an optional %s failure without a forbidden notice', async (failure) => {
    grantedFeatures = ['attachments.view']
    attachmentResponse = async () => {
      if (failure === 'network') throw new TypeError('Failed to fetch')
      return jsonResponse({ error: 'Forbidden', requiredFeatures: ['attachments.view'] }, 403)
    }
    renderClaim()

    expect(await screen.findByRole('heading', { name: CLAIM.claimNumber, level: 1 })).toBeInTheDocument()
    const attachmentTab = await screen.findByRole('tab', { name: /^Attachments/ })
    await waitFor(() => expect(attachmentRequests()).toHaveLength(1))
    await act(async () => {})
    const [, init] = attachmentRequests()[0]
    expect(new Headers(init?.headers).get('x-om-forbidden-redirect')).toBe('0')
    expect(within(attachmentTab).getByText('0')).toBeInTheDocument()
    expect(flash).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: /^Lines/ })).toBeInTheDocument()
  })
})
