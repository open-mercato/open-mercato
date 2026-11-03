/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable, writePerspectiveSnapshot, readPerspectiveSnapshot } from '../DataTable'
import type { DataTableViewApi } from '../DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { render, act, fireEvent, screen } from '@testing-library/react'
import type { PerspectivesIndexResponse } from '@open-mercato/shared/modules/perspectives/types'
import { createEmptyTree, serializeTreeForPersist } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import type { AdvancedFilterTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'

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

jest.mock('../FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('../utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({
    ok: true,
    status: 200,
    result: undefined,
    response: { ok: true, status: 200 } as Response,
    cacheStatus: null as const,
  })),
  withScopedApiRequestHeaders: async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
}))

jest.mock('../PerspectiveSidebar', () => ({
  PerspectiveSidebar: () => null,
}))

type Row = { id: string; name: string }

const TABLE_ID = 'reconcile-table'
const SERVER_UPDATED_AT = '2026-08-06T00:00:00.000Z'
const SERVER_UPDATED_AT_MS = Date.parse(SERVER_UPDATED_AT)

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'id', header: 'Id' },
]

function buildIndexResponse(
  perspectives: PerspectivesIndexResponse['perspectives'],
  overrides?: Partial<PerspectivesIndexResponse>,
): PerspectivesIndexResponse {
  return {
    tableId: TABLE_ID,
    perspectives,
    defaultPerspectiveId: null,
    rolePerspectives: [],
    manageableRolePerspectives: [],
    roles: [],
    canApplyToRoles: false,
    ...overrides,
  }
}

function buildPerspective(
  id: string,
  searchValue: string,
  updatedAt: string = SERVER_UPDATED_AT,
): PerspectivesIndexResponse['perspectives'][number] {
  return {
    id,
    name: id,
    tableId: TABLE_ID,
    settings: { searchValue },
    isDefault: false,
    createdAt: 'now',
    updatedAt,
  }
}

function renderTable(response: PerspectivesIndexResponse, options?: { withAdvancedFilterHost?: boolean }) {
  const searchChanges: string[] = []
  const appliedTrees: unknown[] = []
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(['feature-check', 'perspectives'], { use: true, roleDefaults: true })
  queryClient.setQueryData(['table-perspectives', TABLE_ID], response)

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        <DataTable<Row>
          columns={columns}
          data={[]}
          searchValue=""
          onSearchChange={(value) => { searchChanges.push(value) }}
          perspective={{ tableId: TABLE_ID }}
          advancedFilter={options?.withAdvancedFilterHost
            ? {
                fields: [],
                value: createEmptyTree(),
                onChange: () => {},
                onApply: () => {},
                onClear: () => {},
                onApplyTree: (tree) => { appliedTrees.push(tree) },
              }
            : undefined}
        />
      </I18nProvider>
    </QueryClientProvider>,
  )
  return { ...utils, searchChanges, appliedTrees, queryClient }
}

function buildFilterTree(value: string): AdvancedFilterTree {
  return {
    root: {
      id: 'filter-root',
      type: 'group',
      combinator: 'and',
      children: [
        { id: 'filter-rule', type: 'rule', field: 'name', operator: 'contains', value },
      ],
    },
  }
}

function renderAdvancedFilterTable(
  response: PerspectivesIndexResponse,
  options: { initialTree?: AdvancedFilterTree; strictMode?: boolean } = {},
) {
  const appliedTrees: AdvancedFilterTree[] = []
  const searchChanges: string[] = []
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(['feature-check', 'perspectives'], { use: true, roleDefaults: true })
  queryClient.setQueryData(['table-perspectives', TABLE_ID], response)
  const initialTree = options.initialTree ?? createEmptyTree()
  const viewApiRef = React.createRef<DataTableViewApi>()
  let currentTree = initialTree
  let replaceHostTree: ((tree: AdvancedFilterTree) => void) | undefined

  function Host() {
    const [tree, setTree] = React.useState(initialTree)
    const [searchValue, setSearchValue] = React.useState('')
    currentTree = tree
    replaceHostTree = setTree
    return (
      <DataTable<Row>
        columns={columns}
        data={[]}
        searchValue={searchValue}
        onSearchChange={(value) => {
          searchChanges.push(value)
          setSearchValue(value)
        }}
        perspective={{ tableId: TABLE_ID }}
        viewApiRef={viewApiRef}
        advancedFilter={{
          fields: [{ key: 'name', label: 'Name', type: 'text' }],
          value: tree,
          onChange: setTree,
          onApply: () => {},
          onClear: () => setTree(createEmptyTree()),
          onApplyTree: (restoredTree) => {
            appliedTrees.push(restoredTree)
            setTree(restoredTree)
          },
        }}
      />
    )
  }

  const table = <Host />
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        {options.strictMode ? <React.StrictMode>{table}</React.StrictMode> : table}
      </I18nProvider>
    </QueryClientProvider>,
  )
  return {
    ...utils,
    appliedTrees,
    searchChanges,
    queryClient,
    viewApiRef,
    getTree: () => currentTree,
    clear: () => {
      act(() => { replaceHostTree?.(createEmptyTree()) })
    },
  }
}

describe('DataTable localStorage snapshot vs. server perspective reconciliation (#5113)', () => {
  beforeEach(() => {
    localStorage.clear()
    for (const cookie of document.cookie ? document.cookie.split(';') : []) {
      const name = cookie.split('=')[0].trim()
      if (name) document.cookie = `${name}=; Path=/; Max-Age=0`
    }
  })

  it('yields to a newer server perspective instead of staying pinned to the snapshot', () => {
    // Tab A mounted before tab B saved: the snapshot predates the stored row.
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'persp-1',
      settings: { searchValue: 'stale' },
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })

    const { searchChanges } = renderTable(buildIndexResponse([buildPerspective('persp-1', 'fresh')]))

    expect(searchChanges[0]).toBe('stale')
    expect(searchChanges[searchChanges.length - 1]).toBe('fresh')
  })

  it('keeps the snapshot when the server row is older, so a stale read never wins', () => {
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'persp-1',
      settings: { searchValue: 'local' },
      updatedAt: SERVER_UPDATED_AT_MS + 60_000,
    })

    const { searchChanges } = renderTable(buildIndexResponse([buildPerspective('persp-1', 'older-server')]))

    expect(searchChanges).toEqual(['local'])
  })

  it('does not re-apply on clock skew alone when the settings are identical', () => {
    // `updatedAt` in the snapshot is a browser clock reading and the server's is
    // a database one, so "server is newer" on its own must not repaint the table.
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'persp-1',
      settings: { searchValue: 'same' },
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })

    const { searchChanges } = renderTable(buildIndexResponse([buildPerspective('persp-1', 'same')]))

    expect(searchChanges).toEqual(['same'])
  })

  it('drops a snapshot pointing at a deleted perspective and resumes normal resolution', () => {
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'deleted-1',
      settings: { searchValue: 'orphaned' },
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })

    const { searchChanges } = renderTable(buildIndexResponse(
      [buildPerspective('persp-2', 'server-default')],
      { defaultPerspectiveId: 'persp-2' },
    ))

    expect(searchChanges[searchChanges.length - 1]).toBe('server-default')
    expect(readPerspectiveSnapshot(TABLE_ID)?.perspectiveId).toBe('persp-2')
  })

  it('drops an orphaned snapshot without touching a host-owned advanced filter when a replacement view exists', () => {
    // Same background correction as the "no replacement left" case below — the
    // active view was deleted, unshared or reassigned in another session — but
    // taken through the *common* branch: normal resolution finds a replacement
    // (here, the server default) instead of finding nothing at all.
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'deleted-1',
      settings: { searchValue: 'orphaned' },
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })

    const { searchChanges, appliedTrees } = renderTable(
      buildIndexResponse(
        [buildPerspective('persp-2', 'server-default')],
        { defaultPerspectiveId: 'persp-2' },
      ),
      { withAdvancedFilterHost: true },
    )

    expect(searchChanges[searchChanges.length - 1]).toBe('server-default')
    expect(readPerspectiveSnapshot(TABLE_ID)?.perspectiveId).toBe('persp-2')
    expect(appliedTrees).toHaveLength(0)
  })

  it('clears an orphaned snapshot even when no replacement view is left to fall back to', () => {
    // "my only saved view was deleted elsewhere" is one of the two #5113
    // scenarios. With no default, no role default and no remaining perspective,
    // normal resolution finds no target, so the orphaned settings would stay
    // painted — and `activePerspectiveId` would keep naming a deleted row — for
    // the rest of this page load unless the empty case clears explicitly.
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'deleted-1',
      settings: { searchValue: 'orphaned' },
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })

    const { searchChanges } = renderTable(buildIndexResponse([]))

    expect(searchChanges[0]).toBe('orphaned')
    expect(searchChanges[searchChanges.length - 1]).toBe('')
    expect(readPerspectiveSnapshot(TABLE_ID)).toBeNull()
  })

  it('clears without touching a host-owned advanced filter when no replacement view is left', () => {
    // The clear above is a background correction — the view was deleted in
    // another session — so it follows the same rule as the reconciling apply:
    // on People/Companies/Deals the URL owns the filter and the user must not
    // lose what is on screen because a view they were not looking at vanished.
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'deleted-1',
      settings: { searchValue: 'orphaned' },
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })

    const { searchChanges, appliedTrees } = renderTable(
      buildIndexResponse([]),
      { withAdvancedFilterHost: true },
    )

    expect(searchChanges[searchChanges.length - 1]).toBe('')
    expect(readPerspectiveSnapshot(TABLE_ID)).toBeNull()
    expect(appliedTrees).toHaveLength(0)
  })

  it('leaves a "No view" widths-only snapshot alone rather than forcing the server default', () => {
    // #1835: column widths survive a refresh without an active perspective, and
    // "No view" is an explicit user choice the server default must not override.
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: null,
      settings: { columnSizing: { name: 240 } },
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })

    const { searchChanges } = renderTable(buildIndexResponse(
      [buildPerspective('persp-2', 'server-default')],
      { defaultPerspectiveId: 'persp-2' },
    ))

    expect(searchChanges).not.toContain('server-default')
  })

  it('does not overwrite a host-owned advanced filter while reconciling', () => {
    // Reconciliation is a background correction, so it follows the mount-time
    // restore: on People/Companies/Deals the URL owns the filter and a repaint
    // the user never asked for must not clear what is on screen.
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'persp-1',
      settings: { searchValue: 'stale' },
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })

    const { searchChanges, appliedTrees } = renderTable(
      buildIndexResponse([buildPerspective('persp-1', 'fresh')]),
      { withAdvancedFilterHost: true },
    )

    expect(searchChanges[searchChanges.length - 1]).toBe('fresh')
    expect(appliedTrees).toHaveLength(0)
  })

  it('reconciles once per table, so a later refetch cannot clobber post-mount edits', () => {
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'persp-1',
      settings: { searchValue: 'stale' },
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })

    const { searchChanges, queryClient } = renderTable(
      buildIndexResponse([buildPerspective('persp-1', 'fresh')]),
    )
    expect(searchChanges[searchChanges.length - 1]).toBe('fresh')
    const callsAfterReconcile = searchChanges.length

    act(() => {
      queryClient.setQueryData(
        ['table-perspectives', TABLE_ID],
        buildIndexResponse([buildPerspective('persp-1', 'refetched', '2027-01-01T00:00:00.000Z')]),
      )
    })

    expect(searchChanges).toHaveLength(callsAfterReconcile)
    expect(searchChanges).not.toContain('refetched')
  })

  it.each([false, true])('restores the saved advanced filter on a bare revisit (StrictMode: %s)', (strictMode) => {
    const savedTree = buildFilterTree('Alice')
    const filters = { ...serializeTreeForPersist(savedTree) }
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'persp-1',
      settings: { filters },
      updatedAt: SERVER_UPDATED_AT_MS + 60_000,
    })
    const perspective = { ...buildPerspective('persp-1', ''), settings: { filters } }

    const rendered = renderAdvancedFilterTable(buildIndexResponse([perspective]), { strictMode })

    expect(rendered.getTree()).toEqual(savedTree)
    expect(rendered.appliedTrees).toEqual([savedTree])
    expect(rendered.viewApiRef.current?.getDirtyState().activePerspectiveId).toBe('persp-1')
    expect(readPerspectiveSnapshot(TABLE_ID)?.settings.filters).toEqual(filters)
  })

  it('keeps a populated URL-derived tree ahead of the saved perspective filter', () => {
    const savedTree = buildFilterTree('Alice')
    const urlTree = buildFilterTree('Bob')
    const filters = { ...serializeTreeForPersist(savedTree) }
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'persp-1',
      settings: { filters },
      updatedAt: SERVER_UPDATED_AT_MS + 60_000,
    })
    const perspective = { ...buildPerspective('persp-1', ''), settings: { filters } }

    const rendered = renderAdvancedFilterTable(buildIndexResponse([perspective]), { initialTree: urlTree })

    expect(rendered.getTree()).toEqual(urlTree)
    expect(rendered.appliedTrees).toHaveLength(0)
    expect(readPerspectiveSnapshot(TABLE_ID)?.settings.filters).toEqual(filters)
  })

  it('keeps a deliberately cleared advanced filter empty after remount', () => {
    const savedTree = buildFilterTree('Alice')
    const filters = { ...serializeTreeForPersist(savedTree) }
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'persp-1',
      settings: { filters, columnSizing: { name: 240 } },
      updatedAt: SERVER_UPDATED_AT_MS + 60_000,
    })
    const perspective = { ...buildPerspective('persp-1', ''), settings: { filters } }
    const response = buildIndexResponse([perspective])
    const rendered = renderAdvancedFilterTable(response)
    expect(rendered.getTree()).toEqual(savedTree)

    rendered.clear()

    expect(readPerspectiveSnapshot(TABLE_ID)?.settings.filters).toBeUndefined()
    expect(readPerspectiveSnapshot(TABLE_ID)?.settings.columnSizing).toEqual({ name: 240 })
    expect(readPerspectiveSnapshot(TABLE_ID)?.perspectiveId).toBe('persp-1')
    rendered.unmount()

    const revisited = renderAdvancedFilterTable(response)
    expect(revisited.getTree().root.children).toHaveLength(0)
    expect(revisited.appliedTrees).toHaveLength(0)
  })

  it('does not resurrect a cleared snapshot filter when reconciling a newer server view', () => {
    const filters = { ...serializeTreeForPersist(buildFilterTree('Alice')) }
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'persp-1',
      settings: { searchValue: 'stale' },
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })
    const perspective = { ...buildPerspective('persp-1', 'fresh'), settings: { searchValue: 'fresh', filters } }

    const rendered = renderAdvancedFilterTable(buildIndexResponse([perspective]))

    expect(rendered.searchChanges[rendered.searchChanges.length - 1]).toBe('fresh')
    expect(rendered.getTree().root.children).toHaveLength(0)
    expect(rendered.appliedTrees).toHaveLength(0)
    expect(readPerspectiveSnapshot(TABLE_ID)?.settings.filters).toBeUndefined()
  })

  it('retains the restored filter snapshot when synchronous reconciliation runs before the host rerenders', () => {
    const savedTree = buildFilterTree('Alice')
    const filters = { ...serializeTreeForPersist(savedTree) }
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'persp-1',
      settings: { searchValue: 'stale', filters },
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })
    const perspective = { ...buildPerspective('persp-1', 'fresh'), settings: { searchValue: 'fresh', filters } }

    const rendered = renderAdvancedFilterTable(buildIndexResponse([perspective]))

    expect(rendered.searchChanges[rendered.searchChanges.length - 1]).toBe('fresh')
    expect(rendered.getTree()).toEqual(savedTree)
    expect(readPerspectiveSnapshot(TABLE_ID)?.settings.filters).toEqual(filters)
    expect(rendered.viewApiRef.current?.getDirtyState().changedKeys).not.toContain('filters')
  })

  it('preserves the newly selected filter after switching through an unfiltered view and revisiting', () => {
    const firstTree = buildFilterTree('Alice')
    const nextTree = buildFilterTree('Bob')
    const firstFilters = { ...serializeTreeForPersist(firstTree) }
    const nextFilters = { ...serializeTreeForPersist(nextTree) }
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'persp-1',
      settings: { filters: firstFilters },
      updatedAt: SERVER_UPDATED_AT_MS + 60_000,
    })
    const response = buildIndexResponse([
      { ...buildPerspective('persp-1', ''), settings: { filters: firstFilters } },
      buildPerspective('persp-empty', ''),
      { ...buildPerspective('persp-2', ''), settings: { filters: nextFilters } },
    ])
    const rendered = renderAdvancedFilterTable(response)

    fireEvent.click(screen.getByRole('button', { name: 'persp-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'persp-empty' }))
    expect(rendered.getTree().root.children).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'persp-empty' }))
    fireEvent.click(screen.getByRole('button', { name: 'persp-2' }))
    expect(rendered.getTree()).toEqual(nextTree)
    expect(readPerspectiveSnapshot(TABLE_ID)?.settings.filters).toEqual(nextFilters)
    expect(readPerspectiveSnapshot(TABLE_ID)?.perspectiveId).toBe('persp-2')
    rendered.unmount()

    const revisited = renderAdvancedFilterTable(response)
    expect(revisited.getTree()).toEqual(nextTree)
    expect(revisited.viewApiRef.current?.getDirtyState().activePerspectiveId).toBe('persp-2')
  })

  it('clears a filter restored from an orphaned snapshot when no replacement view exists', () => {
    const filters = { ...serializeTreeForPersist(buildFilterTree('Alice')) }
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'deleted-1',
      settings: { searchValue: 'orphaned', filters },
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })

    const rendered = renderAdvancedFilterTable(buildIndexResponse([]))

    expect(rendered.getTree().root.children).toHaveLength(0)
    expect(rendered.viewApiRef.current?.getDirtyState().activePerspectiveId).toBeNull()
    expect(readPerspectiveSnapshot(TABLE_ID)).toBeNull()
  })

  it('replaces an orphaned snapshot filter with the unfiltered replacement view', () => {
    const filters = { ...serializeTreeForPersist(buildFilterTree('Alice')) }
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'deleted-1',
      settings: { searchValue: 'orphaned', filters },
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })
    const response = buildIndexResponse(
      [buildPerspective('persp-2', 'replacement')],
      { defaultPerspectiveId: 'persp-2' },
    )

    const rendered = renderAdvancedFilterTable(response)

    expect(rendered.getTree().root.children).toHaveLength(0)
    expect(rendered.viewApiRef.current?.getDirtyState().activePerspectiveId).toBe('persp-2')
    expect(readPerspectiveSnapshot(TABLE_ID)?.perspectiveId).toBe('persp-2')
    expect(readPerspectiveSnapshot(TABLE_ID)?.settings.filters).toBeUndefined()
  })

  it('replaces a restored snapshot filter with the newer server filter before the host edits it', () => {
    const savedTree = buildFilterTree('Alice')
    const newerTree = buildFilterTree('Bob')
    const savedFilters = { ...serializeTreeForPersist(savedTree) }
    const newerFilters = { ...serializeTreeForPersist(newerTree) }
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'persp-1',
      settings: { filters: savedFilters },
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })
    const perspective = { ...buildPerspective('persp-1', ''), settings: { filters: newerFilters } }

    const rendered = renderAdvancedFilterTable(buildIndexResponse([perspective]))

    expect(rendered.getTree()).toEqual(newerTree)
    expect(rendered.appliedTrees).toEqual([savedTree, newerTree])
    expect(rendered.viewApiRef.current?.getDirtyState().changedKeys).not.toContain('filters')
    expect(readPerspectiveSnapshot(TABLE_ID)?.settings.filters).toEqual(newerFilters)
  })

  it('preserves the URL filter while retaining the newer server filter for a bare revisit', () => {
    const savedFilters = { ...serializeTreeForPersist(buildFilterTree('Alice')) }
    const newerTree = buildFilterTree('Bob')
    const newerFilters = { ...serializeTreeForPersist(newerTree) }
    const urlTree = buildFilterTree('Charlie')
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'persp-1',
      settings: { filters: savedFilters },
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })
    const perspective = { ...buildPerspective('persp-1', ''), settings: { filters: newerFilters } }
    const response = buildIndexResponse([perspective])

    const rendered = renderAdvancedFilterTable(response, { initialTree: urlTree })

    expect(rendered.getTree()).toEqual(urlTree)
    expect(rendered.appliedTrees).toHaveLength(0)
    expect(readPerspectiveSnapshot(TABLE_ID)?.settings.filters).toEqual(newerFilters)
    rendered.unmount()

    const revisited = renderAdvancedFilterTable(response)
    expect(revisited.getTree()).toEqual(newerTree)
    expect(revisited.viewApiRef.current?.getDirtyState().activePerspectiveId).toBe('persp-1')
  })

  it('retains the newer server filter when a URL filter overrides a snapshot without filters', () => {
    const newerTree = buildFilterTree('Bob')
    const newerFilters = { ...serializeTreeForPersist(newerTree) }
    const urlTree = buildFilterTree('Charlie')
    writePerspectiveSnapshot(TABLE_ID, {
      perspectiveId: 'persp-1',
      settings: {},
      updatedAt: SERVER_UPDATED_AT_MS - 60_000,
    })
    const perspective = { ...buildPerspective('persp-1', ''), settings: { filters: newerFilters } }
    const response = buildIndexResponse([perspective])

    const rendered = renderAdvancedFilterTable(response, { initialTree: urlTree })

    expect(rendered.getTree()).toEqual(urlTree)
    expect(rendered.appliedTrees).toHaveLength(0)
    expect(readPerspectiveSnapshot(TABLE_ID)?.settings.filters).toEqual(newerFilters)
    rendered.unmount()

    const revisited = renderAdvancedFilterTable(response)
    expect(revisited.getTree()).toEqual(newerTree)
  })
})
