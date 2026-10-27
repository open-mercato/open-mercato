/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = MockResizeObserver

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
  apiCallOrThrow: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn() }),
  usePathname: () => '',
  useSearchParams: () => new URLSearchParams(),
}))

// Capture the props the component hands to DataTable. Driving the real Radix select in
// jsdom would test the design system, not this page's filtering; the repo's existing
// component tests (e.g. catalog CategoriesDataTable) mock DataTable for the same reason.
type CapturedProps = {
  data: Array<Record<string, any>>
  filters: Array<{ id: string; options?: Array<{ label: string; value: string }> }>
  onFiltersApply: (values: Record<string, unknown>) => void
  onFiltersClear: () => void
  onSearchChange: (value: string) => void
  onSortingChange: (sorting: unknown) => void
  pagination: { page: number; pageSize: number; total: number; totalPages: number; onPageChange: (p: number) => void }
}
let captured: CapturedProps

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: any) => {
    captured = props
    return <div data-testid="data-table">{props.data.map((row: any) => row.entityId).join(',')}</div>
  },
}))

jest.mock('@open-mercato/ui/backend/FilterBar', () => ({}))

import QueryIndexesTable from '../QueryIndexesTable'

const item = (over: Partial<Record<string, any>> & { entityId: string }) => ({
  label: over.entityId,
  baseCount: 1,
  indexCount: 1,
  vectorCount: null,
  vectorEnabled: false,
  fulltextCount: null,
  fulltextEnabled: false,
  hasCustomFields: false,
  ok: true,
  queryIndexOk: true,
  job: { status: 'idle' },
  ...over,
})

const MIXED = [
  item({ entityId: 'vec_active', vectorEnabled: true, vectorIndexingActive: true, vectorCount: 0, ok: false }),
  item({ entityId: 'vec_runtime_off', vectorEnabled: true, vectorIndexingActive: false, vectorCount: 0, ok: false }),
  item({ entityId: 'ft_only', fulltextEnabled: true, fulltextCount: 1 }),
  item({ entityId: 'cf_only', hasCustomFields: true }),
  item({ entityId: 'plain' }),
]

async function render(items = MIXED) {
  ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items })
  renderWithProviders(<QueryIndexesTable />, { dict: {} })
  await waitFor(() => expect(captured?.data?.length).toBe(items.length))
}

const visible = () => captured.data.map((row) => row.entityId)

async function applyBackend(value: string) {
  captured.onFiltersApply({ backend: value })
  await waitFor(() => expect(captured.data.length).toBeLessThan(MIXED.length))
}

describe('QueryIndexesTable — Backend filter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('offers exactly the three backend options', async () => {
    await render()
    const backend = captured.filters.find((f) => f.id === 'backend')
    expect(backend?.options?.map((o) => o.value)).toEqual(['vector', 'fulltext', 'custom_fields'])
  })

  it('shows every entity when no filter is applied, in the default entityId order', async () => {
    await render()
    expect(visible()).toEqual(['cf_only', 'ft_only', 'plain', 'vec_active', 'vec_runtime_off'])
  })

  it('narrows to vector-configured entities, keeping runtime-disabled ones', async () => {
    await render()
    await applyBackend('vector')
    // `vec_runtime_off` cannot currently index, but it IS a vector entity and its manual
    // reindex action must stay reachable — filtering it out would hide that action.
    expect(visible()).toEqual(['vec_active', 'vec_runtime_off'])
  })

  it('narrows to full-text entities', async () => {
    await render()
    await applyBackend('fulltext')
    expect(visible()).toEqual(['ft_only'])
  })

  it('narrows to custom-field entities', async () => {
    await render()
    await applyBackend('custom_fields')
    expect(visible()).toEqual(['cf_only'])
  })

  it('restores every entity when the filter is cleared', async () => {
    await render()
    await applyBackend('custom_fields')
    captured.onFiltersClear()
    await waitFor(() => expect(captured.data.length).toBe(MIXED.length))
  })

  it('intersects the backend filter with the text search', async () => {
    await render()
    await applyBackend('vector')
    captured.onSearchChange('runtime')
    await waitFor(() => expect(visible()).toEqual(['vec_runtime_off']))
  })
})

describe('QueryIndexesTable — pagination', () => {
  const many = Array.from({ length: 120 }, (_, i) =>
    item({ entityId: `entity_${String(i).padStart(3, '0')}` }))

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('keeps the page size within the repository-wide 100-row cap', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items: many })
    renderWithProviders(<QueryIndexesTable />, { dict: {} })
    await waitFor(() => expect(captured?.pagination?.total).toBe(120))

    expect(captured.pagination.pageSize).toBeLessThanOrEqual(100)
    expect(captured.data.length).toBe(captured.pagination.pageSize)
    expect(captured.pagination.totalPages).toBe(Math.ceil(120 / captured.pagination.pageSize))
  })

  it('serves real subsequent pages rather than re-rendering the first', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items: many })
    renderWithProviders(<QueryIndexesTable />, { dict: {} })
    await waitFor(() => expect(captured?.pagination?.total).toBe(120))

    const firstPage = visible()
    captured.pagination.onPageChange(2)
    await waitFor(() => expect(visible()[0]).not.toBe(firstPage[0]))
    expect(visible().some((id) => firstPage.includes(id))).toBe(false)
  })

  it('sorts across the whole result set, not just the visible page', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items: many })
    renderWithProviders(<QueryIndexesTable />, { dict: {} })
    await waitFor(() => expect(captured?.pagination?.total).toBe(120))

    captured.onSortingChange([{ id: 'entityId', desc: true }])
    // Descending, page 1 must start at the global maximum — if sorting ran after slicing it
    // would start at entity_049, the largest id on the unsorted first page.
    await waitFor(() => expect(visible()[0]).toBe('entity_119'))
  })

  it('clamps back to a valid page when filtering shrinks the result set', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValue({ items: many })
    renderWithProviders(<QueryIndexesTable />, { dict: {} })
    await waitFor(() => expect(captured?.pagination?.total).toBe(120))

    captured.pagination.onPageChange(3)
    await waitFor(() => expect(captured.pagination.page).toBe(3))
    captured.onSearchChange('entity_000')
    await waitFor(() => expect(captured.pagination.total).toBe(1))
    expect(captured.pagination.page).toBe(1)
    expect(visible()).toEqual(['entity_000'])
  })
})
