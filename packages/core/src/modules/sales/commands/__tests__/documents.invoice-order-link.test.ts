/** @jest-environment node */

// Regression coverage for a relation-vs-scalar mismatch: `SalesInvoice` has
// no `orderId` scalar, only an `order` ManyToOne relation (fieldName
// `order_id`). Four places in documents.ts assigned/read a plain `orderId`
// key against the entity instead of `order` — MikroORM silently drops an
// unmapped key on `em.create`/direct assignment, so `sales_invoices.order_id`
// stayed NULL no matter what the caller supplied, and every delete/update
// undo snapshot lost the link too. This file exercises all four sites.

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { SalesInvoice } from '../../data/entities'

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    sales: {
      sales_invoice: 'sales.sales_invoice',
      sales_invoice_line: 'sales.sales_invoice_line',
    },
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn(async () => undefined),
}))

const findOneWithDecryptionMock = jest.fn(async () => ({ id: 'order-exists' }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const TEST_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const TEST_INVOICE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function buildInput(extra: Record<string, unknown> = {}) {
  return {
    organizationId: TEST_ORG_ID,
    tenantId: TEST_TENANT_ID,
    invoiceNumber: 'INV-1',
    currencyCode: 'USD',
    ...extra,
  }
}

function buildHarness() {
  const persisted: Record<string, unknown>[] = []
  let em: Record<string, unknown>
  em = {
    fork: () => em,
    create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
    persist: (entity: Record<string, unknown>) => {
      persisted.push(entity)
    },
    find: async () => [],
    findOne: async () => null,
    findOneOrFail: async () => {
      throw new Error('not stubbed for this test')
    },
    nativeDelete: async () => 0,
    remove: jest.fn(),
    flush: async () => undefined,
    begin: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    getReference: (_entity: unknown, id: unknown) => ({ id }),
  }

  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
    salesDocumentNumberGenerator: asValue({
      generate: async () => ({ number: 'INV-GENERATED' }),
    }),
  })

  const ctx: CommandRuntimeContext = {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
  }

  return { em, persisted, container, ctx }
}

describe('sales.invoices — order relation link (relation-vs-scalar mismatch)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  function getCreateHandler() {
    const handler = commandRegistry.get<Record<string, unknown>, { invoiceId: string }>('sales.invoices.create')
    expect(handler).toBeTruthy()
    return handler!
  }

  function getDeleteHandler() {
    const handler = commandRegistry.get<Record<string, unknown>, { invoiceId: string }>('sales.invoices.delete')
    expect(handler).toBeTruthy()
    return handler!
  }

  function getUpdateHandler() {
    const handler = commandRegistry.get<Record<string, unknown>, { invoiceId: string }>('sales.invoices.update')
    expect(handler).toBeTruthy()
    return handler!
  }

  it('sales.invoices.create assigns the order relation via a reference, not a plain orderId key', async () => {
    const { persisted, ctx } = buildHarness()

    await getCreateHandler().execute(buildInput({ orderId: TEST_ORDER_ID }) as never, ctx)

    expect(findOneWithDecryptionMock).toHaveBeenCalled()
    expect(persisted).toHaveLength(1)
    const invoice = persisted[0]
    expect(invoice.order).toEqual({ id: TEST_ORDER_ID })
    expect(invoice).not.toHaveProperty('orderId')
  })

  it('sales.invoices.create links no order when none was supplied', async () => {
    const { persisted, ctx } = buildHarness()

    await getCreateHandler().execute(buildInput() as never, ctx)

    expect(persisted).toHaveLength(1)
    expect(persisted[0].order).toBeNull()
  })

  it('captureAfter (loadInvoiceSnapshot) reads the order id off the real relation, not a nonexistent scalar', async () => {
    const { em, ctx } = buildHarness()
    // Simulates the entity MikroORM would hand back on reload: the ManyToOne
    // relation is present with its id even when unpopulated; there is no
    // sibling `orderId` scalar.
    em.findOne = async () => ({
      id: TEST_INVOICE_ID,
      organizationId: TEST_ORG_ID,
      tenantId: TEST_TENANT_ID,
      invoiceNumber: 'INV-1',
      order: { id: TEST_ORDER_ID },
      statusEntryId: null,
      status: null,
      issueDate: null,
      dueDate: null,
      currencyCode: 'USD',
      subtotalNetAmount: '0',
      subtotalGrossAmount: '0',
      discountTotalAmount: '0',
      taxTotalAmount: '0',
      grandTotalNetAmount: '0',
      grandTotalGrossAmount: '0',
      paidTotalAmount: '0',
      outstandingAmount: '0',
      metadata: null,
      customFieldSetId: null,
    })

    const snapshot = await getCreateHandler().captureAfter?.(
      buildInput({ orderId: TEST_ORDER_ID }) as never,
      { invoiceId: TEST_INVOICE_ID },
      ctx,
    )

    expect((snapshot as { invoice: { orderId: string | null } } | null)?.invoice.orderId).toBe(TEST_ORDER_ID)
  })

  it('undoing a delete restores the order relation via a reference, not a plain orderId key', async () => {
    const { em, persisted, ctx } = buildHarness()
    const handler = getDeleteHandler()
    const before = {
      invoice: {
        id: TEST_INVOICE_ID,
        organizationId: TEST_ORG_ID,
        tenantId: TEST_TENANT_ID,
        invoiceNumber: 'INV-1',
        orderId: TEST_ORDER_ID,
        statusEntryId: null,
        status: null,
        issueDate: null,
        dueDate: null,
        currencyCode: 'USD',
        subtotalNetAmount: '0',
        subtotalGrossAmount: '0',
        discountTotalAmount: '0',
        taxTotalAmount: '0',
        grandTotalNetAmount: '0',
        grandTotalGrossAmount: '0',
        paidTotalAmount: '0',
        outstandingAmount: '0',
        metadata: null,
        customFieldSetId: null,
      },
      lines: [],
    }

    await handler.undo?.({
      logEntry: { payload: { undo: { before } } } as never,
      ctx,
    } as never)

    expect(persisted).toHaveLength(1)
    const restored = persisted[0] as unknown as SalesInvoice
    expect(restored.order).toEqual({ id: TEST_ORDER_ID })
    expect(restored).not.toHaveProperty('orderId')
  })

  it('undoing an update restores the order relation via a reference, not a plain orderId key', async () => {
    const { em, ctx } = buildHarness()
    const handler = getUpdateHandler()
    const invoice: Record<string, unknown> = {
      id: TEST_INVOICE_ID,
      organizationId: TEST_ORG_ID,
      tenantId: TEST_TENANT_ID,
      invoiceNumber: 'INV-CURRENT',
    }
    em.findOne = async () => invoice

    const before = {
      invoice: {
        id: TEST_INVOICE_ID,
        organizationId: TEST_ORG_ID,
        tenantId: TEST_TENANT_ID,
        invoiceNumber: 'INV-1',
        orderId: TEST_ORDER_ID,
        statusEntryId: null,
        status: null,
        issueDate: null,
        dueDate: null,
        currencyCode: 'USD',
        subtotalNetAmount: '0',
        subtotalGrossAmount: '0',
        discountTotalAmount: '0',
        taxTotalAmount: '0',
        grandTotalNetAmount: '0',
        grandTotalGrossAmount: '0',
        paidTotalAmount: '0',
        outstandingAmount: '0',
        metadata: null,
        customFieldSetId: null,
      },
      lines: [],
    }

    await handler.undo?.({
      logEntry: { payload: { undo: { before } } } as never,
      ctx,
    } as never)

    expect(invoice.order).toEqual({ id: TEST_ORDER_ID })
    expect(invoice).not.toHaveProperty('orderId')
  })
})
