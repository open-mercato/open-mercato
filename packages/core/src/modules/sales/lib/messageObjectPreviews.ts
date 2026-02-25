import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { ObjectPreviewData } from '@open-mercato/shared/modules/messages/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesOrder, SalesQuote } from '../data/entities'

type PreviewContext = {
  tenantId: string
  organizationId?: string | null
}

type DocumentKind = 'order' | 'quote'

type SalesDocumentPreviewRecord = {
  id: string
  status?: string | null
  customerSnapshot?: Record<string, unknown> | null
  currencyCode?: string | null
  grandTotalGrossAmount?: string | null
  orderNumber?: string
  quoteNumber?: string
}

function resolveCustomerName(snapshot: Record<string, unknown> | null): string | null {
  if (!snapshot) return null
  const customer = snapshot.customer as Record<string, unknown> | undefined
  const contact = snapshot.contact as Record<string, unknown> | undefined
  const displayName = typeof customer?.displayName === 'string' ? customer.displayName : null
  if (displayName && displayName.trim().length > 0) return displayName.trim()
  const first = typeof contact?.firstName === 'string' ? contact.firstName : null
  const last = typeof contact?.lastName === 'string' ? contact.lastName : null
  const preferred = typeof contact?.preferredName === 'string' ? contact.preferredName : null
  const parts = [preferred ?? first, last]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
  return parts.length > 0 ? parts.join(' ') : null
}

function formatTotal(amount: string | null | undefined, currency: string | null | undefined): string | null {
  if (!amount) return null
  const value = Number(amount)
  if (!Number.isFinite(value)) return currency ? `${amount} ${currency}` : amount
  if (!currency) return value.toLocaleString()
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
  } catch {
    return `${value.toLocaleString()} ${currency}`
  }
}

function statusColor(status: string | null | undefined): string | undefined {
  if (!status) return undefined
  const value = status.toLowerCase()
  if (value.includes('approved') || value.includes('paid') || value.includes('fulfilled') || value.includes('accepted')) {
    return 'green'
  }
  if (value.includes('cancel') || value.includes('rejected') || value.includes('void')) {
    return 'red'
  }
  if (value.includes('draft') || value.includes('pending') || value.includes('open') || value.includes('sent')) {
    return 'amber'
  }
  return 'blue'
}

async function buildPreview(kind: DocumentKind, entityId: string, record: SalesDocumentPreviewRecord | null): Promise<ObjectPreviewData> {
  const { t } = await resolveTranslations()
  const defaultTitle = kind === 'quote' ? t('sales.messageObjects.quote.title') : t('sales.messageObjects.order.title')
  if (!record) {
    return {
      title: defaultTitle,
      subtitle: entityId,
      status: t('sales.messageObjects.notFound'),
      statusColor: 'gray',
    }
  }

  const number = kind === 'quote' ? record.quoteNumber : record.orderNumber
  const customerName = resolveCustomerName(record.customerSnapshot ?? null)
  const total = formatTotal(record.grandTotalGrossAmount, record.currencyCode)

  const subtitleParts = [customerName, total].filter((part): part is string => Boolean(part && part.trim().length > 0))
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' • ') : entityId

  const metadata: Record<string, string> = {}
  if (number) metadata.Number = number
  if (customerName) metadata.Customer = customerName
  if (total) metadata.Total = total

  return {
    title: number && number.trim().length > 0 ? number : defaultTitle,
    subtitle,
    status: record.status ?? undefined,
    statusColor: statusColor(record.status),
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  }
}

async function loadDocumentRecord(
  kind: DocumentKind,
  entityId: string,
  ctx: PreviewContext,
): Promise<SalesDocumentPreviewRecord | null> {
  if (!ctx.organizationId) return null

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }

  if (kind === 'quote') {
    return await findOneWithDecryption(
      em,
      SalesQuote,
      {
        id: entityId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
  }

  return await findOneWithDecryption(
    em,
    SalesOrder,
    {
      id: entityId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
}

export async function loadSalesQuotePreview(entityId: string, ctx: PreviewContext): Promise<ObjectPreviewData> {
  const record = await loadDocumentRecord('quote', entityId, ctx)
  return await buildPreview('quote', entityId, record)
}

export async function loadSalesOrderPreview(entityId: string, ctx: PreviewContext): Promise<ObjectPreviewData> {
  const record = await loadDocumentRecord('order', entityId, ctx)
  return await buildPreview('order', entityId, record)
}


