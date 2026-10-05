/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
const runMutationMock = jest.fn()
const confirmMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({ useAppEvent: () => {} }))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock, ConfirmDialogElement: null }),
}))

/**
 * Renders the overflow items flat so they can be clicked without a portal, and
 * mirrors the real component's behaviour of rendering nothing for an empty
 * list — a mock that renders a wrapper regardless would hide exactly the
 * regression these tests exist to catch.
 */
jest.mock('@open-mercato/ui/backend/forms/ActionsDropdown', () => ({
  ActionsDropdown: ({ items }: { items?: Array<{ id?: string; label: string; onSelect?: () => void }> }) => (
    !items || items.length === 0 ? null : (
      <div data-testid="overflow">
        {items.map((item, index) => (
          <button key={item.id ?? index} type="button" onClick={item.onSelect}>{item.label}</button>
        ))}
      </div>
    )
  ),
}))

jest.mock('../../../../../components/useDataSyncRunAccess', () => ({
  useDataSyncRunAccess: () => ({ canRunSync: true, canConfigureSync: true }),
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/data-sync/runs/run-1',
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import SyncRunDetailPage from '../page'

type OptionsResponse = { ok: boolean; status: number; result: unknown }

function mockRun(overrides: Record<string, unknown> = {}, options?: OptionsResponse) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/data_sync/options')) {
      return options ?? { ok: true, status: 200, result: { items: [{ integrationId: 'example', startControls: {} }] } }
    }
    if (url.startsWith('/api/data_sync/runs/')) {
      return {
        ok: true,
        status: 200,
        result: {
          id: 'run-1',
          integrationId: 'example',
          entityType: 'example_orders',
          direction: 'import',
          status: 'failed',
          cursor: 'updated_at:2026-09-12T04:15:07Z',
          initialCursor: null,
          createdCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          failedCount: 0,
          batchesCompleted: 41,
          lastError: null,
          progressJobId: null,
          parameters: null,
          progressJob: null,
          triggeredBy: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:20:00.000Z',
          ...overrides,
        },
      }
    }
    if (url.startsWith('/api/integrations/logs')) {
      return { ok: true, status: 200, result: { items: [], total: 0 } }
    }
    return { ok: false, status: 404, result: null }
  })
}

async function clickFromBeginning() {
  const button = await screen.findByRole('button', { name: 'Retry from the beginning' })
  fireEvent.click(button)
}

/**
 * Reads the body the request would actually send, by invoking the operation the
 * guard was handed — asserting `mutationPayload` alone would still pass if the
 * two disagreed.
 */
async function sentRetryBodies(): Promise<unknown[]> {
  const bodies: unknown[] = []
  for (const [arg] of runMutationMock.mock.calls) {
    const { operation } = arg as { operation: () => unknown }
    apiCallMock.mockClear()
    await operation()
    const init = apiCallMock.mock.calls.at(-1)?.[1] as { body?: string } | undefined
    if (init?.body) bodies.push(JSON.parse(init.body))
  }
  return bodies
}

beforeEach(() => {
  apiCallMock.mockReset()
  runMutationMock.mockReset()
  confirmMock.mockReset()
  runMutationMock.mockResolvedValue({ ok: true, result: { id: 'run-2' } })
  confirmMock.mockResolvedValue(true)
})

describe('SyncRunDetailPage retry from the beginning', () => {
  it('sends fromBeginning: true once confirmed', async () => {
    mockRun()
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)
    await clickFromBeginning()

    await waitFor(() => expect(runMutationMock).toHaveBeenCalled())
    expect(await sentRetryBodies()).toContainEqual({ fromBeginning: true })
    // Pinned: without this a double-submit — two runs started from one click —
    // satisfies every other assertion in this suite.
    expect(runMutationMock).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when the confirm is dismissed', async () => {
    confirmMock.mockResolvedValue(false)
    mockRun()
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)
    await clickFromBeginning()

    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    expect(runMutationMock).not.toHaveBeenCalled()
  })

  it('confirms before any request is issued, never after', async () => {
    mockRun()
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)
    await clickFromBeginning()

    await waitFor(() => expect(runMutationMock).toHaveBeenCalled())
    expect(confirmMock.mock.invocationCallOrder[0])
      .toBeLessThan(runMutationMock.mock.invocationCallOrder[0])
  })

  it('names both start positions in the confirm copy', async () => {
    mockRun()
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)
    await clickFromBeginning()

    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    const { text, variant } = confirmMock.mock.calls[0][0] as { text: string; variant: string }
    expect(text).toContain('batch 41')
    expect(text).toMatch(/matched and updated, not duplicated/i)
    // Nothing is deleted, so the red budget stays with Cancel run.
    expect(variant).toBe('default')
  })

  it('omits a record estimate rather than guessing one when totalCount is null', async () => {
    mockRun()
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)
    await clickFromBeginning()

    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    const { text } = confirmMock.mock.calls[0][0] as { text: string }
    expect(text).not.toMatch(/about\s+\d/i)
  })

  /**
   * D3 was withdrawn: the endpoint's `previous.cursor ?? resolveStartCursor(...)`
   * fallback means a run with no cursor of its own may still resume at a shared
   * cursor, so this is exactly where a guaranteed replay matters most.
   */
  it('stays available for a run that committed no batch', async () => {
    mockRun({ cursor: null, batchesCompleted: 0 })
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    expect(await screen.findByRole('button', { name: 'Retry from the beginning' })).toBeInTheDocument()
  })

  /**
   * `resolveResumePoint`'s contract: a run that committed nothing has no known
   * start position, so the confirm must not invent one. Asserting only that the
   * button renders would miss copy claiming "would start at batch 0".
   */
  it('claims no resumable start position when the run committed no batch', async () => {
    mockRun({ cursor: null, batchesCompleted: 0 })
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)
    await clickFromBeginning()

    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    const { text } = confirmMock.mock.calls[0][0] as { text: string }
    expect(text).not.toMatch(/batch \d/)
    expect(text).toMatch(/committed no batch/i)
  })

  it('hides the action when the adapter declares full sync inapplicable', async () => {
    mockRun({}, {
      ok: true,
      status: 200,
      result: {
        items: [{
          integrationId: 'example',
          startControls: { example_orders: { fullSync: false, batchSize: true } },
        }],
      },
    })
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    await screen.findByText(/Resumes from batch 41/)
    await waitFor(() => expect(screen.queryByTestId('overflow')).not.toBeInTheDocument())
    // The detail page explains the absence; the row menu deliberately does not.
    expect(screen.getByText(/cannot be replayed from the start/i)).toBeInTheDocument()
  })

  it('keeps the action for an entity type the adapter does not restrict', async () => {
    mockRun({}, {
      ok: true,
      status: 200,
      result: {
        items: [{
          integrationId: 'example',
          startControls: { some_other_entity: { fullSync: false, batchSize: true } },
        }],
      },
    })
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    expect(await screen.findByRole('button', { name: 'Retry from the beginning' })).toBeInTheDocument()
  })

  /**
   * Fails OPEN. `applicableStartControls` documents "every control applies" as
   * the default for an unresolved entity type, and hiding a valid action
   * because an unrelated request failed is the worse outcome — the endpoint
   * accepts the request regardless.
   */
  it('keeps the action when the options fetch fails', async () => {
    mockRun({}, { ok: false, status: 500, result: null })
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    expect(await screen.findByRole('button', { name: 'Retry from the beginning' })).toBeInTheDocument()
    expect(screen.queryByText(/cannot be replayed from the start/i)).not.toBeInTheDocument()
  })

  it('offers a way out when the retry is refused for stale parameters', async () => {
    runMutationMock.mockResolvedValue({ ok: false, result: { code: 'parametersStale' } })
    mockRun()
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)
    await clickFromBeginning()

    // flash() takes a string and has no action slot, so the remedy lives in a
    // persistent banner rather than a toast that scrolls away.
    expect(await screen.findByRole('button', { name: /start a new run with these settings/i })).toBeInTheDocument()
  })

  it('shows no way-out banner for an ordinary retry failure', async () => {
    runMutationMock.mockResolvedValue({ ok: false, result: { code: 'somethingElse' } })
    mockRun()
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)
    await clickFromBeginning()

    await waitFor(() => expect(runMutationMock).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /start a new run with these settings/i })).not.toBeInTheDocument()
  })

  it.each(['completed', 'running', 'pending'])('offers no overflow at all for a %s run', async (status) => {
    mockRun({ status })
    renderWithProviders(<SyncRunDetailPage params={{ id: 'run-1' }} />)

    await waitFor(() => expect(screen.getByText('data_sync.runs.detail.progress')).toBeInTheDocument())
    expect(screen.queryByTestId('overflow')).not.toBeInTheDocument()
  })
})
