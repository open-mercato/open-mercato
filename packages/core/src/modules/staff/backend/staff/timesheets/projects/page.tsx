import { permanentRedirect } from 'next/navigation'

export default function TimesheetProjectsLegacyRedirectPage() {
  permanentRedirect('/backend/staff/time-tracking/projects')
}
