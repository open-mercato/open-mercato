/**
 * @jest-environment jsdom
 *
 * The Caseload LIST view's two structural column rules (issue #5982).
 *
 * - A status badge is an ATOM. Clipped at the column edge it reads as a
 *   different status ("Auto-approved" cut to "Auto-appro…"), so the Status cell
 *   must not be handed to the table's default truncation — the pill sizes to its
 *   own label, whatever the locale made of it.
 * - The Actions column exists only while some row on screen still owes a
 *   decision. A disposed segment (Approved / Rejected) offers exactly what the
 *   decision pane offers a closed case — the detail, which the row click already
 *   opens — so an Actions header over blank cells is noise, not an affordance.
 */

import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import en from '../i18n/en.json'
import CaseloadPage from '../backend/caseload/page'

let searchParams = new URLSearchParams('')

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => searchParams,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, status: 200, result: { items: [] }, response: {}, cacheStatus: null })),
  apiCallOrThrow: jest.fn(async () => ({})),
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({ useAppEvent: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))

// jsdom ships no ResizeObserver and `TruncatedCell` opens one per cell.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub
}

const dict = en as Record<string, string>
const RUN_ID = '22222222-2222-4222-8222-222222222222'
const OPTION = { id: 'advance', label: 'Advance to won', confidence: 0.9, actions: [{ type: 'set_stage', payload: { stage: 'won' } }] }

function proposal(id: string, disposition: string) {
  return {
    id,
    agent_id: 'deal_advisor',
    run_id: RUN_ID,
    payload: { options: [OPTION] },
    confidence: 0.9,
    disposition,
    selected_option_id: disposition === 'pending' ? null : OPTION.id,
    guard_results: [],
    created_at: '2026-08-11T09:00:00.000Z',
    updated_at: '2026-08-11T09:00:00.000Z',
  }
}

function mockQueue(items: Array<Record<string, unknown>>) {
  ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
    if (url.startsWith('/api/agent_orchestrator/proposals')) {
      return { ok: true, status: 200, result: { items, total: items.length }, response: {}, cacheStatus: null }
    }
    return { ok: true, status: 200, result: { items: [] }, response: {}, cacheStatus: null }
  })
}

function renderQueue(query: string) {
  searchParams = new URLSearchParams(query)
  return renderWithProviders(<CaseloadPage />, { dict })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('Caseload list view — the Status column', () => {
  it('renders the longest status label whole, never handed to the table truncation', async () => {
    mockQueue([proposal('11111111-1111-4111-8111-111111111111', 'auto_approved')])
    renderQueue('view=list&segment=approved')

    const badge = await screen.findByText(dict['agent_orchestrator.caseload.status.autoApproved'])
    const cell = badge.closest('td')
    expect(cell).toBeTruthy()
    // `TruncatedCell` wraps the content in a fixed max-width `overflow-hidden`
    // box; a badge clipped by that box is exactly the reported bug.
    expect(cell!.querySelector('[style*="max-width"]')).toBeNull()
    expect(cell!.querySelector('.overflow-hidden')).toBeNull()
    expect(badge.className).toContain('whitespace-nowrap')
  })
})

describe('Caseload list view — the Actions column', () => {
  it('is absent entirely when no row on screen still owes a decision', async () => {
    mockQueue([
      proposal('11111111-1111-4111-8111-111111111111', 'auto_approved'),
      proposal('33333333-3333-4333-8333-333333333333', 'approved'),
    ])
    renderQueue('view=list&segment=approved')

    await screen.findByText(dict['agent_orchestrator.caseload.status.autoApproved'])
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull()
    expect(document.querySelectorAll('[data-actions-cell]').length).toBe(0)
  })

  it('renders with its approve/reject buttons as soon as one row is pending', async () => {
    mockQueue([proposal('11111111-1111-4111-8111-111111111111', 'pending')])
    renderQueue('view=list&segment=actionRequired')

    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeTruthy())
    expect(document.querySelectorAll('[data-actions-cell]').length).toBe(1)
    expect(screen.getByRole('button', { name: dict['agent_orchestrator.caseload.actions.approveAria'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: dict['agent_orchestrator.caseload.actions.rejectAria'] })).toBeTruthy()
  })
})
