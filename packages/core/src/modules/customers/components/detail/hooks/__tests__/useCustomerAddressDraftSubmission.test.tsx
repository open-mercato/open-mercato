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
