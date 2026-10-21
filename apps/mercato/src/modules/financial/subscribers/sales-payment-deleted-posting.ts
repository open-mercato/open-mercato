import { handleSalesDocumentPosting, type PostingSubscriberContext } from '../lib/salesPostingSubscriber'

export const metadata = {
  event: 'sales.payment.deleted',
  persistent: true,
  id: 'financial:sales-payment-deleted-posting',
}

export default async function handle(payload: unknown, ctx: PostingSubscriberContext): Promise<void> {
  await handleSalesDocumentPosting('sales_payment', 'reverse', payload, ctx)
}
