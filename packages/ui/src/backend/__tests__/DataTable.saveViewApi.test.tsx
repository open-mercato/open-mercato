/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable, type DataTableViewApi, type DataTableViewDirtyState } from '../DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { render, fireEvent, waitFor, screen, act } from '@testing-library/react'
import type { PerspectivesIndexResponse } from '@open-mercato/shared/modules/perspectives/types'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

jest.mock('../injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: async () => false,
  }),
}))

const mockFlash = jest.fn()
jest.mock('../FlashMessages', () => ({ flash: (...args: unknown[]) => mockFlash(...args) }))

const savedPayloads: Array<Record<string, unknown>> = []
const mockApiCall = jest.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
  const url = String(input)
  const method = (init?.method ?? 'GET').toUpperCase()
  if (url.includes('/api/perspectives/') && method === 'POST') {
    const payload = JSON.parse(init?.body ?? '{}') as Record<string, unknown>
    savedPayloads.push(payload)
    return {
      ok: true,
      status: 200,
      result: {
        perspective: {
          id: 'persp-new',
          name: payload.name,
          tableId: 'test-table',
          settings: payload.settings ?? {},
          isDefault: false,
          createdAt: 'now',
          updatedAt: '2026-08-06T00:00:00.000Z',
        },
        rolePerspectives: [],
        clearedRoleIds: [],
      },
      response: { ok: true, status: 200 } as Response,
      cacheStatus: null as const,
    }
  }
  return { ok: true, status: 200, result: undefined, response: { ok: true, status: 200 } as Response, cacheStatus: null as const }
})
jest.mock('../utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...(args as [unknown, { method?: string; body?: string }?])),
  withScopedApiRequestHeaders: async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
}))

// The sidebar itself is not under test; the stub only reports whether the
// component asked for it to be opened.
jest.mock('../PerspectiveSidebar', () => ({
  PerspectiveSidebar: (props: { open: boolean }) => (
    <div data-testid="perspective-sidebar" data-open={String(props.open)} />
  ),
}))

type Row = { id: string; name: string }

const SAVED_VIEW = {
  id: 'persp-1',
  name: 'My view',
  tableId: 'test-table',
  settings: { searchValue: 'acme' },
  isDefault: false,
  createdAt: 'now',
  updatedAt: '2026-08-06T00:00:00.000Z',
}

// DataTable auto-activates the first saved view on load, so tests that assert on
// a pristine "No view" table must start from an empty list.
const buildIndexResponse = (perspectives: PerspectivesIndexResponse['perspectives']): PerspectivesIndexResponse => ({
  tableId: 'test-table',
  perspectives,
  defaultPerspectiveId: null,
  rolePerspectives: [],
  manageableRolePerspectives: [],
  roles: [],
  canApplyToRoles: false,
})

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'id', header: 'Id' },
]

type HarnessProps = {
  apiRef?: React.MutableRefObject<DataTableViewApi | null>
  onDirty?: (state: DataTableViewDirtyState) => void
  showSaveViewButton?: boolean
  withPerspective?: boolean
  initialSearchValue?: string
  savedViews?: PerspectivesIndexResponse['perspectives']
}

function renderTable({ apiRef, onDirty, showSaveViewButton, withPerspective = true, initialSearchValue = '', savedViews = [] }: HarnessProps) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(['feature-check', 'perspectives'], { use: true, roleDefaults: true })
  queryClient.setQueryData(['table-perspectives', 'test-table'], buildIndexResponse(savedViews))

  function Harness({ searchValue }: { searchValue: string }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="en" dict={{}}>
          <DataTable<Row>
            columns={columns}
            data={[]}
            searchValue={searchValue}
            onSearchChange={() => {}}
            perspective={withPerspective ? { tableId: 'test-table' } : undefined}
            viewApiRef={apiRef}
            onColumnsDirtyChange={onDirty}
            showSaveViewButton={showSaveViewButton}
          />
        </I18nProvider>
      </QueryClientProvider>
    )
  }

  const utils = render(<Harness searchValue={initialSearchValue} />)
  return {
    ...utils,
    setSearchValue: (value: string) => utils.rerender(<Harness searchValue={value} />),
  }
}

describe('DataTable public save-view API', () => {
  beforeEach(() => {
    savedPayloads.length = 0
    mockFlash.mockClear()
    mockApiCall.mockClear()
    // DataTable persists the applied view to localStorage + a cookie, and jsdom
    // shares both across tests in a file — clear them so every case starts from
    // a table that has never had a view applied.
    window.localStorage.clear()
    for (const entry of document.cookie.split(';')) {
      const name = entry.split('=')[0]?.trim()
      if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
    }
  })

  it('reports a clean view first and then the changed setting groups', async () => {
    const states: DataTableViewDirtyState[] = []
    const { setSearchValue } = renderTable({ onDirty: (state) => { states.push(state) } })

    await waitFor(() => expect(states.length).toBeGreaterThan(0))
    expect(states[0].isDirty).toBe(false)
    expect(states[0].changedKeys).toEqual([])

    setSearchValue('acme')

    await waitFor(() => expect(states[states.length - 1].isDirty).toBe(true))
    const latest = states[states.length - 1]
    expect(latest.changedKeys).toEqual(['searchValue'])
    expect(latest.changedCount).toBe(1)
    expect(latest.canSaveToActiveView).toBe(false)
  })

  it('does not treat a host-supplied starting state as an unsaved change', async () => {
    const states: DataTableViewDirtyState[] = []
    // The page arrives with a search term already applied (hydrated from the URL,
    // say). That is the starting point, not something the user just changed.
    const apiRef = React.createRef<DataTableViewApi | null>() as React.MutableRefObject<DataTableViewApi | null>
    const { setSearchValue } = renderTable({ apiRef, onDirty: (state) => { states.push(state) }, initialSearchValue: 'acme' })

    await waitFor(() => expect(apiRef.current).not.toBeNull())
    await waitFor(() => expect(states.length).toBeGreaterThan(0))
    expect(states.every((state) => !state.isDirty)).toBe(true)

    setSearchValue('other')
    await waitFor(() => expect(apiRef.current?.getDirtyState().isDirty).toBe(true))
  })

  it('does not notify tables that do not wire perspectives', async () => {
    const onDirty = jest.fn()
    renderTable({ onDirty, withPerspective: false })
    await waitFor(() => expect(screen.queryByTestId('perspective-sidebar')).toBeNull())
    expect(onDirty).not.toHaveBeenCalled()
  })

  it('exposes the live settings and dirty state through the imperative handle', async () => {
    const apiRef = React.createRef<DataTableViewApi | null>() as React.MutableRefObject<DataTableViewApi | null>
    const { setSearchValue } = renderTable({ apiRef })

    await waitFor(() => expect(apiRef.current).not.toBeNull())
    expect(apiRef.current?.getDirtyState().isDirty).toBe(false)

    setSearchValue('acme')

    await waitFor(() => expect(apiRef.current?.getDirtyState().isDirty).toBe(true))
    expect(apiRef.current?.getCurrentSettings().searchValue).toBe('acme')
  })

  it('refuses to save without a name when no personal view is active', async () => {
    const apiRef = React.createRef<DataTableViewApi | null>() as React.MutableRefObject<DataTableViewApi | null>
    renderTable({ apiRef })
    await waitFor(() => expect(apiRef.current).not.toBeNull())

    const result = await act(async () => apiRef.current!.saveCurrentView())
    expect(result).toEqual({ ok: false, reason: 'name-required' })
    expect(savedPayloads).toHaveLength(0)
  })

  it('persists the live settings when a name is supplied', async () => {
    const apiRef = React.createRef<DataTableViewApi | null>() as React.MutableRefObject<DataTableViewApi | null>
    const { setSearchValue } = renderTable({ apiRef })
    await waitFor(() => expect(apiRef.current).not.toBeNull())
    setSearchValue('acme')
    await waitFor(() => expect(apiRef.current?.getDirtyState().isDirty).toBe(true))

    const result = await act(async () => apiRef.current!.saveCurrentView({ name: 'Wide view' }))

    expect(result).toEqual({ ok: true, perspectiveId: 'persp-new' })
    expect(savedPayloads).toHaveLength(1)
    expect(savedPayloads[0].name).toBe('Wide view')
    expect((savedPayloads[0].settings as { searchValue?: string }).searchValue).toBe('acme')
    // A completed save re-baselines the view, so nothing stays flagged as unsaved.
    await waitFor(() => expect(apiRef.current?.getDirtyState().isDirty).toBe(false))
  })

  it('updates the active view in place when no name is supplied', async () => {
    const apiRef = React.createRef<DataTableViewApi | null>() as React.MutableRefObject<DataTableViewApi | null>
    // The saved view is auto-activated on load, so its own settings are the baseline.
    const { setSearchValue } = renderTable({ apiRef, savedViews: [SAVED_VIEW], initialSearchValue: 'acme' })
    await waitFor(() => expect(apiRef.current?.getDirtyState().canSaveToActiveView).toBe(true))

    setSearchValue('other')
    await waitFor(() => expect(apiRef.current?.getDirtyState().isDirty).toBe(true))

    const result = await act(async () => apiRef.current!.saveCurrentView())

    expect(result).toEqual({ ok: true, perspectiveId: 'persp-new' })
    expect(savedPayloads).toHaveLength(1)
    expect(savedPayloads[0].perspectiveId).toBe('persp-1')
    expect(savedPayloads[0].name).toBe('My view')
    expect((savedPayloads[0].settings as { searchValue?: string }).searchValue).toBe('other')
  })

  it('opens the views sidebar on demand', async () => {
    const apiRef = React.createRef<DataTableViewApi | null>() as React.MutableRefObject<DataTableViewApi | null>
    renderTable({ apiRef })
    await waitFor(() => expect(apiRef.current).not.toBeNull())
    expect(screen.getByTestId('perspective-sidebar').getAttribute('data-open')).toBe('false')

    act(() => { apiRef.current!.openViewsSidebar() })

    await waitFor(() => expect(screen.getByTestId('perspective-sidebar').getAttribute('data-open')).toBe('true'))
  })

  it('keeps the built-in save button opt-in and disabled until something changes', async () => {
    const { unmount } = renderTable({})
    await waitFor(() => expect(screen.getByTestId('perspective-sidebar')).toBeTruthy())
    expect(screen.queryByTestId('save-view-trigger')).toBeNull()
    unmount()

    const { setSearchValue } = renderTable({ showSaveViewButton: true })
    const trigger = await screen.findByTestId('save-view-trigger')
    expect(trigger).toBeDisabled()

    setSearchValue('acme')
    await waitFor(() => expect(screen.getByTestId('save-view-trigger')).not.toBeDisabled())
  })

  it('sends an unnamed save to the sidebar instead of inventing a name', async () => {
    const { setSearchValue } = renderTable({ showSaveViewButton: true })
    const trigger = await screen.findByTestId('save-view-trigger')
    setSearchValue('acme')
    await waitFor(() => expect(screen.getByTestId('save-view-trigger')).not.toBeDisabled())

    await act(async () => { fireEvent.click(trigger) })

    await waitFor(() => expect(screen.getByTestId('perspective-sidebar').getAttribute('data-open')).toBe('true'))
    expect(savedPayloads).toHaveLength(0)
  })
})
