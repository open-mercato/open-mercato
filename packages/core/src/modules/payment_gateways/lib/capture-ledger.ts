import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { UnifiedPaymentStatus } from '@open-mercato/shared/modules/payment_gateways/types'
import { decimalToString, parseDecimal, toDecimal, type DecimalValue } from '@open-mercato/shared/lib/decimal'
import { GatewayPaymentOperation, GatewayTransaction } from '../data/entities'

type Scope = { organizationId: string; tenantId: string }

const AMOUNT_SCALE = 4
const AMOUNT_UNITS_PER_WHOLE = 10n ** BigInt(AMOUNT_SCALE)
const DECIMAL_PATTERN = /^(-?)(\d*)(?:\.(\d*))?$/

/**
 * Integer minor units at a fixed 4-decimal scale.
 * @deprecated The ledger now uses exact decimals (`@open-mercato/shared/lib/decimal`); amounts
 * are no longer limited to 4 decimals. Removal no earlier than 0.11.0.
 */
export function parseAmountUnits(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined) return 0n
  const text = typeof value === 'number' ? value.toFixed(AMOUNT_SCALE) : value.trim()
  const match = DECIMAL_PATTERN.exec(text)
  const whole = match?.[2] ?? ''
  const fraction = match?.[3] ?? ''
  if (!match || (whole === '' && fraction === '')) {
    throw new Error(`[internal] Unsupported gateway amount value: ${String(value)}`)
  }
  const keptFraction = fraction.slice(0, AMOUNT_SCALE).padEnd(AMOUNT_SCALE, '0')
  const nextDigit = fraction.charAt(AMOUNT_SCALE)
  let units = BigInt(whole === '' ? '0' : whole) * AMOUNT_UNITS_PER_WHOLE + BigInt(keptFraction)
  if (nextDigit !== '' && Number(nextDigit) >= 5) units += 1n
  return match[1] === '-' ? -units : units
}

/** @deprecated Use decimalToString for exact amounts. Removal no earlier than 0.11.0. */
export function formatAmountUnits(units: bigint): string {
  const negative = units < 0n
  const absolute = negative ? -units : units
  const fraction = (absolute % AMOUNT_UNITS_PER_WHOLE).toString().padStart(AMOUNT_SCALE, '0')
  return `${negative ? '-' : ''}${absolute / AMOUNT_UNITS_PER_WHOLE}.${fraction}`
}

function formatAmountUnitsLabel(units: bigint): string {
  return formatAmountUnits(units).replace(/\.?0+$/, '')
}

function formatAmountLabel(amount: DecimalValue): string {
  return decimalToString(amount)
}

function toLedgerAmount(value: string | number | null | undefined): DecimalValue {
  if (value === null || value === undefined) return toDecimal(0)
  const parsed = parseDecimal(value)
  if (!parsed) throw new Error(`[internal] Unsupported gateway amount value: ${String(value)}`)
  return parsed
}

function nonNegative(value: DecimalValue): DecimalValue {
  return value.lt(0) ? toDecimal(0) : value
}

function captureConflict(code: string, message: string): CrudHttpError {
  return new CrudHttpError(409, { error: message, code })
}

/** @deprecated Use ExactCaptureAmounts. Removal no earlier than 0.11.0. */
export type CaptureAmounts = {
  authorizedUnits: bigint
  capturedUnits: bigint
  remainingUnits: bigint
  requestedUnits: bigint
}

/** @deprecated Use resolveCaptureAmountsExact. Removal no earlier than 0.11.0. */
export function resolveCaptureAmounts(transaction: GatewayTransaction, amount: number | undefined): CaptureAmounts {
  const authorizedUnits = parseAmountUnits(transaction.amount)
  const capturedUnits = parseAmountUnits(transaction.capturedAmount)
  const remainingUnits = authorizedUnits - capturedUnits
  return {
    authorizedUnits,
    capturedUnits,
    remainingUnits,
    requestedUnits: amount === undefined ? remainingUnits : parseAmountUnits(amount),
  }
}

/** @deprecated Use assertCaptureWithinRemainingExact. Removal no earlier than 0.11.0. */
export function assertCaptureWithinRemaining(
  transaction: GatewayTransaction,
  amount: number | undefined,
): CaptureAmounts {
  const amounts = resolveCaptureAmounts(transaction, amount)
  if (amounts.remainingUnits <= 0n) {
    throw captureConflict(
      'payment_capture_ceiling_exceeded',
      `Transaction is already fully captured (${formatAmountUnitsLabel(amounts.capturedUnits)} of ${formatAmountUnitsLabel(amounts.authorizedUnits)})`,
    )
  }
  if (amounts.requestedUnits <= 0n) {
    throw captureConflict('payment_capture_amount_invalid', 'Capture amount must be greater than zero')
  }
  if (amounts.requestedUnits > amounts.remainingUnits) {
    throw captureConflict(
      'payment_capture_ceiling_exceeded',
      `Capture amount ${formatAmountUnitsLabel(amounts.requestedUnits)} exceeds the ${formatAmountUnitsLabel(amounts.remainingUnits)} still capturable on authorized amount ${formatAmountUnitsLabel(amounts.authorizedUnits)} (already captured ${formatAmountUnitsLabel(amounts.capturedUnits)})`,
    )
  }
  return amounts
}

/** @deprecated Use reserveCaptureAmountExact. Removal no earlier than 0.11.0. */
export async function reserveCaptureAmount(em: EntityManager, input: {
  transaction: GatewayTransaction
  operation: GatewayPaymentOperation
  amount: number | undefined
  scope: Scope
}): Promise<bigint> {
  if (input.operation.reservedAmount !== null && input.operation.reservedAmount !== undefined) {
    return parseAmountUnits(input.operation.reservedAmount)
  }
  const amounts = assertCaptureWithinRemaining(input.transaction, input.amount)
  const reservedAmount = await reserveCaptureAmountExact(em, {
    ...input,
    amount: formatAmountUnits(amounts.requestedUnits),
  })
  return parseAmountUnits(reservedAmount)
}

/** @deprecated Use settleCapturedAmountExact. Removal no earlier than 0.11.0. */
export function settleCapturedAmount(
  transaction: GatewayTransaction,
  reservedUnits: bigint,
  capturedAmount: number | undefined,
): void {
  const actualUnits = typeof capturedAmount === 'number' && Number.isFinite(capturedAmount) && capturedAmount >= 0
    ? parseAmountUnits(capturedAmount)
    : reservedUnits
  if (actualUnits === reservedUnits) return
  const settledUnits = parseAmountUnits(transaction.capturedAmount) - reservedUnits + actualUnits
  transaction.capturedAmount = formatAmountUnits(settledUnits < 0n ? 0n : settledUnits)
}

/** @deprecated Use releaseCaptureAmountExact. Removal no earlier than 0.11.0. */
export async function releaseCaptureAmount(em: EntityManager, input: {
  transactionId: string
  operation: GatewayPaymentOperation
  reservedUnits: bigint
  scope: Scope
}): Promise<boolean> {
  return releaseCaptureAmountExact(em, {
    transactionId: input.transactionId,
    operation: input.operation,
    reservedAmount: formatAmountUnits(input.reservedUnits),
    scope: input.scope,
  })
}

/** Exact decimal amounts of a capture request against its authorization. */
export type ExactCaptureAmounts = {
  authorizedAmount: DecimalValue
  capturedAmount: DecimalValue
  remainingAmount: DecimalValue
  requestedAmount: DecimalValue
}

/**
 * Resolves what a capture request means for the transaction's running total. An omitted
 * amount captures everything that is still authorized, not the original full amount.
 */
export function resolveCaptureAmountsExact(
  transaction: GatewayTransaction,
  amount: number | string | undefined,
): ExactCaptureAmounts {
  const authorizedAmount = toLedgerAmount(transaction.amount)
  const capturedAmount = toLedgerAmount(transaction.capturedAmount)
  const remainingAmount = authorizedAmount.minus(capturedAmount)
  return {
    authorizedAmount,
    capturedAmount,
    remainingAmount,
    requestedAmount: amount === undefined ? remainingAmount : toLedgerAmount(amount),
  }
}

/**
 * Rejects a capture whose amount would push the captured-to-date total past the authorized
 * amount. This is the cumulative ceiling: each individual request may look small, but the
 * sum of all captures against one authorization can never exceed it (#4487).
 */
export function assertCaptureWithinRemainingExact(
  transaction: GatewayTransaction,
  amount: number | string | undefined,
): ExactCaptureAmounts {
  const amounts = resolveCaptureAmountsExact(transaction, amount)
  if (amounts.remainingAmount.lte(0)) {
    throw captureConflict(
      'payment_capture_ceiling_exceeded',
      `Transaction is already fully captured (${formatAmountLabel(amounts.capturedAmount)} of ${formatAmountLabel(amounts.authorizedAmount)})`,
    )
  }
  if (amounts.requestedAmount.lte(0)) {
    throw captureConflict('payment_capture_amount_invalid', 'Capture amount must be greater than zero')
  }
  if (amounts.requestedAmount.gt(amounts.remainingAmount)) {
    throw captureConflict(
      'payment_capture_ceiling_exceeded',
      `Capture amount ${formatAmountLabel(amounts.requestedAmount)} exceeds the ${formatAmountLabel(amounts.remainingAmount)} still capturable on authorized amount ${formatAmountLabel(amounts.authorizedAmount)} (already captured ${formatAmountLabel(amounts.capturedAmount)})`,
    )
  }
  return amounts
}

/**
 * Claims the requested slice of the authorized amount before the provider is called, so two
 * concurrent captures can never both charge. The increment is a compare-and-swap on the
 * previous captured-to-date value: whoever loses it never reaches the adapter. The reserved
 * amount is stamped on the operation row in the same transaction, so a retry of the same
 * operation id reuses its reservation instead of reserving twice. Returns the reserved amount
 * as an exact decimal string.
 */
export async function reserveCaptureAmountExact(em: EntityManager, input: {
  transaction: GatewayTransaction
  operation: GatewayPaymentOperation
  amount: number | string | undefined
  scope: Scope
}): Promise<string> {
  if (input.operation.reservedAmount !== null && input.operation.reservedAmount !== undefined) {
    return decimalToString(toLedgerAmount(input.operation.reservedAmount))
  }
  const amounts = assertCaptureWithinRemainingExact(input.transaction, input.amount)
  const previousCapturedAmount = input.transaction.capturedAmount
  const reservedAmount = decimalToString(amounts.requestedAmount)
  const nextCapturedAmount = decimalToString(amounts.capturedAmount.plus(amounts.requestedAmount))

  await em.transactional(async (tx) => {
    const reserved = await tx.nativeUpdate(
      GatewayTransaction,
      {
        id: input.transaction.id,
        organizationId: input.scope.organizationId,
        tenantId: input.scope.tenantId,
        deletedAt: null,
        capturedAmount: previousCapturedAmount,
      },
      { capturedAmount: nextCapturedAmount, updatedAt: new Date() },
    )
    if (reserved !== 1) {
      throw captureConflict(
        'payment_capture_reservation_conflict',
        'This transaction changed while the capture amount was being reserved; re-read it and retry with the remaining amount',
      )
    }
    const stamped = await tx.nativeUpdate(
      GatewayPaymentOperation,
      {
        id: input.operation.id,
        organizationId: input.scope.organizationId,
        tenantId: input.scope.tenantId,
        reservedAmount: null,
      },
      { reservedAmount, updatedAt: new Date() },
    )
    if (stamped !== 1) {
      throw captureConflict(
        'payment_capture_reservation_conflict',
        'Capture reservation could not be recorded for this operation',
      )
    }
  })

  Object.assign(input.operation, { reservedAmount })
  return reservedAmount
}

/**
 * Reconciles the reservation with what the provider actually captured. Runs on the transaction
 * instance loaded inside the completion transaction, so the adjustment commits together with
 * the operation result.
 */
export function settleCapturedAmountExact(
  transaction: GatewayTransaction,
  reservedAmount: string,
  capturedAmount: number | string | undefined,
): void {
  const reserved = toLedgerAmount(reservedAmount)
  const reported = capturedAmount === undefined ? null : parseDecimal(capturedAmount)
  const actual = reported && reported.gte(0) ? reported : reserved
  if (actual.eq(reserved)) return
  const settled = toLedgerAmount(transaction.capturedAmount).minus(reserved).plus(actual)
  transaction.capturedAmount = decimalToString(nonNegative(settled))
}

/**
 * Keeps the ledger honest for captures that happened outside the capture endpoint. A webhook or a
 * status poll reports money that already moved but carries no captured amount, so only `captured`
 * — the provider saying the whole authorization was taken — can be translated into a number: the
 * full amount. The ledger is raised, never lowered, so an already recorded capture survives.
 * `partially_captured` carries no recoverable amount, so it is left alone and the remainder stays
 * capturable.
 */
export function alignCapturedAmountWithStatus(
  transaction: GatewayTransaction,
  status: UnifiedPaymentStatus,
): void {
  if (status !== 'captured') return
  const authorized = toLedgerAmount(transaction.amount)
  if (toLedgerAmount(transaction.capturedAmount).gte(authorized)) return
  transaction.capturedAmount = decimalToString(authorized)
}

/**
 * Gives the reserved slice back after a failed provider call. Both writes share one
 * transaction, so a partial release is impossible: either the amount becomes capturable again
 * and the operation stops holding it, or the reservation stays outstanding. Returning `false`
 * means the reservation is still held — the conservative outcome when it is unknown whether
 * the provider took the money.
 */
export async function releaseCaptureAmountExact(em: EntityManager, input: {
  transactionId: string
  operation: GatewayPaymentOperation
  reservedAmount: string
  scope: Scope
}): Promise<boolean> {
  const reservedAmount = decimalToString(toLedgerAmount(input.reservedAmount))
  try {
    return await em.transactional(async (tx) => {
      const current = await findOneWithDecryption(
        tx,
        GatewayTransaction,
        {
          id: input.transactionId,
          organizationId: input.scope.organizationId,
          tenantId: input.scope.tenantId,
        },
        undefined,
        input.scope,
      )
      if (!current) return false
      const released = toLedgerAmount(current.capturedAmount).minus(reservedAmount)
      const updated = await tx.nativeUpdate(
        GatewayTransaction,
        {
          id: input.transactionId,
          organizationId: input.scope.organizationId,
          tenantId: input.scope.tenantId,
          capturedAmount: current.capturedAmount,
        },
        { capturedAmount: decimalToString(nonNegative(released)), updatedAt: new Date() },
      )
      if (updated !== 1) return false
      const cleared = await tx.nativeUpdate(
        GatewayPaymentOperation,
        {
          id: input.operation.id,
          organizationId: input.scope.organizationId,
          tenantId: input.scope.tenantId,
          reservedAmount,
        },
        { reservedAmount: null, updatedAt: new Date() },
      )
      if (cleared !== 1) {
        throw captureConflict(
          'payment_capture_reservation_conflict',
          'Capture reservation could not be released for this operation',
        )
      }
      Object.assign(input.operation, { reservedAmount: null })
      return true
    })
  } catch {
    return false
  }
}
