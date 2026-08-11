/**
 * @jest-environment jsdom
 *
 * The outcome on the process detail page (spec §Outcome): rendered when the run
 * produced something, LINKED only when the module that owns the record is part
 * of this deployment, and absent entirely when the process produced nothing.
 */

import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import ProcessDetailPage from '../backend/processes/[id]/page'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }))

const apiCallMock = apiCall as jest.Mock

const PROCESS_ID = '11111111-1111-4111-8111-111111111111'

const PROJECTION = {
  process_id: PROCESS_ID,
  workflow_id: 'claims.intake',
  subject_type: 'Motor',
  subject_label: 'CASE-2026-04417',
  status: 'completed',
  current_stage: 'pay',
  opened_at: '2026-08-10T09:00:00.000Z',
}

/** One process-runs row as the list API returns it, href already resolved server-side. */
function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    status: 'completed',
    workflow_instance_id: PROCESS_ID,
    outcome_type: 'claims:claim',
    outcome_id: 'claim-9',
    outcome_label: 'CLM-2026-118',
    outcome_href: '/backend/claims/claim-9',
    ...overrides,
  }
}

function mockApi(runs: Array<Record<string, unknown>>) {
  apiCallMock.mockImplementation(async (url: string) => {
    const ok = (result: unknown) => ({ ok: true, status: 200, result, response: {}, cacheStatus: null })
    if (url.startsWith('/api/agent_orchestrator/processes/')) return ok({ process: PROJECTION })
    if (url.startsWith('/api/agent_orchestrator/process-runs')) return ok({ items: runs })
    return ok({ items: [] })
  })
}

beforeEach(() => {
  apiCallMock.mockReset()
})

async function renderPage() {
  renderWithProviders(<ProcessDetailPage params={{ id: PROCESS_ID }} />)
  // The whole page is gated on `isLoading`, which clears only after the outcome
  // fetch — so this anchor also proves that fetch has settled.
  await waitFor(() => expect(screen.getByRole('heading', { name: 'claims.intake' })).not.toBeNull())
}

describe('the process outcome', () => {
  it('renders NO link when the process produced no outcome — the research/monitoring case', async () => {
    mockApi([runRow({ outcome_type: null, outcome_id: null, outcome_label: null, outcome_href: null })])
    await renderPage()
    expect(screen.queryByTestId('process-outcome')).toBeNull()
    expect(screen.queryByText('agent_orchestrator.process.factOutcome')).toBeNull()
  })

  it('renders NO link when the run row itself is missing', async () => {
    mockApi([])
    await renderPage()
    expect(screen.queryByTestId('process-outcome')).toBeNull()
  })

  it('renders NO link when only half the reference was written', async () => {
    mockApi([runRow({ outcome_id: null })])
    await renderPage()
    expect(screen.queryByTestId('process-outcome')).toBeNull()
  })

  it('links to the produced record when the owning module is present', async () => {
    mockApi([runRow()])
    await renderPage()
    const outcome = await screen.findByTestId('process-outcome')
    expect(outcome.tagName).toBe('A')
    expect(outcome.getAttribute('href')).toBe('/backend/claims/claim-9')
    expect(outcome.textContent).toContain('CLM-2026-118')
    expect(screen.queryByText('agent_orchestrator.process.factOutcome')).not.toBeNull()
  })

  it('DEGRADES to the label snapshot when the owning module is missing — text, never a dead link', async () => {
    mockApi([runRow({ outcome_href: null })])
    await renderPage()
    const outcome = await screen.findByTestId('process-outcome')
    expect(outcome.tagName).not.toBe('A')
    expect(outcome.textContent).toContain('CLM-2026-118')
    expect(outcome.getAttribute('title')).toBe('agent_orchestrator.process.outcomeUnlinked')
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('falls back to the raw id when the run recorded no label snapshot', async () => {
    mockApi([runRow({ outcome_label: null, outcome_href: null })])
    await renderPage()
    const outcome = await screen.findByTestId('process-outcome')
    expect(outcome.textContent).toContain('claim-9')
  })

  it('asks for the run behind THIS process instance, never the whole ledger', async () => {
    mockApi([runRow()])
    await renderPage()
    const urls = apiCallMock.mock.calls.map(([url]) => url as string)
    expect(urls).toContain(
      `/api/agent_orchestrator/process-runs?workflowInstanceId=${PROCESS_ID}&pageSize=1`,
    )
  })
})
