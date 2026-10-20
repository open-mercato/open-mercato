import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { loadCustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { defineExplainConfig } from '@open-mercato/shared/modules/insights/explain'
import type {
  ExplainFieldDescriptor,
  ExplainLoadContext,
  ExplainReferenceDetail,
  ExplainReferenceResolver,
} from '@open-mercato/shared/modules/insights/explain'
import {
  flattenExplainCustomFields,
  isExplainRecordId,
  normalizeExplainIds,
  resolveExplainDecryptionScope,
  resolveExplainOrganizationWhere,
  resolveExplainRecordIdPage,
  runExplainResolverSafely,
  toExplainTimestamp,
  type ExplainRecordIdListOptions,
} from '@open-mercato/shared/modules/insights/helpers'
import { E } from '#generated/entities.ids.generated'
import {
  CustomerDeal,
  CustomerDictionaryEntry,
  CustomerEntity,
  CustomerPipelineStage,
} from './data/entities'
import type { CustomerEntityKind } from './data/entities'
import { mergePersonCustomFieldValues, resolvePersonCustomFieldRouting } from './lib/customFieldRouting'
import { canonicalDealStatus } from './lib/dealStatus'

export const CUSTOMERS_EXPLAIN_REFERENCE_KINDS = {
  pipelineStage: 'customers.pipeline_stage',
  dealStatus: 'customers.dictionary.deal_status',
  entityStatus: 'customers.dictionary.status',
  lifecycleStage: 'customers.dictionary.lifecycle_stage',
} as const

const USER_REFERENCE_KIND = 'auth.user'
const REFERENCE_FAILURE_CODE = 'customers.insights_reference_failed'
const DICTIONARIES_READ_FEATURE = 'customers.people.view'
const DEALS_READ_FEATURE = 'customers.deals.view'

const customerEntityFields: ExplainFieldDescriptor[] = [
  {
    key: 'displayName',
    labelKey: 'customers.insights.fields.displayName',
    valueKind: 'text',
    snapshotPaths: ['entity.displayName'],
    changeKeys: ['entity.displayName'],
    currentPath: 'displayName',
  },
  {
    key: 'status',
    labelKey: 'customers.insights.fields.status',
    valueKind: 'dictionary',
    snapshotPaths: ['entity.status'],
    changeKeys: ['entity.status'],
    currentPath: 'status',
    referenceKind: CUSTOMERS_EXPLAIN_REFERENCE_KINDS.entityStatus,
  },
  {
    key: 'lifecycleStage',
    labelKey: 'customers.insights.fields.lifecycleStage',
    valueKind: 'dictionary',
    snapshotPaths: ['entity.lifecycleStage'],
    changeKeys: ['entity.lifecycleStage'],
    currentPath: 'lifecycleStage',
    referenceKind: CUSTOMERS_EXPLAIN_REFERENCE_KINDS.lifecycleStage,
  },
]

const dealFields: ExplainFieldDescriptor[] = [
  {
    key: 'status',
    labelKey: 'customers.insights.fields.status',
    valueKind: 'dictionary',
    snapshotPaths: ['deal.status'],
    changeKeys: ['deal.status'],
    currentPath: 'status',
    referenceKind: CUSTOMERS_EXPLAIN_REFERENCE_KINDS.dealStatus,
  },
  {
    key: 'pipelineStageId',
    labelKey: 'customers.insights.fields.pipelineStage',
    valueKind: 'reference',
    snapshotPaths: ['deal.pipelineStageId'],
    changeKeys: ['deal.pipelineStageId'],
    currentPath: 'pipelineStageId',
    referenceKind: CUSTOMERS_EXPLAIN_REFERENCE_KINDS.pipelineStage,
  },
  {
    key: 'valueAmount',
    labelKey: 'customers.insights.fields.valueAmount',
    valueKind: 'money',
    snapshotPaths: ['deal.valueAmount'],
    changeKeys: ['deal.valueAmount'],
    currentPath: 'valueAmount',
  },
  {
    key: 'valueCurrency',
    labelKey: 'customers.insights.fields.valueCurrency',
    valueKind: 'text',
    snapshotPaths: ['deal.valueCurrency'],
    changeKeys: ['deal.valueCurrency'],
    currentPath: 'valueCurrency',
  },
  {
    key: 'ownerUserId',
    labelKey: 'customers.insights.fields.owner',
    valueKind: 'user',
    snapshotPaths: ['deal.ownerUserId'],
    changeKeys: ['deal.ownerUserId'],
    currentPath: 'ownerUserId',
    referenceKind: USER_REFERENCE_KIND,
  },
]

async function loadDealCurrent(ctx: ExplainLoadContext, id: string): Promise<Record<string, unknown> | null> {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  if (!organizationWhere || !isExplainRecordId(id)) return null
  const deal = await findOneWithDecryption(
    ctx.em,
    CustomerDeal,
    { id, tenantId: ctx.scope.tenantId, deletedAt: null, ...organizationWhere },
    undefined,
    resolveExplainDecryptionScope(ctx.scope),
  )
  if (!deal) return null
  const custom = await loadCustomFieldSnapshot(ctx.em, {
    entityId: E.customers.customer_deal,
    recordId: deal.id,
    tenantId: deal.tenantId,
    organizationId: deal.organizationId,
  })
  return {
    id: deal.id,
    organizationId: deal.organizationId,
    updatedAt: toExplainTimestamp(deal.updatedAt),
    status: deal.status ?? null,
    pipelineStageId: deal.pipelineStageId ?? null,
    valueAmount: deal.valueAmount ?? null,
    valueCurrency: deal.valueCurrency ?? null,
    ownerUserId: deal.ownerUserId ?? null,
    ...flattenExplainCustomFields(custom),
  }
}

async function loadCustomerEntity(ctx: ExplainLoadContext, id: string, kind: CustomerEntityKind) {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  if (!organizationWhere || !isExplainRecordId(id)) return null
  const populate = kind === 'person' ? (['personProfile'] as const) : (['companyProfile'] as const)
  return findOneWithDecryption(
    ctx.em,
    CustomerEntity,
    { id, tenantId: ctx.scope.tenantId, kind, deletedAt: null, ...organizationWhere },
    { populate },
    resolveExplainDecryptionScope(ctx.scope),
  )
}

function buildEntityCurrent(entity: CustomerEntity, custom: Record<string, unknown>): Record<string, unknown> {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    updatedAt: toExplainTimestamp(entity.updatedAt),
    displayName: entity.displayName ?? null,
    status: entity.status ?? null,
    lifecycleStage: entity.lifecycleStage ?? null,
    ...flattenExplainCustomFields(custom),
  }
}

async function loadPersonCurrent(ctx: ExplainLoadContext, id: string): Promise<Record<string, unknown> | null> {
  const entity = await loadCustomerEntity(ctx, id, 'person')
  if (!entity) return null
  const scope = { tenantId: entity.tenantId, organizationId: entity.organizationId }
  const entityCustom = await loadCustomFieldSnapshot(ctx.em, {
    entityId: E.customers.customer_entity,
    recordId: entity.id,
    ...scope,
  })
  const profileId = entity.personProfile?.id ?? null
  if (!profileId) return buildEntityCurrent(entity, entityCustom)
  const profileCustom = await loadCustomFieldSnapshot(ctx.em, {
    entityId: E.customers.customer_person_profile,
    recordId: profileId,
    ...scope,
  })
  const routing = await resolvePersonCustomFieldRouting(ctx.em, entity.tenantId, entity.organizationId)
  return buildEntityCurrent(entity, mergePersonCustomFieldValues(routing, entityCustom, profileCustom))
}

async function loadCompanyCurrent(ctx: ExplainLoadContext, id: string): Promise<Record<string, unknown> | null> {
  const entity = await loadCustomerEntity(ctx, id, 'company')
  if (!entity) return null
  const profileId = entity.companyProfile?.id ?? null
  if (!profileId) return buildEntityCurrent(entity, {})
  const custom = await loadCustomFieldSnapshot(ctx.em, {
    entityId: E.customers.customer_company_profile,
    recordId: profileId,
    tenantId: entity.tenantId,
    organizationId: entity.organizationId,
  })
  return buildEntityCurrent(entity, custom)
}

async function listDealIds(ctx: ExplainLoadContext, options: ExplainRecordIdListOptions): Promise<string[]> {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  const page = resolveExplainRecordIdPage(options)
  if (!organizationWhere || !page) return []
  const deals = await findWithDecryption(
    ctx.em,
    CustomerDeal,
    { tenantId: ctx.scope.tenantId, deletedAt: null, ...organizationWhere, ...page.where },
    { fields: ['id'], orderBy: { id: 'asc' }, limit: page.limit },
    resolveExplainDecryptionScope(ctx.scope),
  )
  return deals.map((deal) => String(deal.id))
}

function buildEntityIdLister(kind: CustomerEntityKind) {
  return async (ctx: ExplainLoadContext, options: ExplainRecordIdListOptions): Promise<string[]> => {
    const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
    const page = resolveExplainRecordIdPage(options)
    if (!organizationWhere || !page) return []
    const entities = await findWithDecryption(
      ctx.em,
      CustomerEntity,
      { tenantId: ctx.scope.tenantId, kind, deletedAt: null, ...organizationWhere, ...page.where },
      { fields: ['id'], orderBy: { id: 'asc' }, limit: page.limit },
      resolveExplainDecryptionScope(ctx.scope),
    )
    return entities.map((entity) => String(entity.id))
  }
}

async function resolvePipelineStages(ctx: ExplainLoadContext, ids: string[]): Promise<ExplainReferenceDetail[]> {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  const stageIds = normalizeExplainIds(ids, { uuidOnly: true })
  if (!organizationWhere || stageIds.length === 0) return []
  const stages = await findWithDecryption(
    ctx.em,
    CustomerPipelineStage,
    { id: { $in: stageIds }, tenantId: ctx.scope.tenantId, ...organizationWhere },
    undefined,
    resolveExplainDecryptionScope(ctx.scope),
  )
  return stages.map((stage) => ({
    kind: CUSTOMERS_EXPLAIN_REFERENCE_KINDS.pipelineStage,
    id: stage.id,
    label: stage.label,
    href: null,
    organizationId: stage.organizationId,
    facts: { pipelineId: stage.pipelineId, order: stage.order },
  }))
}

type DictionaryReferenceOptions = {
  referenceKind: string
  dictionaryKind: string
  requiredFeatures: string[]
  canonicalize?: (value: string) => string
}

function buildDictionaryLookups(value: string, canonicalize?: (value: string) => string): string[] {
  const lookups = [value.trim().toLowerCase()]
  if (canonicalize) lookups.push(canonicalize(value.trim()).toLowerCase())
  return Array.from(new Set(lookups.filter((lookup) => lookup.length > 0)))
}

async function resolveDictionaryValues(
  ctx: ExplainLoadContext,
  values: string[],
  options: DictionaryReferenceOptions,
): Promise<ExplainReferenceDetail[]> {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  const requested = normalizeExplainIds(values)
  if (!organizationWhere || requested.length === 0) return []
  const lookupsByValue = new Map<string, string[]>()
  for (const value of requested) lookupsByValue.set(value, buildDictionaryLookups(value, options.canonicalize))
  const allLookups = Array.from(new Set(Array.from(lookupsByValue.values()).flat()))
  if (allLookups.length === 0) return []
  const entries = await findWithDecryption(
    ctx.em,
    CustomerDictionaryEntry,
    {
      tenantId: ctx.scope.tenantId,
      kind: options.dictionaryKind,
      normalizedValue: { $in: allLookups },
      ...organizationWhere,
    },
    { orderBy: { createdAt: 'asc', id: 'asc' } },
    resolveExplainDecryptionScope(ctx.scope),
  )
  const entryByLookup = new Map<string, CustomerDictionaryEntry>()
  for (const entry of entries) {
    if (!entryByLookup.has(entry.normalizedValue)) entryByLookup.set(entry.normalizedValue, entry)
  }
  const details: ExplainReferenceDetail[] = []
  for (const [value, lookups] of lookupsByValue.entries()) {
    const entry = lookups.map((lookup) => entryByLookup.get(lookup)).find((candidate) => candidate !== undefined)
    if (!entry) continue
    details.push({
      kind: options.referenceKind,
      id: value,
      label: entry.label,
      href: null,
      organizationId: entry.organizationId,
      facts: { value: entry.value },
    })
  }
  return details
}

function buildDictionaryReferenceResolver(options: DictionaryReferenceOptions): ExplainReferenceResolver {
  return {
    kind: options.referenceKind,
    requiredFeatures: options.requiredFeatures,
    resolve: (ctx, values) =>
      runExplainResolverSafely(
        { module: 'customers', code: REFERENCE_FAILURE_CODE, kind: options.referenceKind },
        () => resolveDictionaryValues(ctx, values, options),
      ),
  }
}

export const explainConfig = defineExplainConfig({
  version: 1,
  resources: [
    {
      resourceKind: 'customers.deal',
      logResourceKinds: ['customers.deal'],
      labelKey: 'customers.insights.resources.deal',
      formEntityIds: ['customers.deal', 'customers.customer_deal'],
      requiredFeatures: [DEALS_READ_FEATURE],
      loadCurrent: loadDealCurrent,
      listRecordIds: listDealIds,
      fields: dealFields,
      customFields: { entityId: E.customers.customer_deal, snapshotContainers: ['custom'] },
      recordHref: (id) => `/backend/customers/deals/${encodeURIComponent(id)}`,
    },
    {
      resourceKind: 'customers.person',
      logResourceKinds: ['customers.person'],
      labelKey: 'customers.insights.resources.person',
      formEntityIds: ['customers.person'],
      requiredFeatures: ['customers.people.view'],
      loadCurrent: loadPersonCurrent,
      listRecordIds: buildEntityIdLister('person'),
      fields: customerEntityFields,
      customFields: { entityId: E.customers.customer_person_profile, snapshotContainers: ['custom'] },
      recordHref: (id) => `/backend/customers/people-v2/${encodeURIComponent(id)}`,
    },
    {
      resourceKind: 'customers.company',
      logResourceKinds: ['customers.company'],
      labelKey: 'customers.insights.resources.company',
      formEntityIds: ['customers.company'],
      requiredFeatures: ['customers.companies.view'],
      loadCurrent: loadCompanyCurrent,
      listRecordIds: buildEntityIdLister('company'),
      fields: customerEntityFields,
      customFields: { entityId: E.customers.customer_company_profile, snapshotContainers: ['custom'] },
      recordHref: (id) => `/backend/customers/companies-v2/${encodeURIComponent(id)}`,
    },
  ],
  referenceResolvers: [
    {
      kind: CUSTOMERS_EXPLAIN_REFERENCE_KINDS.pipelineStage,
      requiredFeatures: ['customers.pipelines.view'],
      resolve: (ctx, ids) =>
        runExplainResolverSafely(
          { module: 'customers', code: REFERENCE_FAILURE_CODE, kind: CUSTOMERS_EXPLAIN_REFERENCE_KINDS.pipelineStage },
          () => resolvePipelineStages(ctx, ids),
        ),
    },
    buildDictionaryReferenceResolver({
      referenceKind: CUSTOMERS_EXPLAIN_REFERENCE_KINDS.dealStatus,
      dictionaryKind: 'deal_status',
      requiredFeatures: [DEALS_READ_FEATURE],
      canonicalize: canonicalDealStatus,
    }),
    buildDictionaryReferenceResolver({
      referenceKind: CUSTOMERS_EXPLAIN_REFERENCE_KINDS.entityStatus,
      dictionaryKind: 'status',
      requiredFeatures: [DICTIONARIES_READ_FEATURE],
    }),
    buildDictionaryReferenceResolver({
      referenceKind: CUSTOMERS_EXPLAIN_REFERENCE_KINDS.lifecycleStage,
      dictionaryKind: 'lifecycle_stage',
      requiredFeatures: [DICTIONARIES_READ_FEATURE],
    }),
  ],
})

export default explainConfig
