import type { AbstractLineResolution, AbstractStatus } from '../data/entities'
import { amountToString, computeLineEnvelope, halalasToAmountString, toAmountNumber, toHalalas } from './money'

/**
 * The trip-abstract lifecycle as a pure state machine.
 *
 * An abstract is generated from executed trips, submitted to the customer, and
 * only becomes invoiceable once one of the three approval routes concludes:
 * the customer accepts it (portal), staff records the acceptance it received
 * offline, or the contract waived the customer gate and staff finalize it
 * internally. Disputes are per line, so a disputed abstract settles only when
 * every disputed line carries a resolution — the command layer raises the
 * errors, this module decides what the states allow and what the amounts become.
 */

export type AbstractAction =
  | 'submit'
  | 'respond'
  | 'resolve'
  | 'finalize'
  | 'record_offline_approval'
  | 'invoice'
  | 'cancel'

export const ABSTRACT_ACTION_SOURCE_STATUSES: Record<AbstractAction, readonly AbstractStatus[]> = {
  submit: ['draft'],
  respond: ['submitted'],
  resolve: ['disputed'],
  finalize: ['draft'],
  record_offline_approval: ['submitted'],
  invoice: ['approved'],
  cancel: ['draft', 'submitted', 'disputed', 'approved'],
}

export function isAbstractActionAllowed(status: AbstractStatus, action: AbstractAction): boolean {
  return ABSTRACT_ACTION_SOURCE_STATUSES[action].includes(status)
}

export type AbstractLineTotalsInput = {
  isBillable: boolean
  totalNetAmount: string
  taxAmount: string
  totalGrossAmount: string
}

export type AbstractTotals = {
  tripCount: number
  subtotalNetAmount: string
  taxTotalAmount: string
  grandTotalGrossAmount: string
}

/**
 * Totals are summed in integer halalas so a hundred-line abstract cannot drift
 * a halala away from the sum of its lines. Lines a resolution removed from
 * billing are skipped — they stay on the abstract as the audit trail of what was
 * disputed and why.
 */
export function sumBillableLines(lines: readonly AbstractLineTotalsInput[]): AbstractTotals {
  let netHalalas = 0
  let taxHalalas = 0
  let grossHalalas = 0
  let tripCount = 0
  for (const line of lines) {
    if (!line.isBillable) continue
    netHalalas += toHalalas(toAmountNumber(line.totalNetAmount))
    taxHalalas += toHalalas(toAmountNumber(line.taxAmount))
    grossHalalas += toHalalas(toAmountNumber(line.totalGrossAmount))
    tripCount += 1
  }
  return {
    tripCount,
    subtotalNetAmount: halalasToAmountString(netHalalas),
    taxTotalAmount: halalasToAmountString(taxHalalas),
    grandTotalGrossAmount: halalasToAmountString(grossHalalas),
  }
}

export type AbstractLineResolutionInput = {
  resolution: AbstractLineResolution
  isBillable: boolean
  totalNetAmount: string
  taxAmount: string
  totalGrossAmount: string
  taxRate: string
  adjustedAmountNet?: string | number | null
}

export type AbstractLineResolutionOutcome = {
  isBillable: boolean
  totalNetAmount: string
  taxAmount: string
  totalGrossAmount: string
  adjustedAmountNet: string | null
}

/**
 * What a resolution does to the line's money.
 *
 * `accepted_as_disputed` and `removed` both stop the line from being billed —
 * the first because the customer was right, the second because the carrier
 * withdrew it — so the trip is released for a later abstract; the line keeps its
 * amounts as the record of what was claimed. `rejected_dispute` leaves the line
 * exactly as billed, and `adjusted` replaces the net at the line's own VAT rate
 * so the tax follows the agreed amount instead of the disputed one.
 */
export function resolveLineAmounts(input: AbstractLineResolutionInput): AbstractLineResolutionOutcome {
  if (input.resolution === 'accepted_as_disputed' || input.resolution === 'removed') {
    return {
      isBillable: false,
      totalNetAmount: input.totalNetAmount,
      taxAmount: input.taxAmount,
      totalGrossAmount: input.totalGrossAmount,
      adjustedAmountNet: null,
    }
  }
  if (input.resolution === 'adjusted') {
    const adjusted = toAmountNumber(input.adjustedAmountNet)
    const envelope = computeLineEnvelope(adjusted, input.taxRate)
    return {
      isBillable: true,
      totalNetAmount: amountToString(envelope.net),
      taxAmount: amountToString(envelope.tax),
      totalGrossAmount: amountToString(envelope.gross),
      adjustedAmountNet: amountToString(adjusted),
    }
  }
  return {
    isBillable: input.isBillable,
    totalNetAmount: input.totalNetAmount,
    taxAmount: input.taxAmount,
    totalGrossAmount: input.totalGrossAmount,
    adjustedAmountNet: null,
  }
}

export function hasOpenDisputes(lines: readonly { disputeStatus: string }[]): boolean {
  return lines.some((line) => line.disputeStatus === 'disputed')
}
