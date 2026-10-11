/**
 * @jest-environment jsdom
 *
 * The outcome on the execution detail page (spec §Outcome): rendered when the
 * execution produced something, LINKED only when the module that owns the record
 * is part of this deployment, and absent entirely when it produced nothing.
 *
 * The page makes ONE read for the whole business view — status, milestones and
 * outcome come back together, so they can no longer disagree.
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
  workflow_instance_id: PROCESS_ID,
  workflow_id: 'claims.intake',
  subject_type: 'Motor',
  subject_label: 'CASE-2026-04417',
  status: 'completed',
  current_stage: 'pay',
  opened_at: '2026-08-10T09:00:00.000Z',
}

/** The outcome as `GET /executions/:id` returns it, href already resolved server-side. */
function outcome(overrides: Record<string, unknown> | null = {}) {
  if (overrides === null) return null
  return {
    type: 'claims:claim',
    id: 'claim-9',
    label: 'CLM-2026-118',
    href: '/backend/claims/claim-9',
    ...overrides,
  }
}

function mockApi(produced: Record<string, unknown> | null) {
  apiCallMock.mockImplementation(async (url: string) => {
    const ok = (result: unknown) => ({ ok: true, status: 200, result, response: {}, cacheStatus: null })
    if (url.startsWith('/api/agent_orchestrator/executions/')) {
      return ok({ execution: PROJECTION, milestones: [], outcome: produced })
    }
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

describe('the execution outcome', () => {
  it('renders NO link when the process produced no outcome — the research/monitoring case', async () => {
    mockApi(null)
    await renderPage()
    expect(screen.queryByTestId('process-outcome')).toBeNull()
    expect(screen.queryByText('agent_orchestrator.process.factOutcome')).toBeNull()
  })

  it('links to the produced record when the owning module is present', async () => {
    mockApi(outcome())
    await renderPage()
    const rendered = await screen.findByTestId('process-outcome')
    expect(rendered.tagName).toBe('A')
    expect(rendered.getAttribute('href')).toBe('/backend/claims/claim-9')
    expect(rendered.textContent).toContain('CLM-2026-118')
    expect(screen.queryByText('agent_orchestrator.process.factOutcome')).not.toBeNull()
  })

  it('DEGRADES to the label snapshot when the owning module is missing — text, never a dead link', async () => {
    mockApi(outcome({ href: null }))
    await renderPage()
    const rendered = await screen.findByTestId('process-outcome')
    expect(rendered.tagName).not.toBe('A')
    expect(rendered.textContent).toContain('CLM-2026-118')
    expect(rendered.getAttribute('title')).toBe('agent_orchestrator.process.outcomeUnlinked')
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('falls back to the raw id when the execution recorded no label snapshot', async () => {
    mockApi(outcome({ label: undefined, href: null }))
    await renderPage()
    const rendered = await screen.findByTestId('process-outcome')
    expect(rendered.textContent).toContain('claim-9')
  })

  it('reads the whole business view in ONE request, never a second ledger query', async () => {
    mockApi(outcome())
    await renderPage()
    const urls = apiCallMock.mock.calls.map(([url]) => url as string)
    expect(urls).toContain(`/api/agent_orchestrator/executions/${PROCESS_ID}`)
    // No follow-up list read for the outcome: a second source is a second chance
    // to disagree with the first.
    expect(urls.filter((url) => url.startsWith('/api/agent_orchestrator/executions?'))).toHaveLength(0)
  })
})
