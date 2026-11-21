/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useCustomerAddressDraftSubmission } from '../useCustomerAddressDraftSubmission'
import type { AddressTileCustomFields } from '@open-mercato/ui/backend/detail/AddressCustomFields'

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ createCrud: jest.fn() }))

const createAddress = jest.mocked(createCrud)
const fields: AddressTileCustomFields = {
  structure: { entityId: 'customers:customer_address', status: 'ready', definitions: [], fields: [], retry: () => {} },
  labels: { loading: 'Loading', error: 'Could not load fields', retry: 'Retry' },
  renderValues: () => null,
}
const scope = { tenantId: 'tenant-1', organizationId: 'organization-1' }
const drafts = [
  { id: 'draft-1', addressLine1: '1 Main Street' },
  { id: 'draft-2', addressLine1: '2 Main Street' },
]

beforeEach(() => createAddress.mockReset())

afterEach(() => {
  document.cookie = 'om_selected_org=; max-age=0; path=/'
  document.cookie = 'om_selected_tenant=; max-age=0; path=/'
})

test('retries rejected children against the created parent without resending a successful request', async () => {
  const createParent = jest.fn(async () => ({ id: 'customer-1' }))
  createAddress.mockImplementationOnce(async () => ({ ok: true } as Awaited<ReturnType<typeof createCrud>>))
  createAddress.mockRejectedValueOnce(Object.assign(new Error('Invalid address'), { status: 422 }))
  createAddress.mockImplementationOnce(async () => ({ ok: true } as Awaited<ReturnType<typeof createCrud>>))
  const { result } = renderHook(() => useCustomerAddressDraftSubmission((key) => key, fields, scope))

  await act(async () => {
    await expect(result.current.submit(drafts, createParent)).rejects.toThrow('customers.people.detail.addresses.retryPending')
  })
  expect(result.current.recovery?.savedAddressIds).toEqual(new Set(['draft-1']))
  await act(async () => {
    await expect(result.current.submit(drafts, createParent)).resolves.toBe('customer-1')
  })
  expect(createParent).toHaveBeenCalledTimes(1)
  expect(createAddress.mock.calls.map(([, body]) => body.addressLine1)).toEqual(['1 Main Street', '2 Main Street', '2 Main Street'])
})

test('uses the request selection while the organization switcher is loading and rejects a changed selection', async () => {
  document.cookie = `om_selected_org=${scope.organizationId}; path=/`
  document.cookie = `om_selected_tenant=${scope.tenantId}; path=/`
  const unresolvedScope: Parameters<typeof useCustomerAddressDraftSubmission>[2] = { organizationId: null, tenantId: null }
  const createParent = jest.fn(async () => ({ id: 'customer-1' }))
  createAddress.mockRejectedValueOnce(Object.assign(new Error('Invalid address'), { status: 422 }))
  createAddress.mockImplementation(async () => ({ ok: true } as Awaited<ReturnType<typeof createCrud>>))
  const { result, rerender } = renderHook(
    (selection) => useCustomerAddressDraftSubmission((key) => key, fields, selection),
    { initialProps: unresolvedScope },
  )

  await act(async () => {
    await expect(result.current.submit(drafts, createParent)).rejects.toThrow('customers.people.detail.addresses.retryPending')
  })
  document.cookie = 'om_selected_org=organization-2; path=/'
  rerender({ ...scope, organizationId: 'organization-2' })
  await expect(result.current.submit(drafts, createParent)).rejects.toThrow('customers.people.detail.addresses.createScopeChanged')
  expect(createAddress).toHaveBeenCalledTimes(1)

  document.cookie = `om_selected_org=${scope.organizationId}; path=/`
  rerender(scope)
  await expect(result.current.submit(drafts, createParent)).resolves.toBe('customer-1')
  expect(createParent).toHaveBeenCalledTimes(1)
  expect(createParent).toHaveBeenCalledWith(scope.organizationId)
  expect(createAddress.mock.calls.map(([, body]) => [body.entityId, body.organizationId])).toEqual([
    ['customer-1', scope.organizationId], ['customer-1', scope.organizationId], ['customer-1', scope.organizationId],
  ])
})

test.each([
  new TypeError('Connection reset'),
  Object.assign(new Error('Gateway timeout'), { status: 504 }),
])('holds a child draft with an unconfirmed write until the user checks the address book', async (failure) => {
  const createParent = jest.fn(async () => ({ id: 'customer-1' }))
  createAddress.mockRejectedValueOnce(failure)
  createAddress.mockImplementationOnce(async () => ({ ok: true } as Awaited<ReturnType<typeof createCrud>>))
  const { result } = renderHook(() => useCustomerAddressDraftSubmission((key) => key, fields, scope))

  await act(async () => {
    await expect(result.current.submit(drafts, createParent)).rejects.toThrow('customers.people.detail.addresses.saveUnconfirmed')
  })
  expect(result.current.recovery?.unconfirmedAddressId).toBe('draft-1')
  await expect(result.current.submit(drafts, createParent)).rejects.toThrow('customers.people.detail.addresses.saveUnconfirmed')
  expect(createAddress).toHaveBeenCalledTimes(1)
  act(() => result.current.confirmAddressOutcome('saved'))
  await act(async () => {
    await expect(result.current.submit(drafts, createParent)).resolves.toBe('customer-1')
  })
  expect(createParent).toHaveBeenCalledTimes(1)
  expect(createAddress.mock.calls.map(([, body]) => body.addressLine1)).toEqual(['1 Main Street', '2 Main Street'])
})
