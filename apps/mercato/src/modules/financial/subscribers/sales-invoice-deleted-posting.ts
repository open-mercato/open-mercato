import { handleSalesDocumentPosting, type PostingSubscriberContext } from '../lib/salesPostingSubscriber'

export const metadata = {
  event: 'sales.invoice.deleted',
  persistent: true,
  id: 'financial:sales-invoice-deleted-posting',
}

export default async function handle(payload: unknown, ctx: PostingSubscriberContext): Promise<void> {
  await handleSalesDocumentPosting('sales_invoice', 'reverse', payload, ctx)
}
