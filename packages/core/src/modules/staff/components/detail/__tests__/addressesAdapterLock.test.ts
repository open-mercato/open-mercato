/**
 * Record-locks coverage (staff addresses): the staff addresses adapter writes
 * through the makeCrudRoute `staff/addresses` route (server-side optimistic-lock
 * guard via the CRUD mutation-guard decorator). This test asserts the update/delete
 * adapter calls attach the `x-om-ext-optimistic-lock-expected-updated-at` header
 * derived from the address's loaded `updatedAt`, and that create stays
 * version-exempt (no prior version to compare). The resulting 409 is surfaced by
 * the shared AddressesSection host through `surfaceRecordConflict`.
 */
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const apiCallOrThrowMock = jest.fn(async () => ({ ok: true, response: new Response(), result: {} }))
const withScopedApiRequestHeadersMock = jest.fn(
  async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
)

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, response: new Response(), result: {} })),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...(args as [])),
  readApiResultOrThrow: jest.fn(async () => ({})),
  withScopedApiRequestHeaders: (headers: Record<string, string>, run: () => Promise<unknown>) =>
    withScopedApiRequestHeadersMock(headers, run),
}))

import { createStaffAddressAdapter } from '../addressesAdapter'

const translator = (key: string, fallback?: string) => fallback ?? key
const UPDATED_AT = '2026-06-01T00:00:00.000Z'

beforeEach(() => {
  apiCallOrThrowMock.mockClear()
  withScopedApiRequestHeadersMock.mockClear()
})

describe('createStaffAddressAdapter — optimistic-lock header', () => {
  test('update attaches the version header derived from the address updatedAt', async () => {
    const adapter = createStaffAddressAdapter(translator)
    await adapter.update({ id: 'addr-1', payload: { addressLine1: '1 Main' }, updatedAt: UPDATED_AT })

    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledTimes(1)
    expect(withScopedApiRequestHeadersMock.mock.calls[0][0]).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT })
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
  })

  test('delete attaches the version header derived from the address updatedAt', async () => {
    const adapter = createStaffAddressAdapter(translator)
    await adapter.delete({ id: 'addr-1', updatedAt: UPDATED_AT })

    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledTimes(1)
    expect(withScopedApiRequestHeadersMock.mock.calls[0][0]).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT })
  })

  test('a missing updatedAt sends no header value (strictly additive — no lock)', async () => {
    const adapter = createStaffAddressAdapter(translator)
    await adapter.update({ id: 'addr-1', payload: { addressLine1: '1 Main' }, updatedAt: null })

    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledTimes(1)
    expect(withScopedApiRequestHeadersMock.mock.calls[0][0]).toEqual({})
  })

  test('create is version-exempt — no lock header wrapper', async () => {
    const adapter = createStaffAddressAdapter(translator)
    await adapter.create({ entityId: 'staff-1', payload: { addressLine1: '1 Main' } })

    expect(withScopedApiRequestHeadersMock).not.toHaveBeenCalled()
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
  })
})
