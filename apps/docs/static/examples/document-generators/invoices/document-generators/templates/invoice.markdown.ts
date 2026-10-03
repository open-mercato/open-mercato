import { escapeInline, formatMoney } from '@open-mercato/document-generators/modules/document_generators/utils/index'
import type { InvoiceTemplateData } from './types'

export function render(data: Record<string, unknown>): string {
  const { labels, document: info, totals, locale, isDraft } = data as unknown as InvoiceTemplateData
  const out: string[] = [`# ${escapeInline(labels.title)} ${escapeInline(info.number)}`, '']
  if (isDraft) out.push(`> **${escapeInline(labels.draftWatermark)}**`, '')
  out.push(`- **${escapeInline(labels.number)}:** ${escapeInline(info.number)}`)
  out.push(`- **${escapeInline(labels.total)}:** ${escapeInline(formatMoney(totals.total, totals.currency, locale))}`)
  return `${out.join('\n')}\n`
}
