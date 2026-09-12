/**
 * Legacy route metadata. Feature guards deliberately live on the new
 * `/backend/staff/time-tracking/*` pages only — this entry exists to keep the old
 * path routable so it can answer 308 instead of 404.
 */
export const metadata = {
  requireAuth: true,
  navHidden: true,
  pageTitle: 'My Timesheets',
  pageTitleKey: 'staff.timesheets.nav.my_timesheets',
}
