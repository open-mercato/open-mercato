/** @jest-environment node */

/**
 * Undo logs written before credit memo lines carried `kind`/`serviceId` (and
 * invoice lines carried `serviceId`) still restore: the re-created lines fall
 * back to a product line without a service instead of writing NULL into the
 * NOT NULL `kind` column.
 */

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async () => null),
}))

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function buildCtx() {
  const created: Array<{ entity: string; data: Record<string, unknown> }> = []
  const em: Record<string, unknown> = {
    create: jest.fn((entity: { name?: string }, data: Record<string, unknown>) => {
      created.push({ entity: entity?.name ?? '', data })
      return { ...data }
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
  }
  em.fork = jest.fn(() => em)
  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  container.register({ em: asValue(em) })
  const ctx: CommandRuntimeContext = {
    container,
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }
  return { ctx, created }
}

const legacyLine = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  orderLineId: null,
  lineNumber: 1,
  name: 'Refunded widget',
  sku: null,
  description: null,
  quantity: '1',
  quantityUnit: null,
  normalizedQuantity: '1',
  normalizedUnit: null,
  uomSnapshot: null,
  currencyCode: 'USD',
  unitPriceNet: '10',
  unitPriceGross: '10',
  discountAmount: '0',
  discountPercent: '0',
  taxRate: '0',
  taxAmount: '0',
  totalNetAmount: '10',
  totalGrossAmount: '10',
  metadata: null,
}

const documentTotals = {
  organizationId: ORG_ID,
  tenantId: TENANT_ID,
  orderId: null,
  statusEntryId: null,
  status: null,
  issueDate: '2026-01-01T00:00:00.000Z',
  currencyCode: 'USD',
  subtotalNetAmount: '10',
  subtotalGrossAmount: '10',
  taxTotalAmount: '0',
  grandTotalNetAmount: '10',
  grandTotalGrossAmount: '10',
  metadata: null,
  customFieldSetId: null,
  customFields: null,
}

describe('credit memo and invoice delete undo with legacy line snapshots', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  it('restores credit memo lines without kind as product lines without a service', async () => {
    const handler = commandRegistry.get('sales.credit_memos.delete')
    expect(handler?.undo).toBeTruthy()
    const { ctx, created } = buildCtx()
    const before = {
      creditMemo: {
        ...documentTotals,
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        creditMemoNumber: 'CM-1',
        invoiceId: null,
        reason: null,
      },
      lines: [legacyLine],
    }

    await handler!.undo!({
      input: { id: before.creditMemo.id, organizationId: ORG_ID, tenantId: TENANT_ID },
      ctx,
      logEntry: { commandPayload: { undo: { before } } },
    })

    const lines = created.filter((entry) => entry.entity === 'SalesCreditMemoLine').map((entry) => entry.data)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ id: legacyLine.id, kind: 'product', serviceId: null })
  })

  it('restores invoice lines without serviceId with a null service reference', async () => {
    const handler = commandRegistry.get('sales.invoices.delete')
    expect(handler?.undo).toBeTruthy()
    const { ctx, created } = buildCtx()
    const before = {
      invoice: {
        ...documentTotals,
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        invoiceNumber: 'INV-1',
        dueDate: null,
        discountTotalAmount: '0',
        paidTotalAmount: '0',
        outstandingAmount: '10',
      },
      lines: [{ ...legacyLine, kind: 'product' }],
    }

    await handler!.undo!({
      input: { id: before.invoice.id, organizationId: ORG_ID, tenantId: TENANT_ID },
      ctx,
      logEntry: { commandPayload: { undo: { before } } },
    })

    const lines = created.filter((entry) => entry.entity === 'SalesInvoiceLine').map((entry) => entry.data)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ id: legacyLine.id, kind: 'product', serviceId: null })
  })
})
