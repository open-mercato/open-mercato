import PublicTrackingView from '../../../components/PublicTrackingView'

export default async function PublicTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <PublicTrackingView token={token} />
}
