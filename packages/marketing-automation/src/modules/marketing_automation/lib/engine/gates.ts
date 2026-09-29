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
 * A timezone Intl accepts, or UTC.
 *
 * The same tolerance `localHourIn` applies, exported because SQL needs it too: `at time zone ?` is a bound
 * parameter, so a typo in a customer's profile cannot inject anything — but Postgres does raise on a name it
 * does not know, which turned one bad profile row into a failed step. Falling back to UTC is what the rest of
 * the timing code already does.
 */
export function usableTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(new Date(0))
    return timeZone
  } catch {
    return 'UTC'
  }
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

/**
 * The next instant at which the subject's local clock reads `hour`.
 *
 * Returns `at` unchanged when it is already that hour, so a send whose optimal moment has arrived goes
 * out now rather than being deferred a full day by its own optimisation.
 *
 * Steps in whole hours and snaps to the top of the hour for the same reason `nextAllowedSendTime` does:
 * a message deferred to "the customer's 9am" should land at 09:00, not at 09:37 because that is when the
 * campaign happened to fire.
 */
export function nextOccurrenceOfHour(hour: number, timeZone: string, at: Date): Date {
  const target = Math.min(Math.max(Math.trunc(hour), 0), 23)
  if (localHourIn(timeZone, at) === target) return at

  for (let hours = 1; hours <= 48; hours += 1) {
    const candidate = new Date(at.getTime() + hours * 3_600_000)
    if (localHourIn(timeZone, candidate) !== target) continue
    const snapped = new Date(candidate)
    snapped.setUTCMinutes(0, 0, 0)
    // Snapping backwards must not land before the caller's instant, nor drop out of the target hour.
    if (snapped.getTime() >= at.getTime() && localHourIn(timeZone, snapped) === target) return snapped
    return candidate
  }
  // A timezone we cannot reason about should not park a send forever.
  return at
}

/**
 * What the recipient themselves asked for.
 *
 * Distinct from the tenant's frequency cap on purpose: one is the shop being careful, the other is a person
 * being explicit, and the two are not the same promise. Both apply, and the customer's can only ever make
 * things quieter — a preference centre that let somebody opt INTO more mail than the shop's own cap allows
 * would be a way to bypass the cap.
 */
export type ContactPreference = {
  /** The customer's own ceiling, messages per week. Null when they have expressed none. */
  maxPerWeek: number | null
  /** "Not until then", chosen by the customer. Null when they are not paused. */
  pausedUntil: Date | null
}

/** A week, as the window the customer's own cap is expressed in. */
export const PREFERENCE_WINDOW_HOURS = 168

/**
 * The customer's cap as a window, or null.
 *
 * Evaluated as a SECOND cap rather than merged with the tenant's: merging would mean normalising two windows
 * into one, and "three a week" plus "two a day" have an exact answer only if both are checked as written.
 */
export function preferenceCap(preference: ContactPreference | null | undefined): FrequencyCap | null {
  if (!preference || preference.maxPerWeek === null) return null
  if (!Number.isFinite(preference.maxPerWeek) || preference.maxPerWeek <= 0) return null
  return { maxMessages: preference.maxPerWeek, windowHours: PREFERENCE_WINDOW_HOURS }
}

/**
 * Whether the recipient has asked not to be messaged yet.
 *
 * A pause DEFERS rather than drops: unlike an unsubscribe, which is "no", this is "not now" — and the engine
 * already parks a run for as long as an author's wait says, so honouring it needs no new machinery.
 */
export function isPaused(preference: ContactPreference | null | undefined, at: Date): boolean {
  if (!preference?.pausedUntil) return false
  return preference.pausedUntil.getTime() > at.getTime()
}

/** The largest pause a customer may choose. Beyond a year, "pause" is an unsubscribe with extra steps. */
export const MAX_PAUSE_DAYS = 365
