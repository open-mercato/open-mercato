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
    `# ${escapeInline(invoice.labels.invoice)} ${escapeInline(invoice.document.number)}`,
    '',
    `- **${escapeInline(invoice.labels.date)}:** ${escapeInline(invoice.document.date)}`,
    ...(invoice.document.dueDate ? [`- **${escapeInline(invoice.labels.dueDate)}:** ${escapeInline(invoice.document.dueDate)}`] : []),
    ...(seller ? [`- **${escapeInline(invoice.labels.seller)}:** ${escapeInline(seller)}`] : []),
    `- **${escapeInline(invoice.labels.billTo)}:** ${escapeInline(invoice.client.name)}`,
    ...(invoice.client.company ? [`- **${escapeInline(invoice.labels.company)}:** ${escapeInline(invoice.client.company)}`] : []),
    ...(invoice.client.email ? [`- **${escapeInline(invoice.labels.email)}:** ${escapeInline(invoice.client.email)}`] : []),
    ...(invoice.client.address ? [`- **${escapeInline(invoice.labels.address)}:** ${escapeInline(invoice.client.address)}`] : []),
    '',
    `## ${escapeInline(invoice.labels.items)}`,
    '',
    [
      invoice.labels.description,
      invoice.labels.details,
      invoice.labels.quantity,
      invoice.labels.unitPrice,
      invoice.labels.amount,
    ].map(escapeTableCell).join(' | '),
    '--- | --- | ---: | ---: | ---:',
    ...lines,
    '',
    `- **${escapeInline(invoice.labels.subtotal)}:** ${formatAmount(invoice.totals.subtotal, currency)}`,
    ...(invoice.totals.tax > 0 ? [`- **${escapeInline(invoice.labels.tax)}:** ${formatAmount(invoice.totals.tax, currency)}`] : []),
    `- **${escapeInline(invoice.labels.amountDue)}:** ${formatAmount(invoice.totals.total, currency)}`,
    ...(invoice.notes ? ['', `## ${escapeInline(invoice.labels.notes)}`, '', escapeInline(invoice.notes)] : []),
    '',
  ].join('\n')
}
