import { describe, expect, test } from '@jest/globals'
import {
  plannerAvailabilityDateSpecificReplaceSchema,
  plannerAvailabilityRuleCreateSchema,
  plannerAvailabilityWeeklyReplaceSchema,
} from '../validators'

const tenantId = '123e4567-e89b-12d3-a456-426614174000'
const organizationId = '123e4567-e89b-12d3-a456-426614174001'

describe('Planner validators', () => {
  test('plannerAvailabilityRuleCreateSchema applies defaults', () => {
    const result = plannerAvailabilityRuleCreateSchema.parse({
      tenantId,
      organizationId,
      subjectType: 'member',
      subjectId: '123e4567-e89b-12d3-a456-426614174002',
      timezone: 'UTC',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    })

    expect(result.exdates).toEqual([])
    expect(result.kind).toBe('availability')
  })

  test('plannerAvailabilityRuleCreateSchema rejects invalid exdates', () => {
    expect(() =>
      plannerAvailabilityRuleCreateSchema.parse({
        tenantId,
        organizationId,
        subjectType: 'member',
        subjectId: '123e4567-e89b-12d3-a456-426614174002',
        timezone: 'UTC',
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        exdates: ['not-a-date'],
      }),
    ).toThrow()
  })

  test('plannerAvailabilityWeeklyReplaceSchema rejects invalid time windows', () => {
    expect(() =>
      plannerAvailabilityWeeklyReplaceSchema.parse({
        tenantId,
        organizationId,
        subjectType: 'resource',
        subjectId: '123e4567-e89b-12d3-a456-426614174003',
        timezone: 'UTC',
        windows: [{ weekday: 1, start: '9:00', end: '18:00' }],
      }),
    ).toThrow()
  })

  test('plannerAvailabilityDateSpecificReplaceSchema requires date or dates', () => {
    expect(() =>
      plannerAvailabilityDateSpecificReplaceSchema.parse({
        tenantId,
        organizationId,
        subjectType: 'ruleset',
        subjectId: '123e4567-e89b-12d3-a456-426614174004',
        timezone: 'UTC',
      }),
    ).toThrow()
  })

  test('plannerAvailabilityDateSpecificReplaceSchema applies defaults', () => {
    const result = plannerAvailabilityDateSpecificReplaceSchema.parse({
      tenantId,
      organizationId,
      subjectType: 'ruleset',
      subjectId: '123e4567-e89b-12d3-a456-426614174004',
      timezone: 'UTC',
      date: '2025-02-09',
    })

    expect(result.windows).toEqual([])
    expect(result.isAvailable).toBe(true)
  })

  test('availability replace schemas reject a window whose end is not after its start', () => {
    const base = {
      tenantId,
      organizationId,
      subjectType: 'member',
      subjectId: '123e4567-e89b-12d3-a456-426614174002',
      timezone: 'UTC',
    }
    const weekly = plannerAvailabilityWeeklyReplaceSchema.safeParse({
      ...base,
      windows: [{ weekday: 1, start: '09:00', end: '17:00' }, { weekday: 2, start: '17:00', end: '09:00' }],
    })
    const dateSpecific = plannerAvailabilityDateSpecificReplaceSchema.safeParse({
      ...base,
      date: '2026-06-15',
      windows: [{ start: '09:00', end: '09:00' }],
    })

    expect(weekly.success).toBe(false)
    expect(weekly.error?.issues.map((issue) => issue.path)).toEqual([['windows', 1, 'end']])
    expect(dateSpecific.success).toBe(false)
    expect(dateSpecific.error?.issues.map((issue) => issue.path)).toEqual([['windows', 0, 'end']])
    expect(
      plannerAvailabilityWeeklyReplaceSchema.safeParse({ ...base, windows: [{ weekday: 1, start: '00:00', end: '23:59' }] }).success,
    ).toBe(true)
    for (const end of ['24:00', '09:75']) {
      expect(
        plannerAvailabilityDateSpecificReplaceSchema.safeParse({ ...base, date: '2026-06-15', windows: [{ start: '08:00', end }] }).success,
      ).toBe(false)
    }
  })
})
