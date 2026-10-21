import { handleSalesDocumentPosting, type PostingSubscriberContext } from '../lib/salesPostingSubscriber'

export const metadata = {
  event: 'sales.payment.created',
  persistent: true,
  id: 'financial:sales-payment-created-posting',
}

export default async function handle(payload: unknown, ctx: PostingSubscriberContext): Promise<void> {
  await handleSalesDocumentPosting('sales_payment', 'upsert', payload, ctx)
}
