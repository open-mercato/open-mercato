/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import SchedulerPage from '../page'

let mockGrantedFeatures: string[]
const mockTranslate = (key: string, fallback?: string) => fallback ?? key
const mockPush = jest.fn()

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: mockGrantedFeatures } }),
}))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PageBody: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ actions, data, rowActions, emptyState }: {
    actions?: React.ReactNode
    data: Array<{ id: string }>
    rowActions: (row: { id: string }) => React.ReactNode
    emptyState: React.ReactNode
  }) => (
    <div>
      {actions}
      {emptyState}
      {data.map((row) => <div key={row.id}>{rowActions(row)}</div>)}
    </div>
  ),
}))
jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; label: string }> }) => (
    <div>{items.map(({ id, label }) => <span key={id}>{label}</span>)}</div>
  ),
}))
jest.mock('@open-mercato/ui/backend/filters/ListEmptyState', () => ({
  ListEmptyState: ({ createHref }: { createHref?: string }) =>
    createHref ? <a href={createHref}>Create from empty state</a> : null,
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: async () => ({ result: { items: [{ id: 'schedule-1' }] } }),
}))

describe('Scheduled Jobs controls', () => {
  it.each([
    { grants: [], manage: false, trigger: false },
    { grants: ['scheduler.jobs.manage'], manage: true, trigger: false },
    { grants: ['scheduler.jobs.trigger'], manage: false, trigger: true },
    { grants: ['scheduler.*'], manage: true, trigger: true },
  ])('shows only actions granted by $grants', async ({ grants, manage, trigger }) => {
    mockGrantedFeatures = ['scheduler.jobs.view', ...grants]
    render(<SchedulerPage />)

    await screen.findByText('View Details')
    expect(Boolean(screen.queryByText('New Schedule'))).toBe(manage)
    expect(Boolean(screen.queryByText('Create from empty state'))).toBe(manage)
    expect(Boolean(screen.queryByText('Edit'))).toBe(manage)
    expect(Boolean(screen.queryByText('Delete'))).toBe(manage)
    expect(Boolean(screen.queryByText('Run Now'))).toBe(trigger)
  })
})
