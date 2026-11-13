import { permanentRedirect } from 'next/navigation'

export default function TimesheetProjectCreateLegacyRedirectPage() {
  permanentRedirect('/backend/staff/time-tracking/projects/create')
}
