import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SalesTaxRate } from '../data/entities'

export type TaxCalculationMode = 'net' | 'gross'

export type CalculateTaxInput = {
  amount: number
  mode: TaxCalculationMode
  organizationId: string
  tenantId: string
  taxRateId?: string | null
  taxRate?: number | string | null
}

export type TaxCalculationResult = {
  netAmount: number
  grossAmount: number
  taxAmount: number
  taxRate: number | null
}

export interface TaxCalculationService {
  calculateUnitAmounts(input: CalculateTaxInput): Promise<TaxCalculationResult>
}

export class DefaultTaxCalculationService implements TaxCalculationService {
  constructor(private readonly em: EntityManager) {}

  async calculateUnitAmounts(input: CalculateTaxInput): Promise<TaxCalculationResult> {
    const amount = this.normalizeAmount(input.amount)
    const mode = input.mode === 'gross' ? 'gross' : input.mode === 'net' ? 'net' : null
    if (!mode) {
      throw new CrudHttpError(400, { error: 'Unsupported tax calculation mode.' })
    }
    const { rate, hasValue } = await this.resolveRate(input)
    const fraction = hasValue ? rate / 100 : 0

    let netAmount: number
    let grossAmount: number
    if (mode === 'net') {
      netAmount = amount
      grossAmount = amount * (1 + fraction)
    } else {
      grossAmount = amount
      netAmount = fraction > 0 ? amount / (1 + fraction) : amount
    }
    const taxAmount = grossAmount - netAmount

    return {
      netAmount: roundAmount(netAmount),
      grossAmount: roundAmount(grossAmount),
      taxAmount: roundAmount(taxAmount),
      taxRate: hasValue ? roundRate(rate) : null,
    }
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

  private normalizeAmount(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new CrudHttpError(400, { error: 'Amount must be zero or greater.' })
    }
    return value
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

function roundAmount(value: number, precision = 4): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function roundRate(value: number, precision = 4): number {
  return roundAmount(value, precision)
}
