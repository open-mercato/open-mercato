/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import enDict from '../i18n/en.json'
import type { XeroConnectionView, XeroOrganisationsView } from '../widgets/injection/xero-tab/types'

const mockApiCall = jest.fn()
const mockApiCallOrThrow = jest.fn()
const mockFlash = jest.fn()
const mockReplace = jest.fn()
const mockConfirm = jest.fn()
let mockSearch = ''
let scopedHeaders: Record<string, string> = {}

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  apiCallOrThrow: (...args: unknown[]) => mockApiCallOrThrow(...args),
  withScopedApiRequestHeaders: async <T,>(headers: Record<string, string>, operation: () => Promise<T>) => {
    scopedHeaders = headers
    try {
      return await operation()
    } finally {
      scopedHeaders = {}
    }
  },
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: async () => false,
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: (...args: unknown[]) => mockConfirm(...args), ConfirmDialogElement: null }),
}))

const mockNavigate = jest.fn()

jest.mock('../widgets/injection/xero-tab/navigation', () => ({
  navigateToXero: (...args: unknown[]) => mockNavigate(...args),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/backend/integrations/sync_xero',
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

import XeroTabWidget, { resolveXeroTabState, revocationUnconfirmed } from '../widgets/injection/xero-tab/widget.client'
import { injectionTable, XERO_TAB_WIDGET_ID } from '../widgets/injection-table'
import { integration } from '../integration'

const XERO_ORG_A = '996096ec-5362-40dd-be90-3e6a2be09dce'
const XERO_ORG_B = '1b2c3d4e-5f60-4718-a9b0-c1d2e3f4a5b6'

function connectionView(overrides: Partial<XeroConnectionView> = {}, grant: Partial<XeroConnectionView['grant']> = {}): XeroConnectionView {
  return {
    redirectUri: 'http://localhost:3000/api/sync_xero/oauth/callback',
    baseUrlMissing: false,
    configured: true,
    canManage: true,
    ...overrides,
    grant: {
      status: 'active',
      connectionState: 'active',
      unavailableReason: null,
      organisation: { id: XERO_ORG_A, name: 'Demo Company (Global)' },
      previousOrganisation: null,
      revisedAt: '2026-10-13T10:00:00.000Z',
      refreshedAt: null,
      obtainedAt: '2026-10-13T10:00:00.000Z',
      refreshExpiresInDays: 60,
      clientChanged: false,
      missingScopes: [],
      lastDisconnect: null,
      ...grant,
    },
  }
}

const organisations: XeroOrganisationsView = {
  organisations: [
    { xeroOrganisationId: XERO_ORG_A, xeroConnectionId: 'a0a0a0a0-0000-4000-8000-00000000000a', name: 'Demo Company (Global)' },
    { xeroOrganisationId: XERO_ORG_B, xeroConnectionId: 'b0b0b0b0-0000-4000-8000-00000000000b', name: 'Second Ltd' },
  ],
  filtered: true,
  selected: null,
  previous: [],
}

function serve(connection: XeroConnectionView, organisationsView: XeroOrganisationsView = organisations): void {
  mockApiCall.mockImplementation(async (url: string) => {
    if (url === '/api/sync_xero/connection') return { ok: true, status: 200, result: connection }
    if (url.startsWith('/api/sync_xero/organisations')) return { ok: true, status: 200, result: organisationsView }
    return { ok: false, status: 404, result: null }
  })
}

function renderTab(context: Record<string, unknown> = {}) {
  return renderWithProviders(<XeroTabWidget context={{ integrationId: 'sync_xero', ...context }} />, { dict: enDict })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSearch = ''
  scopedHeaders = {}
  mockConfirm.mockResolvedValue(true)
})

describe('Xero tab placement', () => {
  it('injects the tab with groupId equal to the integration connectTabId', () => {
    const [slot] = injectionTable[integration.detailPage?.widgetSpotId as string] as Array<{ widgetId: string; groupId?: string; kind?: string }>
    expect(slot.widgetId).toBe(XERO_TAB_WIDGET_ID)
    expect(slot.kind).toBe('tab')
    expect(slot.groupId).toBe(integration.detailPage?.connectTabId)
  })
})

describe('resolveXeroTabState', () => {
  it.each([
    [{ connectionState: 'not_configured' as const }, 'not_configured'],
    [{ status: 'none' as const, connectionState: 'not_connected' as const }, 'not_connected'],
    [{ status: 'unavailable' as const, connectionState: 'unavailable' as const }, 'unavailable'],
    [{ status: 'invalidated' as const, connectionState: 'invalidated' as const }, 'invalidated'],
    [{ organisation: null }, 'account_pending'],
    [{}, 'connected'],
  ])('maps %p to %s', (grant, expected) => {
    expect(resolveXeroTabState(connectionView({}, grant))).toBe(expected)
  })

  it('treats a failed or long-pending revocation as unconfirmed', () => {
    const at = '2026-10-13T10:00:00.000Z'
    const now = Date.parse(at) + 6 * 60 * 1000
    expect(revocationUnconfirmed(connectionView({}, { lastDisconnect: { at, disconnectId: 'd', revocation: 'failed' } }), now)).toBe(true)
    expect(revocationUnconfirmed(connectionView({}, { lastDisconnect: { at, disconnectId: 'd', revocation: 'pending' } }), now)).toBe(true)
    expect(revocationUnconfirmed(connectionView({}, { lastDisconnect: { at, disconnectId: 'd', revocation: 'pending' } }), Date.parse(at))).toBe(false)
    expect(revocationUnconfirmed(connectionView({}, { lastDisconnect: { at, disconnectId: 'd', revocation: 'confirmed' } }), now)).toBe(false)
  })
})

describe('Xero tab', () => {
  it('asks for the Client Configuration and opens the Credentials tab', async () => {
    serve(connectionView({ configured: false }, { status: 'none', connectionState: 'not_configured', organisation: null }))
    const setActiveTab = jest.fn()
    renderTab({ setActiveTab })
    expect(await screen.findByText(enDict['sync_xero.tab.notConfigured'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: enDict['sync_xero.tab.openCredentials'] }))
    expect(setActiveTab).toHaveBeenCalledWith('credentials')
  })

  it('starts the Connect and navigates to the Xero authorization URL', async () => {
    serve(connectionView({}, { status: 'none', connectionState: 'not_connected', organisation: null }))
    mockApiCallOrThrow.mockResolvedValue({ ok: true, status: 200, result: { authorizeUrl: 'https://login.xero.com/identity/connect/authorize?x=1' } })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: enDict['sync_xero.tab.connect'] }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('https://login.xero.com/identity/connect/authorize?x=1'))
    expect(mockApiCallOrThrow).toHaveBeenCalledWith('/api/sync_xero/oauth/initiate', expect.objectContaining({ method: 'POST', body: '{}' }))
  })

  it('disables Connect while APP_URL is missing', async () => {
    serve(connectionView({ baseUrlMissing: true, redirectUri: null }, { status: 'none', connectionState: 'not_connected', organisation: null }))
    renderTab()
    const connect = await screen.findByRole('button', { name: enDict['sync_xero.tab.connect'] })
    expect((connect as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(enDict['sync_xero.tab.baseUrlMissing'])).toBeTruthy()
  })

  it('disables every action for a viewer who cannot manage credentials', async () => {
    serve(connectionView({ canManage: false }))
    renderTab()
    expect(await screen.findByText(enDict['sync_xero.tab.readOnly'])).toBeTruthy()
    for (const button of screen.getAllByRole('button').filter((entry) => entry.getAttribute('aria-label') === null)) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('offers Reconnect for an invalidated grant', async () => {
    serve(connectionView({}, { status: 'invalidated', connectionState: 'invalidated' }))
    renderTab()
    expect(await screen.findByText(enDict['sync_xero.tab.invalidated'])).toBeTruthy()
    expect(screen.getByRole('button', { name: enDict['sync_xero.tab.reconnect'] })).toBeTruthy()
  })

  it('replaces an unreadable connection only after confirmation, with replaceUnreadable in the initiate body', async () => {
    serve(connectionView({}, { status: 'unavailable', connectionState: 'unavailable', unavailableReason: 'unreadable', organisation: null }))
    mockApiCallOrThrow.mockResolvedValue({ ok: true, status: 200, result: { authorizeUrl: 'https://login.xero.com/x' } })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: enDict['sync_xero.tab.unavailable.replace'] }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    await waitFor(() =>
      expect(mockApiCallOrThrow).toHaveBeenCalledWith('/api/sync_xero/oauth/initiate', expect.objectContaining({ body: JSON.stringify({ replaceUnreadable: true }) })),
    )
  })

  it('does not replace an unreadable connection when the confirmation is declined', async () => {
    serve(connectionView({}, { status: 'unavailable', connectionState: 'unavailable', unavailableReason: 'unreadable', organisation: null }))
    mockConfirm.mockResolvedValue(false)
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: enDict['sync_xero.tab.unavailable.replace'] }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    expect(mockApiCallOrThrow).not.toHaveBeenCalled()
  })

  it('saves the chosen Organisation with the grant revision, and confirms a change', async () => {
    serve(connectionView({}, { organisation: null }), { ...organisations, previous: [{ xeroOrganisationId: XERO_ORG_A, name: 'Demo Company (Global)' }] })
    const confirmationError = Object.assign(new Error('Confirm the change of Xero Organisation.'), {
      status: 409,
      code: 'xero.organisation_change_confirmation_required',
      previous: [{ xeroOrganisationId: XERO_ORG_A, name: 'Demo Company (Global)', companyCount: 12 }],
    })
    const sentHeaders: Array<Record<string, string>> = []
    mockApiCallOrThrow.mockImplementation(async () => {
      sentHeaders.push({ ...scopedHeaders })
      if (sentHeaders.length === 1) throw confirmationError
      return { ok: true, status: 200, result: {} }
    })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: enDict['sync_xero.tab.chooseOrganisation'] }))
    fireEvent.click(await screen.findByLabelText('Second Ltd'))
    fireEvent.click(screen.getByRole('button', { name: enDict['sync_xero.picker.save'] }))
    expect(await screen.findByText('12 companies were imported from Demo Company (Global).')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: enDict['sync_xero.picker.confirm.submit'] }))
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith(enDict['sync_xero.picker.saved'], 'success'))
    const bodies = mockApiCallOrThrow.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))
    expect(bodies).toEqual([{ xeroOrganisationId: XERO_ORG_B }, { xeroOrganisationId: XERO_ORG_B, confirmChange: true }])
    expect(sentHeaders[0]).toEqual({ 'x-om-ext-optimistic-lock-expected-updated-at': '2026-10-13T10:00:00.000Z' })
  })

  it('shows the switch block with the invoice count and offers no save', async () => {
    serve(connectionView(), { ...organisations, selected: XERO_ORG_A })
    mockApiCallOrThrow.mockRejectedValue(
      Object.assign(new Error('blocked'), {
        status: 409,
        code: 'xero.organisation_switch_blocked',
        previous: [{ xeroOrganisationId: XERO_ORG_A, name: 'Demo Company (Global)', invoiceCount: 4 }],
      }),
    )
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: enDict['sync_xero.tab.changeOrganisation'] }))
    fireEvent.click(await screen.findByLabelText('Second Ltd'))
    fireEvent.click(screen.getByRole('button', { name: enDict['sync_xero.picker.save'] }))
    expect(await screen.findByText('4 invoices were imported from Demo Company (Global).')).toBeTruthy()
    expect(screen.queryByRole('button', { name: enDict['sync_xero.picker.save'] })).toBeNull()
  })

  it('shows the callback result once and removes it from the URL', async () => {
    mockSearch = 'tab=xero&xeroResult=account_pending'
    serve(connectionView({}, { organisation: null }))
    renderTab()
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith(enDict['sync_xero.result.account_pending'], 'info'))
    expect(mockReplace).toHaveBeenCalledWith('/backend/integrations/sync_xero?tab=xero')
  })
})
