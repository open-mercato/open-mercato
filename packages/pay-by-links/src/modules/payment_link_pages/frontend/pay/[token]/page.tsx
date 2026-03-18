import { PaymentLinkPageClient } from '../../../components/PaymentLinkPageClient'

export default async function PaymentLinkPage({
  params,
}: {
  params: Promise<{ token: string }> | { token: string }
}) {
  const resolvedParams = await params
  return <PaymentLinkPageClient token={resolvedParams.token} />
}
