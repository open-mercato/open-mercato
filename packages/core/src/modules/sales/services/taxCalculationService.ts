import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  DEFAULT_AMOUNT_DECIMAL_PLACES,
  FX_DECIMAL_PLACES,
  countDecimalPlaces,
  decimalToNumber,
  decimalToString,
  divideDecimals,
  isDecimalInput,
  resolveExactDecimal,
  roundDecimal,
  toDecimal,
  type DecimalValue,
} from '@open-mercato/shared/lib/decimal'
import { SalesTaxRate } from '../data/entities'
import { reconcileHookAmount, type AmountPair } from '../lib/calculations'

export type TaxCalculationMode = 'net' | 'gross'

export type CalculateTaxInput = {
  /** Float copy of `amountExact`; prefer the exact field. */
  amount: number
  amountExact?: string | null
  /** Decimal places the derived side is rounded to (never fewer than the entered amount carries); defaults to 4. */
  amountDecimalPlaces?: number
  mode: TaxCalculationMode
  organizationId: string
  tenantId: string
  taxRateId?: string | null
  taxRate?: number | string | null
}

/** Every amount `number` is a float copy of its `<field>Exact` string - prefer the exact fields. */
export type TaxCalculationResult = {
  netAmount: number
  netAmountExact?: string
  grossAmount: number
  grossAmountExact?: string
  taxAmount: number
  taxAmountExact?: string
  taxRate: number | null
}

export interface TaxCalculationService {
  calculateUnitAmounts(input: CalculateTaxInput): Promise<TaxCalculationResult>
}

export class DefaultTaxCalculationService implements TaxCalculationService {
  constructor(private readonly em: EntityManager, private readonly eventBus?: EventBus | null) {}

  async calculateUnitAmounts(input: CalculateTaxInput): Promise<TaxCalculationResult> {
    let workingInput = { ...input }
    let resolved: TaxCalculationResult | undefined

    if (this.eventBus) {
      const inputBefore: AmountPair = { exact: workingInput.amountExact, value: workingInput.amount }
      await this.eventBus.emitEvent('sales.tax.calculate.before', {
        input: workingInput,
        setInput(next: Partial<CalculateTaxInput>) {
          if (!next) return
          workingInput = { ...workingInput, ...next }
        },
        setResult(next: TaxCalculationResult | null | undefined) {
          if (next) resolved = next
        },
      })
      workingInput = reconcileInputAmount(workingInput, inputBefore)
      if (resolved) return withExactResult(resolved)
    }

    resolved = await this.performCalculation(workingInput)

    if (this.eventBus) {
      const resultBefore = captureResultAmounts(resolved)
      await this.eventBus.emitEvent('sales.tax.calculate.after', {
        input: workingInput,
        result: resolved,
        setResult(next: TaxCalculationResult | null | undefined) {
          if (next) resolved = next
        },
      })
      return reconcileResultAmounts(resolved, resultBefore, hookDecimalPlaces(workingInput))
    }

    return withExactResult(resolved)
  }

  private async performCalculation(input: CalculateTaxInput): Promise<TaxCalculationResult> {
    const amount = this.normalizeAmount(input)
    const mode = input.mode === 'gross' ? 'gross' : input.mode === 'net' ? 'net' : null
    if (!mode) {
      throw new CrudHttpError(400, { error: 'Unsupported tax calculation mode.' })
    }
    const { rate, hasValue } = await this.resolveRate(input)
    const fraction = hasValue ? divideDecimals(rate, 100, FX_DECIMAL_PLACES) : toDecimal(0)
    const multiplier = fraction.plus(1)

    const decimalPlaces = Math.max(
      input.amountDecimalPlaces ?? DEFAULT_AMOUNT_DECIMAL_PLACES,
      enteredDecimalPlaces(input, amount),
    )
    let netAmount: DecimalValue
    let grossAmount: DecimalValue
    if (mode === 'net') {
      netAmount = amount
      grossAmount = roundDecimal(amount.times(multiplier), decimalPlaces)
    } else {
      grossAmount = amount
      netAmount = fraction.gt(0)
        ? roundDecimal(divideDecimals(amount, multiplier, FX_DECIMAL_PLACES), decimalPlaces)
        : amount
    }

    return withExactResult({
      netAmount: 0,
      netAmountExact: decimalToString(netAmount),
      grossAmount: 0,
      grossAmountExact: decimalToString(grossAmount),
      taxAmount: 0,
      taxAmountExact: decimalToString(grossAmount.minus(netAmount)),
      taxRate: hasValue ? roundRate(rate) : null,
    }, true)
  }

  private async resolveRate(input: CalculateTaxInput): Promise<{ rate: number; hasValue: boolean }> {
    if (input.taxRateId) {
      const rate = await this.em.findOne(
        SalesTaxRate,
        {
          id: input.taxRateId,
          organizationId: input.organizationId,
          tenantId: input.tenantId,
          deletedAt: null,
        },
        { fields: ['rate', 'organizationId', 'tenantId'] }
      )
      if (!rate) {
        throw new CrudHttpError(400, { error: 'Tax class not found for this organization.' })
      }
      return { rate: this.normalizeRate(rate.rate), hasValue: true }
    }
    if (input.taxRate !== undefined && input.taxRate !== null) {
      return { rate: this.normalizeRate(input.taxRate), hasValue: true }
    }
    return { rate: 0, hasValue: false }
  }

  private normalizeAmount(input: CalculateTaxInput): DecimalValue {
    const exact = resolveExactDecimal(input.amountExact, Number.isFinite(input.amount) ? input.amount : null)
    if (exact === null || toDecimal(exact).lt(0)) {
      throw new CrudHttpError(400, { error: 'Amount must be zero or greater.' })
    }
    return toDecimal(exact)
  }

  private normalizeRate(value: number | string): number {
    const numeric =
      typeof value === 'string'
        ? Number(value)
        : typeof value === 'number'
          ? value
          : Number.NaN
    if (!Number.isFinite(numeric) || numeric < 0) return 0
    return numeric
  }
}

function enteredDecimalPlaces(input: CalculateTaxInput, amount: DecimalValue): number {
  const exact = input.amountExact
  if (typeof exact !== 'string' || !isDecimalInput(exact) || !toDecimal(exact).eq(amount)) return 0
  return countDecimalPlaces(amount)
}

function roundRate(value: number, precision = 4): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

const RESULT_AMOUNT_FIELDS = ['netAmount', 'grossAmount', 'taxAmount'] as const

type ResultAmountField = (typeof RESULT_AMOUNT_FIELDS)[number]

function hookDecimalPlaces(input: CalculateTaxInput): number {
  return input.amountDecimalPlaces ?? DEFAULT_AMOUNT_DECIMAL_PLACES
}

/**
 * Applies a `sales.tax.calculate.before` change to the amount: a changed
 * `amountExact` wins, a changed `amount` alone replaces the exact value, rounded
 * to the amount precision. An untouched input is returned as is.
 */
function reconcileInputAmount(input: CalculateTaxInput, before: AmountPair): CalculateTaxInput {
  if (input.amountExact === before.exact && input.amount === before.value) return input
  const amount = reconcileHookAmount(before, input.amountExact, input.amount, hookDecimalPlaces(input))
  if (amount === null) return input
  return { ...input, amount: decimalToNumber(amount), amountExact: decimalToString(amount) }
}

function captureResultAmounts(result: TaxCalculationResult): Record<ResultAmountField, AmountPair> {
  return {
    netAmount: { exact: result.netAmountExact, value: result.netAmount },
    grossAmount: { exact: result.grossAmountExact, value: result.grossAmount },
    taxAmount: { exact: result.taxAmountExact, value: result.taxAmount },
  }
}

/**
 * Applies a `sales.tax.calculate.after` change to each amount: a changed
 * `<field>Exact` wins and refreshes its float, a changed float alone replaces
 * the exact value, rounded to `decimalPlaces`.
 */
function reconcileResultAmounts(
  result: TaxCalculationResult,
  before: Record<ResultAmountField, AmountPair>,
  decimalPlaces: number,
): TaxCalculationResult {
  const next = { ...result }
  for (const field of RESULT_AMOUNT_FIELDS) {
    const amount = reconcileHookAmount(before[field], result[`${field}Exact`], result[field], decimalPlaces)
    if (amount === null) continue
    next[field] = decimalToNumber(amount)
    next[`${field}Exact`] = decimalToString(amount)
  }
  return next
}

/**
 * Fills the float and exact amount fields from each other. `fromExact` trusts
 * the exact strings (own calculation); otherwise a result handed over by a hook
 * keeps its floats and only gains matching exact strings.
 */
function withExactResult(result: TaxCalculationResult, fromExact = false): TaxCalculationResult {
  const next = { ...result }
  for (const field of RESULT_AMOUNT_FIELDS) {
    const exact = fromExact
      ? (result[`${field}Exact`] ?? null)
      : resolveExactDecimal(result[`${field}Exact`], result[field])
    if (exact === null) continue
    next[field] = decimalToNumber(exact)
    next[`${field}Exact`] = exact
  }
  return next
}
