/** @jest-environment node */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SalesOperation } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))

import { createModuleQueue } from '@open-mercato/queue'
import {
  canonicalJson,
  enqueueSalesOperationRecheck,
  getSalesOperationQueue,
  hashPayload,
  recordOperation,
  recordOperations,
  resolveSalesConcurrency,
  salesOperationCoalesceKey,
  SALES_OPERATION_CONNECTIONS_PER_JOB,
  SALES_OPERATION_QUEUE,
  SALES_OPERATION_RECHECK_DELAY_MS,
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

  describe('batched recording', () => {
    const orderStatus = (orderId: string, statusEntryId = 'status-cancelled') => ({
      kind: 'order_status' as const,
      subjectKey: `order_status:${orderId}:cancelled`,
      payload: { orderId, statusEntryId },
      targetType: 'booking' as const,
      targetId: `booking-${orderId}`,
    })

    it('looks every key up in one query and returns an operation per input in order', async () => {
      const em = new FakeEm()
      const existing = await recordOperation(asEm(em), scope, orderStatus('o1'))
      const find = jest.spyOn(em, 'find')
      const findOne = jest.spyOn(em, 'findOne')
      const operations = await recordOperations(asEm(em), scope, [orderStatus('o1'), orderStatus('o2'), orderStatus('o3')])
      expect(find).toHaveBeenCalledTimes(1)
      expect(find.mock.calls[0][1]).toMatchObject({ ...scope, subjectKey: { $in: ['order_status:o1:cancelled', 'order_status:o2:cancelled', 'order_status:o3:cancelled'] } })
      expect(findOne).not.toHaveBeenCalled()
      expect(operations[0]).toBe(existing)
      expect(operations.map((operation) => operation.subjectKey)).toEqual(['order_status:o1:cancelled', 'order_status:o2:cancelled', 'order_status:o3:cancelled'])
      expect(operations.slice(1).every((operation) => operation.status === 'pending' && operation.token.length === 36)).toBe(true)
      expect(em.rows(SalesOperation)).toHaveLength(3)
    })

    it('creates the operation once for a key repeated in the batch with the same payload', async () => {
      const em = new FakeEm()
      const operations = await recordOperations(asEm(em), scope, [orderStatus('o1'), orderStatus('o1')])
      expect(operations).toHaveLength(2)
      expect(operations[1]).toBe(operations[0])
      expect(em.rows(SalesOperation)).toHaveLength(1)
    })

    it('refuses a key repeated in the batch with a different payload', async () => {
      const em = new FakeEm()
      await expect(recordOperations(asEm(em), scope, [orderStatus('o1'), orderStatus('o1', 'status-other')])).rejects.toMatchObject({
        status: 409,
        body: expect.objectContaining({ code: 'sales_operation_conflict' }),
      })
    })

    it('refuses an existing key with a different payload', async () => {
      const em = new FakeEm()
      await recordOperation(asEm(em), scope, orderStatus('o1'))
      await expect(recordOperations(asEm(em), scope, [orderStatus('o2'), orderStatus('o1', 'status-other')])).rejects.toMatchObject({
        status: 409,
        body: expect.objectContaining({ code: 'sales_operation_conflict' }),
      })
    })

    it('never reuses a refused or compensated operation', async () => {
      for (const status of ['refused', 'compensated'] as const) {
        const em = new FakeEm()
        const existing = await recordOperation(asEm(em), scope, orderStatus('o1'))
        existing.status = status
        const error = await recordOperations(asEm(em), scope, [orderStatus('o1')]).catch((err: unknown) => err)
        expect(error).toBeInstanceOf(CrudHttpError)
        expect((error as CrudHttpError).status).toBe(409)
      }
    })

    it('reuses an existing operation that failed but may be retried', async () => {
      const em = new FakeEm()
      const existing = await recordOperation(asEm(em), scope, orderStatus('o1'))
      existing.status = 'failed'
      const [operation] = await recordOperations(asEm(em), scope, [orderStatus('o1')])
      expect(operation).toBe(existing)
    })

    it('skips the lookup for an empty batch', async () => {
      const em = new FakeEm()
      const find = jest.spyOn(em, 'find')
      await expect(recordOperations(asEm(em), scope, [])).resolves.toEqual([])
      expect(find).not.toHaveBeenCalled()
    })
  })

  it('bounds the queue concurrency', () => {
    expect(resolveSalesConcurrency(undefined, 100)).toBe(2)
    expect(resolveSalesConcurrency('8', 100)).toBe(8)
    expect(resolveSalesConcurrency('500', 100)).toBe(20)
    expect(resolveSalesConcurrency('zero', 100)).toBe(2)
  })

  it('keeps the connections every running job holds within the worker pool', () => {
    expect(SALES_OPERATION_CONNECTIONS_PER_JOB).toBe(3)
    expect(resolveSalesConcurrency('20', 20)).toBe(6)
    expect(resolveSalesConcurrency(undefined, 20)).toBe(2)
    expect(resolveSalesConcurrency('4', 5)).toBe(1)
    expect(resolveSalesConcurrency('4', Number.NaN)).toBe(4)
  })

  it('coalesces repeated enqueues of the same operation', () => {
    getSalesOperationQueue()
    expect(createModuleQueue).toHaveBeenCalledWith(SALES_OPERATION_QUEUE, expect.objectContaining({ coalesceBy: salesOperationCoalesceKey }))
    expect(salesOperationCoalesceKey({ operationId: 'op-1' })).toBe('sales_operation:op-1')
  })

  it('enqueues late-creation re-checks uncoalesced, delaying every re-check after the first', async () => {
    const queue = getSalesOperationQueue()
    await enqueueSalesOperationRecheck('op-1', 1)
    await enqueueSalesOperationRecheck('op-1', 2)
    expect(queue.enqueue).toHaveBeenNthCalledWith(1, { operationId: 'op-1', recheck: 1 }, undefined)
    expect(queue.enqueue).toHaveBeenNthCalledWith(2, { operationId: 'op-1', recheck: 2 }, { delayMs: SALES_OPERATION_RECHECK_DELAY_MS })
    expect(salesOperationCoalesceKey({ operationId: 'op-1', recheck: 2 })).toBeUndefined()
  })
})
