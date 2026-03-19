import { TransactionStatusPage } from '../../../../../components/TransactionStatusPage'

export default async function CheckoutCancelPage({
  params,
}: {
  params: Promise<{ slug: string; transactionId: string }> | { slug: string; transactionId: string }
}) {
  const resolvedParams = await params
  return (
    <TransactionStatusPage
      variant="cancel"
      slug={resolvedParams.slug}
      transactionId={resolvedParams.transactionId}
    />
  )
}
