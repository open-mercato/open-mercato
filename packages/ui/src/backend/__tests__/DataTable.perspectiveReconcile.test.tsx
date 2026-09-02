/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable, writePerspectiveSnapshot, readPerspectiveSnapshot } from '../DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { render, act } from '@testing-library/react'
import type { PerspectivesIndexResponse } from '@open-mercato/shared/modules/perspectives/types'
import { createEmptyTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'

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
})
