/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable, type DataTableViewApi, type DataTableViewDirtyState } from '../DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { render, fireEvent, waitFor, screen, act } from '@testing-library/react'
import type { PerspectiveSettings, PerspectivesIndexResponse } from '@open-mercato/shared/modules/perspectives/types'

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
// Flipped by the one case that needs the perspectives permission check to stay
// in flight; every other case answers it from seeded query data.
let holdFeatureCheck = false
const mockApiCall = jest.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
  const url = String(input)
  const method = (init?.method ?? 'GET').toUpperCase()
  if (holdFeatureCheck && url.includes('/api/auth/feature-check')) {
    await new Promise(() => {})
  }
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

// The sidebar itself is not under test; the stub reports whether the component
// asked for it to be opened, and exposes one activation button per view so a
// test can drive `onActivatePerspective` without going through Radix.
jest.mock('../PerspectiveSidebar', () => ({
  PerspectiveSidebar: (props: {
    open: boolean
    perspectives?: Array<{ id: string }>
    rolePerspectives?: Array<{ id: string }>
    onActivatePerspective?: (item: unknown, source: 'personal' | 'role') => void
  }) => (
    <div data-testid="perspective-sidebar" data-open={String(props.open)}>
      {(props.perspectives ?? []).map((item) => (
        <button
          key={item.id}
          type="button"
          data-testid={`activate-view-${item.id}`}
          onClick={() => props.onActivatePerspective?.(item, 'personal')}
        />
      ))}
      {(props.rolePerspectives ?? []).map((item) => (
        <button
          key={item.id}
          type="button"
          data-testid={`activate-role-view-${item.id}`}
          onClick={() => props.onActivatePerspective?.(item, 'role')}
        />
      ))}
    </div>
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

const ROLE_VIEW = {
  id: 'role-1',
  name: 'Team view',
  tableId: 'test-table',
  settings: { searchValue: 'acme' },
  isDefault: false,
  roleId: 'role-sales',
  roleName: 'Sales',
  createdAt: 'now',
  updatedAt: '2026-08-06T00:00:00.000Z',
} as unknown as PerspectivesIndexResponse['rolePerspectives'][number]

// DataTable auto-activates the first saved view on load, so tests that assert on
// a pristine "No view" table must start from an empty list.
const buildIndexResponse = (
  perspectives: PerspectivesIndexResponse['perspectives'],
  rolePerspectives: PerspectivesIndexResponse['rolePerspectives'] = [],
): PerspectivesIndexResponse => ({
  tableId: 'test-table',
  perspectives,
  defaultPerspectiveId: null,
  rolePerspectives,
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
  roleViews?: PerspectivesIndexResponse['rolePerspectives']
  initialSettings?: PerspectiveSettings
  /** `'granted'` seeds the permission check, `'denied'` seeds a refusal, `'pending'` leaves it in flight. */
  perspectivesFeature?: 'granted' | 'denied' | 'pending'
}

function renderTable({
  apiRef,
  onDirty,
  showSaveViewButton,
  withPerspective = true,
  initialSearchValue = '',
  savedViews = [],
  roleViews = [],
  initialSettings,
  perspectivesFeature = 'granted',
}: HarnessProps) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { retry: false },
    },
  })
  holdFeatureCheck = perspectivesFeature === 'pending'
  if (perspectivesFeature === 'granted') {
    queryClient.setQueryData(['feature-check', 'perspectives'], { use: true, roleDefaults: true })
  } else if (perspectivesFeature === 'denied') {
    queryClient.setQueryData(['feature-check', 'perspectives'], { use: false, roleDefaults: false })
  }
  queryClient.setQueryData(['table-perspectives', 'test-table'], buildIndexResponse(savedViews, roleViews))

  function Harness({ searchValue }: { searchValue: string }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="en" dict={{}}>
          <DataTable<Row>
            columns={columns}
            data={[]}
            searchValue={searchValue}
            onSearchChange={() => {}}
            perspective={withPerspective
              ? {
                  tableId: 'test-table',
                  // Rebuilt on every render on purpose: this is what a server
                  // component hands down, and what the page re-creates whenever
                  // the table re-renders.
                  ...(initialSettings ? { initialState: { initialSettings: { ...initialSettings } } } : {}),
                }
              : undefined}
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
    holdFeatureCheck = false
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

  it('settles a table restored from server-provided initial settings instead of re-rendering forever', async () => {
    // `sanitizePerspectiveSettings` returns a fresh object on every render, so a
    // baseline update that does not compare by value re-triggers its own effect
    // and React tears the tree down with "Maximum update depth exceeded" —
    // taking the whole table (resize handles included) with it.
    const states: DataTableViewDirtyState[] = []
    const apiRef = React.createRef<DataTableViewApi | null>() as React.MutableRefObject<DataTableViewApi | null>
    renderTable({
      apiRef,
      onDirty: (state) => { states.push(state) },
      initialSettings: { columnSizing: { name: 320 } },
    })

    await waitFor(() => expect(apiRef.current).not.toBeNull())
    await waitFor(() => expect(states.length).toBeGreaterThan(0))
    expect(apiRef.current?.getDirtyState().isDirty).toBe(false)

    const settledCount = states.length
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(states.length).toBe(settledCount)
  })

  it('stays clean after activating a saved view when the server also supplied initial settings', async () => {
    // The SSR "eliminating flicker" path: the host forwards `initialState` from
    // `fetchInitialPerspectiveState`. Those settings describe the mount state,
    // so re-seeding the baseline from them after a view is applied would report
    // changes the user never made — permanently, on every later render.
    const apiRef = React.createRef<DataTableViewApi | null>() as React.MutableRefObject<DataTableViewApi | null>
    renderTable({
      apiRef,
      savedViews: [SAVED_VIEW],
      initialSearchValue: 'acme',
      initialSettings: { columnSizing: { name: 320 } },
    })
    await waitFor(() => expect(apiRef.current).not.toBeNull())

    act(() => { apiRef.current!.openViewsSidebar() })
    const activate = await screen.findByTestId('activate-view-persp-1')
    await act(async () => { fireEvent.click(activate) })

    await waitFor(() => expect(apiRef.current?.getDirtyState().activePerspectiveId).toBe('persp-1'))
    expect(apiRef.current?.getDirtyState().changedKeys).toEqual([])
    // The regression re-appeared one render later, so let the tree settle first.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(apiRef.current?.getDirtyState().changedKeys).toEqual([])
    expect(apiRef.current?.getDirtyState().isDirty).toBe(false)
  })

  it('reports a role perspective as active but not saveable in place', async () => {
    const apiRef = React.createRef<DataTableViewApi | null>() as React.MutableRefObject<DataTableViewApi | null>
    const { setSearchValue } = renderTable({ apiRef, roleViews: [ROLE_VIEW], initialSearchValue: 'acme' })
    await waitFor(() => expect(apiRef.current).not.toBeNull())

    act(() => { apiRef.current!.openViewsSidebar() })
    const activate = await screen.findByTestId('activate-role-view-role-1')
    await act(async () => { fireEvent.click(activate) })

    await waitFor(() => expect(apiRef.current?.getDirtyState().activePerspectiveId).toBe('role-1'))
    // A role perspective is not the user's to overwrite: saving needs a name,
    // which creates a personal view instead.
    expect(apiRef.current?.getDirtyState().canSaveToActiveView).toBe(false)

    setSearchValue('other')
    await waitFor(() => expect(apiRef.current?.getDirtyState().isDirty).toBe(true))
    expect(apiRef.current?.getDirtyState().canSaveToActiveView).toBe(false)
    const result = await act(async () => apiRef.current!.saveCurrentView())
    expect(result).toEqual({ ok: false, reason: 'name-required' })
  })

  it('goes clean again after clearing back to "No view"', async () => {
    const apiRef = React.createRef<DataTableViewApi | null>() as React.MutableRefObject<DataTableViewApi | null>
    // A view carrying only table-owned state, so clearing it actually returns
    // the live settings to empty — the harness owns `searchValue` and would
    // otherwise keep a search term the clear cannot reach.
    renderTable({ apiRef, savedViews: [{ ...SAVED_VIEW, settings: { columnSizing: { name: 320 } } }] })
    await waitFor(() => expect(apiRef.current?.getDirtyState().canSaveToActiveView).toBe(true))

    // "No view" lives in the views switcher popover, not in the sidebar.
    const trigger = screen.getByTestId('data-table-open-views-sidebar').parentElement!.querySelector('button:last-of-type')!
    await act(async () => { fireEvent.click(trigger) })
    const clear = await screen.findByText('— No view —')
    await act(async () => { fireEvent.click(clear) })

    await waitFor(() => expect(apiRef.current?.getDirtyState().activePerspectiveId).toBeNull())
    expect(apiRef.current?.getDirtyState().isDirty).toBe(false)
    expect(apiRef.current?.getDirtyState().canSaveToActiveView).toBe(false)
  })

  it('reports not-ready while the permission check is still in flight', async () => {
    const apiRef = React.createRef<DataTableViewApi | null>() as React.MutableRefObject<DataTableViewApi | null>
    renderTable({ apiRef, perspectivesFeature: 'pending' })
    await waitFor(() => expect(apiRef.current).not.toBeNull())

    // "Not yet known" must not be reported as "views are disabled" — a host
    // button would otherwise tell the user a permission they hold is missing.
    const result = await act(async () => apiRef.current!.saveCurrentView({ name: 'Wide view' }))
    expect(result).toEqual({ ok: false, reason: 'not-ready' })
    expect(savedPayloads).toHaveLength(0)
  })

  it('reports perspectives-disabled once the permission check refuses', async () => {
    const apiRef = React.createRef<DataTableViewApi | null>() as React.MutableRefObject<DataTableViewApi | null>
    renderTable({ apiRef, perspectivesFeature: 'denied' })
    await waitFor(() => expect(apiRef.current).not.toBeNull())

    const result = await act(async () => apiRef.current!.saveCurrentView({ name: 'Wide view' }))
    expect(result).toEqual({ ok: false, reason: 'perspectives-disabled' })
    expect(savedPayloads).toHaveLength(0)
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

  it('describes every column in the settings it serializes, without reporting a change nobody made', async () => {
    // #5117: the serialized visibility used to be a verbatim copy of the sparse TanStack
    // state, so a saved view carried no decision for columns the user never toggled and an
    // absent key renders visible. It is now seeded from the full leaf-column set — and the
    // dense map must still compare equal to the sparse one the server stored, or every
    // table with a saved view would report unsaved changes the moment it mounted.
    const apiRef = React.createRef<DataTableViewApi | null>() as React.MutableRefObject<DataTableViewApi | null>
    const states: DataTableViewDirtyState[] = []
    renderTable({
      apiRef,
      onDirty: (state) => { states.push(state) },
      initialSettings: { columnVisibility: { name: false } },
    })

    await waitFor(() => expect(apiRef.current).not.toBeNull())
    expect(apiRef.current!.getCurrentSettings().columnVisibility).toEqual({ name: false, id: true })

    await waitFor(() => expect(states.length).toBeGreaterThan(0))
    expect(states.every((state) => !state.isDirty)).toBe(true)
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
