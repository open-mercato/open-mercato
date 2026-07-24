import WmsSkuDetailPage from '../../../../components/backend/WmsSkuDetailPage'

export default function WmsSkuDetailRoutePage({ params }: { params?: { id?: string } }) {
  return <WmsSkuDetailPage variantId={params?.id ?? ''} />
}
