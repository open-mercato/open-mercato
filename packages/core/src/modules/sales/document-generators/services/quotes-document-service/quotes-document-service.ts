import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BaseDocumentService } from '@open-mercato/shared/modules/document-generators'
import type {
  DocumentDataInput,
  DocumentFetchContext,
  TemplateNormalizationInput,
} from '@open-mercato/shared/modules/document-generators'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { parseDecryptedFieldValue } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { buildDocumentFilename } from '@open-mercato/document-generators/modules/document_generators/utils/filename'
import { SalesChannel, SalesQuote, SalesQuoteLine } from '../../../data/entities'
import {
  SALES_OFFER_LABEL_KEYS,
  type SalesOfferData,
  type SalesOfferLabels,
  type SalesOfferLine,
} from '../../templates/quotes/sales-offer/types'

const quoteRequestSchema = z.object({ id: z.string().uuid() })

type SnapshotRecord = Record<string, unknown>

export interface QuoteDocumentQuoteRecord {
  id: string
  quoteNumber: string
  currencyCode: string
  customerSnapshot: unknown
  billingAddressSnapshot: unknown
  placedAt: string | null
  createdAt: string
  validUntil: string | null
  comments: string | null
  subtotalNetAmount: string
  taxTotalAmount: string
  grandTotalGrossAmount: string
}

export interface QuoteDocumentLineRecord {
  lineNumber: number
  name: string | null
  description: string | null
  quantity: string
  currencyCode: string
  unitPriceNet: string
  unitPriceGross: string
  totalNetAmount: string
  totalGrossAmount: string
}

export interface QuoteDocumentChannelRecord {
  name: string
  contactEmail: string | null
  contactPhone: string | null
}

export interface QuoteDocumentSource {
  quote: QuoteDocumentQuoteRecord
  lines: QuoteDocumentLineRecord[]
  channel: QuoteDocumentChannelRecord | null
}

const LABEL_DEFAULTS: SalesOfferLabels = {
  title: 'Offer',
  number: 'Offer number',
  date: 'Date',
  validUntil: 'Valid until',
  client: 'Client',
  seller: 'Seller',
  item: 'Item',
  quantity: 'Quantity',
  unitPrice: 'Unit price',
  total: 'Total',
  subtotal: 'Subtotal',
  tax: 'Tax',
  grandTotal: 'Total due',
  notes: 'Notes',
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toSnapshotRecord(value: unknown): SnapshotRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as SnapshotRecord
  if (typeof value !== 'string') return null
  const parsed = parseDecryptedFieldValue(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as SnapshotRecord) : null
}

function toText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = toText(value)
    if (text) return text
  }
  return undefined
}

function resolveClientName(snapshot: SnapshotRecord | null): string {
  const customer = toSnapshotRecord(snapshot?.customer)
  const contact = toSnapshotRecord(snapshot?.contact)
  const companyProfile = toSnapshotRecord(customer?.companyProfile)
  const contactName = [toText(contact?.firstName), toText(contact?.lastName)].filter(Boolean).join(' ')
  return (
    firstText(
      customer?.displayName,
      companyProfile?.legalName,
      companyProfile?.brandName,
      contact?.preferredName,
      contactName,
    ) ?? ''
  )
}

function resolveClientAddress(snapshot: SnapshotRecord | null): string | undefined {
  if (!snapshot) return undefined
  const street = [toText(snapshot.addressLine1), toText(snapshot.buildingNumber)].filter(Boolean).join(' ')
  const flat = toText(snapshot.flatNumber)
  const streetWithFlat = flat ? `${street}/${flat}` : street
  const locality = [toText(snapshot.postalCode), toText(snapshot.city)].filter(Boolean).join(' ')
  const parts = [
    streetWithFlat,
    toText(snapshot.addressLine2),
    locality,
    toText(snapshot.region),
    toText(snapshot.country),
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(', ') : undefined
}

function buildLabels(translate: TemplateNormalizationInput['translate']): SalesOfferLabels {
  const entries = SALES_OFFER_LABEL_KEYS.map((key) => [
    key,
    translate(`sales.documents.templates.offer.labels.${key}`, LABEL_DEFAULTS[key]),
  ])
  return Object.fromEntries(entries) as SalesOfferLabels
}

function requireSource(data: unknown): QuoteDocumentSource {
  const source = data as Partial<QuoteDocumentSource> | null
  if (!source || typeof source !== 'object' || !source.quote || !Array.isArray(source.lines)) {
    throw new CrudHttpError(400, { error: 'invalid_request' })
  }
  return source as QuoteDocumentSource
}

export class QuotesDocumentService extends BaseDocumentService {
  readonly id = 'quotes'
  readonly label = 'Quotes'
  readonly module = 'sales'
  readonly resourceKind = 'sales.quote'

  constructor() {
    super()
    this.registerTemplate({
      id: 'sales.offer',
      label: 'sales.documents.templates.offer.label',
      description: 'sales.documents.templates.offer.description',
      documentType: 'offer',
      format: 'pdf',
      tags: ['sales', 'quote'],
      requiredFeatures: ['sales.quotes.view'],
      filename: ({ data }) => buildDocumentFilename(data, 'offer', 'pdf'),
      load: async () => ({
        type: 'react-pdf',
        component: (await import('../../templates/quotes/sales-offer/pdf/SalesOfferPdf')).default,
      }),
    })
  }

  override async fetchData(
    { data }: { data: unknown },
    { container, auth }: DocumentFetchContext,
  ): Promise<QuoteDocumentSource> {
    const parsed = quoteRequestSchema.safeParse(data)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: 'invalid_request', details: parsed.error.flatten() })
    }
    const tenantId = auth?.tenantId
    const organizationId = auth?.orgId
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(403, { error: 'organization_scope_required' })
    }
    const scope = { tenantId, organizationId }
    const em = (container.resolve('em') as EntityManager).fork()
    const quote = await findOneWithDecryption(
      em,
      SalesQuote,
      { id: parsed.data.id, ...scope, deletedAt: null },
      {},
      scope,
    )
    if (!quote) throw notFound('Quote not found')
    const lines = await findWithDecryption(
      em,
      SalesQuoteLine,
      { quote: quote.id, ...scope, deletedAt: null },
      { orderBy: { lineNumber: 'asc' } },
      scope,
    )
    const channel = quote.channelId
      ? await findOneWithDecryption(em, SalesChannel, { id: quote.channelId, ...scope, deletedAt: null }, {}, scope)
      : null
    return {
      quote: {
        id: quote.id,
        quoteNumber: quote.quoteNumber,
        currencyCode: quote.currencyCode,
        customerSnapshot: quote.customerSnapshot ?? null,
        billingAddressSnapshot: quote.billingAddressSnapshot ?? null,
        placedAt: toIso(quote.placedAt),
        createdAt: toIso(quote.createdAt) ?? new Date(0).toISOString(),
        validUntil: toIso(quote.validUntil),
        comments: quote.comments ?? null,
        subtotalNetAmount: quote.subtotalNetAmount,
        taxTotalAmount: quote.taxTotalAmount,
        grandTotalGrossAmount: quote.grandTotalGrossAmount,
      },
      lines: lines.map((line) => ({
        lineNumber: line.lineNumber,
        name: line.name ?? null,
        description: line.description ?? null,
        quantity: line.quantity,
        currencyCode: line.currencyCode,
        unitPriceNet: line.unitPriceNet,
        unitPriceGross: line.unitPriceGross,
        totalNetAmount: line.totalNetAmount,
        totalGrossAmount: line.totalGrossAmount,
      })),
      channel: channel
        ? {
            name: channel.name,
            contactEmail: channel.contactEmail ?? null,
            contactPhone: channel.contactPhone ?? null,
          }
        : null,
    }
  }

  toTemplateData({ data, locale, translate }: TemplateNormalizationInput): SalesOfferData & Record<string, unknown> {
    const { quote, lines, channel } = requireSource(data)
    const customerSnapshot = toSnapshotRecord(quote.customerSnapshot)
    const billingSnapshot = toSnapshotRecord(quote.billingAddressSnapshot)
    const customer = toSnapshotRecord(customerSnapshot?.customer)
    const contact = toSnapshotRecord(customerSnapshot?.contact)
    const companyProfile = toSnapshotRecord(customer?.companyProfile)
    const currency = quote.currencyCode
    const normalizedLines: SalesOfferLine[] = lines.map((line) => ({
      title: toText(line.name) ?? '',
      description: toText(line.description),
      quantity: toNumber(line.quantity),
      unitPrice: toNumber(line.unitPriceNet),
      total: toNumber(line.totalNetAmount),
      currency: line.currencyCode || currency,
    }))
    const sellerName = toText(channel?.name)
    return {
      locale,
      labels: buildLabels(translate),
      document: {
        id: quote.id,
        number: quote.quoteNumber,
        date: quote.placedAt ?? quote.createdAt,
        validUntil: quote.validUntil ?? undefined,
      },
      client: {
        name: resolveClientName(customerSnapshot),
        email: firstText(contact?.email, customer?.primaryEmail),
        company: firstText(billingSnapshot?.companyName, companyProfile?.legalName, companyProfile?.brandName),
        address: resolveClientAddress(billingSnapshot),
      },
      seller: sellerName
        ? {
            name: sellerName,
            email: toText(channel?.contactEmail),
            phone: toText(channel?.contactPhone),
          }
        : undefined,
      lines: normalizedLines,
      totals: {
        subtotal: toNumber(quote.subtotalNetAmount),
        tax: toNumber(quote.taxTotalAmount),
        total: toNumber(quote.grandTotalGrossAmount),
        currency,
      },
      notes: toText(quote.comments),
    }
  }

  resourceId({ data }: DocumentDataInput): string {
    return String((data as { document?: { id?: unknown } }).document?.id ?? '')
  }

  override resourceLabel({ data }: DocumentDataInput): string | undefined {
    const number = (data as { document?: { number?: unknown } }).document?.number
    return typeof number === 'string' && number.length > 0 ? number : undefined
  }
}
