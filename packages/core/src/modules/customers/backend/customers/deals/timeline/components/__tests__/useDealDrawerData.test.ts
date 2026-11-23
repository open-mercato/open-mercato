/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { mapDealDrawerPayload, useDealDrawerData } from '../useDealDrawerData'

type ApiResponse = { ok: boolean; status: number; result: unknown }
type Deferred = { resolve: (value: ApiResponse) => void; url: string }

const mockPending: Deferred[] = []
const mockApiCall = jest.fn(
  (url: string) =>
    new Promise<ApiResponse>((resolve) => {
      mockPending.push({ resolve, url })
    }),
)

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (url: string) => mockApiCall(url),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
}))

const DEAL_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_DEAL_ID = '44444444-4444-4444-8444-444444444444'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'

function detailPayload(title: string, id = DEAL_ID): ApiResponse {
  return {
    ok: true,
    status: 200,
    result: { deal: { id, title, status: 'open', updatedAt: '2026-11-10T10:00:00.000Z' }, pipelineStages: [] },
  }
}

function listPayload(id = DEAL_ID): ApiResponse {
  return { ok: true, status: 200, result: { items: [{ id, updatedAt: '2026-11-10T10:00:00.000Z' }] } }
}

async function settleLatest(detail: ApiResponse, list: ApiResponse = listPayload()): Promise<void> {
  const requests = mockPending.splice(0, mockPending.length)
  await act(async () => {
    for (const request of requests) {
      request.resolve(request.url.includes('?ids=') ? list : detail)
    }
  })
}

describe('useDealDrawerData organization scope', () => {
  beforeEach(() => {
    mockPending.length = 0
    mockApiCall.mockClear()
    act(() => emitOrganizationScopeChanged({ organizationId: ORG_A, tenantId: 'tenant-1' }))
  })

  it('keeps the detail snapshot version when the independent list response is newer', () => {
    const mapped = mapDealDrawerPayload(detailPayload('Open deal').result, {
      id: DEAL_ID,
      updated_at: '2026-11-10T11:00:00.000Z',
      status: 'won',
    })
    expect(mapped).toMatchObject({ status: 'open', updatedAt: '2026-11-10T10:00:00.000Z' })
  })

  it('ignores a reload captured for another selected deal', async () => {
    const { result, rerender } = renderHook(({ id }) => useDealDrawerData(id), { initialProps: { id: DEAL_ID } })
    await settleLatest(detailPayload('Deal A'))
    const staleReload = result.current.reload
    rerender({ id: OTHER_DEAL_ID })
    await settleLatest(detailPayload('Deal B', OTHER_DEAL_ID), listPayload(OTHER_DEAL_ID))
    await waitFor(() => expect(result.current.state.deal?.id).toBe(OTHER_DEAL_ID))
    const callsBeforeReload = mockApiCall.mock.calls.length
    let staleResult: unknown
    await act(async () => {
      const reloading = staleReload()
      await settleLatest(detailPayload('Stale deal A'))
      staleResult = await reloading
    })
    expect(staleResult).toBeNull()
    expect(mockApiCall).toHaveBeenCalledTimes(callsBeforeReload)
    expect(result.current.state.deal?.id).toBe(OTHER_DEAL_ID)
  })

  it('ignores a captured reload after switching away and back to the same deal', async () => {
    const { result, rerender } = renderHook(({ id }) => useDealDrawerData(id), { initialProps: { id: DEAL_ID } })
    await settleLatest(detailPayload('Original selection'))
    const staleReload = result.current.reload
    rerender({ id: OTHER_DEAL_ID })
    await settleLatest(detailPayload('Other deal', OTHER_DEAL_ID), listPayload(OTHER_DEAL_ID))
    rerender({ id: DEAL_ID })
    await settleLatest(detailPayload('Fresh selection'))
    const callsBeforeReload = mockApiCall.mock.calls.length
    await act(async () => {
      const reloading = staleReload()
      await settleLatest(detailPayload('Stale selection'))
      expect(await reloading).toBeNull()
    })
    expect(mockApiCall).toHaveBeenCalledTimes(callsBeforeReload)
    expect(result.current.state.deal?.title).toBe('Fresh selection')
  })

  it('does not start a captured reload from the previous organization or after unmount', async () => {
    const { result, unmount } = renderHook(() => useDealDrawerData(DEAL_ID))
    await settleLatest(detailPayload('Org A deal'))
    const oldScopeReload = result.current.reload
    act(() => emitOrganizationScopeChanged({ organizationId: ORG_B, tenantId: 'tenant-1' }))
    await settleLatest(detailPayload('Org B deal'))
    const unmountedReload = result.current.reload
    const callsBeforeReload = mockApiCall.mock.calls.length
    await act(async () => {
      const reloading = oldScopeReload()
      await settleLatest(detailPayload('Old scope'))
      expect(await reloading).toBeNull()
    })
    unmount()
    const reloading = unmountedReload()
    await settleLatest(detailPayload('Unmounted'))
    expect(await reloading).toBeNull()
    expect(mockApiCall).toHaveBeenCalledTimes(callsBeforeReload)
  })

  it('clears the loaded deal and reloads when the organization scope changes', async () => {
    const { result } = renderHook(() => useDealDrawerData(DEAL_ID))
    await settleLatest(detailPayload('Org A deal'))
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    expect(result.current.state.deal?.title).toBe('Org A deal')

    act(() => emitOrganizationScopeChanged({ organizationId: ORG_B, tenantId: 'tenant-1' }))

    await waitFor(() => expect(result.current.state.status).toBe('loading'))
    expect(result.current.state.deal).toBeNull()
    expect(mockPending.length).toBeGreaterThan(0)

    await settleLatest({ ok: false, status: 404, result: null })
    await waitFor(() => expect(result.current.state.status).toBe('missing'))
    expect(result.current.state.deal).toBeNull()
  })

  it('ignores a request from the previous organization that resolves after the switch', async () => {
    const { result } = renderHook(() => useDealDrawerData(DEAL_ID))
    const staleRequests = mockPending.splice(0, mockPending.length)
    expect(staleRequests.length).toBe(2)

    act(() => emitOrganizationScopeChanged({ organizationId: ORG_B, tenantId: 'tenant-1' }))
    await waitFor(() => expect(mockPending.length).toBe(2))
    const freshRequests = mockPending.splice(0, mockPending.length)

    await act(async () => {
      for (const request of staleRequests) {
        request.resolve(request.url.includes('?ids=') ? listPayload() : detailPayload('Org A deal'))
      }
    })
    expect(result.current.state.deal).toBeNull()
    expect(result.current.state.status).toBe('loading')

    await act(async () => {
      for (const request of freshRequests) {
        request.resolve(request.url.includes('?ids=') ? listPayload() : detailPayload('Org B deal'))
      }
    })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    expect(result.current.state.deal?.title).toBe('Org B deal')
  })
})
