import { permanentRedirect } from 'next/navigation'

export default function TimesheetProjectEditLegacyRedirectPage({ params }: { params?: { id?: string } }) {
  const projectId = params?.id
  if (!projectId) permanentRedirect('/backend/staff/time-tracking/projects')
  permanentRedirect(`/backend/staff/time-tracking/projects/${encodeURIComponent(projectId)}/edit`)
}
