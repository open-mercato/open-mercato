import { describe, expect, test } from '@jest/globals'
import {
  staffLeaveRequestCreateSchema,
  staffTeamMemberCreateSchema,
  staffTeamRoleCreateSchema,
} from '../validators'

const tenantId = '123e4567-e89b-12d3-a456-426614174000'
const organizationId = '123e4567-e89b-12d3-a456-426614174001'

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
