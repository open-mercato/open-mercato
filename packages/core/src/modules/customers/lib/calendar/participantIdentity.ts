/**
 * The one canonical actor key for a calendar participant.
 *
 * A staff/customer attendee is identified by `userId`. An external guest has no
 * record in the system, so the normalized email is the only stable identity it
 * carries. Mapping, dedupe, conflict detection and the editor's conflict-probe
 * dependency key all derive their key from here, so a guest is treated as the
 * same actor across events instead of dropping out of actor comparisons.
 *
 * Returns `null` for a participant with neither — such a participant cannot be
 * compared to any other and must never collide with one that can.
 */
export function participantActorKey(participant: { userId?: string; email?: string }): string | null {
  if (participant.userId) return `user:${participant.userId}`
  const email = participant.email?.trim().toLowerCase()
  return email ? `email:${email}` : null
}
