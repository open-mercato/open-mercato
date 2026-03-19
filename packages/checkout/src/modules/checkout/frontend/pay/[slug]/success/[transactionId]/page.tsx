import { TransactionStatusPage } from '../../../../../components/TransactionStatusPage'

export default async function CheckoutSuccessPage({
  params,
}: {
  params: Promise<{ slug: string; transactionId: string }> | { slug: string; transactionId: string }
}) {
  const resolvedParams = await params
  return (
    <TransactionStatusPage
      variant="success"
      slug={resolvedParams.slug}
      transactionId={resolvedParams.transactionId}
    />
  )
}
