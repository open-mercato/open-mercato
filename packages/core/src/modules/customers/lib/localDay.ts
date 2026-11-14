// Single source of truth for "what timezone is the reader in, and is this the same
// calendar day" across the customers detail components.
//
// Every activity surface in `components/detail/` answers the same two questions, and
// until issue #6011 each answered them with its own byte-identical copy. They are kept
// together here because they are one decision, not two: `isSameDay` is only meaningful
// once both operands have been projected into the same zone, which is what
// `toLocalZonedDate` does with `getUserTimeZone()`.
//
// The zone is the configured display timezone (user override, then tenant setting, see
// `.ai/specs/2026-05-18-date-locale-settings.md`), falling back to the reader's runtime zone.

import { toZonedTime } from 'date-fns-tz'
import { resolveDisplayTimeZone } from '@open-mercato/ui/primitives/date-locale-settings'

/** The IANA zone the customers UI renders days in: the configured display zone, else the runtime zone. */
export function getUserTimeZone(): string {
  return resolveDisplayTimeZone()
}

/**
 * @deprecated Since 0.10.0; scheduled for removal in 0.12.0. Evaluated once at import, before the
 * configured display timezone is known. Use `getUserTimeZone()`.
 */
export const USER_TIMEZONE = getUserTimeZone()

// Project a UTC instant to the user's local timezone before extracting day/month/year
// for "same day" comparisons (issue #1809 — E3 timezone drift). The browser's
// `new Date(iso)` treats the instant correctly, but `getDate()/getMonth()/getFullYear()`
// reflect the user's local day, so an activity scheduled at e.g. 23:30 local on a UTC
// boundary lands on the day the reader would call it.
export function toLocalZonedDate(value: string | Date): Date {
  return toZonedTime(value, getUserTimeZone())
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
