import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'

type Translate = (key: string, fallback?: string) => string

export type TeamMemberScheduleSwitchResult = {
  /** The team member's freshly-bumped updatedAt, used to refresh the optimistic-lock token. */
  updatedAt: string | null
}

/**
 * Persist a team member's selected availability schedule.
 *
 * Sends the optimistic-lock header derived from the caller's current
 * `expectedUpdatedAt` and returns the server's freshly-bumped `updatedAt` so the
 * caller can advance its token before the next sequential switch — otherwise the
 * second switch reuses a stale version and falsely 409s (#2848).
 *
 * On an optimistic-lock conflict the shared conflict bar is surfaced before the
 * error is re-thrown, so the selection reverts AND the user sees visible feedback
 * instead of a silent revert.
 */
export async function switchTeamMemberSchedule(args: {
  memberId: string
  nextRuleSetId: string | null
  expectedUpdatedAt: string | null | undefined
  t: Translate
}): Promise<TeamMemberScheduleSwitchResult> {
  const { memberId, nextRuleSetId, expectedUpdatedAt, t } = args
  const headers = buildOptimisticLockHeader(expectedUpdatedAt)
  try {
    const call = await withScopedApiRequestHeaders(headers, () => (
      updateCrud<{ ok?: boolean; updatedAt?: string | null }>(
        'staff/team-members',
        { id: memberId, availabilityRuleSetId: nextRuleSetId },
        { errorMessage: t('staff.teamMembers.availability.ruleset.updateError', 'Failed to update schedule.') },
      )
    ))
    return { updatedAt: call?.result?.updatedAt ?? null }
  } catch (error) {
    surfaceRecordConflict(error, t)
    throw error
  }
}
