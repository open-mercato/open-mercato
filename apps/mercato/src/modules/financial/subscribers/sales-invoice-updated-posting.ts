import { handleSalesDocumentPosting, type PostingSubscriberContext } from '../lib/salesPostingSubscriber'

export const metadata = {
  event: 'sales.invoice.updated',
  persistent: true,
  id: 'financial:sales-invoice-updated-posting',
}

export default async function handle(payload: unknown, ctx: PostingSubscriberContext): Promise<void> {
  await handleSalesDocumentPosting('sales_invoice', 'upsert', payload, ctx)
}
