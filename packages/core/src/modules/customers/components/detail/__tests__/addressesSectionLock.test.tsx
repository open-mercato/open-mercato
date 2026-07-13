/**
 * @jest-environment jsdom
 *
 * Phase 2 (record-locks customers): Addresses (customer_address) merge-dialog
 * surface. The address writes ride the makeCrudRoute `customers/addresses` route
 * (server-side optimistic-lock guard auto-covered by the CRUD mutation-guard
 * decorator). The client gap was that the section's data adapter neither sent the
 * expected-version header nor surfaced the 409. This test renders the customers
 * AddressesSection (with the shared section mocked to capture the data adapter),
 * then drives the adapter's update/delete to assert:
 *   - the lock header is attached from the address's loaded updatedAt,
 *   - a 409 is routed through surfaceRecordConflict.
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import type { AddressDataAdapter } from '@open-mercato/ui/backend/detail'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

const apiCallOrThrowMock = jest.fn(async () => ({ ok: true, response: new Response(), result: {} }))
const withScopedApiRequestHeadersMock = jest.fn(
  async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
)

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: {} })),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...(args as [])),
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
  withScopedApiRequestHeaders: (headers: Record<string, string>, run: () => Promise<unknown>) =>
    withScopedApiRequestHeadersMock(headers, run),
}))

const surfaceRecordConflictMock = jest.fn(() => true)
jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => surfaceRecordConflictMock(...(args as [])),
}))

// Capture the data adapter the customers section hands to the shared section.
let capturedAdapter: AddressDataAdapter | null = null
jest.mock('@open-mercato/ui/backend/detail', () => ({
  AddressesSection: (props: { dataAdapter: AddressDataAdapter }) => {
    capturedAdapter = props.dataAdapter
    return null
  },
}))

import { AddressesSection } from '../AddressesSection'

const UPDATED_AT = '2026-06-01T00:00:00.000Z'

function renderSection() {
  capturedAdapter = null
  render(
    React.createElement(AddressesSection, {
      entityId: 'entity-1',
      emptyLabel: 'empty',
      addActionLabel: 'add',
      emptyState: { title: 't', actionLabel: 'a' },
    }),
  )
  if (!capturedAdapter) throw new Error('[internal] data adapter not captured')
  return capturedAdapter
}

beforeEach(() => {
  apiCallOrThrowMock.mockReset()
  apiCallOrThrowMock.mockResolvedValue({ ok: true, response: new Response(), result: {} })
  withScopedApiRequestHeadersMock.mockClear()
  surfaceRecordConflictMock.mockClear()
})

describe('customers AddressesSection adapter — optimistic-lock header', () => {
  const payload = {
    addressLine1: '1 Main St',
    name: null,
    purpose: null,
    companyName: null,
    addressLine2: null,
    buildingNumber: null,
    flatNumber: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
    isPrimary: false,
  }

  test('update attaches the version header from the address updatedAt', async () => {
    const adapter = renderSection()
    await adapter.update({ id: 'addr-1', payload, updatedAt: UPDATED_AT })

    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledTimes(1)
    expect(withScopedApiRequestHeadersMock.mock.calls[0][0]).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT })
  })

  test('delete attaches the version header from the address updatedAt', async () => {
    const adapter = renderSection()
    await adapter.delete({ id: 'addr-1', updatedAt: UPDATED_AT })

    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledTimes(1)
    expect(withScopedApiRequestHeadersMock.mock.calls[0][0]).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT })
  })

  test('a 409 on update is routed through surfaceRecordConflict and rethrown', async () => {
    const adapter = renderSection()
    apiCallOrThrowMock.mockRejectedValueOnce(new CrudHttpError(409, { code: 'record_lock_conflict', error: 'conflict' }))

    await expect(adapter.update({ id: 'addr-1', payload, updatedAt: UPDATED_AT })).rejects.toMatchObject({ status: 409 })
    expect(surfaceRecordConflictMock).toHaveBeenCalledTimes(1)
    expect((surfaceRecordConflictMock.mock.calls[0][0] as CrudHttpError).status).toBe(409)
  })

  test('create does not attach a version header (create-only, exempt)', async () => {
    const adapter = renderSection()
    await adapter.create({ entityId: 'entity-1', payload })

    expect(withScopedApiRequestHeadersMock).not.toHaveBeenCalled()
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
  })
})
