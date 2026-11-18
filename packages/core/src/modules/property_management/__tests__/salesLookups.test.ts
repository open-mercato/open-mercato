/** @jest-environment node */
import { SalesOrder, SalesOrderLine, SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { FakeEm } from './support/fakeEm'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/encryptedSalesDocuments').encryptingFindMock())
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError: mockReportError }) }))

import {
  DOCUMENT_LOOKUP_MAX_CANDIDATES,
  DOCUMENT_LOOKUP_PAGE_SIZE,
  documentLookupOf,
  findDocumentsByOperation,
  findFirstOrderLineId,
} from '../lib/salesLookups'
import { storeSalesDocument } from './support/encryptedSalesDocuments'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const CHANNEL = '33333333-3333-4333-8333-333333333333'
const OTHER_CHANNEL = '33333333-3333-4333-8333-333333333334'
const COMPANY = '44444444-4444-4444-8444-444444444444'
const OPERATION_ID = 'operation-1'
const operationCreatedAt = new Date('2026-11-17T10:00:00Z')
const lookup = { operationId: OPERATION_ID, createdAt: operationCreatedAt, channelId: CHANNEL, customerEntityId: COMPANY }

function at(offsetMs: number): Date {
  return new Date(operationCreatedAt.getTime() + offsetMs)
}

function seedCandidates(em: FakeEm, kind: 'order' | 'quote') {
  const base = { ...scope, channelId: CHANNEL, customerEntityId: COMPANY }
  storeSalesDocument(em, kind, { ...base, id: 'doc-match', createdAt: at(1_000), metadata: { propertyManagementOperationId: OPERATION_ID } })
  storeSalesDocument(em, kind, { ...base, id: 'doc-other-operation', createdAt: at(2_000), metadata: { propertyManagementOperationId: 'operation-2' } })
  storeSalesDocument(em, kind, { ...base, id: 'doc-no-metadata', createdAt: at(2_500), metadata: null })
  storeSalesDocument(em, kind, { ...base, id: 'doc-other-channel', channelId: OTHER_CHANNEL, createdAt: at(3_000), metadata: { propertyManagementOperationId: OPERATION_ID } })
  storeSalesDocument(em, kind, { ...base, id: 'doc-deleted', createdAt: at(4_000), deletedAt: at(5_000), metadata: { propertyManagementOperationId: OPERATION_ID } })
  storeSalesDocument(em, kind, { ...base, id: 'doc-too-old', createdAt: at(-2 * 24 * 60 * 60 * 1000), metadata: { propertyManagementOperationId: OPERATION_ID } })
  storeSalesDocument(em, kind, { ...base, id: 'doc-other-org', organizationId: '55555555-5555-4555-8555-555555555555', createdAt: at(6_000), metadata: { propertyManagementOperationId: OPERATION_ID } })
  storeSalesDocument(em, kind, { ...base, id: 'doc-duplicate', createdAt: at(7_000), metadata: { propertyManagementOperationId: OPERATION_ID } })
}

const originalEncryption = process.env.TENANT_DATA_ENCRYPTION

afterEach(() => {
  if (originalEncryption === undefined) delete process.env.TENANT_DATA_ENCRYPTION
  else process.env.TENANT_DATA_ENCRYPTION = originalEncryption
  jest.clearAllMocks()
})

describe('findDocumentsByOperation', () => {
  describe.each([
    ['on', 'yes'],
    ['off', 'no'],
  ])('with tenant data encryption %s', (_label, flag) => {
    beforeEach(() => {
      process.env.TENANT_DATA_ENCRYPTION = flag
    })

    it.each(['order', 'quote'] as const)('finds every live %s carrying the operation id, oldest first', async (kind) => {
      const em = new FakeEm()
      seedCandidates(em, kind)
      const found = await findDocumentsByOperation(em as never, scope, kind, lookup)
      expect(found).toEqual(['doc-match', 'doc-duplicate'])
      expect(em.executed).toEqual([])
      expect(em.rows(kind === 'order' ? SalesQuote : SalesOrder)).toHaveLength(0)
    })
  })

  it('stores the metadata as ciphertext while encryption is on, so only the decrypted read can match it', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    const em = new FakeEm()
    seedCandidates(em, 'order')
    const stored = em.rows(SalesOrder).find((row) => row.id === 'doc-match')
    expect(typeof stored?.metadata).toBe('string')
    expect(String(stored?.metadata)).not.toContain(OPERATION_ID)
    expect(await findDocumentsByOperation(em as never, scope, 'order', lookup)).toEqual(['doc-match', 'doc-duplicate'])
  })

  it('narrows candidates by plaintext columns only and never filters on the encrypted metadata', async () => {
    const em = new FakeEm()
    const find = jest.spyOn(em, 'find')
    await findDocumentsByOperation(em as never, scope, 'order', lookup)
    const [entity, where, options] = find.mock.calls[0]
    expect(entity).toBe(SalesOrder)
    expect(where).toEqual({
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      createdAt: { $gte: new Date(operationCreatedAt.getTime() - 24 * 60 * 60 * 1000) },
      channelId: CHANNEL,
      customerEntityId: COMPANY,
    })
    expect(JSON.stringify(where)).not.toContain('metadata')
    expect(options).toMatchObject({ orderBy: { createdAt: 'asc', id: 'asc' }, limit: DOCUMENT_LOOKUP_PAGE_SIZE })
  })

  it('skips the channel and customer narrowing when the operation payload does not carry them', async () => {
    const em = new FakeEm()
    const find = jest.spyOn(em, 'find')
    await findDocumentsByOperation(em as never, scope, 'quote', { operationId: OPERATION_ID, createdAt: operationCreatedAt })
    const where = find.mock.calls[0][1]
    expect(where).not.toHaveProperty('channelId')
    expect(where).not.toHaveProperty('customerEntityId')
  })

  it('pages through candidates and reports when the candidate cap is reached', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    const em = new FakeEm()
    const base = { ...scope, channelId: CHANNEL, customerEntityId: COMPANY }
    storeSalesDocument(em, 'order', { ...base, id: 'doc-early-match', createdAt: at(1), metadata: { propertyManagementOperationId: OPERATION_ID } })
    for (let index = 0; index < DOCUMENT_LOOKUP_MAX_CANDIDATES + 5; index += 1) {
      const id = `doc-${String(index).padStart(5, '0')}`
      storeSalesDocument(em, 'order', { ...base, id, createdAt: at(10 + index), metadata: { propertyManagementOperationId: `other-${index}` } })
    }
    storeSalesDocument(em, 'order', { ...base, id: 'doc-late-match', createdAt: at(1_000_000), metadata: { propertyManagementOperationId: OPERATION_ID } })
    const find = jest.spyOn(em, 'find')
    const found = await findDocumentsByOperation(em as never, scope, 'order', lookup)
    expect(found).toEqual(['doc-early-match'])
    expect(find).toHaveBeenCalledTimes(DOCUMENT_LOOKUP_MAX_CANDIDATES / DOCUMENT_LOOKUP_PAGE_SIZE)
    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: 'property_management.sales_document_lookup_capped' }),
    )
  })

  it('does not report the cap when the last page is short', async () => {
    const em = new FakeEm()
    seedCandidates(em, 'order')
    await findDocumentsByOperation(em as never, scope, 'order', lookup)
    expect(mockReportError).not.toHaveBeenCalled()
  })
})

describe('documentLookupOf', () => {
  it('takes the channel and customer from the operation payload', () => {
    expect(
      documentLookupOf({ id: OPERATION_ID, createdAt: operationCreatedAt, payload: { channelId: CHANNEL, customerEntityId: COMPANY, lines: [] } }),
    ).toEqual(lookup)
    expect(documentLookupOf({ id: OPERATION_ID, createdAt: operationCreatedAt, payload: { orderId: 'order-1' } })).toEqual({
      operationId: OPERATION_ID,
      createdAt: operationCreatedAt,
      channelId: null,
      customerEntityId: null,
    })
  })
})

describe('findFirstOrderLineId', () => {
  it('skips soft-deleted lines and returns the first live line of the order', async () => {
    const em = new FakeEm()
    em.seed(SalesOrderLine, { id: 'line-deleted', ...scope, order: 'order-1', lineNumber: 1, deletedAt: new Date() } as never)
    em.seed(SalesOrderLine, { id: 'line-live', ...scope, order: 'order-1', lineNumber: 2, deletedAt: null } as never)
    em.seed(SalesOrderLine, { id: 'line-other-order', ...scope, order: 'order-2', lineNumber: 0, deletedAt: null } as never)
    expect(await findFirstOrderLineId(em as never, scope, 'order-1')).toBe('line-live')
    expect(em.executed.at(-1)?.sql).toContain('deleted_at is null')
  })

  it('returns null when every line of the order was deleted', async () => {
    const em = new FakeEm()
    em.seed(SalesOrderLine, { id: 'line-deleted', ...scope, order: 'order-1', lineNumber: 1, deletedAt: new Date() } as never)
    expect(await findFirstOrderLineId(em as never, scope, 'order-1')).toBeNull()
  })
})
