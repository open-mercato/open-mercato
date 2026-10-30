import { describe, expect, test } from '@jest/globals'
import {
  staffLeaveRequestCreateSchema,
  staffTeamMemberCreateSchema,
  staffTeamRoleCreateSchema,
  staffTimeProjectCreateSchema,
  staffTimeProjectUpdateSchema,
} from '../validators'

const tenantId = '123e4567-e89b-12d3-a456-426614174000'
const organizationId = '123e4567-e89b-12d3-a456-426614174001'
const projectId = '123e4567-e89b-12d3-a456-426614174003'
const customerId = '123e4567-e89b-12d3-a456-426614174004'

function projectCreateInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    organizationId,
    name: 'Nordvik service portal',
    code: 'NORDVIK',
    customerId,
    ...overrides,
  }
}

describe('Staff validators', () => {
  test('staffTeamMemberCreateSchema applies default arrays', () => {
    const result = staffTeamMemberCreateSchema.parse({
      tenantId,
      organizationId,
      displayName: 'Taylor Doe',
    })

    expect(result.roleIds).toEqual([])
    expect(result.tags).toEqual([])
  })

  test('staffLeaveRequestCreateSchema rejects inverted date ranges', () => {
    expect(() =>
      staffLeaveRequestCreateSchema.parse({
        tenantId,
        organizationId,
        memberId: '123e4567-e89b-12d3-a456-426614174002',
        timezone: 'UTC',
        startDate: '2025-02-10',
        endDate: '2025-02-09',
      }),
    ).toThrow()
  })

  test('staffLeaveRequestCreateSchema accepts valid date ranges', () => {
    const result = staffLeaveRequestCreateSchema.parse({
      tenantId,
      organizationId,
      memberId: '123e4567-e89b-12d3-a456-426614174002',
      timezone: 'UTC',
      startDate: '2025-02-09',
      endDate: '2025-02-10',
    })

    expect(result.startDate).toBeInstanceOf(Date)
    expect(result.endDate).toBeInstanceOf(Date)
  })

  test('staffTeamRoleCreateSchema validates appearanceColor', () => {
    expect(() =>
      staffTeamRoleCreateSchema.parse({
        tenantId,
        organizationId,
        name: 'Lead',
        appearanceColor: '#FFFFF',
      }),
    ).toThrow()
  })
})

// T2.9 — the project form (T2.2) collects rate, currency, billable default and
// budget; these are the write-path contracts that keep them from being stripped.
describe('Staff time project billing validators', () => {
  test('create accepts the full billing payload the project form posts', () => {
    const result = staffTimeProjectCreateSchema.parse(
      projectCreateInput({
        customerSnapshot: { name: 'Nordvik AS', kind: 'company', taxId: 'NO-998877' },
        description: 'Retainer',
        hourlyRate: '180.5',
        currencyCode: 'pln',
        billableByDefault: false,
        budgetKind: 'amount',
        budgetValue: '25000',
        budgetWarnAtPercent: 90,
      }),
    )

    expect(result).toMatchObject({
      customerId,
      customerSnapshot: { name: 'Nordvik AS', kind: 'company', taxId: 'NO-998877' },
      // numeric(14,4) is a string end to end so no amount round-trips through a float.
      hourlyRate: '180.5',
      // W6: stored canonical upper-case ISO 4217.
      currencyCode: 'PLN',
      billableByDefault: false,
      budgetKind: 'amount',
      budgetValue: '25000',
      budgetWarnAtPercent: 90,
    })
  })

  test('create normalizes a numeric rate and a comma decimal to the canonical string', () => {
    expect(staffTimeProjectCreateSchema.parse(projectCreateInput({ hourlyRate: 180.5 })).hourlyRate).toBe('180.5')
    expect(staffTimeProjectCreateSchema.parse(projectCreateInput({ hourlyRate: '180,5' })).hourlyRate).toBe('180.5')
    expect(staffTimeProjectCreateSchema.parse(projectCreateInput({ hourlyRate: null })).hourlyRate).toBeNull()
  })

  test('create rejects a negative rate and an over-precise amount', () => {
    expect(() => staffTimeProjectCreateSchema.parse(projectCreateInput({ hourlyRate: -1 }))).toThrow()
    expect(() => staffTimeProjectCreateSchema.parse(projectCreateInput({ hourlyRate: '10.123456' }))).toThrow()
  })

  test('create defaults budgetKind to none and billable stays optional', () => {
    const result = staffTimeProjectCreateSchema.parse(projectCreateInput())
    expect(result.budgetKind).toBe('none')
    expect(result.billableByDefault).toBeUndefined()
  })

  test("budgetKind 'none' with a null value is valid", () => {
    const result = staffTimeProjectCreateSchema.parse(
      projectCreateInput({ budgetKind: 'none', budgetValue: null }),
    )
    expect(result.budgetKind).toBe('none')
    expect(result.budgetValue).toBeNull()
  })

  test('budgetWarnAtPercent outside 1..100 is rejected', () => {
    expect(() => staffTimeProjectCreateSchema.parse(projectCreateInput({ budgetWarnAtPercent: 0 }))).toThrow()
    expect(() => staffTimeProjectCreateSchema.parse(projectCreateInput({ budgetWarnAtPercent: 101 }))).toThrow()
    expect(() => staffTimeProjectCreateSchema.parse(projectCreateInput({ budgetWarnAtPercent: 12.5 }))).toThrow()
    expect(staffTimeProjectCreateSchema.parse(projectCreateInput({ budgetWarnAtPercent: 100 })).budgetWarnAtPercent).toBe(100)
  })

  test('US-B1: creating a project without a customer is a validation error', () => {
    const { customerId: _omitted, ...withoutCustomer } = projectCreateInput()
    expect(() => staffTimeProjectCreateSchema.parse(withoutCustomer)).toThrow()
    expect(() => staffTimeProjectCreateSchema.parse(projectCreateInput({ customerId: null }))).toThrow()
  })

  test('update carries the billing fields', () => {
    const result = staffTimeProjectUpdateSchema.parse({
      id: projectId,
      hourlyRate: '210',
      billableByDefault: true,
      budgetKind: 'hours',
      budgetValue: '120',
      budgetWarnAtPercent: 75,
      customerSnapshot: { name: 'Nordvik AS' },
    })

    expect(result).toMatchObject({
      hourlyRate: '210',
      billableByDefault: true,
      budgetKind: 'hours',
      budgetValue: '120',
      budgetWarnAtPercent: 75,
      customerSnapshot: { name: 'Nordvik AS' },
    })
  })

  test('D-3: update drops a smuggled currencyCode instead of relabelling the project', () => {
    const result = staffTimeProjectUpdateSchema.parse({
      id: projectId,
      name: 'Renamed',
      currencyCode: 'EUR',
    })

    expect(result).not.toHaveProperty('currencyCode')
    expect(Object.keys(result)).not.toContain('currencyCode')
  })

  test('update of a legacy row without a customer is allowed', () => {
    const result = staffTimeProjectUpdateSchema.parse({ id: projectId, name: 'Legacy project' })
    expect(result.customerId).toBeUndefined()
    // …and it can still be cleared or assigned explicitly.
    expect(staffTimeProjectUpdateSchema.parse({ id: projectId, customerId: null }).customerId).toBeNull()
    expect(staffTimeProjectUpdateSchema.parse({ id: projectId, customerId }).customerId).toBe(customerId)
  })
})
