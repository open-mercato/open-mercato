import { createSyncScheduleSchema, updateSyncScheduleSchema } from '../validators'

const baseCreatePayload = {
  integrationId: 'sync_excel',
  entityType: 'customers.person',
  direction: 'import' as const,
  scheduleType: 'interval' as const,
  scheduleValue: '1h',
  timezone: 'UTC',
}

function fieldErrorsFor(result: ReturnType<typeof createSyncScheduleSchema.safeParse>) {
  if (result.success) throw new Error('[internal] expected the payload to be rejected')
  return result.error.flatten().fieldErrors
}

describe('createSyncScheduleSchema', () => {
  it('accepts the documented interval format', () => {
    expect(createSyncScheduleSchema.safeParse(baseCreatePayload).success).toBe(true)
    expect(createSyncScheduleSchema.safeParse({ ...baseCreatePayload, scheduleValue: '24h' }).success).toBe(true)
  })

  it('rejects a unitless interval with a scheduleValue field error', () => {
    const result = createSyncScheduleSchema.safeParse({ ...baseCreatePayload, scheduleValue: '3600' })

    expect(result.success).toBe(false)
    expect(fieldErrorsFor(result).scheduleValue).toHaveLength(1)
  })

  it('rejects an interval shorter than the scheduler minimum', () => {
    const result = createSyncScheduleSchema.safeParse({ ...baseCreatePayload, scheduleValue: '30s' })

    expect(result.success).toBe(false)
    expect(fieldErrorsFor(result).scheduleValue).toHaveLength(1)
  })

  it('rejects surrounding whitespace, which the scheduler parser would reject later', () => {
    const result = createSyncScheduleSchema.safeParse({ ...baseCreatePayload, scheduleValue: ' 1h ' })

    expect(result.success).toBe(false)
    expect(fieldErrorsFor(result).scheduleValue).toHaveLength(1)
  })

  it('leaves cron expressions to the scheduler', () => {
    const result = createSyncScheduleSchema.safeParse({
      ...baseCreatePayload,
      scheduleType: 'cron',
      scheduleValue: '0 * * * *',
    })

    expect(result.success).toBe(true)
  })
})

describe('updateSyncScheduleSchema', () => {
  it('rejects a unitless interval on a partial update', () => {
    const result = updateSyncScheduleSchema.safeParse({ scheduleType: 'interval', scheduleValue: '3600' })

    expect(result.success).toBe(false)
    expect(fieldErrorsFor(result as never).scheduleValue).toHaveLength(1)
  })

  it('still requires at least one field', () => {
    expect(updateSyncScheduleSchema.safeParse({}).success).toBe(false)
  })

  it('accepts an unrelated field on its own', () => {
    expect(updateSyncScheduleSchema.safeParse({ isEnabled: false }).success).toBe(true)
  })
})
