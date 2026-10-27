/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { NotificationSettingsPageClient } from '../NotificationSettingsPageClient'

const apiCallMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()
const runMutationMock = jest.fn()
const scopedHeadersMock = jest.fn()
const surfaceRecordConflictMock = jest.fn()
const retryLastMutation = jest.fn(async () => true)

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: (...args: unknown[]) => scopedHeadersMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (...args: unknown[]) => runMutationMock(...args),
    retryLastMutation,
  }),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => surfaceRecordConflictMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

type RunMutationInput = {
  context: { resourceKind: string; retryLastMutation: () => Promise<boolean> }
  mutationPayload: Record<string, unknown>
}

const savedSettings = {
  panelPath: '/backend/notifications',
  strategies: {
    database: { enabled: true },
    email: { enabled: true },
    custom: {},
  },
}

describe('NotificationSettingsPageClient guarded mutation', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, result: { settings: savedSettings } })
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue({ settings: savedSettings })
    runMutationMock.mockReset()
    runMutationMock.mockImplementation(
      async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    )
    retryLastMutation.mockClear()
    scopedHeadersMock.mockReset()
    scopedHeadersMock.mockImplementation((_headers: unknown, operation: () => Promise<unknown>) => operation())
    surfaceRecordConflictMock.mockReset()
    surfaceRecordConflictMock.mockReturnValue(false)
  })

  it('saves settings through the guarded mutation path', async () => {
    renderWithProviders(<NotificationSettingsPageClient />)

    const saveButton = await screen.findByRole('button', { name: /save settings/i })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(runMutationMock).toHaveBeenCalledTimes(1)
    })
    const input = runMutationMock.mock.calls[0][0] as RunMutationInput
    expect(input.context.resourceKind).toBe('notifications.settings')
    expect(input.context.retryLastMutation).toBe(retryLastMutation)
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/notifications/settings',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})


type CatalogueItem = {
  id: string
  labelKey: string
  category?: string | null
  categoryLabel?: string | null
  channels: string[] | null
  storedChannels: string[] | null
  nonOptOut: boolean
  storedNonOptOut: boolean | null
  updatedAt: string | null
}

function catalogueItem(id: string, category?: string | null, categoryLabel?: string | null): CatalogueItem {
  return { id, labelKey: id, category, categoryLabel, channels: ['in_app', 'email'], storedChannels: null, nonOptOut: false, storedNonOptOut: null, updatedAt: '2026-10-01T10:00:00.000Z' }
}

const channelItems = [{ id: 'email', labelKey: 'Email' }, { id: 'in_app', labelKey: 'In-app' }]

function mockCatalogue(items: CatalogueItem[]) {
  readApiResultOrThrowMock.mockImplementation(async (path: string) => {
    if (path === '/api/notifications/types') return { items }
    if (path === '/api/notifications/channels') return { items: channelItems }
    return { settings: savedSettings }
  })
}

describe('NotificationSettingsPageClient category groups', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    runMutationMock.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
    scopedHeadersMock.mockImplementation((_headers: unknown, operation: () => Promise<unknown>) => operation())
    surfaceRecordConflictMock.mockReturnValue(false)
  })

  it('groups by stable keys, sorts categories, and preserves type and channel order', async () => {
    const items = [
      catalogueItem('Sales first', 'sales', 'Ventas'),
      catalogueItem('Customer first', 'customers', 'Clientes'),
      catalogueItem('Sales second', 'sales', 'Ventas'),
      catalogueItem('Auth first', 'auth', 'Autenticación'),
    ]
    mockCatalogue(items)
    renderWithProviders(<NotificationSettingsPageClient />)

    const table = await screen.findByRole('table')
    const groups = within(table).getAllByRole('rowgroup').slice(1)
    expect(groups.map((group) => within(group).getByRole('rowheader').textContent)).toEqual(['Autenticación', 'Clientes', 'Ventas'])
    const sales = screen.getByRole('rowgroup', { name: 'Ventas' })
    expect(within(sales).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual(['Sales first', 'Sales second'])
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Notification type', 'email', 'in_app', 'RequiredUsers cannot opt out when on.'])
    for (const item of items) expect(within(table).getAllByText(item.id)).toHaveLength(1)
    for (const group of groups) {
      expect(within(group).getByRole('rowheader')).toHaveAttribute('scope', 'rowgroup')
      expect(within(group).getByRole('rowheader')).toHaveAttribute('colspan', '4')
    }
  })

  it('keeps categories with the same translated label separate and falls back to raw keys', async () => {
    mockCatalogue([
      catalogueItem('One', 'alpha', 'Shared label'),
      catalogueItem('Two', 'beta', 'Shared label'),
      catalogueItem('Three', 'custom_module'),
    ])
    renderWithProviders(<NotificationSettingsPageClient />)

    const groups = await screen.findAllByRole('rowgroup', { name: 'Shared label' })
    expect(groups).toHaveLength(2)
    expect(within(groups[0]).getByText('One')).toBeVisible()
    expect(within(groups[1]).getByText('Two')).toBeVisible()
    expect(within(screen.getByRole('rowgroup', { name: 'custom_module' })).getByText('Three')).toBeVisible()
  })

  it('keeps missing categories in a localized group without colliding with real keys', async () => {
    mockCatalogue([
      catalogueItem('Null category', null),
      catalogueItem('Absent category'),
      catalogueItem('Empty category', ''),
      catalogueItem('Literal category', 'null', 'Real module'),
    ])
    renderWithProviders(<NotificationSettingsPageClient />, { locale: 'pl', dict: { 'notifications.settings.types.uncategorized': 'Inne powiadomienia' } })

    const fallback = await screen.findByRole('rowgroup', { name: 'Inne powiadomienia' })
    expect(within(fallback).getAllByRole('row')).toHaveLength(4)
    for (const label of ['Null category', 'Absent category', 'Empty category']) expect(within(fallback).getByText(label)).toBeVisible()
    expect(within(screen.getByRole('rowgroup', { name: 'Real module' })).getByText('Literal category')).toBeVisible()
    expect(within(screen.getByRole('table')).getAllByRole('rowgroup').at(-1)).toBe(fallback)
  })

  it('keeps a guarded channel save and its pending indicator within the grouped row', async () => {
    const type = catalogueItem('Order update', 'sales', 'Sales')
    mockCatalogue([type, catalogueItem('Account update', 'auth', 'Authentication')])
    let completeSave!: (value: unknown) => void
    apiCallMock.mockImplementation(() => new Promise((resolve) => { completeSave = resolve }))
    renderWithProviders(<NotificationSettingsPageClient />)

    const group = await screen.findByRole('rowgroup', { name: 'Sales' })
    const toggle = within(group).getByRole('switch', { name: 'Order update – email' })
    fireEvent.click(toggle)
    expect(runMutationMock).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ resourceId: type.id, resourceKind: 'notifications.settings', retryLastMutation }),
      mutationPayload: { id: type.id, channel: 'email', enabled: false },
    }))
    expect(apiCallMock).toHaveBeenCalledWith('/api/notifications/types/Order%20update/channels/email', { method: 'DELETE' })
    expect(within(group).getAllByRole('status')).toHaveLength(1)
    expect(within(screen.getByRole('rowgroup', { name: 'Authentication' })).queryByRole('status')).toBeNull()
    for (const control of within(screen.getByRole('table')).getAllByRole('switch')) expect(control).toBeDisabled()

    await act(async () => completeSave({ ok: true, result: { ok: true, item: { ...type, channels: ['in_app'], storedChannels: ['in_app'] } } }))
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(toggle).toBeEnabled()
    expect(within(group).queryByRole('status')).toBeNull()
    expect(scopedHeadersMock).not.toHaveBeenCalled()
  })

  it('keeps Required updates guarded and sends the record version after grouping', async () => {
    const type = catalogueItem('Order update', 'sales', 'Sales')
    mockCatalogue([type])
    apiCallMock.mockResolvedValue({ ok: true, result: { ok: true, item: { ...type, nonOptOut: true, storedNonOptOut: true } } })
    renderWithProviders(<NotificationSettingsPageClient />)

    const group = await screen.findByRole('rowgroup', { name: 'Sales' })
    const required = within(group).getByRole('switch', { name: 'Order update – Required' })
    fireEvent.click(required)
    await waitFor(() => expect(required).toHaveAttribute('aria-checked', 'true'))
    expect(runMutationMock).toHaveBeenCalledWith(expect.objectContaining({ mutationPayload: { id: type.id, nonOptOut: true } }))
    expect(scopedHeadersMock).toHaveBeenCalledWith({ 'x-om-ext-optimistic-lock-expected-updated-at': type.updatedAt }, expect.any(Function))
    expect(apiCallMock).toHaveBeenCalledWith('/api/notifications/types', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ id: type.id, nonOptOut: true }) }))
  })

  it('refreshes the grouped catalogue when a Required update conflicts', async () => {
    const type = catalogueItem('Order update', 'sales', 'Sales')
    mockCatalogue([type])
    const conflict = { code: 'optimistic_lock_conflict' }
    apiCallMock.mockResolvedValue({ ok: false, status: 409, result: conflict })
    surfaceRecordConflictMock.mockReturnValue(true)
    renderWithProviders(<NotificationSettingsPageClient />)

    const group = await screen.findByRole('rowgroup', { name: 'Sales' })
    mockCatalogue([{ ...type, nonOptOut: true }])
    fireEvent.click(within(group).getByRole('switch', { name: 'Order update – Required' }))
    await waitFor(() => expect(within(group).getByRole('switch', { name: 'Order update – Required' })).toHaveAttribute('aria-checked', 'true'))
    expect(surfaceRecordConflictMock).toHaveBeenCalledWith({ status: 409, body: conflict }, expect.any(Function), expect.objectContaining({ onRefresh: expect.any(Function) }))
  })
})
