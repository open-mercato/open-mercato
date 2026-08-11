import type { OrderInvoiceData } from '../types'

function escapeInline(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+!|>])/g, '\\$1')
}

function escapeTableCell(value: string): string {
  return escapeInline(value).replace(/\r?\n/g, '<br>')
}

function formatAmount(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`
}

export function renderOrderInvoiceMarkdown(data: Record<string, unknown>): string {
  const invoice = data as unknown as OrderInvoiceData
  const currency = invoice.totals.currency
  const seller = invoice.seller.company || invoice.seller.name
  const lines = invoice.lines.map((line) => [
    escapeTableCell(line.title),
    escapeTableCell(line.description ?? ''),
    String(line.quantity),
    formatAmount(line.unitPrice, currency),
    formatAmount(line.total, currency),
  ].join(' | '))

  return [
    `# Invoice ${escapeInline(invoice.document.number)}`,
    '',
    `- **Date:** ${escapeInline(invoice.document.date)}`,
    ...(invoice.document.dueDate ? [`- **Date due:** ${escapeInline(invoice.document.dueDate)}`] : []),
    ...(seller ? [`- **Seller:** ${escapeInline(seller)}`] : []),
    `- **Bill to:** ${escapeInline(invoice.client.name)}`,
    ...(invoice.client.company ? [`- **Company:** ${escapeInline(invoice.client.company)}`] : []),
    ...(invoice.client.email ? [`- **Email:** ${escapeInline(invoice.client.email)}`] : []),
    ...(invoice.client.address ? [`- **Address:** ${escapeInline(invoice.client.address)}`] : []),
    '',
    '## Items',
    '',
    'Description | Details | Qty | Unit price | Amount',
    '--- | --- | ---: | ---: | ---:',
    ...lines,
    '',
    `- **Subtotal:** ${formatAmount(invoice.totals.subtotal, currency)}`,
    ...(invoice.totals.tax > 0 ? [`- **Tax:** ${formatAmount(invoice.totals.tax, currency)}`] : []),
    `- **Amount due:** ${formatAmount(invoice.totals.total, currency)}`,
    ...(invoice.notes ? ['', '## Notes', '', escapeInline(invoice.notes)] : []),
    '',
  ].join('\n')
}
