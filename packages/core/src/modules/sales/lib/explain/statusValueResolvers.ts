import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  ExplainLoadContext,
  ExplainReferenceDetail,
  ExplainReferenceResolver,
} from '@open-mercato/shared/modules/insights/explain'
import {
  normalizeExplainIds,
  resolveExplainDecryptionScope,
  resolveExplainOrganizationWhere,
  runExplainResolverSafely,
} from '@open-mercato/shared/modules/insights/helpers'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'
import { getSalesDictionaryDefinition } from '../dictionaries'

/**
 * Reference kinds resolving a stored sales status VALUE (the `status`, `fulfillmentStatus`,
 * `paymentStatus` columns and the payment / shipment `status`) to the label of its dictionary
 * entry. Process X-Ray uses them for readable activity labels.
 */
export const SALES_STATUS_VALUE_REFERENCE_KINDS = {
  orderStatus: 'sales.status_value.order',
  quoteStatus: 'sales.status_value.quote',
  fulfillmentStatus: 'sales.status_value.fulfillment',
  paymentStatus: 'sales.status_value.payment',
  shipmentStatus: 'sales.status_value.shipment',
} as const

const REFERENCE_FAILURE_CODE = 'sales.insights_reference_failed'

type StatusValueResolverOptions = {
  kind: string
  dictionaryKeys: string[]
  requiredFeatures: string[]
}

/**
 * Labels of the requested values from the first listed dictionary that holds them, within the
 * load context's tenant and organizations (two queries per call). Values without an entry are
 * left out, so the caller keeps its fallback.
 */
export async function resolveSalesStatusValues(
  ctx: ExplainLoadContext,
  values: readonly unknown[],
  options: Pick<StatusValueResolverOptions, 'kind' | 'dictionaryKeys'>,
): Promise<ExplainReferenceDetail[]> {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  const requested = normalizeExplainIds(values)
  if (!organizationWhere || requested.length === 0 || options.dictionaryKeys.length === 0) return []
  const decryptionScope = resolveExplainDecryptionScope(ctx.scope)
  const dictionaries = await findWithDecryption(
    ctx.em,
    Dictionary,
    { tenantId: ctx.scope.tenantId, key: { $in: options.dictionaryKeys }, deletedAt: null, ...organizationWhere },
    undefined,
    decryptionScope,
  )
  if (dictionaries.length === 0) return []
  const rankOfKey = new Map(options.dictionaryKeys.map((key, index) => [key, index]))
  const rankOfDictionary = new Map(dictionaries.map((dictionary) => [dictionary.id, rankOfKey.get(dictionary.key) ?? options.dictionaryKeys.length]))
  const lookups = Array.from(new Set(requested.map(normalizeDictionaryValue).filter((lookup) => lookup.length > 0)))
  const entries = await findWithDecryption(
    ctx.em,
    DictionaryEntry,
    {
      tenantId: ctx.scope.tenantId,
      dictionary: { $in: Array.from(rankOfDictionary.keys()) },
      normalizedValue: { $in: lookups },
      ...organizationWhere,
    },
    { orderBy: { createdAt: 'asc', id: 'asc' } },
    decryptionScope,
  )
  const best = new Map<string, { entry: DictionaryEntry; rank: number }>()
  for (const entry of entries) {
    const rank = rankOfDictionary.get(entry.dictionary.id) ?? options.dictionaryKeys.length
    const current = best.get(entry.normalizedValue)
    if (!current || rank < current.rank) best.set(entry.normalizedValue, { entry, rank })
  }
  const details: ExplainReferenceDetail[] = []
  for (const value of requested) {
    const match = best.get(normalizeDictionaryValue(value))
    if (!match) continue
    details.push({
      kind: options.kind,
      id: value,
      label: match.entry.label,
      href: null,
      organizationId: match.entry.organizationId,
      facts: { value: match.entry.value },
    })
  }
  return details
}

function buildStatusValueResolver(options: StatusValueResolverOptions): ExplainReferenceResolver {
  return {
    kind: options.kind,
    requiredFeatures: options.requiredFeatures,
    resolve: (ctx, values) =>
      runExplainResolverSafely(
        { module: 'sales', code: REFERENCE_FAILURE_CODE, kind: options.kind },
        () => resolveSalesStatusValues(ctx, values, options),
      ),
  }
}

const ORDER_STATUS_DICTIONARY = getSalesDictionaryDefinition('order-status').key
const SHIPMENT_STATUS_DICTIONARY = getSalesDictionaryDefinition('shipment-status').key
const PAYMENT_STATUS_DICTIONARY = getSalesDictionaryDefinition('payment-status').key

export const salesStatusValueResolvers: ExplainReferenceResolver[] = [
  buildStatusValueResolver({
    kind: SALES_STATUS_VALUE_REFERENCE_KINDS.orderStatus,
    dictionaryKeys: [ORDER_STATUS_DICTIONARY],
    requiredFeatures: ['sales.orders.view'],
  }),
  buildStatusValueResolver({
    kind: SALES_STATUS_VALUE_REFERENCE_KINDS.quoteStatus,
    dictionaryKeys: [ORDER_STATUS_DICTIONARY],
    requiredFeatures: ['sales.quotes.view'],
  }),
  buildStatusValueResolver({
    kind: SALES_STATUS_VALUE_REFERENCE_KINDS.fulfillmentStatus,
    dictionaryKeys: [ORDER_STATUS_DICTIONARY, SHIPMENT_STATUS_DICTIONARY],
    requiredFeatures: ['sales.orders.view'],
  }),
  buildStatusValueResolver({
    kind: SALES_STATUS_VALUE_REFERENCE_KINDS.paymentStatus,
    dictionaryKeys: [PAYMENT_STATUS_DICTIONARY],
    requiredFeatures: ['sales.orders.view'],
  }),
  buildStatusValueResolver({
    kind: SALES_STATUS_VALUE_REFERENCE_KINDS.shipmentStatus,
    dictionaryKeys: [SHIPMENT_STATUS_DICTIONARY],
    requiredFeatures: ['sales.orders.view'],
  }),
]
