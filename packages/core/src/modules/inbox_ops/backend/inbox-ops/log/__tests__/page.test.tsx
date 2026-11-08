/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import ProcessingLogPage from '../page'

type Row = Record<string, unknown> & { id: string }
type Column = { cell?: (input: { row: { original: Row } }) => React.ReactNode }

const apiCallMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const confirmMock = jest.fn()
const runContexts: Array<{ contextId: string; context: Record<string, unknown> }> = []

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, operation: () => Promise<unknown>) => operation(),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: (...args: unknown[]) => confirmMock(...args), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => {
  const retryLastMutation = async () => true
  return {
    useGuardedMutation: ({ contextId }: { contextId: string }) => ({
      runMutation: async <T,>({ operation, context }: { operation: () => Promise<T>; context: Record<string, unknown> }): Promise<T> => {
        runContexts.push({ contextId, context })
        return operation()
      },
      retryLastMutation,
    }),
  }
})
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ columns, data, rowActions }: { columns: Column[]; data: Row[]; rowActions?: (row: Row) => React.ReactNode }) => (
    <table>
      <tbody>
        {data.map((row) => (
          <tr key={row.id} data-testid={`row-${row.id}`}>
            {columns.map((column, index) => <td key={index}>{column.cell?.({ row: { original: row } })}</td>)}
            <td>{rowActions?.(row)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}))
jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id?: string; label: string; onSelect?: () => void }> }) => (
    <div>{items.map((item) => <button key={item.id} type="button" onClick={item.onSelect}>{item.label}</button>)}</div>
  ),
}))

const flashMock = flash as jest.Mock

const ROWS: Row[] = [
  { id: 'email-plain', subject: 'Plain mail', forwardedByAddress: 'a@example.test', status: 'failed', receivedAt: '2026-11-08T10:00:00.000Z', attachmentsStatus: null, attachmentsRetryable: false },
  { id: 'email-files', subject: 'Offer with files', forwardedByAddress: 'b@example.test', status: 'processed', receivedAt: '2026-11-08T10:00:00.000Z', updatedAt: '2026-11-08T10:01:00.000Z', attachmentsStatus: 'completed', attachmentsRetryable: false },
  { id: 'email-retryable', subject: 'Offer timed out', forwardedByAddress: 'c@example.test', status: 'processed', receivedAt: '2026-11-08T10:00:00.000Z', attachmentsStatus: 'completed', attachmentsRetryable: true },
]

function configureApi(options: { granted?: string[]; reprocess?: { status: number; result: unknown } } = {}) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/inbox_ops/emails?')) return { ok: true, status: 200, result: { items: ROWS, total: ROWS.length } }
    if (url === '/api/auth/feature-check') return { ok: true, status: 200, result: { ok: true, granted: options.granted ?? ['inbox_ops.proposals.manage'] } }
    if (url.endsWith('/attachments')) {
      return { ok: true, status: 200, result: { items: [{ id: 'part-1', partKey: 'resend:a', fileName: 'offer.pdf', mimeType: 'application/pdf', sizeBytes: 10, disposition: 'attachment', status: 'stored', reason: null, attachmentId: 'att-1', url: '/api/attachments/file/att-1' }] } }
    }
    if (url.endsWith('/reprocess')) {
      const reprocess = options.reprocess ?? { status: 200, result: { ok: true, retiredProposalCount: 0, retiredActionCount: 0 } }
      return { ok: reprocess.status === 200, status: reprocess.status, result: reprocess.result }
    }
    throw new Error(`unexpected request ${url}`)
  })
}

function requestsTo(fragment: string): unknown[][] {
  return apiCallMock.mock.calls.filter(([url]) => typeof url === 'string' && url.includes(fragment))
}

async function renderPage() {
  renderWithProviders(<ProcessingLogPage />)
  await screen.findByText('Offer with files')
}

beforeEach(() => {
  jest.clearAllMocks()
  runContexts.length = 0
  confirmMock.mockResolvedValue(true)
})

describe('ProcessingLogPage attachments, Retry and Delete', () => {
  it('offers "Show attachments" only for emails with an ingest, and loads the list only when the dialog opens', async () => {
    configureApi()
    await renderPage()

    expect(within(screen.getByTestId('row-email-plain')).queryByText('Show attachments')).toBeNull()
    expect(requestsTo('/attachments')).toHaveLength(0)

    fireEvent.click(within(screen.getByTestId('row-email-files')).getByText('Show attachments'))

    expect(await screen.findByText('offer.pdf')).toBeTruthy()
    expect(requestsTo('/attachments').map(([url]) => url)).toEqual(['/api/inbox_ops/emails/email-files/attachments'])
  })

  it('hides Delete when the feature check denies inbox_ops.proposals.manage', async () => {
    configureApi({ granted: ['inbox_ops.log.view'] })
    await renderPage()
    await waitFor(() => expect(requestsTo('/api/auth/feature-check')).toHaveLength(1))
    expect(screen.queryByText('Delete email')).toBeNull()
  })

  it('deletes from the row action and reloads the log', async () => {
    configureApi()
    apiCallOrThrowMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true } })
    await renderPage()

    fireEvent.click(await within(screen.getByTestId('row-email-files')).findByText('Delete email'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true })

    await waitFor(() => expect(requestsTo('/api/inbox_ops/emails?')).toHaveLength(2))
    expect(apiCallOrThrowMock).toHaveBeenCalledWith('/api/inbox_ops/emails/email-files', expect.objectContaining({ method: 'DELETE' }), expect.any(Object))
    expect(runContexts.find((entry) => entry.contextId === 'inbox-ops-email-delete')?.context.retryLastMutation).toEqual(expect.any(Function))
  })

  it('offers Retry for retryable ingests, confirms on a processed email and reloads on success', async () => {
    configureApi()
    await renderPage()
    expect(within(screen.getByTestId('row-email-files')).queryByText('Retry')).toBeNull()

    confirmMock.mockResolvedValueOnce(false)
    fireEvent.click(within(screen.getByTestId('row-email-retryable')).getByText('Retry'))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(requestsTo('/reprocess')).toHaveLength(0)

    fireEvent.click(within(screen.getByTestId('row-email-retryable')).getByText('Retry'))
    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Reprocessing started', 'success'))
    expect(requestsTo('/reprocess')[0]).toEqual([
      '/api/inbox_ops/emails/email-retryable/reprocess',
      { method: 'POST', headers: { 'x-om-forbidden-redirect': '0' } },
    ])
    expect(requestsTo('/api/inbox_ops/emails?')).toHaveLength(2)
    expect(runContexts.find((entry) => entry.contextId === 'inbox-ops-log')?.context.retryLastMutation).toEqual(expect.any(Function))
  })

  it('retries a failed email without asking for confirmation', async () => {
    configureApi()
    await renderPage()
    fireEvent.click(within(screen.getByTestId('row-email-plain')).getByText('Retry'))
    await waitFor(() => expect(requestsTo('/reprocess')).toHaveLength(1))
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it.each([
    [409, 'The attachments of this email are being processed. Try again later.'],
    [403, 'Forbidden'],
  ])('shows the route message when Retry is refused with %s', async (status, error) => {
    configureApi({ reprocess: { status, result: { error } } })
    await renderPage()
    fireEvent.click(within(screen.getByTestId('row-email-plain')).getByText('Retry'))
    await waitFor(() => expect(flashMock).toHaveBeenCalledWith(error, 'error'))
    expect(requestsTo('/api/inbox_ops/emails?')).toHaveLength(1)
  })
})
