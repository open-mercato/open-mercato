import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { defineExplainConfig } from '@open-mercato/shared/modules/insights/explain'
import type {
  ExplainCollectionDescriptor,
  ExplainFieldDescriptor,
  ExplainLoadContext,
  ExplainUnloggedWriter,
} from '@open-mercato/shared/modules/insights/explain'
import {
  isExplainRecordId,
  resolveExplainDecryptionScope,
  resolveExplainOrganizationWhere,
  resolveExplainRecordIdPage,
  toExplainTimestamp,
  type ExplainRecordIdListOptions,
} from '@open-mercato/shared/modules/insights/helpers'
import { SalesOrder, SalesOrderLine, SalesQuote, SalesQuoteLine } from './data/entities'
import { SALES_RESOURCE_KIND_ORDER, SALES_RESOURCE_KIND_QUOTE } from './commands/shared'
import {
  SALES_LINE_PRICE_PROVIDER_ID,
  linePriceProvider,
  readLinePriceMode,
} from './lib/explain/linePriceProvider'
import { salesStatusValueResolvers } from './lib/explain/statusValueResolvers'

export { SALES_LINE_PRICE_PROVIDER_ID }

const DICTIONARY_ENTRY_REFERENCE_KIND = 'dictionary.entry'

type SalesDocumentSnapshotRoot = 'order' | 'quote'

type SalesLineCurrent = {
  id: string
  lineNumber: number
  quantity: string
  unitPriceNet: string
  unitPriceGross: string
  currencyCode: string
  priceId: string | null
  priceMode: 'net' | 'gross' | null
}

const ORDER_STATUS_UNLOGGED_WRITERS: ExplainUnloggedWriter[] = [
  { id: 'sales.shipments.create', labelKey: 'sales.insights.unloggedWriters.shipmentDocumentStatus' },
  { id: 'sales.shipments.update', labelKey: 'sales.insights.unloggedWriters.shipmentDocumentStatus' },
  { id: 'sales.payments.create', labelKey: 'sales.insights.unloggedWriters.paymentDocumentStatus' },
  { id: 'sales.payments.update', labelKey: 'sales.insights.unloggedWriters.paymentDocumentStatus' },
]

const QUOTE_STATUS_UNLOGGED_WRITERS: ExplainUnloggedWriter[] = [
  { id: 'sales.quotes.send', labelKey: 'sales.insights.unloggedWriters.quoteSend' },
  { id: 'sales.quotes.accept', labelKey: 'sales.insights.unloggedWriters.quoteAccept' },
]

function buildDocumentFields(
  root: SalesDocumentSnapshotRoot,
  statusUnloggedWriters: ExplainUnloggedWriter[],
): ExplainFieldDescriptor[] {
  return [
    {
      key: 'status',
      labelKey: 'sales.insights.fields.status',
      valueKind: 'dictionary',
      snapshotPaths: [`${root}.statusEntryId`],
      changeKeys: ['statusEntryId', `${root}.statusEntryId`],
      currentPath: 'statusEntryId',
      referenceKind: DICTIONARY_ENTRY_REFERENCE_KIND,
      unloggedWriters: statusUnloggedWriters,
    },
    {
      key: 'grandTotalNetAmount',
      labelKey: 'sales.insights.fields.grandTotalNet',
      valueKind: 'money',
      snapshotPaths: [`${root}.grandTotalNetAmount`],
      changeKeys: [`${root}.grandTotalNetAmount`],
      currentPath: 'grandTotalNetAmount',
      derived: { dependsOn: ['lines'] },
    },
    {
      key: 'grandTotalGrossAmount',
      labelKey: 'sales.insights.fields.grandTotalGross',
      valueKind: 'money',
      snapshotPaths: [`${root}.grandTotalGrossAmount`],
      changeKeys: [`${root}.grandTotalGrossAmount`],
      currentPath: 'grandTotalGrossAmount',
      derived: { dependsOn: ['lines'] },
    },
    {
      key: 'currencyCode',
      labelKey: 'sales.insights.fields.currency',
      valueKind: 'text',
      snapshotPaths: [`${root}.currencyCode`],
      changeKeys: ['currencyCode', `${root}.currencyCode`],
      currentPath: 'currencyCode',
    },
  ]
}

const linesCollection: ExplainCollectionDescriptor = {
  key: 'lines',
  labelKey: 'sales.insights.collections.lines',
  snapshotPath: 'lines',
  itemIdPath: 'id',
  currentPath: 'lines',
  fields: [
    {
      key: 'unitPriceNet',
      labelKey: 'sales.insights.fields.lineUnitPriceNet',
      valueKind: 'money',
      snapshotPaths: ['unitPriceNet'],
      changeKeys: ['lines'],
      currentPath: 'unitPriceNet',
      provider: SALES_LINE_PRICE_PROVIDER_ID,
    },
    {
      key: 'unitPriceGross',
      labelKey: 'sales.insights.fields.lineUnitPriceGross',
      valueKind: 'money',
      snapshotPaths: ['unitPriceGross'],
      changeKeys: ['lines'],
      currentPath: 'unitPriceGross',
      provider: SALES_LINE_PRICE_PROVIDER_ID,
    },
    {
      key: 'quantity',
      labelKey: 'sales.insights.fields.lineQuantity',
      valueKind: 'decimal',
      snapshotPaths: ['quantity'],
      changeKeys: ['lines'],
      currentPath: 'quantity',
    },
  ],
}

function readLineMetadataText(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata ? metadata[key] : null
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function toLineCurrent(line: SalesOrderLine | SalesQuoteLine): SalesLineCurrent {
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    quantity: line.quantity,
    unitPriceNet: line.unitPriceNet,
    unitPriceGross: line.unitPriceGross,
    currencyCode: line.currencyCode,
    priceId: readLineMetadataText(line.metadata, 'priceId'),
    priceMode: readLinePriceMode(readLineMetadataText(line.metadata, 'priceMode')),
  }
}

function buildDocumentCurrent(
  document: SalesOrder | SalesQuote,
  lines: Array<SalesOrderLine | SalesQuoteLine>,
): Record<string, unknown> {
  return {
    id: document.id,
    organizationId: document.organizationId,
    updatedAt: toExplainTimestamp(document.updatedAt),
    statusEntryId: document.statusEntryId ?? null,
    status: document.status ?? null,
    grandTotalNetAmount: document.grandTotalNetAmount,
    grandTotalGrossAmount: document.grandTotalGrossAmount,
    currencyCode: document.currencyCode,
    lines: lines.map(toLineCurrent),
  }
}

async function loadOrderCurrent(ctx: ExplainLoadContext, id: string): Promise<Record<string, unknown> | null> {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  if (!organizationWhere || !isExplainRecordId(id)) return null
  const decryptionScope = resolveExplainDecryptionScope(ctx.scope)
  const order = await findOneWithDecryption(
    ctx.em,
    SalesOrder,
    { id, tenantId: ctx.scope.tenantId, deletedAt: null, ...organizationWhere },
    undefined,
    decryptionScope,
  )
  if (!order) return null
  const lines = await findWithDecryption(
    ctx.em,
    SalesOrderLine,
    { order: order.id, tenantId: order.tenantId, organizationId: order.organizationId, deletedAt: null },
    { orderBy: { lineNumber: 'asc' } },
    { tenantId: order.tenantId, organizationId: order.organizationId },
  )
  return buildDocumentCurrent(order, lines)
}

async function loadQuoteCurrent(ctx: ExplainLoadContext, id: string): Promise<Record<string, unknown> | null> {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  if (!organizationWhere || !isExplainRecordId(id)) return null
  const decryptionScope = resolveExplainDecryptionScope(ctx.scope)
  const quote = await findOneWithDecryption(
    ctx.em,
    SalesQuote,
    { id, tenantId: ctx.scope.tenantId, deletedAt: null, ...organizationWhere },
    undefined,
    decryptionScope,
  )
  if (!quote) return null
  const lines = await findWithDecryption(
    ctx.em,
    SalesQuoteLine,
    { quote: quote.id, tenantId: quote.tenantId, organizationId: quote.organizationId, deletedAt: null },
    { orderBy: { lineNumber: 'asc' } },
    { tenantId: quote.tenantId, organizationId: quote.organizationId },
  )
  return buildDocumentCurrent(quote, lines)
}

async function listOrderIds(ctx: ExplainLoadContext, options: ExplainRecordIdListOptions): Promise<string[]> {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  const page = resolveExplainRecordIdPage(options)
  if (!organizationWhere || !page) return []
  const orders = await findWithDecryption(
    ctx.em,
    SalesOrder,
    { tenantId: ctx.scope.tenantId, deletedAt: null, ...organizationWhere, ...page.where },
    { fields: ['id'], orderBy: { id: 'asc' }, limit: page.limit },
    resolveExplainDecryptionScope(ctx.scope),
  )
  return orders.map((order) => String(order.id))
}

async function listQuoteIds(ctx: ExplainLoadContext, options: ExplainRecordIdListOptions): Promise<string[]> {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  const page = resolveExplainRecordIdPage(options)
  if (!organizationWhere || !page) return []
  const quotes = await findWithDecryption(
    ctx.em,
    SalesQuote,
    { tenantId: ctx.scope.tenantId, deletedAt: null, ...organizationWhere, ...page.where },
    { fields: ['id'], orderBy: { id: 'asc' }, limit: page.limit },
    resolveExplainDecryptionScope(ctx.scope),
  )
  return quotes.map((quote) => String(quote.id))
}

export const explainConfig = defineExplainConfig({
  version: 1,
  resources: [
    {
      resourceKind: SALES_RESOURCE_KIND_ORDER,
      logResourceKinds: [SALES_RESOURCE_KIND_ORDER],
      labelKey: 'sales.insights.resources.order',
      requiredFeatures: ['sales.orders.view'],
      loadCurrent: loadOrderCurrent,
      listRecordIds: listOrderIds,
      fields: buildDocumentFields('order', ORDER_STATUS_UNLOGGED_WRITERS),
      collections: [linesCollection],
      recordHref: (id) => `/backend/sales/orders/${encodeURIComponent(id)}`,
    },
    {
      resourceKind: SALES_RESOURCE_KIND_QUOTE,
      logResourceKinds: [SALES_RESOURCE_KIND_QUOTE],
      labelKey: 'sales.insights.resources.quote',
      requiredFeatures: ['sales.quotes.view'],
      loadCurrent: loadQuoteCurrent,
      listRecordIds: listQuoteIds,
      fields: buildDocumentFields('quote', QUOTE_STATUS_UNLOGGED_WRITERS),
      collections: [linesCollection],
      recordHref: (id) => `/backend/sales/quotes/${encodeURIComponent(id)}`,
    },
  ],
  providers: [linePriceProvider],
  referenceResolvers: salesStatusValueResolvers,
})

export default explainConfig
