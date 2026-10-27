import WmsLocationDetailPage from '../../../../components/backend/WmsLocationDetailPage'

export default function WmsLocationDetailRoutePage({ params }: { params?: { id?: string } }) {
  return <WmsLocationDetailPage locationId={params?.id ?? ''} />
}
