/**
 * Send gates: the checks that stand between "the campaign says to message this person" and
 * actually messaging them.
 *
 * Both are pure. Quiet hours needs a timezone and a clock, nothing else; the frequency cap
 * needs a count somebody else queried. Keeping them free of I/O is what makes the awkward
 * cases — a window that crosses midnight, a daylight-saving jump — testable at all.
 */

export type FrequencyCap = {
  maxMessages: number
  windowHours: number
}

/** Hours are 0..23 in the subject's own local time. */
export type QuietHoursWindow = {
  startHour: number
  endHour: number
}

export const FALLBACK_TIME_ZONE = 'UTC'

export function isFrequencyCapped(sentInWindow: number, cap: FrequencyCap | null | undefined): boolean {
  if (!cap || cap.maxMessages <= 0 || cap.windowHours <= 0) return false
  return sentInWindow >= cap.maxMessages
}

export function frequencyWindowStart(at: Date, cap: FrequencyCap): Date {
  return new Date(at.getTime() - cap.windowHours * 3_600_000)
}

/**
 * The subject's local hour, falling back to UTC for a timezone Intl rejects.
 *
 * A bad timezone string must not stop a send — it comes from customer data, and refusing to
 * message somebody because their profile has a typo is worse than messaging them in UTC.
 */
export function localHourIn(timeZone: string, at: Date): number {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      hour12: false,
    }).format(at)
    const hour = Number.parseInt(formatted, 10)
    return Number.isFinite(hour) ? hour % 24 : at.getUTCHours()
  } catch {
    return at.getUTCHours()
  }
}

function isQuietHour(hour: number, { startHour, endHour }: QuietHoursWindow): boolean {
  if (startHour === endHour) return false
  // A window like 21 → 08 wraps past midnight, so the test has to be a union, not a range.
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour
}

export function isWithinQuietHours(
  window: QuietHoursWindow | null | undefined,
  timeZone: string,
  at: Date,
): boolean {
  if (!window) return false
  return isQuietHour(localHourIn(timeZone, at), window)
}

const MINUTES_STEP = 15
const MAX_LOOKAHEAD_MINUTES = 48 * 60

/**
 * The first moment at or after `at` that is outside the quiet window.
 *
 * Deliberately found by stepping forward in quarter hours rather than by constructing a local
 * wall-clock time and converting back: that conversion needs the zone's offset at the target
 * instant, which is exactly what breaks across a daylight-saving boundary. Stepping asks the
 * same question the gate asks, so the two can never disagree.
 */
export function nextAllowedSendTime(
  window: QuietHoursWindow | null | undefined,
  timeZone: string,
  at: Date,
): Date {
  if (!isWithinQuietHours(window, timeZone, at)) return at

  for (let minutes = MINUTES_STEP; minutes <= MAX_LOOKAHEAD_MINUTES; minutes += MINUTES_STEP) {
    const candidate = new Date(at.getTime() + minutes * 60_000)
    if (isWithinQuietHours(window, timeZone, candidate)) continue

    // Snap to the top of the hour so deferred sends land at 08:00 rather than at whatever
    // minute the campaign happened to be triggered on. Only if the snapped instant is still
    // allowed — flooring moves backwards, which could re-enter the window we just left.
    const snapped = new Date(candidate)
    snapped.setUTCMinutes(0, 0, 0)
    return snapped >= at && !isWithinQuietHours(window, timeZone, snapped) ? snapped : candidate
  }

  // Unreachable for any window narrower than 24h, which `isQuietHour` guarantees by treating
  // startHour === endHour as "never quiet". Returning `at` keeps the send rather than losing it.
  return at
}
