import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { GatewayPaymentOperation, GatewayTransaction } from '../../data/entities'
import {
  alignCapturedAmountWithStatus,
  assertCaptureWithinRemaining,
  formatAmountUnits,
  parseAmountUnits,
  releaseCaptureAmount,
  reserveCaptureAmount,
  resolveCaptureAmounts,
  settleCapturedAmount,
} from '../capture-ledger'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const findOneMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const scope = { organizationId: 'org_1', tenantId: 'tenant_1' }

function makeTransaction(amount: string, capturedAmount: string): GatewayTransaction {
  return {
    id: 'txn_1',
    amount,
    capturedAmount,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  } as unknown as GatewayTransaction
}

function makeOperation(reservedAmount: string | null): GatewayPaymentOperation {
  return {
    id: 'operation_1',
    operationId: 'capture-1',
    reservedAmount,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  } as unknown as GatewayPaymentOperation
}

function makeEm(updateResults: number[]) {
  const remaining = [...updateResults]
  const nativeUpdate = jest.fn(async (
    _entity: unknown,
    _where: Record<string, unknown>,
    _update: Record<string, unknown>,
  ) => remaining.shift() ?? 1)
  const em = {
    nativeUpdate,
    transactional: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(em)),
  }
  return { em, nativeUpdate }
}

beforeEach(() => {
  findOneMock.mockReset()
})

describe('capture ledger amounts', () => {
  it('parses and formats amounts on exact minor units', () => {
    expect(parseAmountUnits('100.0000')).toBe(1_000_000n)
    expect(parseAmountUnits('100')).toBe(1_000_000n)
    expect(parseAmountUnits(49.99)).toBe(499_900n)
    expect(parseAmountUnits('.5')).toBe(5_000n)
    expect(parseAmountUnits(null)).toBe(0n)
    expect(parseAmountUnits(undefined)).toBe(0n)
    expect(formatAmountUnits(1_000_000n)).toBe('100.0000')
    expect(formatAmountUnits(499_900n)).toBe('49.9900')
    expect(formatAmountUnits(0n)).toBe('0.0000')
  })

  it('rounds half-up past the fourth decimal, matching the numeric(18,4) column', () => {
    expect(parseAmountUnits('1.00005')).toBe(10_001n)
    expect(parseAmountUnits('1.00004')).toBe(10_000n)
    expect(parseAmountUnits('-1.00005')).toBe(-10_001n)
  })

  it('rejects a value it cannot represent instead of guessing', () => {
    expect(() => parseAmountUnits('not-a-number')).toThrow(/Unsupported gateway amount/)
  })

  it('treats an omitted amount as the amount still capturable', () => {
    const amounts = resolveCaptureAmounts(makeTransaction('100.0000', '60.0000'), undefined)

    expect(amounts.remainingUnits).toBe(400_000n)
    expect(amounts.requestedUnits).toBe(400_000n)
  })
})

describe('assertCaptureWithinRemaining', () => {
  it('accepts a partial capture that fits under the running total', () => {
    const amounts = assertCaptureWithinRemaining(makeTransaction('100.0000', '60.0000'), 40)

    expect(amounts.requestedUnits).toBe(400_000n)
  })

  it('rejects the cumulative overrun that a per-capture check would have allowed', () => {
    expect(() => assertCaptureWithinRemaining(makeTransaction('100.0000', '60.0000'), 60))
      .toThrow(/exceeds the 40 still capturable/)
  })

  it('rejects any capture on a fully captured transaction', () => {
    expect(() => assertCaptureWithinRemaining(makeTransaction('100.0000', '100.0000'), 1))
      .toThrow(/already fully captured/)
  })

  it('rejects a non-positive capture amount', () => {
    expect(() => assertCaptureWithinRemaining(makeTransaction('100.0000', '0.0000'), 0))
      .toThrow(/greater than zero/)
  })
})

describe('reserveCaptureAmount', () => {
  it('claims the requested slice and stamps it on the operation', async () => {
    const transaction = makeTransaction('100.0000', '60.0000')
    const operation = makeOperation(null)
    const { em, nativeUpdate } = makeEm([1, 1])

    const reserved = await reserveCaptureAmount(em as never, { transaction, operation, amount: 40, scope })

    expect(reserved).toBe(400_000n)
    expect(operation.reservedAmount).toBe('40.0000')
    expect(nativeUpdate.mock.calls[0]?.[1]).toMatchObject({ capturedAmount: '60.0000', deletedAt: null, ...scope })
    expect(nativeUpdate.mock.calls[0]?.[2]).toMatchObject({ capturedAmount: '100.0000' })
  })

  it('rejects a capture that lost the compare-and-swap to a concurrent capture', async () => {
    const { em } = makeEm([0])

    await expect(reserveCaptureAmount(em as never, {
      transaction: makeTransaction('100.0000', '0.0000'),
      operation: makeOperation(null),
      amount: 60,
      scope,
    })).rejects.toMatchObject({ status: 409, body: { code: 'payment_capture_reservation_conflict' } })
  })

  it('reuses the reservation an earlier attempt of the same operation already holds', async () => {
    const { em, nativeUpdate } = makeEm([])

    const reserved = await reserveCaptureAmount(em as never, {
      transaction: makeTransaction('100.0000', '60.0000'),
      operation: makeOperation('60.0000'),
      amount: 60,
      scope,
    })

    expect(reserved).toBe(600_000n)
    expect(nativeUpdate).not.toHaveBeenCalled()
  })
})

describe('settleCapturedAmount', () => {
  it('leaves the ledger alone when the provider captured exactly what was reserved', () => {
    const transaction = makeTransaction('100.0000', '60.0000')

    settleCapturedAmount(transaction, 600_000n, 60)

    expect(transaction.capturedAmount).toBe('60.0000')
  })

  it('adjusts the ledger down when the provider captured less than reserved', () => {
    const transaction = makeTransaction('100.0000', '60.0000')

    settleCapturedAmount(transaction, 600_000n, 45)

    expect(transaction.capturedAmount).toBe('45.0000')
  })

  it('keeps the reservation when the provider reports an unusable amount', () => {
    const transaction = makeTransaction('100.0000', '60.0000')

    settleCapturedAmount(transaction, 600_000n, Number.NaN)

    expect(transaction.capturedAmount).toBe('60.0000')
  })
})

describe('alignCapturedAmountWithStatus', () => {
  it('records the full amount when the provider reports a completed capture', () => {
    const transaction = makeTransaction('100.0000', '0.0000')

    alignCapturedAmountWithStatus(transaction, 'captured')

    expect(transaction.capturedAmount).toBe('100.0000')
  })

  it('never lowers a ledger that already recorded more than the reported status implies', () => {
    const transaction = makeTransaction('100.0000', '100.0000')

    alignCapturedAmountWithStatus(transaction, 'captured')

    expect(transaction.capturedAmount).toBe('100.0000')
  })

  it('leaves a partial capture alone because the reported status carries no amount', () => {
    const transaction = makeTransaction('100.0000', '0.0000')

    alignCapturedAmountWithStatus(transaction, 'partially_captured')

    expect(transaction.capturedAmount).toBe('0.0000')
  })

  it('ignores statuses that do not mean money was captured', () => {
    const transaction = makeTransaction('100.0000', '0.0000')

    alignCapturedAmountWithStatus(transaction, 'authorized')

    expect(transaction.capturedAmount).toBe('0.0000')
  })
})

describe('releaseCaptureAmount', () => {
  it('gives the reserved slice back and stops the operation holding it', async () => {
    const transaction = makeTransaction('100.0000', '60.0000')
    const operation = makeOperation('60.0000')
    findOneMock.mockResolvedValue(transaction as never)
    const { em, nativeUpdate } = makeEm([1, 1])

    await expect(releaseCaptureAmount(em as never, {
      transactionId: transaction.id,
      operation,
      reservedUnits: 600_000n,
      scope,
    })).resolves.toBe(true)

    expect(nativeUpdate.mock.calls[0]?.[2]).toMatchObject({ capturedAmount: '0.0000' })
    expect(operation.reservedAmount).toBeNull()
  })

  it('reports the reservation as still held when the ledger moved underneath it', async () => {
    const operation = makeOperation('60.0000')
    findOneMock.mockResolvedValue(makeTransaction('100.0000', '60.0000') as never)
    const { em } = makeEm([0])

    await expect(releaseCaptureAmount(em as never, {
      transactionId: 'txn_1',
      operation,
      reservedUnits: 600_000n,
      scope,
    })).resolves.toBe(false)

    expect(operation.reservedAmount).toBe('60.0000')
  })
})
