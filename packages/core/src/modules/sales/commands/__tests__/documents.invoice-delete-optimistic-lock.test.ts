import { LockMode } from '@mikro-orm/core'
import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { SalesInvoice } from '../../data/entities'
import polishTranslations from '../../i18n/pl.json'

const mockTranslate = jest.fn((key: string, _fallback?: string) => key)

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: mockTranslate }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  invalidateCrudCache: jest.fn(async () => undefined),
}))

type FindOptions = { lockMode?: LockMode; refresh?: boolean }
type DecryptionScope = { organizationId: string; tenantId: string }
type LookupEm = {
  findOne: (entity: unknown, where: unknown, options?: FindOptions, scope?: DecryptionScope) => Promise<unknown>
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

const INVOICE_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const VALIDATED_VERSION = '2026-11-16T09:30:00.500Z'
const EDITED_VERSION = '2026-11-16T09:31:00.000Z'

type FakeInvoice = { id: string; tenantId: string; organizationId: string; updatedAt: Date; deletedAt: Date | null }

function setup(expectedVersion: string | null, editBeforeTransaction = false) {
  const invoice: FakeInvoice = {
    id: INVOICE_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    updatedAt: new Date(VALIDATED_VERSION),
    deletedAt: null,
  }
  let inTransaction = false
  let persistedVersion = VALIDATED_VERSION
  const em = {
    findOne: jest.fn(async (
      entity: unknown,
      _where: unknown,
      options?: FindOptions,
      scope?: DecryptionScope,
    ): Promise<FakeInvoice | null> => {
      if (entity !== SalesInvoice) return null
      expect(inTransaction).toBe(true)
      expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true })
      expect(scope).toEqual({ organizationId: ORG_ID, tenantId: TENANT_ID })
      invoice.updatedAt = new Date(persistedVersion)
      return invoice
    }),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => {
      inTransaction = true
      if (editBeforeTransaction) persistedVersion = EDITED_VERSION
    }),
    commit: jest.fn(async () => { inTransaction = false }),
    rollback: jest.fn(async () => { inTransaction = false }),
    fork() { return this },
  }
  const container = createContainer()
  container.register({ em: asValue(em), dataEngine: asValue({}) })
  const headers = expectedVersion ? { [OPTIMISTIC_LOCK_HEADER_NAME]: expectedVersion } : undefined
  const ctx = {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: new Request('https://example.test/api/sales/invoices', { method: 'DELETE', headers }),
  } as CommandRuntimeContext
  const handler = commandRegistry.get('sales.invoices.delete')!
  return {
    em,
    invoice,
    run: () => handler.execute({ id: INVOICE_ID, organizationId: ORG_ID, tenantId: TENANT_ID }, ctx),
  }
}

describe('sales.invoices.delete optimistic locking', () => {
  beforeAll(async () => { await import('../documents') })
  beforeEach(() => {
    jest.clearAllMocks()
    mockTranslate.mockImplementation((key) => key)
  })

  it('refuses an invoice edited between version validation and the deletion transaction', async () => {
    const { em, invoice, run } = setup(VALIDATED_VERSION, true)

    await expect(run()).rejects.toMatchObject({
      status: 409,
      body: { code: 'optimistic_lock_conflict', expectedUpdatedAt: VALIDATED_VERSION, currentUpdatedAt: EDITED_VERSION },
    })

    expect(em.findOne).toHaveBeenCalledWith(SalesInvoice,
      { id: INVOICE_ID, organizationId: ORG_ID, tenantId: TENANT_ID, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      { organizationId: ORG_ID, tenantId: TENANT_ID })
    expect(invoice.deletedAt).toBeNull()
    expect(invoice.updatedAt.toISOString()).toBe(EDITED_VERSION)
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
  })

  it.each([VALIDATED_VERSION, null])('soft-deletes the locked invoice with expected version %s', async (expectedVersion) => {
    const { em, invoice, run } = setup(expectedVersion)

    await expect(run()).resolves.toEqual({ invoiceId: INVOICE_ID })

    expect(invoice.deletedAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalled()
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).toHaveBeenCalledTimes(1)
  })

  it('returns a Polish 404 without deletion when the locked invoice no longer exists', async () => {
    const { em, run } = setup(VALIDATED_VERSION)
    em.findOne.mockResolvedValueOnce(null)
    mockTranslate.mockImplementation(createFallbackTranslator(polishTranslations))

    await expect(run()).rejects.toMatchObject({
      status: 404,
      body: { error: polishTranslations['sales.documents.detail.notFound'] },
    })

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
  })
})
