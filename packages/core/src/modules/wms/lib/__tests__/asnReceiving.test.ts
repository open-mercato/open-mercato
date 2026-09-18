/** @jest-environment node */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  assertAsnQcTransition,
  assertReceivingLineLifecycleFieldsForbidden,
  buildAsnReceivePutawayKey,
  buildAsnReceiveReferenceId,
  buildAsnStatusFilter,
  hasAsnDeleteBlockingLineActivity,
  hasAsnReceiptActivity,
  isAsnCloseable,
  putawayMetadataMatchesKey,
  resolveAsnReceiveAttempt,
  resolvePutawayQuantityForAlreadyAtTargetRetry,
  shouldEnsurePutawayOnAlreadyAtTarget,
  shouldRecreatePutawayOnAlreadyAtTarget,
  shouldWriteStockOnQcPass,
} from '../asnReceiving'

describe('asnReceiving QC helpers', () => {
  it('allows pending → passed/failed and same-status re-entry', () => {
    expect(() => assertAsnQcTransition('pending', 'passed')).not.toThrow()
    expect(() => assertAsnQcTransition('pending', 'failed')).not.toThrow()
    expect(() => assertAsnQcTransition('passed', 'passed')).not.toThrow()
    expect(() => assertAsnQcTransition('failed', 'failed')).not.toThrow()
  })

  it('rejects opposite QC transitions', () => {
    expect(() => assertAsnQcTransition('passed', 'failed')).toThrow(CrudHttpError)
    expect(() => assertAsnQcTransition('failed', 'passed')).toThrow(CrudHttpError)
    try {
      assertAsnQcTransition('passed', 'failed')
    } catch (error) {
      expect(error).toBeInstanceOf(CrudHttpError)
      expect((error as CrudHttpError).status).toBe(422)
      expect((error as CrudHttpError).body).toMatchObject({ error: 'invalid_qc_transition' })
    }
  })

  it('only writes stock on QC pass', () => {
    expect(shouldWriteStockOnQcPass('passed')).toBe(true)
    expect(shouldWriteStockOnQcPass('failed')).toBe(false)
  })

  it('evaluates ASN closeability for short receipts', () => {
    const lines = [
      { expectedQty: '10', receivedQty: '10', qcStatus: 'passed' },
      { expectedQty: '5', receivedQty: '3', qcStatus: 'passed' },
    ]
    expect(isAsnCloseable(lines, false)).toBe(false)
    expect(isAsnCloseable(lines, true)).toBe(true)
    expect(isAsnCloseable([{ expectedQty: '5', receivedQty: '5', qcStatus: 'passed' }], false)).toBe(
      true,
    )
  })

  it('rejects header-only ASNs with zero receiving lines', () => {
    expect(isAsnCloseable([], false)).toBe(false)
    expect(isAsnCloseable([], true)).toBe(false)
  })

  it('rejects zero-receipt lines even with closeWhenShort', () => {
    const untouched = [{ expectedQty: '10', receivedQty: '0', qcStatus: 'pending' as const }]
    expect(hasAsnReceiptActivity(untouched)).toBe(false)
    expect(hasAsnDeleteBlockingLineActivity(untouched)).toBe(false)
    expect(isAsnCloseable(untouched, false)).toBe(false)
    expect(isAsnCloseable(untouched, true)).toBe(false)
    expect(
      isAsnCloseable(
        [
          { expectedQty: '5', receivedQty: 0, qcStatus: 'pending' },
          { expectedQty: '5', receivedQty: '0', qcStatus: 'pending' },
        ],
        true,
      ),
    ).toBe(false)
  })

  it('blocks ASN delete on received qty or non-pending QC', () => {
    expect(
      hasAsnDeleteBlockingLineActivity([
        { receivedQty: '0', qcStatus: 'pending' },
      ]),
    ).toBe(false)
    expect(
      hasAsnDeleteBlockingLineActivity([
        { receivedQty: '1', qcStatus: 'pending' },
      ]),
    ).toBe(true)
    expect(
      hasAsnDeleteBlockingLineActivity([
        { receivedQty: '0', qcStatus: 'passed' },
      ]),
    ).toBe(true)
    expect(
      hasAsnDeleteBlockingLineActivity([
        { receivedQty: '0', qcStatus: 'failed' },
      ]),
    ).toBe(true)
  })

  it('does not treat QC-fail qty as accepted fulfillment unless closeWhenShort', () => {
    const lines = [{ expectedQty: '10', receivedQty: '10', qcStatus: 'failed' as const }]
    expect(hasAsnReceiptActivity(lines)).toBe(true)
    expect(hasAsnDeleteBlockingLineActivity(lines)).toBe(true)
    expect(isAsnCloseable(lines, false)).toBe(false)
    expect(isAsnCloseable(lines, true)).toBe(true)
    expect(
      isAsnCloseable([{ expectedQty: '10', receivedQty: '10', qcStatus: 'pending' }], false),
    ).toBe(false)
  })

  it('resolves stable attempt keys from absolute target for post-success retries', () => {
    const lineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const first = resolveAsnReceiveAttempt({
      lineId,
      priorReceivedQty: 0,
      receivedQty: 4,
      targetReceivedQty: 4,
    })
    // After success, prior advanced to 4 but client still sends the same absolute target.
    const retryAfterSuccess = resolveAsnReceiveAttempt({
      lineId,
      priorReceivedQty: 4,
      receivedQty: 4,
      targetReceivedQty: 4,
    })
    expect(first.attemptKey).toBe(retryAfterSuccess.attemptKey)
    expect(first.applyQty).toBe(4)
    expect(retryAfterSuccess.applyQty).toBe(0)

    const nextPartial = resolveAsnReceiveAttempt({
      lineId,
      priorReceivedQty: 4,
      receivedQty: 4,
      targetReceivedQty: 8,
    })
    expect(nextPartial.attemptKey).not.toBe(first.attemptKey)
    expect(nextPartial.applyQty).toBe(4)
  })

  it('requires absolute targetReceivedQty for all receive attempts', () => {
    expect(() =>
      resolveAsnReceiveAttempt({
        lineId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        priorReceivedQty: 0,
        receivedQty: 4,
      }),
    ).toThrow(CrudHttpError)
    try {
      resolveAsnReceiveAttempt({
        lineId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        priorReceivedQty: 0,
        receivedQty: 4,
      })
    } catch (error) {
      expect((error as CrudHttpError).status).toBe(422)
      expect((error as CrudHttpError).body).toMatchObject({ error: 'target_received_qty_required' })
    }
    // idempotencyKey alone must NOT derive prior+delta (would double-apply on retry).
    expect(() =>
      resolveAsnReceiveAttempt({
        lineId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        priorReceivedQty: 0,
        receivedQty: 4,
        idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    ).toThrow(CrudHttpError)
  })

  it('keeps idempotencyKey as optional stabilizer when absolute target is present', () => {
    const withKey = resolveAsnReceiveAttempt({
      lineId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      priorReceivedQty: 0,
      receivedQty: 4,
      targetReceivedQty: 4,
      idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })
    const retry = resolveAsnReceiveAttempt({
      lineId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      priorReceivedQty: 4,
      receivedQty: 4,
      targetReceivedQty: 4,
      idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })
    expect(withKey.applyQty).toBe(4)
    expect(retry.applyQty).toBe(0)
    expect(withKey.attemptKey).toBe(retry.attemptKey)
    expect(buildAsnReceiveReferenceId({ attemptKey: withKey.attemptKey })).toBe(
      buildAsnReceiveReferenceId({ attemptKey: retry.attemptKey }),
    )
    expect(buildAsnReceivePutawayKey({ attemptKey: withKey.attemptKey })).toBe(
      buildAsnReceivePutawayKey({ attemptKey: retry.attemptKey }),
    )
  })

  it('does not reuse movement/putaway keys when same idempotencyKey has a higher absolute target', () => {
    const lineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const first = resolveAsnReceiveAttempt({
      lineId,
      priorReceivedQty: 0,
      receivedQty: 4,
      targetReceivedQty: 4,
      idempotencyKey,
    })
    // Client reuses the same idempotencyKey but advances absolute target after
    // the first attempt succeeded (prior=4). applyQty must be positive and keys
    // must differ so stock/putaway are not replayed against the first movement.
    const higherTarget = resolveAsnReceiveAttempt({
      lineId,
      priorReceivedQty: 4,
      receivedQty: 4,
      targetReceivedQty: 8,
      idempotencyKey,
    })
    expect(first.applyQty).toBe(4)
    expect(higherTarget.applyQty).toBe(4)
    expect(higherTarget.attemptKey).not.toBe(first.attemptKey)
    expect(buildAsnReceiveReferenceId({ attemptKey: higherTarget.attemptKey })).not.toBe(
      buildAsnReceiveReferenceId({ attemptKey: first.attemptKey }),
    )
    expect(buildAsnReceivePutawayKey({ attemptKey: higherTarget.attemptKey })).not.toBe(
      buildAsnReceivePutawayKey({ attemptKey: first.attemptKey }),
    )
  })

  it('keeps QC-fail identical retries applyQty=0 (no audit qty inflation)', () => {
    const lineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const first = resolveAsnReceiveAttempt({
      lineId,
      priorReceivedQty: 0,
      receivedQty: 3,
      targetReceivedQty: 3,
    })
    // Identical HTTP retry after QC-fail success: prior advanced, same absolute target.
    const retry = resolveAsnReceiveAttempt({
      lineId,
      priorReceivedQty: 3,
      receivedQty: 3,
      targetReceivedQty: 3,
    })
    expect(first.applyQty).toBe(3)
    expect(retry.applyQty).toBe(0)
    expect(retry.targetReceivedQty).toBe(3)
    expect(first.attemptKey).toBe(retry.attemptKey)
  })

  it('builds identical movement/putaway keys for the same attempt (ASN lock is ASN-only)', () => {
    const attempt = resolveAsnReceiveAttempt({
      lineId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      priorReceivedQty: 0,
      receivedQty: 4,
      targetReceivedQty: 4,
    })
    const firstRef = buildAsnReceiveReferenceId({ attemptKey: attempt.attemptKey })
    const retryRef = buildAsnReceiveReferenceId({ attemptKey: attempt.attemptKey })
    const firstPutaway = buildAsnReceivePutawayKey({ attemptKey: attempt.attemptKey })
    const retryPutaway = buildAsnReceivePutawayKey({ attemptKey: attempt.attemptKey })
    expect(firstRef).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(retryRef).toBe(firstRef)
    expect(retryPutaway).toBe(firstPutaway)

    // Intentional second partial uses a different absolute target → different putaway key.
    const next = resolveAsnReceiveAttempt({
      lineId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      priorReceivedQty: 4,
      receivedQty: 4,
      targetReceivedQty: 8,
    })
    expect(buildAsnReceivePutawayKey({ attemptKey: next.attemptKey })).not.toBe(firstPutaway)
  })

  it('matches putaway metadata by putawayKey (column putaway_key is the indexed lookup)', () => {
    const attempt = resolveAsnReceiveAttempt({
      lineId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      priorReceivedQty: 0,
      receivedQty: 4,
      targetReceivedQty: 4,
    })
    const putawayKey = buildAsnReceivePutawayKey({ attemptKey: attempt.attemptKey })
    // Find-or-create queries PutawayTask.putawayKey (dedicated column), not newest-50 metadata scan.
    expect(putawayKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(putawayMetadataMatchesKey({ putawayKey, source: 'asn_receive' }, putawayKey)).toBe(true)
    expect(putawayMetadataMatchesKey({ putawayKey: 'other' }, putawayKey)).toBe(false)
    expect(putawayMetadataMatchesKey(null, putawayKey)).toBe(false)
  })

  it('ensures putaway recreate after cancel on already-at-target retry', () => {
    expect(shouldEnsurePutawayOnAlreadyAtTarget(null)).toBe(true)
    expect(shouldEnsurePutawayOnAlreadyAtTarget(undefined)).toBe(true)
    expect(shouldEnsurePutawayOnAlreadyAtTarget({ id: 'task-1' })).toBe(false)

    // Prefer cancelled task qty (partial attempt) over absolute target.
    expect(
      resolvePutawayQuantityForAlreadyAtTargetRetry({
        cancelledTaskQuantity: 2,
        absoluteTargetQty: 5,
      }),
    ).toBe(2)
    expect(
      resolvePutawayQuantityForAlreadyAtTargetRetry({
        cancelledTaskQuantity: null,
        absoluteTargetQty: 5,
      }),
    ).toBe(5)
    expect(
      resolvePutawayQuantityForAlreadyAtTargetRetry({
        cancelledTaskQuantity: 0,
        absoluteTargetQty: 5,
      }),
    ).toBe(5)
  })

  it('skips already-at-target recreate when staging is fully committed by other putaways', () => {
    expect(
      shouldRecreatePutawayOnAlreadyAtTarget({
        requestedQuantity: 5,
        remainingAvailable: 5,
      }),
    ).toBe(true)
    expect(
      shouldRecreatePutawayOnAlreadyAtTarget({
        requestedQuantity: 5,
        remainingAvailable: 4.999,
      }),
    ).toBe(false)
    expect(
      shouldRecreatePutawayOnAlreadyAtTarget({
        requestedQuantity: 5,
        remainingAvailable: 0,
      }),
    ).toBe(false)
    expect(
      shouldRecreatePutawayOnAlreadyAtTarget({
        requestedQuantity: 0,
        remainingAvailable: 10,
      }),
    ).toBe(false)
  })

  it('rejects receiving-line lifecycle fields before CRUD strip', () => {
    expect(() =>
      assertReceivingLineLifecycleFieldsForbidden({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        receivedQty: 3,
      }),
    ).toThrow(CrudHttpError)
    try {
      assertReceivingLineLifecycleFieldsForbidden({ qcStatus: 'passed' })
    } catch (error) {
      expect((error as CrudHttpError).status).toBe(422)
      expect((error as CrudHttpError).body).toMatchObject({ error: 'lifecycle_field_forbidden' })
    }
  })
})

describe('buildAsnStatusFilter', () => {
  it('returns $eq for a single status', () => {
    expect(buildAsnStatusFilter('draft')).toEqual({ $eq: 'draft' })
  })

  it('returns $in for comma-separated open-queue statuses', () => {
    expect(buildAsnStatusFilter('draft,in_transit')).toEqual({
      $in: ['draft', 'in_transit'],
    })
  })

  it('dedupes and ignores blank/invalid tokens', () => {
    expect(buildAsnStatusFilter('draft, draft, bogus,in_transit')).toEqual({
      $in: ['draft', 'in_transit'],
    })
    expect(buildAsnStatusFilter('')).toBeUndefined()
    expect(buildAsnStatusFilter(undefined)).toBeUndefined()
    expect(buildAsnStatusFilter('not-a-status')).toBeUndefined()
  })
})
