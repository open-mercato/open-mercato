/** @jest-environment node */
import { staffTimeProjectUpdateSchema } from '../../../../../data/validators'
import { buildProjectPayload, createProjectFormSchema, type ProjectFormValues } from '../projectFormConfig'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'
const PRECISE_RATE = '123.123456789012345678'
const PRECISE_BUDGET = '98765.432109876543210987'

const PRECISE_PROJECT: ProjectFormValues = {
  id: PROJECT_ID,
  name: 'Renamed project',
  code: 'PRJ-1',
  customerId: CUSTOMER_ID,
  currencyCode: 'EUR',
  currencyLocked: false,
  entryCount: 0,
  hourlyRate: PRECISE_RATE,
  budgetEnabled: true,
  budgetKind: 'amount',
  budgetValue: PRECISE_BUDGET,
  status: 'active',
}

function issuePaths(values: ProjectFormValues): string[] {
  const result = createProjectFormSchema().safeParse(values)
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
}

describe('project form amount validation matches the API (exact decimals)', () => {
  it('accepts an untouched high-precision rate and budget when only the name changes', () => {
    expect(issuePaths(PRECISE_PROJECT)).toEqual([])
  })

  it('submits the untouched exact rate and budget strings the API accepts', () => {
    const payload = buildProjectPayload(PRECISE_PROJECT)
    expect(payload.hourlyRate).toBe(PRECISE_RATE)
    expect(payload.budgetValue).toBe(PRECISE_BUDGET)
    const parsed = staffTimeProjectUpdateSchema.parse(payload)
    expect(parsed.hourlyRate).toBe(PRECISE_RATE)
    expect(parsed.budgetValue).toBe(PRECISE_BUDGET)
  })

  it('accepts a decimal comma and an empty value', () => {
    expect(issuePaths({ ...PRECISE_PROJECT, hourlyRate: '180,123456789', budgetValue: '' })).toEqual([])
  })

  it.each(['-1', 'abc', '1.2.3', '1e5', `1${'0'.repeat(300)}`])('rejects %s like the API does', (value) => {
    expect(issuePaths({ ...PRECISE_PROJECT, hourlyRate: value })).toEqual(['hourlyRate'])
    expect(issuePaths({ ...PRECISE_PROJECT, budgetValue: value })).toEqual(['budgetValue'])
    expect(staffTimeProjectUpdateSchema.safeParse({ id: PROJECT_ID, hourlyRate: value }).success).toBe(false)
  })
})
