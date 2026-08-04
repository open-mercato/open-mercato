import IncidentDetailClientPage from './IncidentDetailClient'

export default function IncidentDetailPage({ params }: { params?: { id?: string } }) {
  return <IncidentDetailClientPage params={params} />
}
