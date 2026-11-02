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
const reportErrorMock = jest.fn()
const formInitialValuesMock = jest.fn()
let mockScopeVersion = 0

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => mockScopeVersion }))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: () => false }))
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
    { formInitialValuesMock(initialValues); return <button type="button" onClick={() => { void onSubmit(initialValues) }}>submit-activity-type</button> },
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
    mockScopeVersion = 0
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

  it('seeds the optimistic-lock version from the stored row when the catalog serves an unchanged built-in without one', async () => {
    const storedUpdatedAt = '2026-10-09T15:01:35.000Z'
    readMock.mockImplementation(async (path: string) => {
      if (path === '/api/customers/activity-types') return { items: [{ ...inherited, isInherited: false, updatedAt: null }] }
      if (path === '/api/customers/dictionaries/activity-types') return { items: [{ id: 'seeded-id', value: 'meeting', isInherited: false, updatedAt: storedUpdatedAt }] }
      if (path.startsWith('/api/entities/definitions?')) return { fieldsetsByEntity: { [E.customers.customer_interaction]: [] } }
      throw new Error(path)
    })
    renderWithProviders(<ActivityTypeEditor title="Activity types" description="Manage activity types" />)
    fireEvent.click(await screen.findByRole('button', { name: 'edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'submit-activity-type' }))
    await waitFor(() => expect(writeMock).toHaveBeenCalledWith(
      '/api/customers/dictionaries/activity-types/seeded-id',
      expect.objectContaining({ method: 'PATCH' }),
    ))
    expect(formInitialValuesMock).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: storedUpdatedAt }))
  })

  it('keeps the optimistic-lock version captured when the dialog opened across a reload', async () => {
    const openedUpdatedAt = '2026-10-09T15:01:35.000Z'
    let storedUpdatedAt = openedUpdatedAt
    readMock.mockImplementation(async (path: string) => {
      if (path === '/api/customers/activity-types') return { items: [{ ...inherited, isInherited: false, updatedAt: null }] }
      if (path === '/api/customers/dictionaries/activity-types') return { items: [{ id: 'seeded-id', value: 'meeting', isInherited: false, updatedAt: storedUpdatedAt }] }
      if (path.startsWith('/api/entities/definitions?')) return { fieldsetsByEntity: { [E.customers.customer_interaction]: [] } }
      throw new Error(path)
    })
    const view = renderWithProviders(<ActivityTypeEditor title="Activity types" description="Manage activity types" />)
    fireEvent.click(await screen.findByRole('button', { name: 'edit' }))
    await screen.findByRole('button', { name: 'submit-activity-type' })
    storedUpdatedAt = '2026-10-10T08:00:00.000Z'
    const dictionaryReads = () => readMock.mock.calls.filter(([path]) => path === '/api/customers/dictionaries/activity-types').length
    const readsBefore = dictionaryReads()
    mockScopeVersion = 1
    view.rerender(<ActivityTypeEditor title="Activity types" description="Manage activity types" />)
    await waitFor(() => expect(dictionaryReads()).toBeGreaterThan(readsBefore))
    fireEvent.click(await screen.findByRole('button', { name: 'submit-activity-type' }))
    await waitFor(() => expect(writeMock).toHaveBeenCalled())
    expect(formInitialValuesMock.mock.calls.length).toBeGreaterThan(0)
    formInitialValuesMock.mock.calls.forEach(([values]) => expect(values).toEqual(expect.objectContaining({ updatedAt: openedUpdatedAt })))
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

  it('reports catalog load failures to telemetry once', async () => {
    const error = new Error('catalog unavailable')
    readMock.mockImplementation(async (path: string) => {
      if (path === '/api/customers/activity-types') throw error
      if (path === '/api/customers/dictionaries/activity-types') return { items: [] }
      throw new Error(path)
    })

    renderWithProviders(<ActivityTypeEditor title="Activity types" description="Manage activity types" />)

    expect(await screen.findByText('Failed to load activity types.')).toBeInTheDocument()
    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(error, {
      module: 'customers',
      code: 'customers.activity_type_settings_load_failed',
    })
  })

  it('reports fieldset load failures to telemetry once', async () => {
    const error = new Error('fieldsets unavailable')
    readMock.mockImplementation(async (path: string) => {
      if (path === '/api/customers/activity-types') return { items: [inherited] }
      if (path === '/api/customers/dictionaries/activity-types') return { items: [] }
      if (path.startsWith('/api/entities/definitions?')) throw error
      throw new Error(path)
    })

    renderWithProviders(<ActivityTypeEditor title="Activity types" description="Manage activity types" />)
    fireEvent.click(await screen.findByRole('button', { name: 'edit' }))

    expect(await screen.findByText('Fieldsets are unavailable. Retry loading before saving.')).toBeInTheDocument()
    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(error, {
      module: 'customers',
      code: 'customers.activity_type_fieldsets_load_failed',
    })
  })

  it('reports delete mutation failures to telemetry once', async () => {
    const error = new Error('delete unavailable')
    readMock.mockImplementation(async (path: string) => {
      if (path === '/api/customers/activity-types') return { items: [{ ...inherited, isInherited: false, isLocalOverride: true }] }
      if (path === '/api/customers/dictionaries/activity-types') return { items: [{ id: 'local-id', value: 'meeting', isInherited: false, updatedAt: inherited.updatedAt }] }
      return { fieldsetsByEntity: {} }
    })
    writeMock.mockRejectedValueOnce(error)

    renderWithProviders(<ActivityTypeEditor title="Activity types" description="Manage activity types" />)
    fireEvent.click(await screen.findByRole('button', { name: 'delete' }))

    await waitFor(() => expect(reportErrorMock).toHaveBeenCalledTimes(1))
    expect(reportErrorMock).toHaveBeenCalledWith(error, {
      module: 'customers',
      code: 'customers.activity_type_settings_remove_failed',
    })
  })
})
