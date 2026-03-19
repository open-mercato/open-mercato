import { PayPage } from '../../../../../components/PayPage'

export default async function CheckoutTemplatePreviewPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const resolvedParams = await params
  return <PayPage mode="template" sourceId={resolvedParams.id} />
}
