/** @jest-environment node */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SalesOperation } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))

import {
  canonicalJson,
  hashPayload,
  recordOperation,
  resolveSalesConcurrency,
  withOperationMetadata,
} from '../lib/salesOperations'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const asEm = (em: FakeEm) => em as never

describe('sales operation recording', () => {
  it('hashes payloads canonically regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[1,{"y":2,"z":1}],"d":2},"b":1}')
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }))
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }))
  })

  it('stamps the operation id into the document metadata', () => {
    expect(withOperationMetadata({ metadata: { leaseId: 'x' }, lines: [] }, 'op-1')).toEqual({
      metadata: { leaseId: 'x', propertyManagementOperationId: 'op-1' },
      lines: [],
    })
  })

  it('records a pending operation with a token', async () => {
    const em = new FakeEm()
    const op = await recordOperation(asEm(em), scope, {
      kind: 'lease_order',
      subjectKey: 'lease_order:v1',
      payload: { lines: [1] },
      targetType: 'lease_version',
      targetId: 'v1',
      leaseId: 'l1',
    })
    expect(op.status).toBe('pending')
    expect(op.token).toMatch(/[0-9a-f-]{36}/)
    expect(em.rows(SalesOperation)).toHaveLength(1)
  })

  it('returns the existing operation for the same key and payload', async () => {
    const em = new FakeEm()
    const input = { kind: 'lease_order' as const, subjectKey: 'lease_order:v1', payload: { a: 1 }, targetType: 'lease_version' as const, targetId: 'v1' }
    const first = await recordOperation(asEm(em), scope, input)
    const second = await recordOperation(asEm(em), scope, { ...input, payload: { a: 1 } })
    expect(second).toBe(first)
    expect(em.rows(SalesOperation)).toHaveLength(1)
  })

  it('refuses the same key with a different payload', async () => {
    const em = new FakeEm()
    const input = { kind: 'lease_order' as const, subjectKey: 'lease_order:v1', payload: { a: 1 }, targetType: 'lease_version' as const, targetId: 'v1' }
    await recordOperation(asEm(em), scope, input)
    await expect(recordOperation(asEm(em), scope, { ...input, payload: { a: 2 } })).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'sales_operation_conflict' }),
    })
  })

  it('never reuses a refused or compensated operation', async () => {
    const em = new FakeEm()
    const input = { kind: 'recurrence_cancel' as const, subjectKey: 'recurrence_cancel:o1:c1', payload: { a: 1 }, targetType: 'lease' as const, targetId: 'l1' }
    const first = await recordOperation(asEm(em), scope, input)
    first.status = 'refused'
    const error = await recordOperation(asEm(em), scope, input).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(CrudHttpError)
  })

  it('bounds the queue concurrency', () => {
    expect(resolveSalesConcurrency(undefined)).toBe(4)
    expect(resolveSalesConcurrency('8')).toBe(8)
    expect(resolveSalesConcurrency('500')).toBe(20)
    expect(resolveSalesConcurrency('zero')).toBe(4)
  })
})
