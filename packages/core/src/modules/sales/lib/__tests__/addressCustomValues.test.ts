import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolvePrimaryAddressValues, serializePrimaryAddressValues } from '../addressCustomValues'

const mockLoadDefinitions = jest.fn(async () => new Map())
const mockSeal = jest.fn(async (_container: unknown, input: { values: Record<string, unknown> | null }) => input.values)

jest.mock('@open-mercato/core/modules/entities/lib/addressCustomFields', () => ({
  ...jest.requireActual('@open-mercato/core/modules/entities/lib/addressCustomFields'),
  applyAddressCustomValues: jest.fn(async (_em: unknown, {
    previous, patch,
  }: { previous?: Record<string, unknown> | null; patch?: Record<string, unknown> }) => (
    patch ? { ...previous, ...patch } : previous ?? null
  )),
  loadAddressCustomFieldDefinitions: (...args: []) => mockLoadDefinitions(...args),
  sealAddressCustomValues: (...args: Parameters<typeof mockSeal>) => mockSeal(...args),
}))

const documentScope = {
  kind: 'quote' as const,
  tenantId: 'tenant-id',
  organizationId: 'organization-id',
}
const em = {} as EntityManager
const ctx = { container: {} } as CommandRuntimeContext
const postal = { addressLine1: '10 Address Lane' }
const previous = {
  billingAddressId: 'billing-source',
  shippingAddressId: 'shipping-source',
  billingAddressSnapshot: postal,
  shippingAddressSnapshot: postal,
  addressCustomValues: { billing: { instructions: 'Billing' }, shipping: { instructions: 'Shipping' } },
}

describe('Sales primary address custom values', () => {
  it('leaves a frozen bag unchanged when an ordinary update resends the same address ID', async () => {
    await expect(resolvePrimaryAddressValues(em, ctx, {
      ...documentScope, previous, current: previous, input: { shippingAddressId: 'shipping-source' },
    })).resolves.toBeUndefined()
  })

  it('clears only the slot whose source changes', async () => {
    await expect(resolvePrimaryAddressValues(em, ctx, {
      ...documentScope,
      previous,
      current: { ...previous, billingAddressId: 'replacement' },
      input: { billingAddressId: 'replacement' },
    })).resolves.toEqual({ shipping: { instructions: 'Shipping' } })
  })

  it('clears both slots when the document customer changes', async () => {
    await expect(resolvePrimaryAddressValues(em, ctx, {
      ...documentScope, customerChanged: true, previous, current: {}, input: {},
    })).resolves.toBeNull()
  })

  it('omits values with no active definition from the private response', () => {
    expect(serializePrimaryAddressValues({
      billing: { instructions: 'Billing', removed: 'Old value' },
      shipping: { removed: 'Other old value' },
    }, new Map([['instructions', {}]]))).toEqual({
      billingAddressCustomValues: { instructions: 'Billing' },
    })
  })

  it('rejects an unreadable value rather than replacing it with a blank bag', async () => {
    await expect(resolvePrimaryAddressValues(em, ctx, {
      ...documentScope,
      previous: { ...previous, addressCustomValues: 'unreadable stored value' },
      current: previous,
      input: { billingAddressCustomValues: { instructions: 'Replacement' } },
    })).rejects.toMatchObject({ status: 503 })
  })
})
