/** @jest-environment node */

import { LockMode } from '@mikro-orm/core'
import { asValue, createContainer, InjectionMode } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { SalesCreditMemo, SalesInvoice, SalesOrder } from '../../data/entities'
import englishTranslations from '../../i18n/en.json'
import polishTranslations from '../../i18n/pl.json'

const mockTranslate = jest.fn((key: string, fallback?: string) => fallback ?? key)

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: mockTranslate,
    translate: mockTranslate,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

type FindOptions = { lockMode?: LockMode; refresh?: boolean }
type DecryptionScope = { organizationId: string; tenantId: string }
type LookupEm = {
  findOne: (
    entity: unknown,
    where: unknown,
    options?: FindOptions,
    scope?: DecryptionScope,
  ) => Promise<unknown>
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: async (
    em: LookupEm,
    entity: unknown,
    where: unknown,
    options?: FindOptions,
    scope?: DecryptionScope,
  ) => em.findOne(entity, where, options, scope),
}))

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_TENANT_ID = '88888888-8888-4888-8888-888888888888'
const CREDIT_MEMO_ID = '44444444-4444-4444-8444-444444444444'
const ORDER_ID = '55555555-5555-4555-8555-555555555555'
const INVOICE_ID = '66666666-6666-4666-8666-666666666666'
const BEFORE_UPDATED_AT = '2026-11-20T10:00:00.000Z'
const AFTER_UPDATED_AT = '2026-11-20T10:05:00.000Z'
const LATER_UPDATED_AT = '2026-11-20T10:10:00.000Z'

type CreditMemoHeaderSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  creditMemoNumber: string
  orderId: string | null
  invoiceId: string | null
  statusEntryId: string | null
  status: string | null
  reason: string | null
  issueDate: string | Date | null
  currencyCode: string
  subtotalNetAmount: string
  subtotalGrossAmount: string
  taxTotalAmount: string
  grandTotalNetAmount: string
  grandTotalGrossAmount: string
  metadata: Record<string, unknown> | null
  customFieldSetId: string | null
  customFields: Record<string, unknown> | null
  updatedAt?: string | Date | null
}

function buildSnapshot(overrides: Partial<CreditMemoHeaderSnapshot> = {}) {
  return {
    creditMemo: {
      id: CREDIT_MEMO_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      creditMemoNumber: 'CM-BEFORE',
      orderId: ORDER_ID,
      invoiceId: INVOICE_ID,
      statusEntryId: null,
      status: 'draft',
      reason: 'Before reason',
      issueDate: '2026-07-02T00:00:00.000Z',
      currencyCode: 'EUR',
      subtotalNetAmount: '50',
      subtotalGrossAmount: '61.5',
      taxTotalAmount: '11.5',
      grandTotalNetAmount: '50',
      grandTotalGrossAmount: '61.5',
      metadata: { source: 'before', nested: { a: 1, b: 2 } },
      customFieldSetId: null,
      customFields: null,
      updatedAt: BEFORE_UPDATED_AT,
      ...overrides,
    },
    lines: [],
  }
}

function makeCreditMemoEntity(overrides: Partial<SalesCreditMemo> = {}): SalesCreditMemo {
  return Object.assign(new SalesCreditMemo(), {
    id: CREDIT_MEMO_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    creditMemoNumber: 'CM-AFTER',
    order: { id: ORDER_ID } as SalesOrder,
    invoice: { id: INVOICE_ID } as SalesInvoice,
    statusEntryId: null,
    status: 'issued',
    reason: 'After reason',
    issueDate: new Date('2026-07-05T00:00:00.000Z'),
    currencyCode: 'PLN',
    subtotalNetAmount: '100',
    subtotalGrossAmount: '123',
    taxTotalAmount: '23',
    grandTotalNetAmount: '100',
    grandTotalGrossAmount: '123',
    metadata: { source: 'after', nested: { a: 1, b: 2 } },
    customFieldSetId: null,
    deletedAt: null,
    updatedAt: new Date(AFTER_UPDATED_AT),
    ...overrides,
  })
}

function makeHarness(
  currentRow: SalesCreditMemo | null,
  options: {
    authTenantId?: string
    authOrgId?: string
    onBegin?: () => void
  } = {},
) {
  let inTransaction = false
  const em = {
    fork() {
      return this
    },
    begin: jest.fn(async () => {
      inTransaction = true
      options.onBegin?.()
    }),
    commit: jest.fn(async () => {
      inTransaction = false
    }),
    rollback: jest.fn(async () => {
      inTransaction = false
    }),
    findOne: jest.fn(async (
      entity: unknown,
      _where: unknown,
      findOptions?: FindOptions,
      scope?: DecryptionScope,
    ) => {
      if (entity !== SalesCreditMemo) return null
      expect(inTransaction).toBe(true)
      expect(findOptions).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true })
      expect(scope).toEqual({ organizationId: ORG_ID, tenantId: TENANT_ID })
      return currentRow
    }),
    find: jest.fn(async () => []),
    getReference: jest.fn((entity: unknown, id: string) => ({ entity, id })),
    flush: jest.fn(async () => undefined),
  }

  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
  })

  const ctx: CommandRuntimeContext = {
    container,
    auth: {
      tenantId: options.authTenantId ?? TENANT_ID,
      orgId: options.authOrgId ?? ORG_ID,
      sub: 'user-1',
    },
    selectedOrganizationId: options.authOrgId ?? ORG_ID,
    organizationScope: null,
    organizationIds: [options.authOrgId ?? ORG_ID],
  }

  return { em, ctx }
}

describe('sales.credit_memos.update undo staleness and locking', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockTranslate.mockImplementation(createFallbackTranslator(englishTranslations))
  })

  const getHandler = () => {
    const handler = commandRegistry.get('sales.credit_memos.update')
    if (!handler) throw new Error('sales.credit_memos.update command not registered')
    return handler
  }

  it('locks the scoped live row and restores before fields when the current row matches the logged after snapshot', async () => {
    const before = buildSnapshot()
    const after = buildSnapshot({
      creditMemoNumber: 'CM-AFTER',
      status: 'issued',
      reason: 'After reason',
      issueDate: '2026-07-05T00:00:00.000Z',
      currencyCode: 'PLN',
      subtotalNetAmount: '100',
      subtotalGrossAmount: '123',
      taxTotalAmount: '23',
      grandTotalNetAmount: '100',
      grandTotalGrossAmount: '123',
      metadata: { nested: { b: 2, a: 1 }, source: 'after' },
      updatedAt: AFTER_UPDATED_AT,
    })
    const current = makeCreditMemoEntity({
      subtotalNetAmount: '100.0000',
      subtotalGrossAmount: '123.00',
      taxTotalAmount: '23.0000',
      grandTotalNetAmount: '100.00',
      grandTotalGrossAmount: '123.0000',
      metadata: { source: 'after', nested: { a: 1, b: 2 } },
    })
    const { em, ctx } = makeHarness(current)

    await getHandler().undo!({
      input: {},
      logEntry: { commandPayload: { undo: { before, after } } },
      ctx,
    } as never)

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.findOne).toHaveBeenCalledWith(
      SalesCreditMemo,
      {
        id: CREDIT_MEMO_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        deletedAt: null,
      },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      { organizationId: ORG_ID, tenantId: TENANT_ID },
    )
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
    expect(current.creditMemoNumber).toBe('CM-BEFORE')
    expect(current.status).toBe('draft')
    expect(current.reason).toBe('Before reason')
    expect(current.issueDate).toEqual(new Date('2026-07-02T00:00:00.000Z'))
    expect(current.currencyCode).toBe('EUR')
    expect(current.subtotalNetAmount).toBe('50')
    expect(current.subtotalGrossAmount).toBe('61.5')
    expect(current.taxTotalAmount).toBe('11.5')
    expect(current.grandTotalNetAmount).toBe('50')
    expect(current.grandTotalGrossAmount).toBe('61.5')
    expect(current.metadata).toEqual({ source: 'before', nested: { a: 1, b: 2 } })
    expect(current.metadata).not.toBe(before.creditMemo.metadata)
  })

  it('refuses with 409 and rolls back without overwriting when a later edit modified a header field', async () => {
    const before = buildSnapshot()
    const after = buildSnapshot({
      creditMemoNumber: 'CM-AFTER',
      status: 'issued',
      reason: 'After reason',
      issueDate: '2026-07-05T00:00:00.000Z',
      currencyCode: 'PLN',
      subtotalNetAmount: '100',
      subtotalGrossAmount: '123',
      taxTotalAmount: '23',
      grandTotalNetAmount: '100',
      grandTotalGrossAmount: '123',
      metadata: { source: 'after', nested: { a: 1, b: 2 } },
      updatedAt: undefined,
    })
    const current = makeCreditMemoEntity({
      reason: 'Later concurrent edit',
    })
    const { em, ctx } = makeHarness(current)

    await expect(
      getHandler().undo!({
        input: {},
        logEntry: { commandPayload: { undo: { before, after } } },
        ctx,
      } as never),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: englishTranslations['sales.documents.errors.undoStaleCreditMemo'] },
    })

    expect(current.reason).toBe('Later concurrent edit')
    expect(current.creditMemoNumber).toBe('CM-AFTER')
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
  })

  it.each<[string, Partial<SalesCreditMemo>]>([
    ['creditMemoNumber', { creditMemoNumber: 'CM-LATER' }],
    ['order', { order: null }],
    ['invoice', { invoice: null }],
    ['statusEntryId', { statusEntryId: '77777777-7777-4777-8777-777777777777' }],
    ['status', { status: 'voided' }],
    ['issueDate', { issueDate: new Date('2026-07-09T00:00:00.000Z') }],
    ['currencyCode', { currencyCode: 'USD' }],
    ['subtotalNetAmount', { subtotalNetAmount: '100.0001' }],
    ['subtotalGrossAmount', { subtotalGrossAmount: '123.01' }],
    ['taxTotalAmount', { taxTotalAmount: '24' }],
    ['grandTotalNetAmount', { grandTotalNetAmount: '101' }],
    ['grandTotalGrossAmount', { grandTotalGrossAmount: '124' }],
    ['metadata', { metadata: { source: 'after', nested: { a: 1, b: 999 } } }],
    ['customFieldSetId', { customFieldSetId: '77777777-7777-4777-8777-777777777777' }],
  ])('refuses with 409 when %s diverged after the logged update', async (_field, divergence) => {
    const before = buildSnapshot()
    const after = buildSnapshot({
      creditMemoNumber: 'CM-AFTER',
      status: 'issued',
      reason: 'After reason',
      issueDate: '2026-07-05T00:00:00.000Z',
      currencyCode: 'PLN',
      subtotalNetAmount: '100',
      subtotalGrossAmount: '123',
      taxTotalAmount: '23',
      grandTotalNetAmount: '100',
      grandTotalGrossAmount: '123',
      metadata: { source: 'after', nested: { a: 1, b: 2 } },
      updatedAt: undefined,
    })
    const current = makeCreditMemoEntity(divergence)
    const { em, ctx } = makeHarness(current)

    await expect(
      getHandler().undo!({
        input: {},
        logEntry: { commandPayload: { undo: { before, after } } },
        ctx,
      } as never),
    ).rejects.toMatchObject({ status: 409 })

    expect(em.flush).not.toHaveBeenCalled()
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
  })

  it('refuses with 409 when a concurrent edit commits before the undo row lock is acquired', async () => {
    const before = buildSnapshot()
    const after = buildSnapshot({
      creditMemoNumber: 'CM-AFTER',
      status: 'issued',
      reason: 'After reason',
      issueDate: '2026-07-05T00:00:00.000Z',
      currencyCode: 'PLN',
      subtotalNetAmount: '100',
      subtotalGrossAmount: '123',
      taxTotalAmount: '23',
      grandTotalNetAmount: '100',
      grandTotalGrossAmount: '123',
      metadata: { source: 'after', nested: { a: 1, b: 2 } },
      updatedAt: AFTER_UPDATED_AT,
    })
    const current = makeCreditMemoEntity()
    const { em, ctx } = makeHarness(current, {
      onBegin: () => {
        current.updatedAt = new Date(LATER_UPDATED_AT)
      },
    })
    mockTranslate.mockImplementation(createFallbackTranslator(polishTranslations))

    await expect(
      getHandler().undo!({
        input: {},
        logEntry: { commandPayload: { undo: { before, after } } },
        ctx,
      } as never),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: polishTranslations['sales.documents.errors.undoStaleCreditMemo'] },
    })

    expect(current.creditMemoNumber).toBe('CM-AFTER')
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
  })

  it('refuses with 409 when the credit memo was deleted after the logged update', async () => {
    const before = buildSnapshot()
    const after = buildSnapshot({ creditMemoNumber: 'CM-AFTER', updatedAt: AFTER_UPDATED_AT })
    const { em, ctx } = makeHarness(null)

    await expect(
      getHandler().undo!({
        input: {},
        logEntry: { commandPayload: { undo: { before, after } } },
        ctx,
      } as never),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: englishTranslations['sales.documents.errors.undoStaleCreditMemo'] },
    })

    expect(em.flush).not.toHaveBeenCalled()
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
  })

  it('restores legacy undo payloads without an after snapshot while still taking the scoped row lock', async () => {
    const before = buildSnapshot()
    const current = makeCreditMemoEntity({ reason: 'Changed later' })
    const { em, ctx } = makeHarness(current)

    await getHandler().undo!({
      input: {},
      logEntry: { commandPayload: { undo: { before } } },
      ctx,
    } as never)

    expect(current.reason).toBe('Before reason')
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
  })

  it('rejects cross-tenant and cross-organization snapshots before opening a transaction or locking the row', async () => {
    const before = buildSnapshot()
    const after = buildSnapshot({ creditMemoNumber: 'CM-AFTER' })
    const current = makeCreditMemoEntity()

    const wrongTenant = makeHarness(current, { authTenantId: OTHER_TENANT_ID })
    await expect(
      getHandler().undo!({
        input: {},
        logEntry: { commandPayload: { undo: { before, after } } },
        ctx: wrongTenant.ctx,
      } as never),
    ).rejects.toMatchObject({ status: 403 })
    expect(wrongTenant.em.begin).not.toHaveBeenCalled()
    expect(wrongTenant.em.findOne).not.toHaveBeenCalled()

    const wrongOrg = makeHarness(current, { authOrgId: OTHER_ORG_ID })
    await expect(
      getHandler().undo!({
        input: {},
        logEntry: { commandPayload: { undo: { before, after } } },
        ctx: wrongOrg.ctx,
      } as never),
    ).rejects.toMatchObject({ status: 403 })
    expect(wrongOrg.em.begin).not.toHaveBeenCalled()
    expect(wrongOrg.em.findOne).not.toHaveBeenCalled()
  })

  it('captures updatedAt in credit memo after snapshots', async () => {
    const current = makeCreditMemoEntity()
    const findOne = jest.fn(async (entity: unknown) => (entity === SalesCreditMemo ? current : null))
    const em = {
      fork() {
        return this
      },
      findOne,
      find: jest.fn(async () => []),
    }
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ em: asValue(em) })
    const ctx = {
      container,
      auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
      selectedOrganizationId: ORG_ID,
      organizationScope: null,
      organizationIds: [ORG_ID],
    } as CommandRuntimeContext

    const snapshot = await getHandler().captureAfter?.(
      { id: CREDIT_MEMO_ID, organizationId: ORG_ID, tenantId: TENANT_ID } as never,
      { creditMemoId: CREDIT_MEMO_ID } as never,
      ctx,
    ) as { creditMemo: CreditMemoHeaderSnapshot } | null

    expect(snapshot?.creditMemo.updatedAt).toEqual(new Date(AFTER_UPDATED_AT))
  })
})
