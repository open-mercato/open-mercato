/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import AttachmentDocumentSectionPage from '../page'

const apiCallMock = jest.fn()

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div data-testid="loading">{label}</div>,
  RecordNotFoundState: ({ label }: { label: string }) => <div data-testid="record-not-found">{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div data-testid="error-message">{label}</div>,
}))

const ATTACHMENT_ID = '11111111-1111-4111-8111-111111111111'
const ANCHOR_KEY = '0123456789abcdef0123456789abcdef'

function section(overrides: Record<string, unknown> = {}) {
  return {
    numberLabel: '8.12',
    heading: 'Past performance',
    headingPath: ['Terms', 'Past performance'],
    text: 'Bidders must list <script>alert(1)</script> three references.',
    textTruncated: false,
    pageStart: 3,
    pageEnd: 3,
    citation: '8.12 Past performance (p. 3)',
    ...overrides,
  }
}

function renderPage(params: { id?: string; anchorKey?: string }) {
  return renderWithProviders(<AttachmentDocumentSectionPage params={params} />)
}

describe('attachment cited section page', () => {
  beforeEach(() => apiCallMock.mockReset())

  it('loads the section by anchor key through the scoped structure API and renders it', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items: [section()] } })
    const { container } = renderPage({ id: ATTACHMENT_ID, anchorKey: ANCHOR_KEY })
    expect(await screen.findByText('8.12 Past performance (p. 3)')).toBeInTheDocument()
    const [url] = apiCallMock.mock.calls[0] as [string]
    expect(url.startsWith(`/api/attachments/structure/${ATTACHMENT_ID}/sections?`)).toBe(true)
    const query = new URLSearchParams(url.split('?')[1])
    expect(query.get('anchorKey')).toBe(ANCHOR_KEY)
    expect(query.get('limit')).toBe('1')
    expect(screen.getByText('Terms › Past performance')).toBeInTheDocument()
    expect(screen.getByTestId('attachment-cited-section').textContent).toContain('<script>alert(1)</script>')
    expect(container.querySelector('script')).toBeNull()
    const fileLink = container.querySelector(`a[href="/api/attachments/file/${ATTACHMENT_ID}?download=1"]`)
    expect(fileLink).not.toBeNull()
    expect(fileLink?.hasAttribute('download')).toBe(true)
    expect(fileLink?.textContent).toContain('Download document')
  })

  it('shows not found when the API refuses the attachment (other tenant, organization or no access)', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 404, result: { error: 'Attachment not found' } })
    renderPage({ id: ATTACHMENT_ID, anchorKey: ANCHOR_KEY })
    expect(await screen.findByTestId('record-not-found')).toBeInTheDocument()
  })

  it('shows not found when the anchor no longer matches a section', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { extractionId: null, items: [], nextCursor: null } })
    renderPage({ id: ATTACHMENT_ID, anchorKey: ANCHOR_KEY })
    expect(await screen.findByTestId('record-not-found')).toBeInTheDocument()
  })

  it('shows an error for other failures', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 500, result: null })
    renderPage({ id: ATTACHMENT_ID, anchorKey: ANCHOR_KEY })
    expect(await screen.findByTestId('error-message')).toBeInTheDocument()
  })

  it('never calls the API for malformed route params', async () => {
    renderPage({ id: '../etc', anchorKey: ANCHOR_KEY })
    expect(await screen.findByTestId('record-not-found')).toBeInTheDocument()
    renderPage({ id: ATTACHMENT_ID, anchorKey: 'not-an-anchor' })
    await waitFor(() => expect(screen.getAllByTestId('record-not-found')).toHaveLength(2))
    expect(apiCallMock).not.toHaveBeenCalled()
  })
})
