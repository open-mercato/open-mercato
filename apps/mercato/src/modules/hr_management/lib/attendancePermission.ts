import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'

/**
 * The lateness permission: the one employee-facing use of the HR approval engine.
 *
 * A recorded lateness can be excused by an approval — the engine flips the attendance record to
 * `present` when the request is approved — and this module is where both entry points (the record's
 * own screen and the list's row action) share one definition of when that is possible and one call
 * that starts it. Two implementations of the same rule is how a screen ends up offering an action the
 * engine cannot act on.
 */

/** Contract with the engine: the string it matches to know what it is approving. */
export const ATTENDANCE_APPROVAL_ENTITY_TYPE = 'hr_attendance_record'

export const APPROVAL_SUBMIT_ENDPOINT = '/api/hr_management/approvals/submit'

/**
 * Only a `late` record can be excused.
 *
 * Not "any record that is not present": an absence is a different conversation (leave, or a
 * disciplinary matter), and offering to excuse one would produce a request whose approval changes
 * nothing, which reads as a broken button.
 */
export function isLatenessPermissionEligible(status: string | null | undefined): boolean {
  return status === 'late'
}

/**
 * The id of a request already waiting for a decision on this record, if there is one.
 *
 * The lookup runs when a dialog opens rather than per row: a list of fifty records cannot afford
 * fifty extra queries, and the answer only matters once the operator acts on one.
 */
export async function findPendingApprovalRequest(entityId: string): Promise<string | null> {
  const data = await fetchCrudList<{ id: string }>('hr_management/approval-requests', {
    entityType: ATTENDANCE_APPROVAL_ENTITY_TYPE,
    entityId,
    status: 'pending',
    pageSize: 1,
  })
  return data?.items?.[0]?.id ?? null
}

/** Starts the permission. The engine owns what approval then does to the record. */
export async function submitAttendanceForApproval(workflowId: string, attendanceId: string): Promise<void> {
  await apiCallOrThrow(APPROVAL_SUBMIT_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowId,
      entityType: ATTENDANCE_APPROVAL_ENTITY_TYPE,
      entityId: attendanceId,
    }),
  })
}
