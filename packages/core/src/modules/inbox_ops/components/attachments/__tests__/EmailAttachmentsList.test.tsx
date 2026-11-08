/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { EmailAttachmentsList } from '../EmailAttachmentsList'
import { EmailAttachmentsDialog } from '../EmailAttachmentsDialog'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

const EMAIL_ID = '33333333-3333-4333-8333-333333333333'

function part(overrides: Record<string, unknown>) {
  return {
    id: `part-${String(overrides.partKey ?? 'a')}`,
    partKey: 'resend:a',
    fileName: 'offer.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    disposition: 'attachment',
    status: 'stored',
    reason: null,
    attachmentId: '00000000-0000-4000-8000-000000000001',
    url: '/api/attachments/file/00000000-0000-4000-8000-000000000001',
    ...overrides,
  }
}

function respond(status: number, result: unknown) {
  apiCallMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, result })
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('EmailAttachmentsList', () => {
  it('shows a loading state, then the parts with downloads, statuses and translated reasons', async () => {
    let resolve: (value: unknown) => void = () => undefined
    apiCallMock.mockReturnValue(new Promise((done) => { resolve = done }))
    renderWithProviders(<EmailAttachmentsList emailId={EMAIL_ID} />)
    expect(screen.getByText('Loading attachments...')).toBeTruthy()

    resolve({
      ok: true,
      status: 200,
      result: {
        items: [
          part({}),
          part({ partKey: 'resend:b', fileName: 'setup.exe', status: 'skipped', reason: 'dangerous_executable', attachmentId: null, url: null, sizeBytes: 3 * 1024 * 1024 }),
          part({ partKey: 'resend:c', fileName: null, status: 'failed', reason: 'quota_exceeded', attachmentId: null, url: null, sizeBytes: null }),
          part({ partKey: 'resend:d', fileName: 'late.pdf', status: 'pending', attachmentId: null, url: null, sizeBytes: 12 }),
        ],
      },
    })

    const download = await screen.findByRole('link', { name: 'Download offer.pdf' })
    expect(download.getAttribute('href')).toBe('/api/attachments/file/00000000-0000-4000-8000-000000000001')
    expect(screen.getByText('application/pdf · 2.0 KB')).toBeTruthy()
    expect(screen.getByText('Skipped')).toBeTruthy()
    expect(screen.getByText('Executable files are not stored')).toBeTruthy()
    expect(screen.getByText('application/pdf · 3.0 MB')).toBeTruthy()
    expect(screen.getByText('Unnamed attachment')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText('The attachment storage quota is exhausted')).toBeTruthy()
    expect(screen.getByText('Pending')).toBeTruthy()
    expect(screen.getByText('application/pdf · 12 B')).toBeTruthy()

    const [url, init] = apiCallMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/inbox_ops/emails/${EMAIL_ID}/attachments`)
    expect(init.headers).toEqual({ 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('shows the empty state, or nothing when asked to hide an empty list', async () => {
    respond(200, { items: [] })
    const { unmount } = renderWithProviders(<EmailAttachmentsList emailId={EMAIL_ID} asSection />)
    expect(await screen.findByText('No attachments were recorded for this email.')).toBeTruthy()
    expect(screen.getByText('Attachments')).toBeTruthy()
    unmount()

    const hidden = renderWithProviders(<EmailAttachmentsList emailId={EMAIL_ID} asSection hideWhenEmpty />)
    await waitFor(() => expect(hidden.container.textContent).toBe(''))
  })

  it.each([401, 403, 404])('hides the whole section on %s', async (status) => {
    respond(status, { error: 'Forbidden' })
    const { container } = renderWithProviders(<EmailAttachmentsList emailId={EMAIL_ID} asSection />)
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('renders the empty state without a request when the caller knows the email has no parts', () => {
    renderWithProviders(<EmailAttachmentsList emailId={EMAIL_ID} asSection knownEmpty />)
    expect(screen.getByText('No attachments were recorded for this email.')).toBeTruthy()
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('renders nothing while loading when an empty list would be hidden', () => {
    apiCallMock.mockReturnValue(new Promise(() => undefined))
    const { container } = renderWithProviders(<EmailAttachmentsList emailId={EMAIL_ID} asSection hideWhenEmpty />)
    expect(container.textContent).toBe('')
    expect(screen.queryByText('Loading attachments...')).toBeNull()
  })

  it('shows an error state for other failures', async () => {
    respond(500, { error: 'boom' })
    renderWithProviders(<EmailAttachmentsList emailId={EMAIL_ID} />)
    expect(await screen.findByText('Failed to load attachments')).toBeTruthy()
  })

  it('retries the request from the error state', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: false, status: 500, result: { error: 'boom' } })
    renderWithProviders(<EmailAttachmentsList emailId={EMAIL_ID} />)
    expect(await screen.findByText('Failed to load attachments')).toBeTruthy()

    apiCallMock.mockResolvedValueOnce({ ok: true, status: 200, result: { items: [part({})] } })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('offer.pdf')).toBeTruthy()
    expect(screen.queryByText('Failed to load attachments')).toBeNull()
    expect(apiCallMock).toHaveBeenCalledTimes(2)
  })

  it('formats sizes for the active locale', async () => {
    respond(200, { items: [part({ sizeBytes: 1536 }), part({ partKey: 'resend:b', fileName: 'big.pdf', sizeBytes: 5 * 1024 * 1024 + 512 * 1024 })] })
    renderWithProviders(<EmailAttachmentsList emailId={EMAIL_ID} />, { locale: 'pl' })
    expect(await screen.findByText('application/pdf · 1,5 KB')).toBeTruthy()
    expect(screen.getByText('application/pdf · 5,5 MB')).toBeTruthy()
  })

  it('shows an error state when the request throws', async () => {
    apiCallMock.mockRejectedValue(new Error('network down'))
    renderWithProviders(<EmailAttachmentsList emailId={EMAIL_ID} />)
    expect(await screen.findByText('Failed to load attachments')).toBeTruthy()
  })

  it('aborts its request on unmount', () => {
    apiCallMock.mockReturnValue(new Promise(() => undefined))
    const { unmount } = renderWithProviders(<EmailAttachmentsList emailId={EMAIL_ID} />)
    const [, init] = apiCallMock.mock.calls[0] as [string, RequestInit]
    unmount()
    expect(init.signal?.aborted).toBe(true)
  })
})

describe('EmailAttachmentsDialog', () => {
  it('loads the list only while open and closes with Cmd/Ctrl+Enter', async () => {
    respond(200, { items: [part({})] })
    const onClose = jest.fn()
    const { rerender } = renderWithProviders(<EmailAttachmentsDialog email={null} onClose={onClose} />)
    expect(apiCallMock).not.toHaveBeenCalled()

    rerender(<EmailAttachmentsDialog email={{ id: EMAIL_ID, subject: 'Offer 42' }} onClose={onClose} />)
    expect(await screen.findByText('offer.pdf')).toBeTruthy()
    expect(screen.getByText('Offer 42')).toBeTruthy()
    expect(apiCallMock).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', metaKey: true })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
