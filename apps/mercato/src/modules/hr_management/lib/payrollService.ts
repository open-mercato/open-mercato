import {
  divideDecimalByInteger,
  isZeroDecimal,
  multiplyDecimalStrings,
  roundDecimalHalfUp,
  subtractDecimalStrings,
  sumDecimalStrings,
} from '../../financial/lib/money'

/**
 * Payroll arithmetic, pure and independent of the ORM.
 *
 * Money is decimal strings all the way through, for the same reason the ledger
 * uses them: a payslip is an auditable document and a binary float that rounds a
 * halala the wrong way is a payroll dispute. Deductions are capped only by a
 * configurable share of gross; a share of 0 disables the cap until local counsel
 * confirms the legally correct value.
 */

export type PayrollCompensation = {
  basicSalary: string
  housingAllowance: string
  transportAllowance: string
  otherAllowance: string
}

export type PayrollAdjustment = {
  id: string
  label: string
  amount: string
}

export type PayrollInput = {
  compensation: PayrollCompensation
  unpaidLeaveDays: number
  absenceDays: number
  overtimeAmount: string
  incentives: PayrollAdjustment[]
  penalties: PayrollAdjustment[]
  loanInstalments: PayrollAdjustment[]
  /** Share of gross that all deductions may consume. 0 disables the cap. */
  deductionCeilingShare?: number
}

export type PayrollLineDraft = {
  kind: 'earning' | 'deduction'
  code: 'basic' | 'allowance' | 'overtime' | 'incentive' | 'loan_instalment' | 'penalty' | 'unpaid_leave' | 'absence' | 'manual'
  label: string
  amount: string
  sourceEntityType?: string | null
  sourceEntityId?: string | null
}

export type PayrollComputation = {
  grossAmount: string
  deductionAmount: string
  netAmount: string
  lines: PayrollLineDraft[]
}

const ZERO = '0.00'

function money(value: string | number): string {
  return roundDecimalHalfUp(value, 2)
}

function positiveDays(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function computePayroll(input: PayrollInput): PayrollComputation {
  const compensation = input.compensation
  const contractTotal = money(sumDecimalStrings([
    compensation.basicSalary,
    compensation.housingAllowance,
    compensation.transportAllowance,
    compensation.otherAllowance,
  ]))
  const dailyRate = divideDecimalByInteger(contractTotal, 30, 6)

  const earnings: PayrollLineDraft[] = [
    { kind: 'earning', code: 'basic', label: 'Basic salary', amount: money(compensation.basicSalary) },
  ]
  if (!isZeroDecimal(compensation.housingAllowance)) {
    earnings.push({ kind: 'earning', code: 'allowance', label: 'Housing allowance', amount: money(compensation.housingAllowance) })
  }
  if (!isZeroDecimal(compensation.transportAllowance)) {
    earnings.push({ kind: 'earning', code: 'allowance', label: 'Transport allowance', amount: money(compensation.transportAllowance) })
  }
  if (!isZeroDecimal(compensation.otherAllowance)) {
    earnings.push({ kind: 'earning', code: 'allowance', label: 'Other allowance', amount: money(compensation.otherAllowance) })
  }
  if (!isZeroDecimal(input.overtimeAmount)) {
    earnings.push({ kind: 'earning', code: 'overtime', label: 'Overtime', amount: money(input.overtimeAmount) })
  }
  for (const incentive of input.incentives) {
    earnings.push({
      kind: 'earning',
      code: 'incentive',
      label: incentive.label,
      amount: money(incentive.amount),
      sourceEntityType: 'hr_employee_incentive',
      sourceEntityId: incentive.id,
    })
  }

  const deductions: PayrollLineDraft[] = []
  const unpaidDays = positiveDays(input.unpaidLeaveDays)
  const absenceDays = positiveDays(input.absenceDays)
  if (unpaidDays > 0) {
    deductions.push({
      kind: 'deduction',
      code: 'unpaid_leave',
      label: `Unpaid leave (${unpaidDays} days)`,
      amount: money(multiplyDecimalStrings(dailyRate, String(unpaidDays))),
    })
  }
  if (absenceDays > 0) {
    deductions.push({
      kind: 'deduction',
      code: 'absence',
      label: `Absence (${absenceDays} days)`,
      amount: money(multiplyDecimalStrings(dailyRate, String(absenceDays))),
    })
  }
  for (const penalty of input.penalties) {
    deductions.push({
      kind: 'deduction',
      code: 'penalty',
      label: penalty.label,
      amount: money(penalty.amount),
      sourceEntityType: 'hr_employee_penalty',
      sourceEntityId: penalty.id,
    })
  }
  for (const instalment of input.loanInstalments) {
    deductions.push({
      kind: 'deduction',
      code: 'loan_instalment',
      label: instalment.label,
      amount: money(instalment.amount),
      sourceEntityType: 'hr_loan_instalment',
      sourceEntityId: instalment.id,
    })
  }

  const grossAmount = money(sumDecimalStrings(earnings.map((line) => line.amount)))
  const capped = applyDeductionCeiling(deductions, grossAmount, input.deductionCeilingShare ?? 0)
  let deductionAmount = money(sumDecimalStrings(capped.map((line) => line.amount)))
  let netAmount = money(subtractDecimalStrings(grossAmount, deductionAmount))
  if (netAmount.startsWith('-')) {
    deductionAmount = grossAmount
    netAmount = ZERO
  }

  return {
    grossAmount,
    deductionAmount,
    netAmount,
    lines: [...earnings, ...capped],
  }
}

function applyDeductionCeiling(
  deductions: PayrollLineDraft[],
  grossAmount: string,
  ceilingShare: number,
): PayrollLineDraft[] {
  if (!(ceilingShare > 0) || !(ceilingShare < 1)) return deductions
  const ceiling = money(multiplyDecimalStrings(grossAmount, String(ceilingShare)))
  const fixed = deductions.filter((line) => line.code === 'unpaid_leave' || line.code === 'absence')
  const discretionary = deductions.filter((line) => line.code === 'penalty' || line.code === 'loan_instalment')
  const fixedTotal = money(sumDecimalStrings(fixed.map((line) => line.amount)))
  let budget = subtractDecimalStrings(ceiling, fixedTotal, 6)
  if (budget.startsWith('-')) budget = ZERO
  const reduced: PayrollLineDraft[] = []
  for (const line of discretionary) {
    const amount = money(line.amount)
    if (Number(amount) <= 0) continue
    if (Number(budget) <= 0) continue
    const take = Number(amount) <= Number(budget) ? amount : money(budget)
    reduced.push({ ...line, amount: take })
    budget = money(subtractDecimalStrings(budget, take))
  }
  return [...fixed, ...reduced]
}

export type GosiInput = {
  basicSalary: string
  housingAllowance: string
  employeeRate: number
  employerRate: number
  /** Contribution base cap; 0 or undefined means no cap. */
  baseCap?: number
}

export type GosiComputation = {
  base: string
  employeeContribution: string
  employerContribution: string
  total: string
}

export function computeGosi(input: GosiInput): GosiComputation {
  const rawBase = money(sumDecimalStrings([input.basicSalary, input.housingAllowance]))
  const base = input.baseCap && input.baseCap > 0 && Number(rawBase) > input.baseCap
    ? money(input.baseCap)
    : rawBase
  const employeeContribution = money(multiplyDecimalStrings(base, String(input.employeeRate)))
  const employerContribution = money(multiplyDecimalStrings(base, String(input.employerRate)))
  return {
    base,
    employeeContribution,
    employerContribution,
    total: money(sumDecimalStrings([employeeContribution, employerContribution])),
  }
}

export type EosbReason = 'resignation' | 'termination' | 'contract_end'

export type EosbInput = {
  lastWage: string
  yearsOfService: number
  reason: EosbReason
  firstFiveFactor?: number
  afterFiveFactor?: number
}

export type EosbComputation = {
  serviceYears: number
  grossEntitlement: string
  entitlement: string
  reasonFactor: number
}

/**
 * End-of-service award. The statutory shape is half a month per year for the
 * first five years and one month per year after that; a resignation scales the
 * award by service length. The factors are parameters so a tenant's confirmed
 * policy can replace the defaults without a code change.
 */
export function computeEosb(input: EosbInput): EosbComputation {
  const years = Number.isFinite(input.yearsOfService) && input.yearsOfService > 0 ? input.yearsOfService : 0
  const firstFiveFactor = input.firstFiveFactor ?? 0.5
  const afterFiveFactor = input.afterFiveFactor ?? 1
  const firstYears = Math.min(years, 5)
  const remainingYears = Math.max(years - 5, 0)
  const wageMonths = firstYears * firstFiveFactor + remainingYears * afterFiveFactor
  const grossEntitlement = money(multiplyDecimalStrings(input.lastWage, String(wageMonths)))
  const reasonFactor = input.reason === 'resignation'
    ? years < 2 ? 0 : years < 5 ? 1 / 3 : years < 10 ? 2 / 3 : 1
    : 1
  let entitlement = grossEntitlement
  if (input.reason === 'resignation') {
    if (years < 2) entitlement = '0.00'
    else if (years < 5) entitlement = money(divideDecimalByInteger(grossEntitlement, 3))
    else if (years < 10) {
      entitlement = money(multiplyDecimalStrings(divideDecimalByInteger(grossEntitlement, 3), '2'))
    }
  }
  return {
    serviceYears: years,
    grossEntitlement,
    entitlement,
    reasonFactor,
  }
}

export type WpsRow = {
  employeeNumber: string
  name: string
  iban: string
  basicSalary: string
  allowances: string
  deductions: string
  netAmount: string
}

/**
 * A deterministic WPS-style SIF for inspection and bank negotiation.
 *
 * The concrete column order varies by bank; this exporter keeps the header,
 * detail and trailer records explicit and the amounts unformatted so a bank
 * adapter can remap them. Nothing here claims a bank will accept the file until
 * its format is validated.
 */
export function buildWpsSif(rows: readonly WpsRow[], options?: { fileDate?: string; employerBankCode?: string }): string {
  const fileDate = options?.fileDate ?? new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const bankCode = options?.employerBankCode ?? ''
  const totalNet = money(sumDecimalStrings(rows.map((row) => row.netAmount)))
  const lines = [
    `H,${fileDate},${bankCode},${rows.length},${totalNet}`,
    ...rows.map((row) => [
      'D',
      row.employeeNumber,
      row.name.replace(/,/g, ' '),
      row.iban,
      money(row.basicSalary),
      money(row.allowances),
      money(row.deductions),
      money(row.netAmount),
    ].join(',')),
    `T,${rows.length},${totalNet}`,
  ]
  return `${lines.join('\n')}\n`
}
