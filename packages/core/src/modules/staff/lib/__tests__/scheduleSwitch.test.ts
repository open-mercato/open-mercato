/** @jest-environment jsdom */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const updateCrudMock = jest.fn()
const surfaceRecordConflictMock = jest.fn()
const scopedHeaderCalls: Array<Record<string, string>> = []

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: (...args: unknown[]) => updateCrudMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  withScopedApiRequestHeaders: <T,>(headers: Record<string, string>, run: () => Promise<T>) => {
    scopedHeaderCalls.push(headers)
    return run()
  },
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => surfaceRecordConflictMock(...args),
}))

import { switchTeamMemberSchedule } from '../scheduleSwitch'

const t = (_key: string, fallback?: string) => fallback ?? _key
const MEMBER_ID = 'member-1'
const V0 = '2026-06-08T08:00:00.000Z'
const V1 = '2026-06-08T08:00:05.000Z'
const V2 = '2026-06-08T08:00:09.000Z'

describe('switchTeamMemberSchedule', () => {
  beforeEach(() => {
    updateCrudMock.mockReset()
    surfaceRecordConflictMock.mockReset().mockReturnValue(true)
    scopedHeaderCalls.length = 0
  })

  it('sends the optimistic-lock header derived from the current updatedAt', async () => {
    updateCrudMock.mockResolvedValue({ result: { ok: true, updatedAt: V1 } })

    await switchTeamMemberSchedule({
      memberId: MEMBER_ID,
      nextRuleSetId: 'ruleset-a',
      expectedUpdatedAt: V0,
      t,
    })

    expect(updateCrudMock).toHaveBeenCalledTimes(1)
    expect(updateCrudMock).toHaveBeenCalledWith(
      'staff/team-members',
      { id: MEMBER_ID, availabilityRuleSetId: 'ruleset-a' },
      expect.objectContaining({ errorMessage: expect.any(String) }),
    )
    expect(scopedHeaderCalls).toContainEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: V0 })
  })

  it('returns the freshly-bumped updatedAt from the response', async () => {
    updateCrudMock.mockResolvedValue({ result: { ok: true, updatedAt: V1 } })

    const result = await switchTeamMemberSchedule({
      memberId: MEMBER_ID,
      nextRuleSetId: 'ruleset-a',
      expectedUpdatedAt: V0,
      t,
    })

    expect(result.updatedAt).toBe(V1)
  })

  // Regression for #2848: the second sequential switch must send the version
  // returned by the first switch, not the stale initial version.
  it('advances the lock token across sequential switches', async () => {
    updateCrudMock.mockResolvedValueOnce({ result: { ok: true, updatedAt: V1 } })
    updateCrudMock.mockResolvedValueOnce({ result: { ok: true, updatedAt: V2 } })

    // Mirror the page: thread the returned updatedAt into the next call.
    let version: string | null = V0
    const first = await switchTeamMemberSchedule({
      memberId: MEMBER_ID,
      nextRuleSetId: 'ruleset-a',
      expectedUpdatedAt: version,
      t,
    })
    version = first.updatedAt
    await switchTeamMemberSchedule({
      memberId: MEMBER_ID,
      nextRuleSetId: 'ruleset-b',
      expectedUpdatedAt: version,
      t,
    })

    expect(scopedHeaderCalls).toEqual([
      { [OPTIMISTIC_LOCK_HEADER_NAME]: V0 },
      { [OPTIMISTIC_LOCK_HEADER_NAME]: V1 },
    ])
  })

  it('surfaces the conflict bar and re-throws on an optimistic-lock 409', async () => {
    const conflict = Object.assign(new Error('conflict'), {
      status: 409,
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: V1,
      expectedUpdatedAt: V0,
    })
    updateCrudMock.mockRejectedValue(conflict)

    await expect(
      switchTeamMemberSchedule({
        memberId: MEMBER_ID,
        nextRuleSetId: 'ruleset-a',
        expectedUpdatedAt: V0,
        t,
      }),
    ).rejects.toBe(conflict)

    expect(surfaceRecordConflictMock).toHaveBeenCalledWith(conflict, t)
  })

  it('re-throws non-conflict errors after attempting to surface them', async () => {
    surfaceRecordConflictMock.mockReturnValue(false)
    const failure = Object.assign(new Error('boom'), { status: 500 })
    updateCrudMock.mockRejectedValue(failure)

    await expect(
      switchTeamMemberSchedule({
        memberId: MEMBER_ID,
        nextRuleSetId: 'ruleset-a',
        expectedUpdatedAt: V0,
        t,
      }),
    ).rejects.toBe(failure)

    expect(surfaceRecordConflictMock).toHaveBeenCalledWith(failure, t)
  })
})
