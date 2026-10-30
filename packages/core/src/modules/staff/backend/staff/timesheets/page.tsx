import { permanentRedirect } from 'next/navigation'

/**
 * Legacy route. The timesheets pages moved to the `Time tracking` nav group at
 * `/backend/staff/time-tracking/*`; the editable project x day grid now lives at
 * `/backend/staff/time-tracking/timesheet`.
 *
 * `permanentRedirect` answers 308, so bookmarks, deep links and API-doc examples
 * keep working. Retained for at least one minor release per `UPGRADE_NOTES.md`.
 */
export default function TimesheetsLegacyRedirectPage() {
  permanentRedirect('/backend/staff/time-tracking/timesheet')
}
