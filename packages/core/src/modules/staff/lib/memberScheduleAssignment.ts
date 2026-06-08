export type OptimisticVersionStore = {
  get: () => string | null
  set: (next: string | null) => void
}

export type UpdateMemberScheduleAssignmentParams = {
  versionStore: OptimisticVersionStore
  applyAssignment: (expectedUpdatedAt: string | null) => Promise<unknown>
  readCurrentVersion: () => Promise<string | null>
}

/**
 * Update a team member's availability-schedule assignment while keeping the
 * member's optimistic-lock version fresh.
 *
 * The member's `updated_at` is bumped on every assignment write, so reusing the
 * page-load version for a follow-up write — e.g. clearing the assignment while
 * deleting the schedule — sends a stale token and triggers a false 409
 * `record_modified` even with no concurrent editing (#2847). After a successful
 * write the tracked version is refreshed from the server so the next assignment
 * write compares against the current row.
 *
 * The version is refreshed ONLY after the write succeeds, which preserves
 * genuine conflict detection: a concurrent edit from another tab still leaves
 * the tracked version stale at write time and surfaces a real 409 (the write
 * throws before the refresh runs).
 */
export async function updateMemberScheduleAssignment(
  params: UpdateMemberScheduleAssignmentParams,
): Promise<void> {
  const { versionStore, applyAssignment, readCurrentVersion } = params
  await applyAssignment(versionStore.get())
  try {
    versionStore.set(await readCurrentVersion())
  } catch {
    // Keep the last-known version when the refresh read fails; the next write
    // falls back to the prior token rather than dropping the lock entirely.
  }
}
