/**
 * @jest-environment jsdom
 *
 * Guards issue #4342: the download cell anchor must not bubble its click to
 * the DataTable row handler — the row click opens the "Edit metadata" dialog,
 * so a missing stopPropagation made the Download icon open that dialog
 * instead of just downloading the file.
 *
 * Follows the repo pattern of mocking DataTable and exercising captured
 * column cells directly (see workflows page.toggleEnabled.optimisticLock
 * test) so the test stays cheap while still covering the real cell markup.
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { AttachmentLibrary } from '../AttachmentLibrary'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/backend/storage/attachments',
  useSearchParams: () => new URLSearchParams(),
}))

type CapturedTableProps = {
  columns: Array<ColumnDef<Record<string, unknown>> & { id?: string }>
  onRowClick?: (row: Record<string, unknown>) => void
}

let capturedTableProps: CapturedTableProps | null = null
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: CapturedTableProps) => {
    capturedTableProps = props
    return null
  },
}))

const apiCallMock = jest.fn(async () => ({ ok: true, result: {} }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...(args as [])),
}))

const attachmentRow = {
  id: 'att-1',
  fileName: 'invoice.pdf',
  fileSize: 2048,
  mimeType: 'application/pdf',
  partitionCode: 'default',
  partitionTitle: 'Default',
  createdAt: '2026-07-01T10:00:00.000Z',
  tags: [],
  assignments: [],
}

function renderLibraryAndCaptureTable(): CapturedTableProps {
  capturedTableProps = null
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AttachmentLibrary />
    </QueryClientProvider>,
  )
  expect(capturedTableProps).not.toBeNull()
  return capturedTableProps as unknown as CapturedTableProps
}

function renderCellInsideClickableRow(tableProps: CapturedTableProps, columnId: string) {
  const column = tableProps.columns.find((entry) => entry.id === columnId)
  expect(column).toBeDefined()
  const cell = (column as { cell?: (ctx: { row: { original: typeof attachmentRow } }) => React.ReactNode }).cell
  expect(typeof cell).toBe('function')

  // The spy stands in for DataTable's row onClick (which opens the metadata
  // dialog); mounting the real dialog is out of scope for this bubbling test.
  expect(typeof tableProps.onRowClick).toBe('function')
  const rowClickSpy = jest.fn()
  render(
    <div data-testid={`row-${columnId}`} onClick={rowClickSpy}>
      {cell!({ row: { original: attachmentRow } })}
    </div>,
  )
  return rowClickSpy
}

describe('AttachmentLibrary download cell', () => {
  it('a regular cell click bubbles to the row handler (sanity check)', () => {
    const tableProps = renderLibraryAndCaptureTable()
    const rowClickSpy = renderCellInsideClickableRow(tableProps, 'createdAt')

    fireEvent.click(screen.getByTestId('row-createdAt').firstElementChild as Element)

    expect(rowClickSpy).toHaveBeenCalledTimes(1)
  })

  it('the download anchor click does not bubble to the row handler', () => {
    const tableProps = renderLibraryAndCaptureTable()
    const rowClickSpy = renderCellInsideClickableRow(tableProps, 'download')

    fireEvent.click(screen.getByRole('link', { name: 'Download' }))

    expect(rowClickSpy).not.toHaveBeenCalled()
  })
})
