import WmsAsnDetailPage from '../../../../components/backend/WmsAsnDetailPage'

export default function WmsAsnDetailRoutePage({ params }: { params?: { id?: string } }) {
  return <WmsAsnDetailPage asnId={params?.id ?? ''} />
}
