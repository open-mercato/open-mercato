/** @jest-environment jsdom */

import { act, render, renderHook, waitFor } from '@testing-library/react'

const apiCallMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const runMutationMock = jest.fn()
const retryLastMutationMock = jest.fn(async () => false)
const surfaceRecordConflictMock = jest.fn()
const mockDataTableProps = jest.fn()
const translateMock = (key: string) => key

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: unknown) => {
    mockDataTableProps(props)
    return null
  },
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({ RowActions: () => null }))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: runMutationMock,
    retryLastMutation: retryLastMutationMock,
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(async () => true),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => surfaceRecordConflictMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translateMock }))

import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useTemplatesPage } from '../backend/documents/templates/useTemplatesPage'
import { TemplatesTable } from '../backend/documents/templates/TemplatesTable'
import { metadata as templatesPageMetadata } from '../backend/documents/templates/page.meta'
import features from '../acl'

const UPDATED_AT = '2026-07-10T01:00:00.000Z'

function template(id: string, name: string, isActive: boolean) {
  return {
    id,
    name,
    description: null,
    bodyHtml: '<p>Template</p>',
    contextSlots: [],
    isActive,
    updatedAt: UPDATED_AT,
    createdAt: UPDATED_AT,
  }
}

function templatePage(input: {
  items: ReturnType<typeof template>[]
  page?: number
  total?: number
  totalPages?: number
  canManageTemplates?: boolean
}) {
  return {
    ok: true,
    result: {
      items: input.items,
      total: input.total ?? input.items.length,
      capabilities: { canManageTemplates: input.canManageTemplates ?? true },
      page: input.page ?? 1,
      pageSize: 100,
      totalPages: input.totalPages ?? 1,
    },
  }
}

describe('templates management page guard', () => {
  it('gates the management page and its nav entry on the template feature', () => {
    // The list API stays on documents.view for the new-from-template dialog,
    // but this page only offers manage-gated actions.
    expect(templatesPageMetadata.requireFeatures).toEqual(['documents.templates.manage'])
    expect(templatesPageMetadata.requireFeatures).not.toContain('documents.view')
  })

  it('declares that feature in the module ACL', () => {
    expect(features.map((feature) => feature.id)).toContain('documents.templates.manage')
  })
})

describe('templates management visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockReset()
    apiCallOrThrowMock.mockReset()
    runMutationMock.mockReset()
    runMutationMock.mockResolvedValue(undefined)
    apiCallMock.mockResolvedValue(templatePage({
      items: [
        template('11111111-1111-4111-8111-111111111111', 'Active template', true),
        template('22222222-2222-4222-8222-222222222222', 'Inactive template', false),
      ],
    }))
  })

  it('keeps inactive templates visible to managers', async () => {
    const { result } = renderHook(() => useTemplatesPage())
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/documents/templates?page=1&pageSize=100&includeBody=false',
      undefined,
      { fallback: { items: [] } },
    )
    expect(result.current.rows).toEqual([
      expect.objectContaining({ name: 'Active template', isActive: true }),
      expect.objectContaining({ name: 'Inactive template', isActive: false }),
    ])
    expect(result.current).toMatchObject({ page: 1, pageSize: 100, total: 2, totalPages: 1 })
    expect(result.current.canManageTemplates).toBe(true)
  })

  it('enters loading state immediately for every subsequent search', async () => {
    let resolveSearch: ((value: unknown) => void) | null = null
    apiCallMock
      .mockResolvedValueOnce(templatePage({
        items: [template('88888888-8888-4888-8888-888888888888', 'Initial template', true)],
      }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSearch = resolve }))

    const { result } = renderHook(() => useTemplatesPage())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => result.current.setSearch('Release'))

    expect(result.current.isLoading).toBe(true)
    expect(result.current.loadError).toBeNull()
    await act(async () => {
      resolveSearch?.(templatePage({ items: [] }))
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
  })

  it('reaches page two for broad searches with duplicate template names and resets after deletion', async () => {
    const firstDuplicate = template('33333333-3333-4333-8333-333333333333', 'Quarterly plan', true)
    const laterDuplicate = template('44444444-4444-4444-8444-444444444444', 'Quarterly plan', false)
    apiCallMock
      .mockResolvedValueOnce(templatePage({ items: [firstDuplicate], total: 101, totalPages: 2 }))
      .mockResolvedValueOnce(templatePage({ items: [laterDuplicate], page: 2, total: 101, totalPages: 2 }))
      .mockResolvedValueOnce(templatePage({ items: [firstDuplicate], total: 101, totalPages: 2 }))
      .mockResolvedValueOnce(templatePage({ items: [laterDuplicate], page: 2, total: 101, totalPages: 2 }))
      .mockResolvedValueOnce(templatePage({ items: [firstDuplicate], total: 100, totalPages: 1 }))

    const { result } = renderHook(() => useTemplatesPage())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current).toMatchObject({ page: 1, pageSize: 100, total: 101, totalPages: 2 })

    act(() => result.current.setPage(2))
    await waitFor(() => expect(result.current.rows[0]?.id).toBe(laterDuplicate.id))
    expect(apiCallMock).toHaveBeenNthCalledWith(
      2,
      '/api/documents/templates?page=2&pageSize=100&includeBody=false',
      undefined,
      { fallback: { items: [] } },
    )
    expect(result.current).toMatchObject({ page: 2, pageSize: 100, total: 101, totalPages: 2 })

    act(() => result.current.setSearch('  Quarterly  '))
    await waitFor(() => expect(result.current.rows[0]?.id).toBe(firstDuplicate.id))
    expect(apiCallMock).toHaveBeenNthCalledWith(
      3,
      '/api/documents/templates?page=1&pageSize=100&includeBody=false&search=Quarterly',
      undefined,
      { fallback: { items: [] } },
    )
    expect(result.current.page).toBe(1)

    act(() => result.current.setPage(2))
    await waitFor(() => expect(result.current.rows[0]?.id).toBe(laterDuplicate.id))
    expect(apiCallMock).toHaveBeenNthCalledWith(
      4,
      '/api/documents/templates?page=2&pageSize=100&includeBody=false&search=Quarterly',
      undefined,
      { fallback: { items: [] } },
    )
    await act(async () => { await result.current.deleteTemplate(laterDuplicate) })
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(5))
    expect(apiCallMock).toHaveBeenNthCalledWith(
      5,
      '/api/documents/templates?page=1&pageSize=100&includeBody=false&search=Quarterly',
      undefined,
      { fallback: { items: [] } },
    )
    expect(result.current.page).toBe(1)
  })

  it('does not flash a duplicate error when a delete 409 is surfaced on the conflict banner', async () => {
    const row = template('77777777-7777-4777-8777-777777777777', 'Contended template', true)
    runMutationMock.mockRejectedValueOnce(new Error('Record changed by another user'))
    surfaceRecordConflictMock.mockReturnValueOnce(true)

    const { result } = renderHook(() => useTemplatesPage())
    await waitFor(() => expect(result.current.canManageTemplates).toBe(true))

    await act(async () => { await result.current.deleteTemplate(row) })

    expect(surfaceRecordConflictMock).toHaveBeenCalledWith(
      expect.any(Error),
      translateMock,
      { onRefresh: expect.any(Function) },
    )
    expect(flash).not.toHaveBeenCalled()
  })

  it('clears stale rows and pagination metadata after a load error', async () => {
    apiCallMock
      .mockResolvedValueOnce(templatePage({
        items: [template('55555555-5555-4555-8555-555555555555', 'Reachable template', true)],
        total: 125,
        totalPages: 2,
      }))
      .mockResolvedValueOnce({ ok: false, result: { items: [] } })

    const { result } = renderHook(() => useTemplatesPage())
    await waitFor(() => expect(result.current.total).toBe(125))

    act(() => result.current.refresh())
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.rows).toEqual([])
    expect(result.current).toMatchObject({ total: 0, totalPages: 1, canManageTemplates: false })
  })

  it('passes bounded server pagination metadata and navigation to DataTable', () => {
    const onPageChange = jest.fn()
    const onPageSizeChange = jest.fn()
    render(<TemplatesTable
      rows={[template('66666666-6666-4666-8666-666666666666', 'Page one', true)]}
      page={1}
      pageSize={100}
      total={101}
      totalPages={2}
      totalIsCapped={false}
      search="Quarterly"
      isLoading={false}
      canManageTemplates
      onSearchChange={jest.fn()}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      onRefresh={jest.fn()}
      onEdit={jest.fn()}
      onDelete={jest.fn()}
    />)

    const props = mockDataTableProps.mock.lastCall?.[0] as {
      pagination?: {
        page: number
        pageSize: number
        total: number
        totalPages: number
        pageSizeOptions: number[]
        onPageChange: (page: number) => void
        onPageSizeChange: (pageSize: number) => void
      }
    }
    expect(props.pagination).toMatchObject({
      page: 1,
      pageSize: 100,
      total: 101,
      totalPages: 2,
      pageSizeOptions: [25, 50, 100],
    })

    act(() => props.pagination?.onPageChange(2))
    act(() => props.pagination?.onPageSizeChange(50))
    expect(onPageChange).toHaveBeenCalledWith(2)
    expect(onPageSizeChange).toHaveBeenCalledWith(50)
  })
})
