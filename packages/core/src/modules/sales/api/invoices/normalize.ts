export function normalizeInvoiceListItem(item: Record<string, unknown> | null | undefined) {
  if (!item) return item
  return {
    ...item,
    orderId: item.orderId ?? item.order_id ?? null,
    invoiceNumber: item.invoiceNumber ?? item.invoice_number ?? null,
    statusEntryId: item.statusEntryId ?? item.status_entry_id ?? null,
    issueDate: item.issueDate ?? item.issue_date ?? null,
    dueDate: item.dueDate ?? item.due_date ?? null,
    currencyCode: item.currencyCode ?? item.currency_code ?? null,
    subtotalNetAmount: item.subtotalNetAmount ?? item.subtotal_net_amount ?? null,
    subtotalGrossAmount: item.subtotalGrossAmount ?? item.subtotal_gross_amount ?? null,
    discountTotalAmount: item.discountTotalAmount ?? item.discount_total_amount ?? null,
    taxTotalAmount: item.taxTotalAmount ?? item.tax_total_amount ?? null,
    grandTotalNetAmount: item.grandTotalNetAmount ?? item.grand_total_net_amount ?? null,
    grandTotalGrossAmount: item.grandTotalGrossAmount ?? item.grand_total_gross_amount ?? null,
    paidTotalAmount: item.paidTotalAmount ?? item.paid_total_amount ?? null,
    outstandingAmount: item.outstandingAmount ?? item.outstanding_amount ?? null,
    createdAt: item.createdAt ?? item.created_at ?? null,
    updatedAt: item.updatedAt ?? item.updated_at ?? null,
  }
}
