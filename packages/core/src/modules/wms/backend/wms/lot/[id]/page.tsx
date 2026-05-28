import WmsLotDetailPage from '../../../../components/backend/WmsLotDetailPage'

export default function WmsLotDetailRoutePage({ params }: { params?: { id?: string } }) {
  return <WmsLotDetailPage lotId={params?.id ?? ''} />
}
