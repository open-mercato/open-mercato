// Single source of truth for "what timezone is the reader in, and is this the same
// calendar day" across the customers detail components.
//
// Every activity surface in `components/detail/` answers the same two questions, and
// until issue #6011 each answered them with its own byte-identical copy. They are kept
// together here because they are one decision, not two: `isSameDay` is only meaningful
// once both operands have been projected into the same zone, which is what
// `toLocalZonedDate` does with `USER_TIMEZONE`.
//
// The zone is deliberately the reader's own runtime zone. Host/tenant-configured
// display timezones are planned in `.ai/specs/2026-05-18-date-locale-settings.md`
// (issue #1964); when that lands, threading a configured zone through the detail
// components is an edit to this file rather than a hunt through every component.

import { toZonedTime } from 'date-fns-tz'

export const USER_TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()

// Project a UTC instant to the user's local timezone before extracting day/month/year
// for "same day" comparisons (issue #1809 — E3 timezone drift). The browser's
// `new Date(iso)` treats the instant correctly, but `getDate()/getMonth()/getFullYear()`
// reflect the user's local day, so an activity scheduled at e.g. 23:30 local on a UTC
// boundary lands on the day the reader would call it.
export function toLocalZonedDate(value: string | Date): Date {
  return toZonedTime(value, USER_TIMEZONE)
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
