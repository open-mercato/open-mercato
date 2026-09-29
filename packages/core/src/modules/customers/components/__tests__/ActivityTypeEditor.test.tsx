/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivityTypeEditor } from '../ActivityTypeEditor'
import { calendarEventTypes } from '../../calendar-event-types'
import { E } from '#generated/entities.ids.generated'

const readMock = jest.fn()
const writeMock = jest.fn()
const confirmMock = jest.fn()
const runMutationMock = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const headerMock = jest.fn(() => ({}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => 0 }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readMock(...args),
  apiCallOrThrow: (...args: unknown[]) => writeMock(...args),
  withScopedApiRequestHeaders: (_header: unknown, operation: () => Promise<unknown>) => operation(),
}))
jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({ buildOptimisticLockHeader: (...args: unknown[]) => headerMock(...args) }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: (...args: unknown[]) => runMutationMock(...(args as [{ operation: () => Promise<unknown> }])), retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: (...args: unknown[]) => confirmMock(...args), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ data, actions, rowActions, columns }: { data: Array<{ key: string; label: string; labelKey?: string }>; actions: React.ReactNode; rowActions: (item: { key: string }) => React.ReactNode; columns: Array<{ accessorKey?: string; cell?: (props: { row: { original: { key: string; label: string; labelKey?: string } } }) => React.ReactNode }> }) =>
    <div>{actions}{data.map((item) => <div key={item.key}><span>{item.key}</span>{columns.find((column) => column.accessorKey === 'label')?.cell?.({ row: { original: item } })}{rowActions(item)}</div>)}</div>,
}))
jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; onSelect: () => void }> }) => <div>{items.map((item) =>
    <button key={item.id} type="button" onClick={item.onSelect}>{item.id}</button>)}</div>,
}))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ initialValues, onSubmit }: { initialValues: Record<string, unknown>; onSubmit: (values: Record<string, unknown>) => Promise<void> }) =>
    <button type="button" onClick={() => { void onSubmit(initialValues) }}>submit-activity-type</button>,
}))

const base = calendarEventTypes[0]!
const inherited = {
  ...base, key: 'meeting', source: 'customers', provenance: {}, historical: false,
  selectable: true, adminConfigurable: true, isInherited: true, isLocalOverride: false,
  updatedAt: '2026-01-01T00:00:00.000Z', missingCustomFieldsetIds: [],
}

describe('ActivityTypeEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    confirmMock.mockResolvedValue(true)
    writeMock.mockResolvedValue({})
    readMock.mockImplementation(async (path: string) => {
      if (path === '/api/customers/activity-types') return { items: [inherited] }
      if (path === '/api/customers/dictionaries/activity-types') return { items: [{ id: 'inherited-id', value: 'meeting', isInherited: true, updatedAt: inherited.updatedAt }] }
      if (path.startsWith('/api/entities/definitions?')) return { fieldsetsByEntity: { [E.customers.customer_interaction]: [{ code: 'agenda', label: 'Agenda' }] } }
      throw new Error(path)
    })
  })

  it('creates a local override for an inherited type while preserving its stable key and behavior', async () => {
    renderWithProviders(<ActivityTypeEditor title="Activity types" description="Manage activity types" />)
    fireEvent.click(await screen.findByRole('button', { name: 'edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'submit-activity-type' }))
    await waitFor(() => expect(writeMock).toHaveBeenCalledWith(
      '/api/customers/dictionaries/activity-types',
      expect.objectContaining({ method: 'POST' }),
    ))
    const payload = JSON.parse(writeMock.mock.calls[0][1].body)
    expect(payload.value).toBe('meeting')
    expect(payload.behavior).toMatchObject({ schemaVersion: 1, baseKind: 'meeting', fields: base.behavior.fields })
  })

  it('deletes only the local override with its optimistic-lock version', async () => {
    readMock.mockImplementation(async (path: string) => {
      if (path === '/api/customers/activity-types') return { items: [{ ...inherited, isInherited: false, isLocalOverride: true }] }
      if (path === '/api/customers/dictionaries/activity-types') return { items: [{ id: 'local-id', value: 'meeting', isInherited: false, updatedAt: inherited.updatedAt }] }
      return { fieldsetsByEntity: {} }
    })
    renderWithProviders(<ActivityTypeEditor title="Activity types" description="Manage activity types" />)
    fireEvent.click(await screen.findByRole('button', { name: 'delete' }))
    await waitFor(() => expect(writeMock).toHaveBeenCalledWith(
      '/api/customers/dictionaries/activity-types/local-id',
      { method: 'DELETE' },
    ))
    expect(headerMock).toHaveBeenCalledWith(inherited.updatedAt)
    expect(runMutationMock).toHaveBeenCalledTimes(1)
  })

  it('renders the patched label key in the activity type manager', async () => {
    readMock.mockImplementation(async (path: string) => {
      if (path === '/api/customers/activity-types') return { items: [{ ...inherited, labelKey: 'example.calendar.customerMeeting' }] }
      if (path === '/api/customers/dictionaries/activity-types') return { items: [] }
      return { fieldsetsByEntity: {} }
    })
    renderWithProviders(<ActivityTypeEditor title="Activity types" description="Manage activity types" />, {
      dict: { 'example.calendar.customerMeeting': 'Customer meeting' },
    })
    expect(await screen.findByText('Customer meeting')).toBeInTheDocument()
  })
})
