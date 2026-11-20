/** @jest-environment node */
import { StorefrontResolutionError, type StorefrontResolutionErrorCode, type StorefrontResolutionStatus } from '@open-mercato/core/modules/ecommerce/lib/storeContext'
import { GET, POST } from '../route'
import { POST as addLine } from '../lines/route'
import { POST as bulkAdd } from '../lines/bulk/route'
import { PATCH, DELETE as removeLine } from '../lines/[lineId]/route'
import { POST as applyPromotion } from '../promotions/route'
import { DELETE as removePromotion } from '../promotions/[id]/route'
import { POST as merge } from '../merge/route'
import { POST as undoMerge } from '../undo-merge/route'

const mockExecute = jest.fn()
let mockRefusal: unknown

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => ({ execute: mockExecute }) }),
}))
jest.mock('../../../lib/routeContext', () => ({
  resolveCartRouteContext: async () => { throw mockRefusal },
  isCartStoreContextUnavailableError: () => false,
}))
jest.mock('../../../lib/rateLimit', () => ({ enforceCartRateLimit: async () => null }))

const handlers: Array<[string, (request: Request) => Promise<Response>]> = [
  ['read', GET],
  ['create', POST],
  ['add line', addLine],
  ['bulk add', bulkAdd],
  ['update line', (request) => PATCH(request, { params: { lineId: '11111111-1111-4111-8111-111111111111' } })],
  ['remove line', (request) => removeLine(request, { params: { lineId: '11111111-1111-4111-8111-111111111111' } })],
  ['apply promotion', applyPromotion],
  ['remove promotion', (request) => removePromotion(request, { params: { id: '22222222-2222-4222-8222-222222222222' } })],
  ['merge', merge],
  ['undo merge', undoMerge],
]
const refusals: Array<[StorefrontResolutionStatus, StorefrontResolutionErrorCode]> = [
  [400, 'store_slug_not_allowed'],
  [404, 'store_not_found'],
  [403, 'store_draft'],
  [410, 'store_archived'],
  [503, 'store_misconfigured'],
  [401, 'portal_session_scope_mismatch'],
  [401, 'portal_session_invalid'],
]

describe.each(handlers)('%s storefront refusal', (_name, handler) => {
  it.each(refusals)('returns %s %s before executing a cart command', async (status, code) => {
    mockExecute.mockClear()
    mockRefusal = new StorefrontResolutionError(status, code)
    const response = await handler(new Request('http://localhost/api/cart/current', {
      headers: { 'X-Cart-Token': 'test-token' },
    }))
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ error: code })
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
