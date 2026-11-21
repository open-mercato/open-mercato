import type { EntityManager } from '@mikro-orm/postgresql'
import type { GatewayPaymentOperation } from '../../data/entities'
import { completePaymentOperation, type ClaimedPaymentOperation } from '../payment-operation-idempotency'

function fixture() {
  const leaseExpiresAt = new Date('2030-01-01T00:00:00Z')
  const record = {
    id: 'operation-row',
    operationId: 'capture-operation',
    status: 'in_progress',
    result: null,
    leaseExpiresAt,
  } as unknown as GatewayPaymentOperation
  const claim: ClaimedPaymentOperation = { record, attemptToken: 'attempt-token', providerIdempotencyKey: 'provider-key' }
  const tx = { nativeUpdate: jest.fn(async () => 1), flush: jest.fn(async () => {}) }
  const em = {
    transactional: jest.fn(async (callback: (manager: EntityManager) => Promise<boolean>) => callback(tx as unknown as EntityManager)),
  }
  return { record, claim, tx, em, leaseExpiresAt }
}

describe('payment operation completion commit boundary', () => {
  it('retains the settled status for replay and updates the caller claim only after commit', async () => {
    const { record, claim, tx, em } = fixture()
    const result = { status: 'captured', capturedAmountExact: '0.000000000000000001' }
    em.transactional.mockImplementation(async (callback) => {
      const changed = await callback(tx as unknown as EntityManager)
      expect(record.status).toBe('in_progress')
      expect(record.result).toBeNull()
      return changed
    })

    await expect(completePaymentOperation(em as unknown as EntityManager, claim, result, async () => ({
      statusChanged: false,
      settledStatus: 'cancelled',
    }))).resolves.toBe(false)

    expect(tx.nativeUpdate).toHaveBeenNthCalledWith(1, expect.anything(), {
      id: record.id, status: 'in_progress', attemptToken: claim.attemptToken,
    }, expect.objectContaining({ status: 'succeeded', result }))
    expect(record).toMatchObject({
      status: 'succeeded',
      leaseExpiresAt: null,
      result: { ...result, __settledTransactionStatus: 'cancelled' },
    })
    expect(tx.nativeUpdate).toHaveBeenNthCalledWith(2, expect.anything(), {
      id: record.id, status: 'succeeded', attemptToken: claim.attemptToken,
    }, { result: record.result })
  })

  it.each(['flush', 'commit'] as const)('keeps the caller claim unchanged after %s failure', async (failure) => {
    const { record, claim, tx, em, leaseExpiresAt } = fixture()
    const error = new Error('[internal] completion failed')
    if (failure === 'flush') tx.flush.mockRejectedValueOnce(error)
    else em.transactional.mockImplementation(async (callback) => {
      await callback(tx as unknown as EntityManager)
      throw error
    })

    await expect(completePaymentOperation(em as unknown as EntityManager, claim, { status: 'captured' }, async () => ({
      statusChanged: true,
      settledStatus: 'captured',
    }))).rejects.toBe(error)

    expect(record).toMatchObject({ status: 'in_progress', result: null, leaseExpiresAt })
  })

  it('rejects a lost attempt before applying the provider result', async () => {
    const { record, claim, tx, em } = fixture()
    tx.nativeUpdate.mockResolvedValueOnce(0)
    const applyResult = jest.fn(async () => ({ statusChanged: true, settledStatus: 'captured' }))

    await expect(completePaymentOperation(em as unknown as EntityManager, claim, { status: 'captured' }, applyResult))
      .rejects.toMatchObject({ status: 409, body: { code: 'payment_operation_claim_lost' } })

    expect(applyResult).not.toHaveBeenCalled()
    expect(tx.flush).not.toHaveBeenCalled()
    expect(record.status).toBe('in_progress')
  })
})
