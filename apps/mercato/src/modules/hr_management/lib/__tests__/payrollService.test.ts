/** @jest-environment node */
/**
 * Pins payroll arithmetic: earnings, leave/absence deductions, the deduction
 * ceiling, GOSI, end-of-service and the SIF shape.
 *
 * A payslip is an auditable document; these assertions are the worked examples
 * an accountant would check by hand, so a drift is visible before a run closes.
 */
import {
  buildWpsSif,
  computeEosb,
  computeGosi,
  computePayroll,
} from '../payrollService'

const compensation = {
  basicSalary: '3000.00',
  housingAllowance: '0',
  transportAllowance: '0',
  otherAllowance: '0',
}

describe('payroll computation', () => {
  it('adds allowances and deducts unpaid leave at one-thirtieth of contract pay', () => {
    const result = computePayroll({
      compensation: { basicSalary: '3000.00', housingAllowance: '500.00', transportAllowance: '200.00', otherAllowance: '0' },
      unpaidLeaveDays: 2,
      absenceDays: 0,
      overtimeAmount: '0',
      incentives: [],
      penalties: [],
      loanInstalments: [],
    })
    expect(result.grossAmount).toBe('3700.00')
    const leaveLine = result.lines.find((line) => line.code === 'unpaid_leave')
    expect(leaveLine?.amount).toBe('246.67')
    expect(result.netAmount).toBe('3453.33')
  })

  it('adds incentives and deducts penalties and loan instalments', () => {
    const result = computePayroll({
      compensation,
      unpaidLeaveDays: 0,
      absenceDays: 1,
      overtimeAmount: '100.00',
      incentives: [{ id: 'inc-1', label: 'Bonus', amount: '500.00' }],
      penalties: [{ id: 'pen-1', label: 'Late', amount: '50.00' }],
      loanInstalments: [{ id: 'inst-1', label: 'Loan', amount: '200.00' }],
    })
    expect(result.grossAmount).toBe('3600.00')
    expect(result.deductionAmount).toBe('350.00')
    expect(result.netAmount).toBe('3250.00')
    const incentive = result.lines.find((line) => line.code === 'incentive')
    expect(incentive).toMatchObject({ sourceEntityType: 'hr_employee_incentive', sourceEntityId: 'inc-1' })
    const loan = result.lines.find((line) => line.code === 'loan_instalment')
    expect(loan).toMatchObject({ sourceEntityType: 'hr_loan_instalment', sourceEntityId: 'inst-1' })
  })

  it('caps discretionary deductions at the configured share of gross', () => {
    const result = computePayroll({
      compensation: { basicSalary: '1000.00', housingAllowance: '0', transportAllowance: '0', otherAllowance: '0' },
      unpaidLeaveDays: 0,
      absenceDays: 0,
      overtimeAmount: '0',
      incentives: [],
      penalties: [{ id: 'pen-1', label: 'Penalty', amount: '150.00' }],
      loanInstalments: [],
      deductionCeilingShare: 0.1,
    })
    expect(result.deductionAmount).toBe('100.00')
    expect(result.netAmount).toBe('900.00')
    expect(result.lines.find((line) => line.code === 'penalty')?.amount).toBe('100.00')
  })

  it('never returns a negative net when deductions exceed gross', () => {
    const result = computePayroll({
      compensation: { basicSalary: '100.00', housingAllowance: '0', transportAllowance: '0', otherAllowance: '0' },
      unpaidLeaveDays: 0,
      absenceDays: 0,
      overtimeAmount: '0',
      incentives: [],
      penalties: [{ id: 'pen-1', label: 'Penalty', amount: '500.00' }],
      loanInstalments: [],
    })
    expect(result.netAmount).toBe('0.00')
    expect(result.deductionAmount).toBe('100.00')
  })
})

describe('GOSI', () => {
  it('computes employee and employer contributions on basic plus housing', () => {
    const result = computeGosi({
      basicSalary: '10000.00',
      housingAllowance: '2500.00',
      employeeRate: 0.0975,
      employerRate: 0.1175,
    })
    expect(result.base).toBe('12500.00')
    expect(result.employeeContribution).toBe('1218.75')
    expect(result.employerContribution).toBe('1468.75')
    expect(result.total).toBe('2687.50')
  })

  it('applies the contribution base cap', () => {
    const result = computeGosi({
      basicSalary: '40000.00',
      housingAllowance: '10000.00',
      employeeRate: 0.0975,
      employerRate: 0.1175,
      baseCap: 45000,
    })
    expect(result.base).toBe('45000.00')
    expect(result.employeeContribution).toBe('4387.50')
  })
})

describe('end-of-service award', () => {
  it('pays half a month per year for the first five years and one month after', () => {
    const result = computeEosb({ lastWage: '10000.00', yearsOfService: 10, reason: 'termination' })
    expect(result.grossEntitlement).toBe('75000.00')
    expect(result.entitlement).toBe('75000.00')
  })

  it('scales a resignation by service length', () => {
    expect(computeEosb({ lastWage: '10000.00', yearsOfService: 3, reason: 'resignation' }).entitlement).toBe('5000.00')
    expect(computeEosb({ lastWage: '10000.00', yearsOfService: 1, reason: 'resignation' }).entitlement).toBe('0.00')
    expect(computeEosb({ lastWage: '10000.00', yearsOfService: 10, reason: 'resignation' }).entitlement).toBe('75000.00')
  })
})

describe('WPS SIF', () => {
  it('writes header, detail and trailer with the total net', () => {
    const sif = buildWpsSif([
      { employeeNumber: 'E1', name: 'Ahmed Ali', iban: 'SA0000000000000000000000', basicSalary: '1000', allowances: '200', deductions: '50', netAmount: '1150' },
      { employeeNumber: 'E2', name: 'Sara Omar', iban: 'SA1111111111111111111111', basicSalary: '2000', allowances: '0', deductions: '0', netAmount: '2000' },
    ], { fileDate: '20261019', employerBankCode: 'BANK' })
    const lines = sif.trim().split('\n')
    expect(lines[0]).toBe('H,20261019,BANK,2,3150.00')
    expect(lines[1]).toContain('D,E1,Ahmed Ali,SA0000000000000000000000,1000.00,200.00,50.00,1150.00')
    expect(lines[3]).toBe('T,2,3150.00')
  })
})
