import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { GatewayPaymentOperation, GatewayTransaction } from '../../data/entities'
import {
  alignCapturedAmountWithStatus,
  assertCaptureWithinRemaining,
  releaseCaptureAmount,
  reserveCaptureAmount,
  resolveCaptureAmounts,
  settleCapturedAmount,
  assertCaptureWithinRemainingExact,
  formatAmountUnits,
  parseAmountUnits,
  releaseCaptureAmountExact,
  reserveCaptureAmountExact,
  resolveCaptureAmountsExact,
  settleCapturedAmountExact,
  type CaptureAmounts,
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
    const amounts = resolveCaptureAmountsExact(makeTransaction('100.0000', '60.0000'), undefined)

    expect(amounts.remainingAmount.toFixed()).toBe('40')
    expect(amounts.requestedAmount.toFixed()).toBe('40')
  })
})

describe('assertCaptureWithinRemainingExact', () => {
  it('accepts a partial capture that fits under the running total', () => {
    const amounts = assertCaptureWithinRemainingExact(makeTransaction('100.0000', '60.0000'), 40)

    expect(amounts.requestedAmount.toFixed()).toBe('40')
  })

  it('rejects the cumulative overrun that a per-capture check would have allowed', () => {
    expect(() => assertCaptureWithinRemainingExact(makeTransaction('100.0000', '60.0000'), 60))
      .toThrow(/exceeds the 40 still capturable/)
  })

  it('rejects any capture on a fully captured transaction', () => {
    expect(() => assertCaptureWithinRemainingExact(makeTransaction('100.0000', '100.0000'), 1))
      .toThrow(/already fully captured/)
  })

  it('rejects a non-positive capture amount', () => {
    expect(() => assertCaptureWithinRemainingExact(makeTransaction('100.0000', '0.0000'), 0))
      .toThrow(/greater than zero/)
  })
})

describe('reserveCaptureAmountExact', () => {
  it('claims the requested slice and stamps it on the operation', async () => {
    const transaction = makeTransaction('100.0000', '60.0000')
    const operation = makeOperation(null)
    const { em, nativeUpdate } = makeEm([1, 1])

    const reserved = await reserveCaptureAmountExact(em as never, { transaction, operation, amount: 40, scope })

    expect(reserved).toBe('40')
    expect(operation.reservedAmount).toBe('40')
    expect(nativeUpdate.mock.calls[0]?.[1]).toMatchObject({ capturedAmount: '60.0000', deletedAt: null, ...scope })
    expect(nativeUpdate.mock.calls[0]?.[2]).toMatchObject({ capturedAmount: '100' })
  })

  it('rejects a capture that lost the compare-and-swap to a concurrent capture', async () => {
    const { em } = makeEm([0])

    await expect(reserveCaptureAmountExact(em as never, {
      transaction: makeTransaction('100.0000', '0.0000'),
      operation: makeOperation(null),
      amount: 60,
      scope,
    })).rejects.toMatchObject({ status: 409, body: { code: 'payment_capture_reservation_conflict' } })
  })

  it('reuses the reservation an earlier attempt of the same operation already holds', async () => {
    const { em, nativeUpdate } = makeEm([])

    const reserved = await reserveCaptureAmountExact(em as never, {
      transaction: makeTransaction('100.0000', '60.0000'),
      operation: makeOperation('60.0000'),
      amount: 60,
      scope,
    })

    expect(reserved).toBe('60')
    expect(nativeUpdate).not.toHaveBeenCalled()
  })
})

describe('settleCapturedAmountExact', () => {
  it('leaves the ledger alone when the provider captured exactly what was reserved', () => {
    const transaction = makeTransaction('100.0000', '60.0000')

    settleCapturedAmountExact(transaction, '60', 60)

    expect(transaction.capturedAmount).toBe('60.0000')
  })

  it('adjusts the ledger down when the provider captured less than reserved', () => {
    const transaction = makeTransaction('100.0000', '60.0000')

    settleCapturedAmountExact(transaction, '60', 45)

    expect(transaction.capturedAmount).toBe('45')
  })

  it('keeps the reservation when the provider reports an unusable amount', () => {
    const transaction = makeTransaction('100.0000', '60.0000')

    settleCapturedAmountExact(transaction, '60', Number.NaN)

    expect(transaction.capturedAmount).toBe('60.0000')
  })
})

describe('alignCapturedAmountWithStatus', () => {
  it('records the full amount when the provider reports a completed capture', () => {
    const transaction = makeTransaction('100.0000', '0.0000')

    alignCapturedAmountWithStatus(transaction, 'captured')

    expect(transaction.capturedAmount).toBe('100')
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

describe('exact decimal captures', () => {
  it('reserves, retries, settles and releases without losing digits beyond four decimals', async () => {
    const transaction = makeTransaction('1.000000000000000009', '0.500000000000000005')
    const operation = makeOperation(null)
    const { em, nativeUpdate } = makeEm([1, 1, 1, 1])

    const reserved = await reserveCaptureAmountExact(em as never, {
      transaction,
      operation,
      amount: '0.000000000000000003',
      scope,
    })

    expect(reserved).toBe('0.000000000000000003')
    expect(nativeUpdate.mock.calls[0]?.[2]).toMatchObject({ capturedAmount: '0.500000000000000008' })
    expect(operation.reservedAmount).toBe('0.000000000000000003')
    await expect(reserveCaptureAmountExact(em as never, { transaction, operation, amount: undefined, scope }))
      .resolves.toBe('0.000000000000000003')
    expect(nativeUpdate).toHaveBeenCalledTimes(2)

    transaction.capturedAmount = '0.500000000000000008'
    settleCapturedAmountExact(transaction, reserved, '0.000000000000000002')
    expect(transaction.capturedAmount).toBe('0.500000000000000007')

    transaction.capturedAmount = '0.500000000000000008'
    findOneMock.mockResolvedValue(transaction as never)
    await expect(releaseCaptureAmountExact(em as never, {
      transactionId: transaction.id,
      operation,
      reservedAmount: reserved,
      scope,
    })).resolves.toBe(true)
    expect(nativeUpdate.mock.calls[2]?.[2]).toMatchObject({ capturedAmount: '0.500000000000000005' })
    expect(nativeUpdate.mock.calls[3]?.[1]).toMatchObject({ reservedAmount: '0.000000000000000003', ...scope })
    expect(operation.reservedAmount).toBeNull()
  })

  it('captures amounts beyond four decimals without rounding', () => {
    const transaction = makeTransaction('1.000000000000000001', '0')
    const amounts = assertCaptureWithinRemainingExact(transaction, '0.000000000000000001')

    expect(amounts.requestedAmount.toFixed()).toBe('0.000000000000000001')
    expect(amounts.remainingAmount.toFixed()).toBe('1.000000000000000001')
    expect(() => assertCaptureWithinRemainingExact(transaction, '1.000000000000000002')).toThrow(/exceeds/)
  })
})

describe('releaseCaptureAmountExact', () => {
  it('gives the reserved slice back and stops the operation holding it', async () => {
    const transaction = makeTransaction('100.0000', '60.0000')
    const operation = makeOperation('60.0000')
    findOneMock.mockResolvedValue(transaction as never)
    const { em, nativeUpdate } = makeEm([1, 1])

    await expect(releaseCaptureAmountExact(em as never, {
      transactionId: transaction.id,
      operation,
      reservedAmount: '60',
      scope,
    })).resolves.toBe(true)

    expect(nativeUpdate.mock.calls[0]?.[2]).toMatchObject({ capturedAmount: '0' })
    expect(operation.reservedAmount).toBeNull()
  })

  it('reports the reservation as still held when the ledger moved underneath it', async () => {
    const operation = makeOperation('60.0000')
    findOneMock.mockResolvedValue(makeTransaction('100.0000', '60.0000') as never)
    const { em } = makeEm([0])

    await expect(releaseCaptureAmountExact(em as never, {
      transactionId: 'txn_1',
      operation,
      reservedAmount: '60',
      scope,
    })).resolves.toBe(false)

    expect(operation.reservedAmount).toBe('60.0000')
  })
})

describe('legacy bigint capture ledger bridges', () => {
  it('keeps the exported fixed-scale fields and omitted-amount semantics', () => {
    const expected: CaptureAmounts = {
      authorizedUnits: 1_000_000n,
      capturedUnits: 600_000n,
      remainingUnits: 400_000n,
      requestedUnits: 400_000n,
    }

    expect(resolveCaptureAmounts(makeTransaction('100.0000', '60.0000'), undefined)).toEqual(expected)
    expect(assertCaptureWithinRemaining(makeTransaction('100.0000', '60.0000'), 40)).toEqual(expected)
    expect(() => assertCaptureWithinRemaining(makeTransaction('100.0000', '60.0000'), 60))
      .toThrow(/exceeds the 40 still capturable/)
  })

  it('retains the four-decimal rounding of legacy amount resolution', () => {
    const amounts = resolveCaptureAmounts(makeTransaction('1.00005', '0.00004'), 0.5)

    expect(amounts.authorizedUnits).toBe(10_001n)
    expect(amounts.capturedUnits).toBe(0n)
    expect(amounts.requestedUnits).toBe(5_000n)
  })

  it('returns a bigint reservation while retaining scoped compare-and-swap writes', async () => {
    const transaction = makeTransaction('100.0000', '60.0000')
    const operation = makeOperation(null)
    const { em, nativeUpdate } = makeEm([1, 1])

    const reserved: bigint = await reserveCaptureAmount(em as never, { transaction, operation, amount: 40, scope })

    expect(reserved).toBe(400_000n)
    expect(nativeUpdate.mock.calls[0]?.[1]).toMatchObject({ capturedAmount: '60.0000', deletedAt: null, ...scope })
    expect(nativeUpdate.mock.calls[0]?.[2]).toMatchObject({ capturedAmount: '100' })
    expect(nativeUpdate.mock.calls[1]?.[1]).toMatchObject({ reservedAmount: null, ...scope })
    expect(operation.reservedAmount).toBe('40')
  })

  it('reuses a legacy reservation without reserving twice', async () => {
    const { em, nativeUpdate } = makeEm([])

    await expect(reserveCaptureAmount(em as never, {
      transaction: makeTransaction('100.0000', '60.0000'),
      operation: makeOperation('60.0000'),
      amount: 60,
      scope,
    })).resolves.toBe(600_000n)
    expect(nativeUpdate).not.toHaveBeenCalled()
  })

  it('accepts bigint units for settlement and retains fixed-scale rounding', () => {
    const transaction = makeTransaction('100.0000', '60.0000')

    settleCapturedAmount(transaction, 600_000n, 45.00004)

    expect(transaction.capturedAmount).toBe('45.0000')
    settleCapturedAmount(transaction, 450_000n, Number.NaN)
    expect(transaction.capturedAmount).toBe('45.0000')
  })

  it('accepts the reservedUnits input and clears the legacy reservation atomically', async () => {
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

    expect(nativeUpdate.mock.calls[0]?.[2]).toMatchObject({ capturedAmount: '0' })
    expect(nativeUpdate.mock.calls[1]?.[1]).toMatchObject({ reservedAmount: '60', ...scope })
    expect(operation.reservedAmount).toBeNull()
  })
})
