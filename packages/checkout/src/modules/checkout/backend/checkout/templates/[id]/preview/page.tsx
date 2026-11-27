import { PayPage } from '../../../../../components/PayPage'

export default async function CheckoutTemplatePreviewPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await params
  return <PayPage mode="template" sourceId={id} />
}
