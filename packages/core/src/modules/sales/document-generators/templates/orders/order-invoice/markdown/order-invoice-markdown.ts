import {
  escapeInline,
  escapeTableCell,
  formatDate,
  formatMoney,
} from '@open-mercato/document-generators/modules/document_generators/utils/index'
import type { OrderInvoiceData } from '../types'

function formatQuantity(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value)
}

export function render(data: Record<string, unknown>): string {
  const invoice = data as unknown as OrderInvoiceData
  const { labels, document: documentInfo, client, seller, lines, totals, notes, locale } = invoice
  const money = (amount: number, currency: string) => escapeInline(formatMoney(amount, currency, locale))
  const out: string[] = []

  out.push(`# ${escapeInline(labels.title)} ${escapeInline(documentInfo.number)}`, '')
  out.push(`- **${escapeInline(labels.number)}:** ${escapeInline(documentInfo.number)}`)
  out.push(`- **${escapeInline(labels.date)}:** ${escapeInline(formatDate(documentInfo.date, locale))}`)
  if (documentInfo.dueDate) {
    out.push(`- **${escapeInline(labels.dueDate)}:** ${escapeInline(formatDate(documentInfo.dueDate, locale))}`)
  }
  out.push('')

  out.push(`## ${escapeInline(labels.client)}`, '')
  out.push(escapeInline(client.name))
  const clientDetails = [client.company, client.address, client.email].filter(Boolean)
  for (const detail of clientDetails) out.push(`- ${escapeInline(detail)}`)
  out.push('')

  if (seller) {
    out.push(`## ${escapeInline(labels.seller)}`, '')
    out.push(escapeInline(seller.name))
    for (const detail of [seller.email, seller.phone].filter(Boolean)) out.push(`- ${escapeInline(detail)}`)
    out.push('')
  }

  out.push(
    `| ${escapeTableCell(labels.item)} | ${escapeTableCell(labels.quantity)} | ${escapeTableCell(labels.unitPrice)} | ${escapeTableCell(labels.total)} |`,
    '| --- | ---: | ---: | ---: |',
  )
  for (const line of lines) {
    const item = line.description ? `${line.title} — ${line.description}` : line.title
    out.push(
      `| ${escapeTableCell(item)} | ${escapeTableCell(formatQuantity(line.quantity, locale))} | ${escapeTableCell(formatMoney(line.unitPrice, line.currency, locale))} | ${escapeTableCell(formatMoney(line.total, line.currency, locale))} |`,
    )
  }
  out.push('')

  const row = (label: string, amount: number) =>
    out.push(`- **${escapeInline(label)}:** ${money(amount, totals.currency)}`)
  row(labels.subtotal, totals.subtotal)
  if (totals.discount !== 0) row(labels.discount, -Math.abs(totals.discount))
  if (totals.shipping !== 0) row(labels.shipping, totals.shipping)
  if (totals.surcharge !== 0) row(labels.surcharge, totals.surcharge)
  row(labels.tax, totals.tax)
  row(labels.grandTotal, totals.total)
  if (totals.paid > 0) {
    row(labels.paid, totals.paid)
    row(labels.outstanding, totals.outstanding)
  }
  out.push('')

  if (notes) {
    out.push(`## ${escapeInline(labels.notes)}`, '', escapeInline(notes), '')
  }

  return `${out.join('\n').trimEnd()}\n`
}
