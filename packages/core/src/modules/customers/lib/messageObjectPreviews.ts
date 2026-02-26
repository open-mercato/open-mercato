import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { ObjectPreviewData } from '@open-mercato/shared/modules/messages/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDeal, CustomerEntity } from '../data/entities'

type PreviewContext = {
  tenantId: string
  organizationId?: string | null
}

function formatCurrency(amount: string | null | undefined, currency: string | null | undefined): string | null {
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
  if (value.includes('won') || value.includes('active') || value.includes('qualified')) return 'green'
  if (value.includes('lost') || value.includes('rejected') || value.includes('inactive')) return 'red'
  if (value.includes('open') || value.includes('new') || value.includes('pending')) return 'amber'
  return 'blue'
}

async function resolveEm() {
  const { resolve } = await createRequestContainer()
  return resolve('em') as EntityManager
}

export async function loadCustomerPersonPreview(entityId: string, ctx: PreviewContext): Promise<ObjectPreviewData> {
  const { t } = await resolveTranslations()
  const defaultTitle = t('customers.messageObjects.person.title')

  if (!ctx.organizationId) {
    return { title: defaultTitle, subtitle: entityId }
  }

  const em = await resolveEm()
  const entity = await findOneWithDecryption(
    em,
    CustomerEntity,
    {
      id: entityId,
      kind: 'person',
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!entity) {
    return { title: defaultTitle, subtitle: entityId, status: t('customers.messageObjects.notFound'), statusColor: 'gray' }
  }

  const subtitleParts = [entity.primaryEmail, entity.primaryPhone]
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
  return {
    title: entity.displayName,
    subtitle: subtitleParts.join(' • ') || entityId,
    status: entity.status ?? undefined,
    statusColor: statusColor(entity.status),
  }
}

export async function loadCustomerCompanyPreview(entityId: string, ctx: PreviewContext): Promise<ObjectPreviewData> {
  const { t } = await resolveTranslations()
  const defaultTitle = t('customers.messageObjects.company.title')

  if (!ctx.organizationId) {
    return { title: defaultTitle, subtitle: entityId }
  }

  const em = await resolveEm()
  const entity = await findOneWithDecryption(
    em,
    CustomerEntity,
    {
      id: entityId,
      kind: 'company',
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!entity) {
    return { title: defaultTitle, subtitle: entityId, status: t('customers.messageObjects.notFound'), statusColor: 'gray' }
  }

  const subtitleParts = [entity.primaryEmail, entity.primaryPhone]
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
  return {
    title: entity.displayName,
    subtitle: subtitleParts.join(' • ') || entityId,
    status: entity.status ?? undefined,
    statusColor: statusColor(entity.status),
  }
}

export async function loadCustomerDealPreview(entityId: string, ctx: PreviewContext): Promise<ObjectPreviewData> {
  const { t } = await resolveTranslations()
  const defaultTitle = t('customers.messageObjects.deal.title')

  if (!ctx.organizationId) {
    return { title: defaultTitle, subtitle: entityId }
  }

  const em = await resolveEm()
  const deal = await findOneWithDecryption(
    em,
    CustomerDeal,
    {
      id: entityId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!deal) {
    return { title: defaultTitle, subtitle: entityId, status: t('customers.messageObjects.notFound'), statusColor: 'gray' }
  }

  const amount = formatCurrency(deal.valueAmount, deal.valueCurrency)
  const probability = typeof deal.probability === 'number' ? `${deal.probability}%` : null
  const subtitle = [amount, probability].filter((part): part is string => Boolean(part && part.length > 0)).join(' • ')
  const metadata: Record<string, string> = {}
  if (amount) metadata.Value = amount
  if (probability) metadata.Probability = probability

  return {
    title: deal.title,
    subtitle: subtitle || entityId,
    status: deal.status ?? undefined,
    statusColor: statusColor(deal.status),
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  }
}

