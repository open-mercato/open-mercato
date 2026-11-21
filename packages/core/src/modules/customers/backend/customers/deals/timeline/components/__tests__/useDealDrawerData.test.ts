/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { useDealDrawerData } from '../useDealDrawerData'

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
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'

function detailPayload(title: string): ApiResponse {
  return {
    ok: true,
    status: 200,
    result: { deal: { id: DEAL_ID, title, status: 'open', updatedAt: '2026-11-10T10:00:00.000Z' }, pipelineStages: [] },
  }
}

function listPayload(): ApiResponse {
  return { ok: true, status: 200, result: { items: [{ id: DEAL_ID, updatedAt: '2026-11-10T10:00:00.000Z' }] } }
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
