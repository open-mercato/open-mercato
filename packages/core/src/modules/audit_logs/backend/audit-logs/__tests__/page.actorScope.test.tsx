/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type CapturedAccessTableProps = {
  filters?: FilterDef[]
  filterValues?: FilterValues
  onFiltersApply?: (values: FilterValues) => void
  onFiltersClear?: () => void
}

let latestAccessTableProps: CapturedAccessTableProps = {}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/backend/audit-logs',
  useSearchParams: () => new URLSearchParams(),
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
  AccessLogsTable: (props: CapturedAccessTableProps) => {
    latestAccessTableProps = props
    return <div data-testid="access-table" />
  },
}))

jest.mock('../../../components/ActionLogDetailsDialog', () => ({
  ActionLogDetailsDialog: () => null,
}))

import AuditLogsPage from '../page'

const mockedRead = readApiResultOrThrow as jest.Mock
const emptyPage = { items: [], canViewTenant: true, page: 1, pageSize: 50, total: 0, totalPages: 1 }

function accessUrls(): string[] {
  return mockedRead.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/api/audit_logs/audit-logs/access?'))
}

function lastAccessParams(): URLSearchParams {
  const urls = accessUrls()
  return new URLSearchParams(urls[urls.length - 1].split('?')[1])
}

async function renderAccessTab() {
  renderWithProviders(<AuditLogsPage />, { dict: { 'audit_logs.access.title': 'Access' } })
  fireEvent.click(screen.getByRole('tab', { name: 'Access' }))
  await screen.findByTestId('access-table')
}

beforeEach(() => {
  mockedRead.mockReset()
  mockedRead.mockResolvedValue(emptyPage)
  latestAccessTableProps = {}
})

describe('AuditLogsPage access actor scope', () => {
  it('defaults to own entries without requesting actorScope=all', async () => {
    await renderAccessTab()

    await waitFor(() => expect(accessUrls().length).toBeGreaterThan(0))
    expect(lastAccessParams().has('actorScope')).toBe(false)
    await waitFor(() => expect(latestAccessTableProps.filterValues?.actorScope).toBe('self'))
    const actorScopeDef = latestAccessTableProps.filters?.find((def) => def.id === 'actorScope')
    expect(actorScopeDef?.options?.[0]?.value).toBe('self')
  })

  it('requests actorScope=all only after the user picks all', async () => {
    await renderAccessTab()
    await waitFor(() => expect(latestAccessTableProps.onFiltersApply).toBeDefined())
    const initialCount = accessUrls().length

    act(() => {
      latestAccessTableProps.onFiltersApply?.({ actorScope: 'all' })
    })

    await waitFor(() => expect(accessUrls().length).toBeGreaterThan(initialCount))
    expect(lastAccessParams().get('actorScope')).toBe('all')
    expect(latestAccessTableProps.filterValues?.actorScope).toBe('all')

    const afterAllCount = accessUrls().length
    act(() => {
      latestAccessTableProps.onFiltersClear?.()
    })

    await waitFor(() => expect(accessUrls().length).toBeGreaterThan(afterAllCount))
    expect(lastAccessParams().has('actorScope')).toBe(false)
    expect(latestAccessTableProps.filterValues?.actorScope).toBe('self')
  })

  it('does not inject an actor scope value for users without tenant-wide access', async () => {
    mockedRead.mockResolvedValue({ ...emptyPage, canViewTenant: false })

    await renderAccessTab()

    await waitFor(() => expect(accessUrls().length).toBeGreaterThan(0))
    await waitFor(() => expect(latestAccessTableProps.filters).toBeDefined())
    expect(latestAccessTableProps.filters?.some((def) => def.id === 'actorScope')).toBe(false)
    expect(latestAccessTableProps.filterValues?.actorScope).toBeUndefined()
  })
})
