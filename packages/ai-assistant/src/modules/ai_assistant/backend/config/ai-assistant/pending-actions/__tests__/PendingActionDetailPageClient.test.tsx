/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import en from '../../../../../i18n/en.json'
import { PendingActionDetailPageClient } from '../[id]/PendingActionDetailPageClient'

const apiCallMock = jest.fn()
const runMutationMock = jest.fn()
const retryLastMutationMock = jest.fn()
const flashMock = jest.fn()
const refreshBadgeMock = jest.fn()

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (input: { operation: () => Promise<unknown> }) => runMutationMock(input),
    retryLastMutation: retryLastMutationMock,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('../../../../../components/pending-actions/pendingActionsNavBadge', () => ({
  refreshPendingActionsNavBadge: (...args: unknown[]) => refreshBadgeMock(...args),
}))

const dict = en as Record<string, string>
const ACTION_ID = '11111111-1111-4111-8111-111111111111'
const DETAIL_URL = `/api/ai_assistant/ai/actions/${ACTION_ID}`

function makeAction(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTION_ID,
    agentId: 'ai_assistant.raw_tool',
    toolName: 'catalog.update_product',
    status: 'pending',
    fieldDiff: [{ field: 'title', before: 'Old title', after: 'New title' }],
    records: null,
    failedRecords: null,
    sideEffectsSummary: null,
    attachmentIds: [],
    targetEntityType: 'catalog.product',
    targetRecordId: 'prod-1',
    recordVersion: null,
    queueMode: 'inline',
    executionResult: null,
    createdAt: '2026-10-22T10:00:00.000Z',
    expiresAt: '2026-10-22T10:15:00.000Z',
    resolvedAt: null,
    resolvedByUserId: null,
    channel: 'mcp',
    requester: { userId: null, apiKeyId: '33333333-3333-4333-8333-333333333333' },
    ...overrides,
  }
}

type Responder = (url: string, init?: RequestInit) => { ok: boolean; status: number; result: unknown }

function respondWith(responder: Responder) {
  apiCallMock.mockImplementation(async (url: string, init?: RequestInit) => responder(url, init))
}

function postedCalls() {
  return apiCallMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'POST')
}

describe('PendingActionDetailPageClient', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    runMutationMock.mockReset()
    flashMock.mockReset()
    refreshBadgeMock.mockReset()
    runMutationMock.mockImplementation((input: { operation: () => Promise<unknown> }) => input.operation())
  })

  it('renders the diff and the request metadata', async () => {
    respondWith(() => ({ ok: true, status: 200, result: makeAction() }))
    renderWithProviders(<PendingActionDetailPageClient id={ACTION_ID} />, { dict })

    expect(await screen.findByText('New title')).toBeTruthy()
    expect(screen.getByText('Old title')).toBeTruthy()
    expect(screen.getByText(dict['ai_assistant.pendingActions.channel.mcp'])).toBeTruthy()
    expect(screen.getByText('API key 33333333')).toBeTruthy()
    expect(String(apiCallMock.mock.calls[0][0])).toBe(DETAIL_URL)
  })

  it('approves through the guarded mutation and the confirm endpoint', async () => {
    respondWith((url) =>
      url.endsWith('/confirm')
        ? { ok: true, status: 200, result: { ok: true, pendingAction: makeAction({ status: 'confirmed' }) } }
        : { ok: true, status: 200, result: makeAction() },
    )
    renderWithProviders(<PendingActionDetailPageClient id={ACTION_ID} />, { dict })
    const approve = await screen.findByText(dict['ai_assistant.pendingActions.actions.approve'])

    await act(async () => {
      fireEvent.click(approve)
    })

    await waitFor(() => expect(runMutationMock).toHaveBeenCalledTimes(1))
    const mutationInput = runMutationMock.mock.calls[0][0] as { context: Record<string, unknown> }
    expect(typeof mutationInput.context.retryLastMutation).toBe('function')
    expect(postedCalls().map((call) => call[0])).toEqual([`${DETAIL_URL}/confirm`])
    await waitFor(() =>
      expect(flashMock).toHaveBeenCalledWith(dict['ai_assistant.pendingActions.flash.approved'], 'success'),
    )
    expect(refreshBadgeMock).toHaveBeenCalled()
  })

  it('maps a recheck failure code to a translated flash error', async () => {
    respondWith((url) =>
      url.endsWith('/confirm')
        ? { ok: false, status: 412, result: { error: 'Record changed', code: 'stale_version' } }
        : { ok: true, status: 200, result: makeAction() },
    )
    renderWithProviders(<PendingActionDetailPageClient id={ACTION_ID} />, { dict })
    const approve = await screen.findByText(dict['ai_assistant.pendingActions.actions.approve'])

    await act(async () => {
      fireEvent.click(approve)
    })

    await waitFor(() =>
      expect(flashMock).toHaveBeenCalledWith(dict['ai_assistant.pendingActions.errors.stale_version'], 'error'),
    )
  })

  it('rejects with a reason via Cmd/Ctrl+Enter in the reject dialog', async () => {
    respondWith((url) =>
      url.endsWith('/cancel')
        ? { ok: true, status: 200, result: { ok: true, pendingAction: makeAction({ status: 'cancelled' }) } }
        : { ok: true, status: 200, result: makeAction() },
    )
    renderWithProviders(<PendingActionDetailPageClient id={ACTION_ID} />, { dict })

    fireEvent.click(await screen.findByText(dict['ai_assistant.pendingActions.actions.reject']))
    const textarea = await screen.findByLabelText(dict['ai_assistant.pendingActions.rejectDialog.reasonLabel'])
    fireEvent.change(textarea, { target: { value: 'Wrong product' } })

    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    })

    await waitFor(() => expect(postedCalls()).toHaveLength(1))
    const [url, init] = postedCalls()[0] as [string, RequestInit]
    expect(url).toBe(`${DETAIL_URL}/cancel`)
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'Wrong product' })
    expect(runMutationMock).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(flashMock).toHaveBeenCalledWith(dict['ai_assistant.pendingActions.flash.rejected'], 'success'),
    )
  })

  it('closes the reject dialog on Escape without calling the API', async () => {
    respondWith(() => ({ ok: true, status: 200, result: makeAction() }))
    renderWithProviders(<PendingActionDetailPageClient id={ACTION_ID} />, { dict })

    fireEvent.click(await screen.findByText(dict['ai_assistant.pendingActions.actions.reject']))
    const textarea = await screen.findByLabelText(dict['ai_assistant.pendingActions.rejectDialog.reasonLabel'])

    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Escape' })
    })

    await waitFor(() =>
      expect(screen.queryByLabelText(dict['ai_assistant.pendingActions.rejectDialog.reasonLabel'])).toBeNull(),
    )
    expect(postedCalls()).toHaveLength(0)
    expect(runMutationMock).not.toHaveBeenCalled()
  })

  it('hides the decision buttons and shows the execution error for a failed action', async () => {
    respondWith(() => ({
      ok: true,
      status: 200,
      result: makeAction({
        status: 'failed',
        resolvedAt: '2026-10-22T10:05:00.000Z',
        executionResult: { error: { code: 'handler_error', message: 'Product is archived' } },
      }),
    }))
    renderWithProviders(<PendingActionDetailPageClient id={ACTION_ID} />, { dict })

    expect(await screen.findByText('Product is archived')).toBeTruthy()
    expect(screen.queryByText(dict['ai_assistant.pendingActions.actions.approve'])).toBeNull()
    expect(screen.queryByText(dict['ai_assistant.pendingActions.actions.reject'])).toBeNull()
  })

  it('renders the not-found state on 404', async () => {
    respondWith(() => ({ ok: false, status: 404, result: { error: 'nope', code: 'pending_action_not_found' } }))
    renderWithProviders(<PendingActionDetailPageClient id={ACTION_ID} />, { dict })
    expect(await screen.findByText(dict['ai_assistant.pendingActions.detail.notFound'])).toBeTruthy()
  })
})
