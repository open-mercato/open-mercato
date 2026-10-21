import { handleSalesDocumentPosting, type PostingSubscriberContext } from '../lib/salesPostingSubscriber'

export const metadata = {
  event: 'sales.invoice.created',
  persistent: true,
  id: 'financial:sales-invoice-created-posting',
}

export default async function handle(payload: unknown, ctx: PostingSubscriberContext): Promise<void> {
  await handleSalesDocumentPosting('sales_invoice', 'upsert', payload, ctx)
}
