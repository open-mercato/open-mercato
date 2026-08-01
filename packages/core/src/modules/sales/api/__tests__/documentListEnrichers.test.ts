/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((em: any, entityName: any, where: any, options: any) =>
    em.find(entityName, where, options)
  ),
}))

import { attachOrderContext, normalizeJsonRecord } from '@open-mercato/core/modules/sales/api/_documentListEnrichers'

type FakeEntityData = Record<string, Record<string, unknown>[]>

function makeCtx(data: FakeEntityData, calls: string[]) {
  const em = {
    find: (entity: { name: string }) => {
      calls.push(entity.name)
      return Promise.resolve(data[entity.name] ?? [])
    },
  }
  return {
    container: { resolve: (token: string) => (token === 'em' ? em : null) },
    auth: { tenantId: 'ten-1', orgId: 'org-1' },
  }
}

// The order's snapshot as it arrives from `findWithDecryption`: an encrypted
// jsonb column decrypts to the raw JSON *string*, never a parsed object.
const ENCRYPTED_SNAPSHOT_AS_STRING = JSON.stringify({
  customer: { id: 'cus-1', displayName: 'Frozen Name Sp. z o.o.', primaryEmail: 'frozen@example.com' },
  contact: null,
})

describe('normalizeJsonRecord', () => {
  it('parses a decrypted JSON string into a record', () => {
    expect(normalizeJsonRecord(ENCRYPTED_SNAPSHOT_AS_STRING)).toEqual({
      customer: { id: 'cus-1', displayName: 'Frozen Name Sp. z o.o.', primaryEmail: 'frozen@example.com' },
      contact: null,
    })
  })

  it('passes an already-parsed record through untouched', () => {
    const record = { customer: { displayName: 'Already An Object' } }
    expect(normalizeJsonRecord(record)).toBe(record)
  })

  it('returns null for values that are not JSON objects', () => {
    expect(normalizeJsonRecord(null)).toBeNull()
    expect(normalizeJsonRecord(undefined)).toBeNull()
    expect(normalizeJsonRecord('not json at all')).toBeNull()
    expect(normalizeJsonRecord('[1,2,3]')).toBeNull()
    expect(normalizeJsonRecord(42)).toBeNull()
  })
})

describe('attachOrderContext', () => {
  // Regression for QA finding F1/F2 on PR #1977 (issue #4143): the decrypted
  // snapshot arrived as a JSON string, so `hasCustomerDisplayName` never
  // matched and every invoice/credit memo silently re-hydrated the *live*
  // customer row — an invoice would show a renamed customer's new name
  // instead of the name frozen onto its own order, and a deleted customer
  // would blank the card entirely.
  it('parses the order snapshot and does not fall back to the live customer', async () => {
    const calls: string[] = []
    const ctx = makeCtx(
      {
        SalesOrder: [
          {
            id: 'ord-1',
            orderNumber: 'SO-1',
            customerEntityId: 'cus-1',
            customerSnapshot: ENCRYPTED_SNAPSHOT_AS_STRING,
          },
        ],
        CustomerEntity: [
          { id: 'cus-1', kind: 'company', displayName: 'Renamed Later Sp. z o.o.', primaryEmail: 'new@example.com' },
        ],
      },
      calls,
    )
    const payload: { items: Record<string, unknown>[] } = {
      items: [{ id: 'inv-1', order_id: 'ord-1' }],
    }

    await attachOrderContext(payload, ctx as never)

    const item = payload.items[0]
    expect(item.order).toEqual({ id: 'ord-1', orderNumber: 'SO-1' })
    expect(item.customerEntityId).toBe('cus-1')
    // The snapshot is handed to consumers as an object, matching what the
    // detail routes' openApi schema promises.
    expect(item.customerSnapshot).toEqual({
      customer: { id: 'cus-1', displayName: 'Frozen Name Sp. z o.o.', primaryEmail: 'frozen@example.com' },
      contact: null,
    })
    // A usable snapshot means the live customer row is never queried at all.
    expect(calls).not.toContain('CustomerEntity')
  })

  it('still hydrates from the live customer when the order has no usable snapshot', async () => {
    const calls: string[] = []
    const ctx = makeCtx(
      {
        SalesOrder: [
          { id: 'ord-2', orderNumber: 'SO-2', customerEntityId: 'cus-2', customerSnapshot: null },
        ],
        CustomerEntity: [
          { id: 'cus-2', kind: 'person', displayName: 'Live Customer', primaryEmail: 'live@example.com', primaryPhone: null },
        ],
      },
      calls,
    )
    const payload: { items: Record<string, unknown>[] } = {
      items: [{ id: 'inv-2', order_id: 'ord-2' }],
    }

    await attachOrderContext(payload, ctx as never)

    expect(calls).toContain('CustomerEntity')
    expect(payload.items[0].customerSnapshot).toEqual({
      customer: {
        id: 'cus-2',
        kind: 'person',
        displayName: 'Live Customer',
        primaryEmail: 'live@example.com',
        primaryPhone: null,
      },
      contact: null,
    })
  })

  it('leaves a document with no order without customer context', async () => {
    const calls: string[] = []
    const ctx = makeCtx({}, calls)
    const payload: { items: Record<string, unknown>[] } = {
      items: [{ id: 'cm-1', order_id: null }],
    }

    await attachOrderContext(payload, ctx as never)

    expect(payload.items[0].order).toBeNull()
    expect(payload.items[0].customerEntityId).toBeNull()
    expect(payload.items[0].customerSnapshot).toBeNull()
    expect(calls).not.toContain('CustomerEntity')
  })
})
