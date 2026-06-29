// Stub the heavy CrudForm import chain so `DealForm.tsx` (a "use client" module
// that pulls in CrudForm + many UI primitives) can be imported in the node test
// environment. We only exercise the pure zod contract exported as `dealFormSchema`,
// mirroring the existing DealForm.validation.test.ts pattern.
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

import { dealFormSchema } from '../DealForm'

describe('dealFormSchema', () => {
  it('rejects an empty title', () => {
    const result = dealFormSchema.safeParse({ title: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const titleIssue = result.error.issues.find((issue) => issue.path[0] === 'title')
      expect(titleIssue?.message).toBe('customers.people.detail.deals.titleRequired')
    }
  })

  it('accepts a valid title', () => {
    const result = dealFormSchema.safeParse({ title: 'Copperleaf — Q3 Renewal' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.title).toBe('Copperleaf — Q3 Renewal')
    }
  })

  it('coerces numeric string valueAmount and probability to numbers', () => {
    const result = dealFormSchema.safeParse({
      title: 'Numeric coercion',
      valueAmount: '1500.50',
      probability: '75',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.valueAmount).toBe(1500.5)
      expect(typeof result.data.valueAmount).toBe('number')
      expect(result.data.probability).toBe(75)
      expect(typeof result.data.probability).toBe('number')
    }
  })

  it('rejects a probability greater than 100', () => {
    const result = dealFormSchema.safeParse({ title: 'Too confident', probability: '101' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const probabilityIssue = result.error.issues.find((issue) => issue.path[0] === 'probability')
      expect(probabilityIssue?.message).toBe('customers.people.detail.deals.probabilityInvalid')
    }
  })

  it('upper-cases a provided valueCurrency and allows it to be empty', () => {
    const upper = dealFormSchema.safeParse({ title: 'Currency casing', valueCurrency: 'usd' })
    expect(upper.success).toBe(true)
    if (upper.success) {
      expect(upper.data.valueCurrency).toBe('USD')
    }

    const empty = dealFormSchema.safeParse({ title: 'Empty currency', valueCurrency: '' })
    expect(empty.success).toBe(true)
    if (empty.success) {
      expect(empty.data.valueCurrency).toBe('')
    }
  })

  it('passes personIds and companyIds arrays through', () => {
    const result = dealFormSchema.safeParse({
      title: 'With associations',
      personIds: ['person-1', 'person-2'],
      companyIds: ['company-1'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.personIds).toEqual(['person-1', 'person-2'])
      expect(result.data.companyIds).toEqual(['company-1'])
    }
  })
})
