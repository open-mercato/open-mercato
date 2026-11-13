/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import TimeTrackingReportsPage from '../page'

const mockTranslate = (_key: string, fallback: string) => fallback
const mockSearchParams = new URLSearchParams()
const mockRouter = { push: jest.fn(), replace: jest.fn() }
let mockPeriodMeta: unknown

jest.mock('next/navigation', () => ({ useRouter: () => mockRouter, useSearchParams: () => mockSearchParams }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => 0 }))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: () => ({ payload: { grantedFeatures: [] } }) }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ readApiResultOrThrow: jest.fn() }))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ columns, data }: { columns: ColumnDef<Record<string, unknown>>[]; data: Record<string, unknown>[] }) => {
    const period = columns.find((column) => column.id === 'period')
    const PeriodCell = period?.cell as React.ComponentType<{ row: { original: Record<string, unknown> } }>
    mockPeriodMeta = period?.meta
    return <div>{data.map((record) => <div key={String(record.id)}><PeriodCell row={{ original: record }} /></div>)}</div>
  },
}))

it('shows distinct complete report ranges and opts out of the host truncation', async () => {
  jest.mocked(readApiResultOrThrow).mockResolvedValue({ items: [
    { id: 'report-short', title: 'September partial', period_from: '2026-09-01', period_to: '2026-09-23' },
    { id: 'report-full', title: 'September full', period_from: '2026-09-01', period_to: '2026-09-30' },
  ], total: 2 })
  render(<TimeTrackingReportsPage />)
  await waitFor(() => expect(screen.getByText('2026-09-01 – 2026-09-23')).toBeInTheDocument())
  const fullRange = screen.getByText('2026-09-01 – 2026-09-30')
  expect(fullRange).toHaveClass('whitespace-normal')
  expect(mockPeriodMeta).toEqual(expect.objectContaining({ truncate: false }))
})
