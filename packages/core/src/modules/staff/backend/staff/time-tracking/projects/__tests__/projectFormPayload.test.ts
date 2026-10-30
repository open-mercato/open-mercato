/** @jest-environment node */
// D-3 regression: `staffTimeProjectUpdateSchema` deliberately carries no
// `currencyCode`, because every post-creation currency change goes through
// `POST /api/staff/timesheets/time-projects/[id]/change-currency` with its
// acknowledgement and its locked-entry refusal. Zod strips unknown keys in
// silence, so an update payload that still carried the key made the edit form
// report a successful save that changed nothing — worse than a disabled field.
// The update payload MUST NOT carry it, whether or not the project has entries.
import { staffTimeProjectUpdateSchema } from '../../../../../data/validators'
import { buildProjectPayload, createProjectFormSchema, type ProjectFormValues } from '../projectFormConfig'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'

const BASE_VALUES: ProjectFormValues = {
  name: '  Nordvik — service portal  ',
  code: 'nrd-01',
  customerId: CUSTOMER_ID,
  customerName: 'Nordvik',
  currencyCode: 'EUR',
  hourlyRate: '180,50',
  status: 'active',
}

describe('buildProjectPayload currency handling (D-3)', () => {
  it('validates a name edit while preserving precise project rate and budget amounts', () => {
    const values = createProjectFormSchema().parse({
      ...BASE_VALUES,
      id: PROJECT_ID,
      name: 'Updated project name',
      hourlyRate: '123,123456789012345678',
      budgetEnabled: true,
      budgetKind: 'amount',
      budgetValue: '98765432109876543210.123456789012345678',
    })
    const payload = buildProjectPayload(values)
    expect(payload.hourlyRate).toBe('123.123456789012345678')
    expect(payload.budgetValue).toBe('98765432109876543210.123456789012345678')
    const parsed = staffTimeProjectUpdateSchema.parse(payload)
    expect(parsed.hourlyRate).toBe(payload.hourlyRate)
    expect(parsed.budgetValue).toBe(payload.budgetValue)
  })

  it.each(['1e305', '1'.repeat(301), `0.${'1'.repeat(1001)}`, '-1'])('rejects invalid project amount %s', (amount) => {
    const result = createProjectFormSchema().safeParse({ ...BASE_VALUES, hourlyRate: amount, budgetValue: amount })
    expect(result.success).toBe(false)
  })

  it('omits currencyCode when updating a project that has no entries', () => {
    const payload = buildProjectPayload({
      ...BASE_VALUES,
      id: PROJECT_ID,
      currencyLocked: false,
      entryCount: 0,
    })

    expect(Object.keys(payload)).not.toContain('currencyCode')
    expect(payload).not.toHaveProperty('currencyCode')
    expect(payload.id).toBe(PROJECT_ID)
  })

  it('omits currencyCode when updating a project that already has entries', () => {
    const payload = buildProjectPayload({
      ...BASE_VALUES,
      id: PROJECT_ID,
      currencyLocked: true,
      entryCount: 12,
    })

    expect(Object.keys(payload)).not.toContain('currencyCode')
    expect(payload).not.toHaveProperty('currencyCode')
    expect(payload.id).toBe(PROJECT_ID)
  })

  it('still sends currencyCode when creating a project', () => {
    const payload = buildProjectPayload({ ...BASE_VALUES })

    expect(payload.currencyCode).toBe('EUR')
    expect(payload).not.toHaveProperty('id')
  })

  it('normalises an empty currency to null on create', () => {
    const payload = buildProjectPayload({ ...BASE_VALUES, currencyCode: '   ' })

    expect(payload.currencyCode).toBeNull()
  })

  it('keeps the rest of the update payload intact', () => {
    const payload = buildProjectPayload({ ...BASE_VALUES, id: PROJECT_ID, currencyLocked: true })

    expect(payload.name).toBe('Nordvik — service portal')
    expect(payload.code).toBe('NRD-01')
    expect(payload.customerId).toBe(CUSTOMER_ID)
    expect(payload.hourlyRate).toBe('180.50')
    expect(payload.status).toBe('active')
  })

  it('matches the update schema, which owns no currencyCode key', () => {
    expect(Object.keys(staffTimeProjectUpdateSchema.shape)).not.toContain('currencyCode')
  })
})
