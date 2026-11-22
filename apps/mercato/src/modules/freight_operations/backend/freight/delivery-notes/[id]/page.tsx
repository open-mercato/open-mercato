import DeliveryNoteDetail from '../../../../components/DeliveryNoteDetail'

export default async function FreightDeliveryNoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DeliveryNoteDetail id={id} />
}
