import type { SearchBuildContext, SearchIndexSource, SearchModuleConfig, SearchResultPresenter } from '@open-mercato/shared/modules/search'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

type SalesDocumentKind = 'order' | 'quote' | 'invoice' | 'credit_memo'

const SALES_CONFIG_URL = '/backend/config/sales'
const SALES_CHANNELS_URL = '/backend/sales/channels'
const SALES_ORDERS_URL = '/backend/sales/orders'
const SALES_QUOTES_URL = '/backend/sales/quotes'

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function pickText(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    const text = normalizeText(candidate)
    if (text) return text
  }
  return null
}

function readRecordText(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const text = normalizeText(record[key])
    if (text) return text
  }
  return null
}

function readObjectText(source: unknown, ...keys: string[]): string | null {
  if (!source || typeof source !== 'object') return null
  const record = source as Record<string, unknown>
  return readRecordText(record, ...keys)
}

function formatSubtitle(...parts: Array<unknown>): string | undefined {
  const text = parts
    .map((part) => normalizeText(part))
    .filter((value): value is string => Boolean(value))
  if (!text.length) return undefined
  return text.join(' · ')
}

function snippet(value: unknown, maxLength = 140): string | undefined {
  const text = normalizeText(value)
  if (!text) return undefined
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 3)}...`
}

function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = Array.isArray(value)
    ? value.map((item) => normalizeText(item)).filter(Boolean).join(', ')
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value)
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

function friendlyLabel(input: string): string {
  return input
    .replace(/^cf:/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, (_match, firstChar, secondChar) => `${firstChar} ${secondChar}`)
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function appendCustomFieldLines(lines: string[], customFields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(customFields)) {
    if (value === null || value === undefined) continue
    appendLine(lines, friendlyLabel(key), value)
  }
}

function buildIndexSource(
  ctx: SearchBuildContext,
  presenter: SearchResultPresenter,
  lines: string[],
): SearchIndexSource | null {
  appendCustomFieldLines(lines, ctx.customFields)
  if (!lines.length) return null
  return {
    text: lines,
    presenter,
    checksumSource: { record: ctx.record, customFields: ctx.customFields },
  }
}

function buildOrderUrl(orderId: string | null): string | null {
  if (!orderId) return null
  return `${SALES_ORDERS_URL}/${encodeURIComponent(orderId)}`
}

function buildQuoteUrl(quoteId: string | null): string | null {
  if (!quoteId) return null
  return `${SALES_QUOTES_URL}/${encodeURIComponent(quoteId)}`
}

function resolveDocumentKind(record: Record<string, unknown>): SalesDocumentKind | null {
  const kind = readRecordText(record, 'document_kind', 'documentKind', 'context_type', 'contextType', 'kind')
  if (!kind) return null
  if (kind === 'order' || kind === 'quote' || kind === 'invoice' || kind === 'credit_memo') return kind
  return null
}

function resolveDocumentId(record: Record<string, unknown>): string | null {
  return readRecordText(record, 'document_id', 'documentId', 'context_id', 'contextId')
}

function resolveOrderId(record: Record<string, unknown>): string | null {
  return readRecordText(record, 'order_id', 'orderId')
}

function resolveQuoteId(record: Record<string, unknown>): string | null {
  return readRecordText(record, 'quote_id', 'quoteId')
}

function resolveDocumentUrl(kind: SalesDocumentKind | null, documentId: string | null): string | null {
  if (!documentId) return null
  if (kind === 'quote') return buildQuoteUrl(documentId)
  if (kind === 'order') return buildOrderUrl(documentId)
  return null
}

function resolveCustomerName(record: Record<string, unknown>): string | null {
  const snapshot = record.customer_snapshot ?? record.customerSnapshot
  const snapshotName = readObjectText(
    snapshot,
    'display_name',
    'displayName',
    'company_name',
    'companyName',
    'legal_name',
    'legalName',
    'name',
  )
  if (snapshotName) return snapshotName
  const firstName = readObjectText(snapshot, 'first_name', 'firstName')
  const lastName = readObjectText(snapshot, 'last_name', 'lastName')
  if (firstName || lastName) return `${firstName ?? ''} ${lastName ?? ''}`.trim()
  return readRecordText(record, 'customer_name', 'customerName')
}

function formatAmount(amount: unknown, currency: unknown): string | null {
  const amountText = normalizeText(amount)
  if (!amountText) return null
  const currencyText = normalizeText(currency)
  return currencyText ? `${amountText} ${currencyText}` : amountText
}

function buildDocumentTitle(label: string, number: string | null, fallbackId: string | null): string {
  if (number) return `${label} ${number}`
  if (fallbackId) return `${label} ${fallbackId}`
  return label
}

function buildOrderPresenter(
  translate: TranslateFn,
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const label = translate('sales.search.badge.order', 'Order')
  const title = buildDocumentTitle(
    label,
    readRecordText(record, 'order_number', 'orderNumber') ?? readRecordText(customFields, 'order_number', 'orderNumber'),
    readRecordText(record, 'id'),
  )
  const subtitle = formatSubtitle(
    resolveCustomerName(record),
    readRecordText(record, 'status'),
    readRecordText(record, 'fulfillment_status', 'fulfillmentStatus'),
    readRecordText(record, 'payment_status', 'paymentStatus'),
  )
  return { title, subtitle, icon: 'shopping-cart', badge: label }
}

function buildQuotePresenter(
  translate: TranslateFn,
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const label = translate('sales.search.badge.quote', 'Quote')
  const title = buildDocumentTitle(
    label,
    readRecordText(record, 'quote_number', 'quoteNumber') ?? readRecordText(customFields, 'quote_number', 'quoteNumber'),
    readRecordText(record, 'id'),
  )
  const subtitle = formatSubtitle(
    resolveCustomerName(record),
    readRecordText(record, 'status'),
    readRecordText(record, 'valid_until', 'validUntil'),
  )
  return { title, subtitle, icon: 'file-text', badge: label }
}

function buildInvoicePresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.invoice', 'Invoice')
  const title = buildDocumentTitle(label, readRecordText(record, 'invoice_number', 'invoiceNumber'), readRecordText(record, 'id'))
  const subtitle = formatSubtitle(
    readRecordText(record, 'status'),
    readRecordText(record, 'due_date', 'dueDate'),
    formatAmount(readRecordText(record, 'grand_total_gross_amount', 'grandTotalGrossAmount'), record.currency_code ?? record.currencyCode),
  )
  return { title, subtitle, icon: 'receipt', badge: label }
}

function buildCreditMemoPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.creditMemo', 'Credit memo')
  const title = buildDocumentTitle(
    label,
    readRecordText(record, 'credit_memo_number', 'creditMemoNumber'),
    readRecordText(record, 'id'),
  )
  const subtitle = formatSubtitle(
    readRecordText(record, 'status'),
    formatAmount(readRecordText(record, 'grand_total_gross_amount', 'grandTotalGrossAmount'), record.currency_code ?? record.currencyCode),
  )
  return { title, subtitle, icon: 'file-minus', badge: label }
}

function buildShipmentPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.shipment', 'Shipment')
  const title = buildDocumentTitle(label, readRecordText(record, 'shipment_number', 'shipmentNumber'), readRecordText(record, 'id'))
  const tracking = record.tracking_numbers ?? record.trackingNumbers
  const subtitle = formatSubtitle(readRecordText(record, 'status'), Array.isArray(tracking) ? tracking.join(', ') : tracking)
  return { title, subtitle, icon: 'truck', badge: label }
}

function buildPaymentPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.payment', 'Payment')
  const title = buildDocumentTitle(label, readRecordText(record, 'payment_reference', 'paymentReference'), readRecordText(record, 'id'))
  const subtitle = formatSubtitle(
    formatAmount(readRecordText(record, 'amount'), record.currency_code ?? record.currencyCode),
    readRecordText(record, 'status'),
  )
  return { title, subtitle, icon: 'credit-card', badge: label }
}

function buildPaymentAllocationPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.paymentAllocation', 'Payment allocation')
  const title = buildDocumentTitle(label, null, readRecordText(record, 'id'))
  const subtitle = formatSubtitle(formatAmount(readRecordText(record, 'amount'), record.currency_code ?? record.currencyCode))
  return { title, subtitle, icon: 'layers', badge: label }
}

function buildDocumentAddressPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.address', 'Address')
  const title = pickText(
    readRecordText(record, 'name'),
    readRecordText(record, 'company_name', 'companyName'),
    readRecordText(record, 'address_line1', 'addressLine1'),
    readRecordText(record, 'id'),
  )
  const subtitle = formatSubtitle(
    readRecordText(record, 'address_line1', 'addressLine1'),
    readRecordText(record, 'city'),
    readRecordText(record, 'region'),
    readRecordText(record, 'country'),
  )
  return { title: title ?? label, subtitle, icon: 'map-pin', badge: label }
}

function buildNotePresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.note', 'Note')
  const title = snippet(readRecordText(record, 'body'), 120) ?? label
  const subtitle = formatSubtitle(readRecordText(record, 'author_user_id', 'authorUserId'))
  return { title, subtitle, icon: 'sticky-note', badge: label }
}

function buildOrderLinePresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.orderLine', 'Order line')
  const lineTitle = pickText(
    readRecordText(record, 'name'),
    readRecordText(record, 'description'),
    readRecordText(record, 'line_number', 'lineNumber'),
  )
  const subtitle = formatSubtitle(
    readRecordText(record, 'kind'),
    formatAmount(readRecordText(record, 'total_gross_amount', 'totalGrossAmount'), record.currency_code ?? record.currencyCode),
    readRecordText(record, 'status'),
  )
  return { title: lineTitle ? `${label} ${lineTitle}` : label, subtitle, icon: 'list', badge: label }
}

function buildQuoteLinePresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.quoteLine', 'Quote line')
  const lineTitle = pickText(
    readRecordText(record, 'name'),
    readRecordText(record, 'description'),
    readRecordText(record, 'line_number', 'lineNumber'),
  )
  const subtitle = formatSubtitle(
    readRecordText(record, 'kind'),
    formatAmount(readRecordText(record, 'total_gross_amount', 'totalGrossAmount'), record.currency_code ?? record.currencyCode),
    readRecordText(record, 'status'),
  )
  return { title: lineTitle ? `${label} ${lineTitle}` : label, subtitle, icon: 'list', badge: label }
}

function buildInvoiceLinePresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.invoiceLine', 'Invoice line')
  const lineTitle = pickText(readRecordText(record, 'description'), readRecordText(record, 'line_number', 'lineNumber'))
  const subtitle = formatSubtitle(
    readRecordText(record, 'kind'),
    formatAmount(readRecordText(record, 'total_gross_amount', 'totalGrossAmount'), record.currency_code ?? record.currencyCode),
  )
  return { title: lineTitle ? `${label} ${lineTitle}` : label, subtitle, icon: 'list', badge: label }
}

function buildCreditMemoLinePresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.creditMemoLine', 'Credit memo line')
  const lineTitle = pickText(readRecordText(record, 'description'), readRecordText(record, 'line_number', 'lineNumber'))
  const subtitle = formatSubtitle(
    readRecordText(record, 'kind'),
    formatAmount(readRecordText(record, 'total_gross_amount', 'totalGrossAmount'), record.currency_code ?? record.currencyCode),
  )
  return { title: lineTitle ? `${label} ${lineTitle}` : label, subtitle, icon: 'list', badge: label }
}

function buildShipmentItemPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.shipmentItem', 'Shipment item')
  const subtitle = formatSubtitle(readRecordText(record, 'quantity'))
  return { title: label, subtitle, icon: 'package', badge: label }
}

function buildOrderAdjustmentPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.orderAdjustment', 'Order adjustment')
  const title = pickText(readRecordText(record, 'label'), readRecordText(record, 'code'), readRecordText(record, 'id'))
  const subtitle = formatSubtitle(
    readRecordText(record, 'kind'),
    formatAmount(readRecordText(record, 'amount_gross', 'amountGross'), record.currency_code ?? record.currencyCode),
  )
  return { title: title ? `${label} ${title}` : label, subtitle, icon: 'sliders', badge: label }
}

function buildQuoteAdjustmentPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.quoteAdjustment', 'Quote adjustment')
  const title = pickText(readRecordText(record, 'label'), readRecordText(record, 'code'), readRecordText(record, 'id'))
  const subtitle = formatSubtitle(
    readRecordText(record, 'kind'),
    formatAmount(readRecordText(record, 'amount_gross', 'amountGross'), record.currency_code ?? record.currencyCode),
  )
  return { title: title ? `${label} ${title}` : label, subtitle, icon: 'sliders', badge: label }
}

function buildChannelPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.channel', 'Channel')
  const title = pickText(readRecordText(record, 'name'), readRecordText(record, 'code'), readRecordText(record, 'id')) ?? label
  const subtitle = formatSubtitle(readRecordText(record, 'code'), readRecordText(record, 'status'))
  return { title, subtitle, icon: 'store', badge: label }
}

function buildShippingMethodPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.shippingMethod', 'Shipping method')
  const title = pickText(readRecordText(record, 'name'), readRecordText(record, 'code'), readRecordText(record, 'id')) ?? label
  const subtitle = formatSubtitle(readRecordText(record, 'carrier_code', 'carrierCode'), readRecordText(record, 'service_level', 'serviceLevel'))
  return { title, subtitle, icon: 'truck', badge: label }
}

function buildDeliveryWindowPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.deliveryWindow', 'Delivery window')
  const title = pickText(readRecordText(record, 'name'), readRecordText(record, 'code'), readRecordText(record, 'id')) ?? label
  const subtitle = formatSubtitle(readRecordText(record, 'lead_time_days', 'leadTimeDays'), readRecordText(record, 'timezone'))
  return { title, subtitle, icon: 'clock', badge: label }
}

function buildPaymentMethodPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.paymentMethod', 'Payment method')
  const title = pickText(readRecordText(record, 'name'), readRecordText(record, 'code'), readRecordText(record, 'id')) ?? label
  const subtitle = formatSubtitle(readRecordText(record, 'provider_key', 'providerKey'))
  return { title, subtitle, icon: 'credit-card', badge: label }
}

function buildTaxRatePresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.taxRate', 'Tax rate')
  const title = pickText(readRecordText(record, 'name'), readRecordText(record, 'code'), readRecordText(record, 'id')) ?? label
  const subtitle = formatSubtitle(readRecordText(record, 'rate'), readRecordText(record, 'country_code', 'countryCode'))
  return { title, subtitle, icon: 'percent', badge: label }
}

function buildDocumentTagPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('sales.search.badge.documentTag', 'Document tag')
  const title = pickText(readRecordText(record, 'label'), readRecordText(record, 'slug'), readRecordText(record, 'id')) ?? label
  const subtitle = formatSubtitle(readRecordText(record, 'description'))
  return { title, subtitle, icon: 'tag', badge: label }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'sales:sales_channel',
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name ?? ctx.customFields.name)
        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Description', record.description)
        appendLine(lines, 'Status', record.status)
        appendLine(lines, 'Website', record.website_url ?? record.websiteUrl)
        appendLine(lines, 'Contact email', record.contact_email ?? record.contactEmail)
        appendLine(lines, 'Contact phone', record.contact_phone ?? record.contactPhone)
        return buildIndexSource(ctx, buildChannelPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildChannelPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => {
        const channelId = readRecordText(ctx.record, 'id')
        return channelId ? `${SALES_CHANNELS_URL}/${encodeURIComponent(channelId)}/edit` : SALES_CHANNELS_URL
      },
    },
    {
      entityId: 'sales:sales_order',
      enabled: true,
      priority: 10,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Order number', record.order_number ?? record.orderNumber)
        appendLine(lines, 'Customer', resolveCustomerName(record))
        appendLine(lines, 'Status', record.status)
        appendLine(lines, 'Fulfillment status', record.fulfillment_status ?? record.fulfillmentStatus)
        appendLine(lines, 'Payment status', record.payment_status ?? record.paymentStatus)
        appendLine(lines, 'External reference', record.external_reference ?? record.externalReference)
        appendLine(lines, 'Customer reference', record.customer_reference ?? record.customerReference)
        return buildIndexSource(ctx, buildOrderPresenter(translate, record, ctx.customFields), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildOrderPresenter(translate, ctx.record, ctx.customFields)
      },
      resolveUrl: async (ctx) => buildOrderUrl(readRecordText(ctx.record, 'id')),
    },
    {
      entityId: 'sales:sales_quote',
      enabled: true,
      priority: 10,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Quote number', record.quote_number ?? record.quoteNumber)
        appendLine(lines, 'Customer', resolveCustomerName(record))
        appendLine(lines, 'Status', record.status)
        appendLine(lines, 'Valid until', record.valid_until ?? record.validUntil)
        appendLine(lines, 'External reference', record.external_reference ?? record.externalReference)
        appendLine(lines, 'Customer reference', record.customer_reference ?? record.customerReference)
        return buildIndexSource(ctx, buildQuotePresenter(translate, record, ctx.customFields), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildQuotePresenter(translate, ctx.record, ctx.customFields)
      },
      resolveUrl: async (ctx) => buildQuoteUrl(readRecordText(ctx.record, 'id')),
    },
    {
      entityId: 'sales:sales_order_line',
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Description', record.description)
        appendLine(lines, 'Kind', record.kind)
        appendLine(lines, 'Quantity', record.quantity)
        appendLine(lines, 'Status', record.status)
        return buildIndexSource(ctx, buildOrderLinePresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildOrderLinePresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildOrderUrl(resolveOrderId(ctx.record)),
    },
    {
      entityId: 'sales:sales_quote_line',
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Description', record.description)
        appendLine(lines, 'Kind', record.kind)
        appendLine(lines, 'Quantity', record.quantity)
        appendLine(lines, 'Status', record.status)
        return buildIndexSource(ctx, buildQuoteLinePresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildQuoteLinePresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildQuoteUrl(resolveQuoteId(ctx.record)),
    },
    {
      entityId: 'sales:sales_order_adjustment',
      enabled: true,
      priority: 6,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Label', record.label)
        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Kind', record.kind)
        appendLine(lines, 'Amount gross', record.amount_gross ?? record.amountGross)
        return buildIndexSource(ctx, buildOrderAdjustmentPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildOrderAdjustmentPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildOrderUrl(resolveOrderId(ctx.record)),
    },
    {
      entityId: 'sales:sales_quote_adjustment',
      enabled: true,
      priority: 6,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Label', record.label)
        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Kind', record.kind)
        appendLine(lines, 'Amount gross', record.amount_gross ?? record.amountGross)
        return buildIndexSource(ctx, buildQuoteAdjustmentPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildQuoteAdjustmentPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildQuoteUrl(resolveQuoteId(ctx.record)),
    },
    {
      entityId: 'sales:sales_shipment',
      enabled: true,
      priority: 6,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Shipment number', record.shipment_number ?? record.shipmentNumber)
        appendLine(lines, 'Status', record.status)
        appendLine(lines, 'Carrier', record.carrier_name ?? record.carrierName)
        appendLine(lines, 'Tracking numbers', record.tracking_numbers ?? record.trackingNumbers)
        return buildIndexSource(ctx, buildShipmentPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildShipmentPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildOrderUrl(resolveOrderId(ctx.record)),
    },
    {
      entityId: 'sales:sales_shipment_item',
      enabled: true,
      priority: 5,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Quantity', record.quantity)
        appendLine(lines, 'Shipment', record.shipment_id ?? record.shipmentId)
        return buildIndexSource(ctx, buildShipmentItemPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildShipmentItemPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildOrderUrl(resolveOrderId(ctx.record)),
    },
    {
      entityId: 'sales:sales_invoice',
      enabled: true,
      priority: 6,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Invoice number', record.invoice_number ?? record.invoiceNumber)
        appendLine(lines, 'Status', record.status)
        appendLine(lines, 'Due date', record.due_date ?? record.dueDate)
        appendLine(lines, 'Total gross', record.grand_total_gross_amount ?? record.grandTotalGrossAmount)
        return buildIndexSource(ctx, buildInvoicePresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildInvoicePresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildOrderUrl(resolveOrderId(ctx.record)),
    },
    {
      entityId: 'sales:sales_invoice_line',
      enabled: true,
      priority: 5,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Description', record.description)
        appendLine(lines, 'Kind', record.kind)
        appendLine(lines, 'Quantity', record.quantity)
        return buildIndexSource(ctx, buildInvoiceLinePresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildInvoiceLinePresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildOrderUrl(resolveOrderId(ctx.record)),
    },
    {
      entityId: 'sales:sales_credit_memo',
      enabled: true,
      priority: 6,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Credit memo number', record.credit_memo_number ?? record.creditMemoNumber)
        appendLine(lines, 'Status', record.status)
        appendLine(lines, 'Issue date', record.issue_date ?? record.issueDate)
        appendLine(lines, 'Total gross', record.grand_total_gross_amount ?? record.grandTotalGrossAmount)
        return buildIndexSource(ctx, buildCreditMemoPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildCreditMemoPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildOrderUrl(resolveOrderId(ctx.record)),
    },
    {
      entityId: 'sales:sales_credit_memo_line',
      enabled: true,
      priority: 5,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Description', record.description)
        appendLine(lines, 'Kind', record.kind)
        appendLine(lines, 'Quantity', record.quantity)
        return buildIndexSource(ctx, buildCreditMemoLinePresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildCreditMemoLinePresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildOrderUrl(resolveOrderId(ctx.record)),
    },
    {
      entityId: 'sales:sales_payment',
      enabled: true,
      priority: 8,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Payment reference', record.payment_reference ?? record.paymentReference)
        appendLine(lines, 'Status', record.status)
        appendLine(lines, 'Amount', record.amount)
        appendLine(lines, 'Currency', record.currency_code ?? record.currencyCode)
        return buildIndexSource(ctx, buildPaymentPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildPaymentPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildOrderUrl(resolveOrderId(ctx.record)),
    },
    {
      entityId: 'sales:sales_payment_allocation',
      enabled: true,
      priority: 5,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Amount', record.amount)
        appendLine(lines, 'Currency', record.currency_code ?? record.currencyCode)
        appendLine(lines, 'Order', record.order_id ?? record.orderId)
        appendLine(lines, 'Invoice', record.invoice_id ?? record.invoiceId)
        return buildIndexSource(ctx, buildPaymentAllocationPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildPaymentAllocationPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildOrderUrl(resolveOrderId(ctx.record)),
    },
    {
      entityId: 'sales:sales_note',
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Body', record.body)
        appendLine(lines, 'Author', record.author_user_id ?? record.authorUserId)
        appendLine(lines, 'Context type', record.context_type ?? record.contextType)
        return buildIndexSource(ctx, buildNotePresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildNotePresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => {
        const kind = resolveDocumentKind(ctx.record)
        const documentId = resolveDocumentId(ctx.record)
        return resolveDocumentUrl(kind, documentId)
      },
    },
    {
      entityId: 'sales:sales_document_address',
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Company', record.company_name ?? record.companyName)
        appendLine(lines, 'Address', record.address_line1 ?? record.addressLine1)
        appendLine(lines, 'City', record.city)
        appendLine(lines, 'Region', record.region)
        appendLine(lines, 'Country', record.country)
        return buildIndexSource(ctx, buildDocumentAddressPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildDocumentAddressPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => {
        const kind = resolveDocumentKind(ctx.record)
        const documentId = resolveDocumentId(ctx.record)
        return resolveDocumentUrl(kind, documentId)
      },
    },
    {
      entityId: 'sales:sales_shipping_method',
      enabled: true,
      priority: 4,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Carrier', record.carrier_code ?? record.carrierCode)
        appendLine(lines, 'Service level', record.service_level ?? record.serviceLevel)
        return buildIndexSource(ctx, buildShippingMethodPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildShippingMethodPresenter(translate, ctx.record)
      },
      resolveUrl: async () => SALES_CONFIG_URL,
    },
    {
      entityId: 'sales:sales_delivery_window',
      enabled: true,
      priority: 4,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Lead time', record.lead_time_days ?? record.leadTimeDays)
        appendLine(lines, 'Timezone', record.timezone)
        return buildIndexSource(ctx, buildDeliveryWindowPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildDeliveryWindowPresenter(translate, ctx.record)
      },
      resolveUrl: async () => SALES_CONFIG_URL,
    },
    {
      entityId: 'sales:sales_payment_method',
      enabled: true,
      priority: 4,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Provider', record.provider_key ?? record.providerKey)
        appendLine(lines, 'Terms', record.terms)
        return buildIndexSource(ctx, buildPaymentMethodPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildPaymentMethodPresenter(translate, ctx.record)
      },
      resolveUrl: async () => SALES_CONFIG_URL,
    },
    {
      entityId: 'sales:sales_tax_rate',
      enabled: true,
      priority: 4,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Rate', record.rate)
        appendLine(lines, 'Country', record.country_code ?? record.countryCode)
        return buildIndexSource(ctx, buildTaxRatePresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildTaxRatePresenter(translate, ctx.record)
      },
      resolveUrl: async () => SALES_CONFIG_URL,
    },
    {
      entityId: 'sales:sales_document_tag',
      enabled: true,
      priority: 3,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Label', record.label)
        appendLine(lines, 'Slug', record.slug)
        appendLine(lines, 'Description', record.description)
        return buildIndexSource(ctx, buildDocumentTagPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildDocumentTagPresenter(translate, ctx.record)
      },
      resolveUrl: async () => SALES_ORDERS_URL,
    },
  ],
}

export default searchConfig
export const config = searchConfig
