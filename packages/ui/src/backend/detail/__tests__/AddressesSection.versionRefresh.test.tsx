import * as React from 'react'
import { act, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AddressesSection, type AddressDataAdapter, type AddressSummary } from '../AddressesSection'
import type { AddressInput } from '../AddressTiles'

type TileCallbacks = {
  onCreate: (payload: AddressInput) => Promise<void>
  onUpdate: (id: string, payload: AddressInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

let mockCallbacks: TileCallbacks | null = null

jest.mock('../AddressTiles', () => ({
  __esModule: true,
  default: (props: TileCallbacks) => {
    mockCallbacks = props
    return null
  },
}))
jest.mock('@open-mercato/ui/backend/detail', () => ({ LoadingMessage: () => null }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('../../injection/useRegisteredComponent', () => ({
  useRegisteredComponent: (_handle: string, fallback: React.ComponentType) => fallback,
}))

const firstVersion = '2026-11-14T07:00:00.000Z'
const secondVersion = '2026-11-14T07:01:00.000Z'
const thirdVersion = '2026-11-14T07:02:00.000Z'
const payload: AddressInput = { addressLine1: '1 Main Street' }
const address: AddressSummary = { id: 'address-1', addressLine1: payload.addressLine1, updatedAt: firstVersion }

function callbacks(): TileCallbacks {
  if (!mockCallbacks) throw new Error('[internal] address callbacks unavailable')
  return mockCallbacks
}

async function renderSection(adapter: AddressDataAdapter) {
  mockCallbacks = null
  renderWithProviders(
    <AddressesSection
      entityId="entity-1"
      emptyLabel="No addresses"
      addActionLabel="Add address"
      emptyState={{ title: 'No addresses', actionLabel: 'Add address' }}
      dataAdapter={adapter}
    />,
  )
  await waitFor(() => expect(mockCallbacks).not.toBeNull())
}

describe('AddressesSection saved versions', () => {
  it('loads a newly created child version before its first update and the next delete', async () => {
    const adapter = {
      list: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([address]).mockResolvedValueOnce([{ ...address, updatedAt: secondVersion }]),
      create: jest.fn(async () => ({ id: address.id })),
      update: jest.fn(async (_input: Parameters<AddressDataAdapter['update']>[0]) => undefined),
      delete: jest.fn(async () => undefined),
    } satisfies AddressDataAdapter
    await renderSection(adapter)
    await act(async () => callbacks().onCreate(payload))
    await act(async () => callbacks().onUpdate(address.id, payload))
    expect(adapter.update).toHaveBeenCalledWith(expect.objectContaining({ id: address.id, updatedAt: firstVersion }))
    await act(async () => callbacks().onDelete(address.id))
    expect(adapter.delete).toHaveBeenCalledWith(expect.objectContaining({ id: address.id, updatedAt: secondVersion }))
  })

  it('uses the refreshed version on a second edit without a page reload', async () => {
    const adapter = {
      list: jest.fn().mockResolvedValueOnce([address]).mockResolvedValueOnce([{ ...address, updatedAt: secondVersion }]).mockResolvedValueOnce([{ ...address, updatedAt: thirdVersion }]),
      create: jest.fn(async () => ({ id: address.id })),
      update: jest.fn(async (_input: Parameters<AddressDataAdapter['update']>[0]) => undefined),
      delete: jest.fn(async () => undefined),
    } satisfies AddressDataAdapter
    await renderSection(adapter)
    await act(async () => callbacks().onUpdate(address.id, { ...payload, city: 'First edit' }))
    await act(async () => callbacks().onUpdate(address.id, { ...payload, city: 'Second edit' }))
    expect(adapter.update.mock.calls.map(([input]) => input.updatedAt)).toEqual([firstVersion, secondVersion])
  })
})
