/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { render, fireEvent, waitFor, screen } from '@testing-library/react'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import type { PerspectivesIndexResponse, RolePerspectiveDto } from '@open-mercato/shared/modules/perspectives/types'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

// The guarded-mutation hook is the contract under test: every perspective write
// must be routed through `runMutation` so global mutation injections, record
// locks, and conflict handling participate consistently.
const mockRunMutation = jest.fn(
  async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
)
const mockRetryLastMutation = jest.fn(async () => false)
jest.mock('../injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: mockRunMutation,
    retryLastMutation: mockRetryLastMutation,
  }),
}))

// Capture the optimistic-lock headers attached to writes while keeping the call
// flow real: `apiCall` is recorded, `withScopedApiRequestHeaders` records the
// header bag and still runs the wrapped operation.
const mockScopedHeaderCalls: Array<Record<string, string>> = []
const mockApiCall = jest.fn(async (input: unknown, init?: { method?: string }) => {
  const url = String(input)
  const method = (init?.method ?? 'GET').toUpperCase()
  const ok = (result: unknown) => ({
    ok: true,
    status: 200,
    result,
    response: { ok: true, status: 200 } as Response,
    cacheStatus: null as const,
  })
  if (url.includes('/api/perspectives/') && method === 'POST') {
    return ok({
      perspective: {
        id: 'persp-1',
        name: 'My view',
        tableId: 'test-table',
        settings: {},
        isDefault: false,
        createdAt: 'now',
        updatedAt: '2026-06-19T00:00:00.000Z',
      },
      rolePerspectives: [],
      clearedRoleIds: [],
    })
  }
  return ok(undefined)
})
jest.mock('../utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...(args as [unknown, { method?: string }?])),
  withScopedApiRequestHeaders: async (
    headers: Record<string, string>,
    run: () => Promise<unknown>,
  ) => {
    mockScopedHeaderCalls.push(headers)
    return run()
  },
}))

type SidebarProps = {
  onSave: (input: {
    name: string
    isDefault: boolean
    applyToRoles: string[]
    setRoleDefault: boolean
    perspectiveId?: string | null
    settings?: unknown
  }) => void | Promise<void>
  onDeletePerspective: (perspectiveId: string) => void | Promise<void>
  onClearRole: (perspective: RolePerspectiveDto) => void | Promise<void>
}

const CLEAR_ROLE_PERSPECTIVE: RolePerspectiveDto = {
  id: 'role-persp-1',
  name: 'Role view',
  tableId: 'test-table',
  settings: {} as RolePerspectiveDto['settings'],
  isDefault: false,
  createdAt: 'now',
  updatedAt: '2026-06-19T00:00:00.000Z',
  roleId: 'role-1',
  tenantId: null,
  organizationId: null,
}

// Replace the heavy drawer UI with a stub exposing the three write handlers as
// buttons, so the test drives the mutations without rendering the full sidebar.
jest.mock('../PerspectiveSidebar', () => ({
  PerspectiveSidebar: (props: SidebarProps) => (
    <div>
      <button
        type="button"
        data-testid="save-perspective"
        onClick={() => {
          void props.onSave({
            name: 'My view',
            isDefault: false,
            applyToRoles: [],
            setRoleDefault: false,
            perspectiveId: 'persp-1',
            settings: {
              columnOrder: [],
              columnVisibility: {},
              filters: {},
              sorting: [],
              pageSize: 20,
              searchValue: '',
            },
          })
        }}
      >
        save
      </button>
      <button
        type="button"
        data-testid="delete-perspective"
        onClick={() => {
          void props.onDeletePerspective('persp-1')
        }}
      >
        delete
      </button>
      <button
        type="button"
        data-testid="clear-role"
        onClick={() => {
          void props.onClearRole(CLEAR_ROLE_PERSPECTIVE)
        }}
      >
        clear
      </button>
    </div>
  ),
}))

type Row = { id: string; name: string }

const INDEX_RESPONSE: PerspectivesIndexResponse = {
  tableId: 'test-table',
  perspectives: [
    {
      id: 'persp-1',
      name: 'My view',
      tableId: 'test-table',
      settings: {},
      isDefault: false,
      createdAt: 'now',
      updatedAt: '2026-06-19T00:00:00.000Z',
    },
  ],
  defaultPerspectiveId: null,
  rolePerspectives: [],
  roles: [{ id: 'role-1', name: 'Role 1', hasPerspective: false, hasDefault: false }],
  canApplyToRoles: true,
}

function renderTable() {
  const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      mutations: { retry: false },
    },
  })
  // Seed both perspective queries so the component renders the (mocked) sidebar
  // without issuing any network fetch for them.
  queryClient.setQueryData(['feature-check', 'perspectives'], { use: true, roleDefaults: true })
  queryClient.setQueryData(['table-perspectives', 'test-table'], INDEX_RESPONSE)
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        <DataTable
          columns={columns}
          data={[]}
          perspective={{ tableId: 'test-table' }}
        />
      </I18nProvider>
    </QueryClientProvider>,
  )
  return { ...utils, queryClient }
}

describe('DataTable perspective writes go through useGuardedMutation', () => {
  beforeEach(() => {
    mockRunMutation.mockClear()
    mockRetryLastMutation.mockClear()
    mockApiCall.mockClear()
    mockScopedHeaderCalls.length = 0
  })

  it('routes perspective save through runMutation and keeps the optimistic-lock header', async () => {
    const { queryClient } = renderTable()
    try {
      fireEvent.click(screen.getByTestId('save-perspective'))
      await waitFor(() => expect(mockRunMutation).toHaveBeenCalledTimes(1))

      const call = mockRunMutation.mock.calls[0][0] as {
        operation: () => Promise<unknown>
        context: Record<string, unknown>
        mutationPayload?: Record<string, unknown>
      }
      expect(call.context.resourceKind).toBe('perspective')
      expect(typeof call.context.retryLastMutation).toBe('function')

      await waitFor(() =>
        expect(mockApiCall).toHaveBeenCalledWith(
          expect.stringContaining('/api/perspectives/test-table'),
          expect.objectContaining({ method: 'POST' }),
        ),
      )
      // The save still attaches the optimistic-lock header for the edited record.
      expect(mockScopedHeaderCalls).toContainEqual({
        [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-06-19T00:00:00.000Z',
      })
    } finally {
      queryClient.clear()
    }
  })

  it('routes perspective delete through runMutation', async () => {
    const { queryClient } = renderTable()
    try {
      fireEvent.click(screen.getByTestId('delete-perspective'))
      await waitFor(() => expect(mockRunMutation).toHaveBeenCalledTimes(1))

      const call = mockRunMutation.mock.calls[0][0] as { context: Record<string, unknown> }
      expect(call.context.resourceKind).toBe('perspective')
      expect(typeof call.context.retryLastMutation).toBe('function')

      await waitFor(() =>
        expect(mockApiCall).toHaveBeenCalledWith(
          expect.stringContaining('/api/perspectives/test-table/persp-1'),
          expect.objectContaining({ method: 'DELETE' }),
        ),
      )
    } finally {
      queryClient.clear()
    }
  })

  it('routes role-clear through runMutation', async () => {
    const { queryClient } = renderTable()
    try {
      fireEvent.click(screen.getByTestId('clear-role'))
      await waitFor(() => expect(mockRunMutation).toHaveBeenCalledTimes(1))

      const call = mockRunMutation.mock.calls[0][0] as { context: Record<string, unknown> }
      expect(call.context.resourceKind).toBe('perspective')
      expect(typeof call.context.retryLastMutation).toBe('function')

      await waitFor(() =>
        expect(mockApiCall).toHaveBeenCalledWith(
          expect.stringContaining('/api/perspectives/test-table/roles/role-1'),
          expect.objectContaining({ method: 'DELETE' }),
        ),
      )
    } finally {
      queryClient.clear()
    }
  })
})
