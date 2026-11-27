import { FileText } from 'lucide-react'
import type { ScheduleLinkTypeWidget } from '@open-mercato/core/modules/customers/components/detail/schedule/linkTypes'

function readLabel(item: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

const widget: ScheduleLinkTypeWidget = {
  metadata: {
    id: 'sales.injection.schedule-offer-link',
    title: 'Schedule offer link',
    features: ['sales.quotes.view'],
    requiredModules: ['customers'],
  },
  Widget: () => null,
  linkTypes: [{
    id: 'offer',
    label: 'Offer',
    labelKey: 'sales.schedule.linkType.offer',
    icon: FileText,
    buildSearchUrl: ({ page, pageSize, query }) =>
      `/api/sales/quotes?pageSize=${pageSize}&page=${page}${query.trim() ? `&search=${encodeURIComponent(query.trim())}` : ''}`,
    resolveLabel: (item) => {
      const quoteNumber = readLabel(item, ['quoteNumber', 'quote_number', 'documentNumber', 'document_number', 'externalReference', 'external_reference'])
      const customerName = readLabel(item, ['customerName', 'customer_name', 'display_name', 'displayName', 'name', 'title'])
      if (quoteNumber && customerName) return `${quoteNumber}, ${customerName}`
      return quoteNumber ?? customerName ?? String(item.id ?? '')
    },
  }],
}

export default widget
