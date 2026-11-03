/** @jest-environment node */
// D-3 regression: `staffTimeProjectUpdateSchema` deliberately carries no
// `currencyCode`, because every post-creation currency change goes through
// `POST /api/staff/timesheets/time-projects/[id]/change-currency` with its
// acknowledgement and its locked-entry refusal. Zod strips unknown keys in
// silence, so an update payload that still carried the key made the edit form
// report a successful save that changed nothing — worse than a disabled field.
// The update payload MUST NOT carry it, whether or not the project has entries.
import { staffTimeProjectUpdateSchema } from '../../../../../data/validators'
import { buildProjectPayload, type ProjectFormValues } from '../projectFormConfig'

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
