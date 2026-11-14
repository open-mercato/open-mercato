/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import {
  PORTAL_BRIDGE_RECONNECTED_EVENT_ID,
  PORTAL_EVENT_DOM_NAME,
} from '@open-mercato/ui/portal/hooks/usePortalAppEvent'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => undefined,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

const portalAuthState = { auth: { user: { id: 'customer-user-1' }, loading: false } }

jest.mock('@open-mercato/ui/portal/PortalContext', () => ({
  usePortalContext: () => portalAuthState,
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async <T,>({ operation }: { operation: () => Promise<T> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

import enDict from '../i18n/en.json'
import PortalSupportTicketDetailPage from '../frontend/[orgSlug]/portal/support/[id]/page'

const DETAIL_URL = '/api/staff/portal/support-tickets/ticket-1'

function buildTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    supportReference: 'SUP-0042',
    subject: 'Invoice is missing',
    description: 'I cannot find my invoice.',
    category: { value: 'billing', label: 'Billing' },
    portalStatus: 'open',
    createdAt: '2026-06-15T10:00:00.000Z',
    updatedAt: '2026-06-15T10:00:00.000Z',
    canReply: true,
    requester: { name: 'Jane Customer', isSelf: true },
    messages: [],
    attachments: [],
    ...overrides,
  }
}

function detailResponse(ticket: Record<string, unknown>) {
  return { ok: true, status: 200, result: ticket }
}

function mockTicket(ticket: Record<string, unknown>) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url === '/api/staff/portal/support-tickets/options') {
      return { ok: true, status: 200, result: { maxUploadBytes: 1024 * 1024 } }
    }
    if (url === DETAIL_URL) return detailResponse(ticket)
    throw new Error(`[internal] Unexpected apiCall in test: ${url}`)
  })
}

function dispatchPortalEvent(id: string, payload: Record<string, unknown> = {}) {
  fireEvent(window, new CustomEvent(PORTAL_EVENT_DOM_NAME, {
    detail: { id, payload, timestamp: Date.now() },
  }))
}

function deferResponse<Response>() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((complete) => { resolve = complete })
  return { promise, resolve }
}

function detailCalls() {
  return apiCallMock.mock.calls.filter(([url]) => url === DETAIL_URL)
}

function renderPage() {
  return renderWithProviders(
    <PortalSupportTicketDetailPage params={{ orgSlug: 'acme-corp', id: 'ticket-1' }} />,
    { dict: enDict },
  )
}

describe('PortalSupportTicketDetailPage live refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockReset()
    window.sessionStorage.clear()
  })

  it('refetches on portal bridge reconnect while keeping the reply draft mounted and focused', async () => {
    mockTicket(buildTicket())
    const view = renderPage()
    const textarea = await view.findByPlaceholderText('Write a reply')
    fireEvent.change(textarea, { target: { value: 'Draft typed during the gap' } })
    textarea.focus()

    const updated = buildTicket({
      messages: [{ id: 'message-1', authorKind: 'staff', authorName: null, body: 'Reply sent while offline.', createdAt: null }],
    })
    const pending = deferResponse<ReturnType<typeof detailResponse>>()
    apiCallMock.mockReturnValueOnce(pending.promise)
    apiCallMock.mockClear()

    dispatchPortalEvent(PORTAL_BRIDGE_RECONNECTED_EVENT_ID)

    expect(detailCalls()).toHaveLength(1)
    expect(view.getByPlaceholderText('Write a reply')).toBe(textarea)
    expect(document.activeElement).toBe(textarea)

    await act(async () => { pending.resolve(detailResponse(updated)) })

    expect(await view.findByText('Reply sent while offline.')).toBeTruthy()
    expect(view.getByPlaceholderText('Write a reply')).toBe(textarea)
    expect((textarea as HTMLTextAreaElement).value).toBe('Draft typed during the gap')
    expect(document.activeElement).toBe(textarea)
  })

  it('keeps the newest ticket when a reconnect refresh finishes after a later update refresh', async () => {
    mockTicket(buildTicket())
    const view = renderPage()
    await view.findByPlaceholderText('Write a reply')

    const reconnectRefresh = deferResponse<ReturnType<typeof detailResponse>>()
    const updateRefresh = deferResponse<ReturnType<typeof detailResponse>>()
    apiCallMock.mockReturnValueOnce(reconnectRefresh.promise).mockReturnValueOnce(updateRefresh.promise)
    apiCallMock.mockClear()

    dispatchPortalEvent(PORTAL_BRIDGE_RECONNECTED_EVENT_ID)
    dispatchPortalEvent('staff.support_ticket.portal_updated', { ticketId: 'ticket-1' })
    expect(detailCalls()).toHaveLength(2)

    await act(async () => { updateRefresh.resolve(detailResponse(buildTicket({ subject: 'Newest subject' }))) })
    expect(await view.findByText('Newest subject')).toBeTruthy()

    await act(async () => { reconnectRefresh.resolve(detailResponse(buildTicket({ subject: 'Stale subject' }))) })
    expect(view.getByText('Newest subject')).toBeTruthy()
    expect(view.queryByText('Stale subject')).toBeNull()
  })

  it('ignores updates for other tickets and stops listening after unmount', async () => {
    mockTicket(buildTicket())
    const view = renderPage()
    await view.findByPlaceholderText('Write a reply')
    apiCallMock.mockClear()

    dispatchPortalEvent('staff.support_ticket.portal_updated', { ticketId: 'ticket-2' })
    dispatchPortalEvent('sales.order.status_changed', { ticketId: 'ticket-1' })
    expect(detailCalls()).toHaveLength(0)

    view.unmount()
    dispatchPortalEvent('staff.support_ticket.portal_updated', { ticketId: 'ticket-1' })
    dispatchPortalEvent(PORTAL_BRIDGE_RECONNECTED_EVENT_ID)
    expect(detailCalls()).toHaveLength(0)
  })
})
