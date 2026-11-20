/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const LOG_ID = '55555555-5555-4555-8555-555555555555'
let mockSearch = new URLSearchParams()
const mockReplace = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: mockReplace, prefetch: jest.fn() }),
  usePathname: () => '/backend/audit-logs',
  useSearchParams: () => mockSearch,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: jest.fn(),
}))

jest.mock('../../../components/AuditLogsActions', () => ({
  AuditLogsActions: () => <div data-testid="actions-table" />,
}))

jest.mock('../../../components/AccessLogsTable', () => ({
  AccessLogsTable: () => <div data-testid="access-table" />,
}))

jest.mock('../../../components/ActionLogDetailsDialog', () => ({
  ActionLogDetailsDialog: ({ item, onClose }: { item: { id: string }; onClose: () => void }) => (
    <div data-testid="action-log-details-dialog">
      {item.id}
      <button type="button" onClick={onClose}>close-dialog</button>
    </div>
  ),
}))

import AuditLogsPage from '../page'

const mockedRead = readApiResultOrThrow as jest.Mock
const emptyPage = { items: [], canViewTenant: true, page: 1, pageSize: 50, total: 0, totalPages: 1 }

function respond(linked: Array<{ id: string }>) {
  mockedRead.mockImplementation(async (url: string) => {
    if (url.includes('ids=')) return { ...emptyPage, items: linked, total: linked.length }
    return emptyPage
  })
}

beforeEach(() => {
  mockedRead.mockReset()
  mockReplace.mockReset()
  mockSearch = new URLSearchParams()
})

describe('AuditLogsPage ?logId=', () => {
  it('opens the details dialog for the linked entry', async () => {
    mockSearch = new URLSearchParams({ logId: LOG_ID })
    respond([{ id: LOG_ID }])

    renderWithProviders(<AuditLogsPage />)

    expect(await screen.findByTestId('action-log-details-dialog')).toHaveTextContent(LOG_ID)
    expect(mockedRead).toHaveBeenCalledWith(
      `/api/audit_logs/audit-logs/actions?ids=${LOG_ID}&pageSize=1`,
      undefined,
      expect.anything(),
    )
  })

  it('removes logId from the URL when the deep-linked dialog is closed', async () => {
    mockSearch = new URLSearchParams({ logId: LOG_ID, tab: 'actions' })
    respond([{ id: LOG_ID }])

    renderWithProviders(<AuditLogsPage />)

    await screen.findByTestId('action-log-details-dialog')
    fireEvent.click(screen.getByText('close-dialog'))

    expect(screen.queryByTestId('action-log-details-dialog')).not.toBeInTheDocument()
    expect(mockReplace).toHaveBeenCalledWith('/backend/audit-logs?tab=actions')
  })

  it('shows a not-found message when the entry is missing or out of scope', async () => {
    mockSearch = new URLSearchParams({ logId: LOG_ID })
    respond([])

    renderWithProviders(<AuditLogsPage />, {
      dict: { 'audit_logs.error.entry_not_found': 'Entry not found' },
    })

    expect(await screen.findByText('Entry not found')).toBeInTheDocument()
    expect(screen.queryByTestId('action-log-details-dialog')).not.toBeInTheDocument()
  })

  it('ignores a malformed logId without an extra request', async () => {
    mockSearch = new URLSearchParams({ logId: 'not-a-uuid' })
    respond([])

    renderWithProviders(<AuditLogsPage />)

    await waitFor(() => expect(mockedRead).toHaveBeenCalled())
    expect(mockedRead.mock.calls.some(([url]) => String(url).includes('ids='))).toBe(false)
    expect(screen.queryByTestId('action-log-details-dialog')).not.toBeInTheDocument()
  })
})
