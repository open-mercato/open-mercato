/**
 * `HH:mm` of an instant in the caller's UTC offset (the offset its conflict window was built in),
 * or in UTC when the caller sent none. Kept for clients that render the legacy `startTime` /
 * `endTime` strings; new clients format the ISO `startsAt` / `endsAt` instead.
 */
export function formatConflictClock(instant: Date, offsetMinutes: number | undefined): string {
  const shifted = new Date(instant.getTime() + (offsetMinutes ?? 0) * 60_000)
  return shifted.toISOString().slice(11, 16)
}
