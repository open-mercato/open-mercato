import type { QueryCustomFieldSource, QueryEngine } from '@open-mercato/shared/lib/query/types'
import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchResultPresenter,
  SearchResultLink,
  SearchIndexSource,
} from '@open-mercato/shared/modules/search'

// =============================================================================
// Context Types
// =============================================================================

type SearchContext = SearchBuildContext & {
  tenantId: string
  queryEngine?: QueryEngine
}

function assertTenantContext(ctx: SearchBuildContext): asserts ctx is SearchContext {
  if (typeof ctx.tenantId !== 'string' || ctx.tenantId.length === 0) {
    throw new Error('[search.customers] Missing tenantId in search build context')
  }
}

type CustomerProfileKind = 'person' | 'company'

type LoadedCustomerEntity = {
  entity: Record<string, unknown> | null
  customFields: Record<string, unknown>
}

// =============================================================================
// Caching
// =============================================================================

const entityIdCache = new Map<string, LoadedCustomerEntity | null>()
const profileEntityCache = new WeakMap<Record<string, unknown>, Partial<Record<CustomerProfileKind, LoadedCustomerEntity | null>>>()
const todoCache = new WeakMap<Record<string, unknown>, unknown>()

// =============================================================================
// Query Configuration
// =============================================================================

const CUSTOMER_ENTITY_FIELDS = [
  'id',
  'kind',
  'display_name',
  'description',
  'primary_email',
  'primary_phone',
  'status',
  'lifecycle_stage',
  'owner_user_id',
  'source',
  'next_interaction_at',
  'next_interaction_name',
  'next_interaction_ref_id',
  'next_interaction_icon',
  'next_interaction_color',
  'organization_id',
  'tenant_id',
  'created_at',
  'updated_at',
  'deleted_at',
] satisfies string[]

const CUSTOMER_CUSTOM_FIELD_SOURCES: QueryCustomFieldSource[] = [
  {
    entityId: 'customers:customer_person_profile',
    table: 'customer_people',
    alias: 'person_profile',
    recordIdColumn: 'id',
    join: { fromField: 'id', toField: 'entity_id' },
  },
  {
    entityId: 'customers:customer_company_profile',
    table: 'customer_companies',
    alias: 'company_profile',
    recordIdColumn: 'id',
    join: { fromField: 'id', toField: 'entity_id' },
  },
]

// =============================================================================
// Helper Functions
// =============================================================================

function extractCustomFieldMap(source: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!source) return {}
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (key.startsWith('cf:')) {
      result[key.slice(3)] = value
    } else if (key.startsWith('cf_')) {
      result[key.slice(3)] = value
    }
  }
  return result
}

function normalizeCustomerEntity(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    id: row.id ?? row.entity_id ?? row.entityId ?? null,
    kind: row.kind ?? null,
  }
  const assign = (snake: string, camel?: string) => {
    const value = row[snake] ?? (camel ? row[camel] : undefined)
    if (value !== undefined) {
      normalized[snake] = value
      if (camel) normalized[camel] = value
    }
  }
  assign('display_name', 'displayName')
  assign('description')
  assign('primary_email', 'primaryEmail')
  assign('primary_phone', 'primaryPhone')
  assign('status')
  assign('lifecycle_stage', 'lifecycleStage')
  assign('owner_user_id', 'ownerUserId')
  assign('source')
  assign('next_interaction_at', 'nextInteractionAt')
  assign('next_interaction_name', 'nextInteractionName')
  assign('next_interaction_ref_id', 'nextInteractionRefId')
  assign('next_interaction_icon', 'nextInteractionIcon')
  assign('next_interaction_color', 'nextInteractionColor')
  assign('organization_id', 'organizationId')
  assign('tenant_id', 'tenantId')
  assign('created_at', 'createdAt')
  assign('updated_at', 'updatedAt')
  assign('deleted_at', 'deletedAt')
  return normalized
}

function getProfileCache(record: Record<string, unknown>): Partial<Record<CustomerProfileKind, LoadedCustomerEntity | null>> {
  let cache = profileEntityCache.get(record)
  if (!cache) {
    cache = {}
    profileEntityCache.set(record, cache)
  }
  return cache
}

function subtractCustomFields(
  primary: Record<string, unknown>,
  secondary: Record<string, unknown>,
): Record<string, unknown> {
  if (!secondary || Object.keys(secondary).length === 0) return {}
  const primaryKeys = new Set(Object.keys(primary))
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(secondary)) {
    if (!primaryKeys.has(key)) {
      result[key] = value
    }
  }
  return result
}

// =============================================================================
// Entity Loading Functions
// =============================================================================

type CustomerEntityQueryOptions = {
  entityId?: string | null
  profileKind?: CustomerProfileKind
  profileId?: string | null
}

async function loadCustomerEntityBundle(ctx: SearchContext, opts: CustomerEntityQueryOptions): Promise<LoadedCustomerEntity | null> {
  if (!ctx.queryEngine) return null
  const filters: Record<string, unknown> = {}
  const resolvedEntityId = typeof opts.entityId === 'string' && opts.entityId.length ? opts.entityId : null
  const resolvedProfileId =
    opts.profileId != null && String(opts.profileId).trim().length > 0 ? String(opts.profileId).trim() : null
  if (resolvedEntityId) {
    filters.id = { $eq: resolvedEntityId }
  }
  if (opts.profileKind && resolvedProfileId) {
    const alias = opts.profileKind === 'person' ? 'person_profile' : 'company_profile'
    filters[`${alias}.id`] = { $eq: resolvedProfileId }
  }
  if (!Object.keys(filters).length) return null
  try {
    const result = await ctx.queryEngine.query('customers:customer_entity', {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId ?? undefined,
      filters,
      includeCustomFields: true,
      customFieldSources: CUSTOMER_CUSTOM_FIELD_SOURCES,
      fields: CUSTOMER_ENTITY_FIELDS,
      page: { page: 1, pageSize: 1 },
    })
    const row = result.items[0] as Record<string, unknown> | undefined
    if (!row) return null
    const entity = normalizeCustomerEntity(row)
    const customFields = extractCustomFieldMap(row)
    return { entity, customFields }
  } catch (error) {
    console.warn('[search.customers] Failed to load customer entity via QueryEngine', {
      entityId: resolvedEntityId ?? null,
      profileKind: opts.profileKind ?? null,
      profileId: resolvedProfileId ?? null,
      error: error instanceof Error ? error.message : error,
    })
    return null
  }
}

async function loadCustomerEntityForProfile(ctx: SearchContext, kind: CustomerProfileKind): Promise<LoadedCustomerEntity | null> {
  const cache = getProfileCache(ctx.record)
  if (cache[kind] !== undefined) return cache[kind] ?? null
  const entityIdHint = resolveCustomerEntityId(ctx.record)
  const profileIdRaw = ctx.record.id ?? null
  const profileId = profileIdRaw != null ? String(profileIdRaw) : null
  if (!entityIdHint && !profileId) {
    cache[kind] = null
    return null
  }
  const loaded = await loadCustomerEntityBundle(ctx, {
    entityId: entityIdHint,
    profileKind: kind,
    profileId,
  })
  cache[kind] = loaded ?? null
  const resolvedId = loaded?.entity?.id ?? entityIdHint
  if (resolvedId && typeof resolvedId === 'string') {
    ctx.record.entity_id ??= resolvedId
    ctx.record.entityId ??= resolvedId
    entityIdCache.set(resolvedId, loaded ?? null)
  }
  if (loaded?.entity) {
    if (!ctx.record.entity) ctx.record.entity = loaded.entity
    if (!ctx.record.customer_entity) ctx.record.customer_entity = loaded.entity
  }
  return loaded ?? null
}

async function loadCustomerEntityById(ctx: SearchContext, entityId: string | null | undefined): Promise<LoadedCustomerEntity | null> {
  const resolvedId = typeof entityId === 'string' && entityId.length ? entityId : null
  if (!resolvedId) return null
  if (entityIdCache.has(resolvedId)) {
    return entityIdCache.get(resolvedId) ?? null
  }
  const loaded = await loadCustomerEntityBundle(ctx, { entityId: resolvedId })
  entityIdCache.set(resolvedId, loaded ?? null)
  return loaded ?? null
}

async function getCustomerEntity(ctx: SearchContext, entityId?: string | null): Promise<Record<string, unknown> | null> {
  const profileCache = profileEntityCache.get(ctx.record)
  if (profileCache) {
    const cached = Object.values(profileCache).find((entry) => {
      if (!entry?.entity) return false
      if (!entityId) return true
      return entry.entity.id === entityId
    })
    if (cached?.entity) return cached.entity
  }
  const inline = getInlineCustomerEntity(ctx.record)
  if (inline && (!entityId || inline.id === entityId)) {
    if (inline.id && typeof inline.id === 'string') {
      entityIdCache.set(inline.id, { entity: inline, customFields: {} })
    }
    return inline
  }
  const resolvedId = entityId ?? resolveCustomerEntityId(ctx.record)
  const loaded = await loadCustomerEntityById(ctx, resolvedId)
  return loaded?.entity ?? null
}

type HydratedProfileContext = {
  entity: Record<string, unknown> | null
  entityId: string | null
  profileCustomFields: Record<string, unknown>
  entityCustomFields: Record<string, unknown>
  entityOnlyCustomFields: Record<string, unknown>
}

async function hydrateProfileContext(ctx: SearchContext, kind: CustomerProfileKind): Promise<HydratedProfileContext> {
  const profileCustomFields = ctx.customFields ?? {}
  const loaded = await loadCustomerEntityForProfile(ctx, kind)
  let entity = loaded?.entity ?? getInlineCustomerEntity(ctx.record)
  let entityCustomFields = loaded?.customFields ?? {}
  let entityId = (entity?.id as string | undefined) ?? resolveCustomerEntityId(ctx.record)
  if (!entity && entityId) {
    const fetched = await loadCustomerEntityById(ctx, entityId)
    entity = fetched?.entity ?? null
    if (fetched?.customFields) {
      entityCustomFields = Object.keys(entityCustomFields).length ? entityCustomFields : fetched.customFields
    }
  }
  if (!entity && !entityId) {
    entityId = resolveCustomerEntityId(ctx.record)
  }
  if (entity?.id && typeof entity.id === 'string') {
    entityId = entity.id
    ctx.record.entity_id ??= entity.id
    ctx.record.entityId ??= entity.id
    if (!ctx.record.entity) ctx.record.entity = entity
    if (!ctx.record.customer_entity) ctx.record.customer_entity = entity
  }
  const entityOnlyCustomFields = subtractCustomFields(profileCustomFields, entityCustomFields)
  return {
    entity: entity ?? null,
    entityId: entityId ?? null,
    profileCustomFields,
    entityCustomFields,
    entityOnlyCustomFields,
  }
}

async function loadRecord(ctx: SearchContext, entityId: string, recordId?: string | null) {
  if (!recordId || !ctx.queryEngine) return null
  const res = await ctx.queryEngine.query(entityId, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId ?? undefined,
    filters: { id: recordId },
    includeCustomFields: true,
    page: { page: 1, pageSize: 1 },
  })
  return res.items[0] as Record<string, unknown> | undefined
}

function resolveCustomerEntityId(record: Record<string, unknown>): string | null {
  const direct =
    record.customer_entity_id ??
    record.entityId ??
    record.entity_id ??
    record.customerEntityId ??
    record.customerEntityID ??
    (typeof record.entity === 'object' && record.entity ? (record.entity as Record<string, unknown>).id : undefined) ??
    (typeof record.customer_entity === 'object' && record.customer_entity ? (record.customer_entity as Record<string, unknown>).id : undefined)
  const value = typeof direct === 'string' && direct.length ? direct : null
  return value
}

function getInlineCustomerEntity(record: Record<string, unknown>): Record<string, unknown> | null {
  const inline =
    (typeof record.entity === 'object' && record.entity) ||
    (typeof record.customer_entity === 'object' && record.customer_entity) ||
    null
  return inline as Record<string, unknown> | null
}

async function getLinkedTodo(ctx: SearchContext) {
  if (todoCache.has(ctx.record)) {
    return todoCache.get(ctx.record)
  }
  const sourceRaw = typeof ctx.record.todo_source === 'string' ? ctx.record.todo_source : 'example:todo'
  const [moduleId, entityName] = sourceRaw.split(':')
  const entityId = moduleId && entityName ? `${moduleId}:${entityName}` : 'example:todo'
  const todo = await loadRecord(ctx, entityId, ctx.record.todo_id as string ?? ctx.record.todoId as string)
  todoCache.set(ctx.record, todo ?? null)
  return todo ?? null
}

// =============================================================================
// URL and Formatting Helpers
// =============================================================================

function buildCustomerUrl(kind: string | null | undefined, id?: string | null): string | null {
  if (!id) return null
  const encoded = encodeURIComponent(id)
  if (kind === 'person') return `/backend/customers/people/${encoded}`
  if (kind === 'company') return `/backend/customers/companies/${encoded}`
  return `/backend/customers/companies/${encoded}`
}

function formatDealValue(record: Record<string, unknown>): string | undefined {
  const amount = record.value_amount ?? record.valueAmount
  if (!amount) return undefined
  const currency = record.value_currency ?? record.valueCurrency ?? ''
  return currency ? `${amount} ${currency}` : String(amount)
}

function snippet(text: unknown, max = 140): string | undefined {
  if (typeof text !== 'string') return undefined
  const trimmed = text.trim()
  if (!trimmed.length) return undefined
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 3)}...`
}

function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = Array.isArray(value)
    ? value.map((item) => (item === null || item === undefined ? '' : String(item))).filter(Boolean).join(', ')
    : (typeof value === 'object' ? JSON.stringify(value) : String(value))
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

function friendlyLabel(input: string): string {
  return input
    .replace(/^cf:/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, (_, a, b) => `${a} ${b}`)
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function appendCustomFieldLines(lines: string[], customFields: Record<string, unknown>, prefix: string) {
  for (const [key, value] of Object.entries(customFields)) {
    if (value === null || value === undefined) continue
    const label = prefix ? `${prefix} ${friendlyLabel(key)}` : friendlyLabel(key)
    appendLine(lines, label, value)
  }
}

function pickValue(source: Record<string, unknown> | null | undefined, ...keys: string[]): unknown {
  if (!source) return undefined
  for (const key of keys) {
    if (key in source && source[key] != null) return source[key]
  }
  return undefined
}

function pickString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length) {
      return candidate.trim()
    }
  }
  return null
}

function pickLabel(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue
    const value = typeof candidate === 'string' ? candidate : String(candidate)
    const trimmed = value.trim()
    if (trimmed.length) return trimmed
  }
  return null
}

function appendCustomerEntityLines(
  lines: string[],
  entity: Record<string, unknown> | null,
  contactLabel: 'Customer' | 'Primary' = 'Customer',
) {
  if (!entity) return
  appendLine(lines, 'Customer', pickValue(entity, 'display_name', 'displayName') ?? entity.id)
  appendLine(lines, `${contactLabel} email`, pickValue(entity, 'primary_email', 'primaryEmail'))
  appendLine(lines, `${contactLabel} phone`, pickValue(entity, 'primary_phone', 'primaryPhone'))
  appendLine(lines, 'Lifecycle stage', pickValue(entity, 'lifecycle_stage', 'lifecycleStage'))
  appendLine(lines, 'Status', pickValue(entity, 'status'))
}

function ensureFallbackLines(lines: string[], record: Record<string, unknown>, options: { includeId?: boolean } = {}) {
  if (lines.length) return
  const excluded = new Set(['tenant_id', 'organization_id', 'created_at', 'updated_at', 'deleted_at'])
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue
    if (excluded.has(key)) continue
    if (key === 'id') continue
    appendLine(lines, friendlyLabel(key), value)
  }
  if (!lines.length && options.includeId !== false) {
    const fallbackId =
      record.id ??
      record.entity_id ??
      record.customer_entity_id ??
      record.entityId ??
      record.customerEntityId ??
      null
    if (fallbackId) {
      appendLine(lines, 'Record ID', fallbackId)
    }
  }
}

// =============================================================================
// Presenter Functions
// =============================================================================

function resolvePersonPresenter(
  record: Record<string, unknown>,
  entity: Record<string, unknown> | null,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const fallbackEntityId = resolveCustomerEntityId(record)
  const firstName = record.first_name ?? record.firstName ?? customFields.first_name ?? customFields.firstName ?? ''
  const lastName = record.last_name ?? record.lastName ?? customFields.last_name ?? customFields.lastName ?? ''
  const nameParts = [firstName, lastName].filter(Boolean).join(' ')
  const title =
    (pickValue(entity, 'display_name', 'displayName') as string | undefined) ??
    (record.preferred_name as string | undefined) ??
    (record.preferredName as string | undefined) ??
    (nameParts.length ? nameParts : undefined) ??
    fallbackEntityId ??
    (record.id as string | undefined) ??
    'Person'
  const subtitlePieces: string[] = []
  const jobTitle = record.job_title ?? record.jobTitle ?? customFields.job_title ?? customFields.jobTitle
  if (jobTitle) subtitlePieces.push(String(jobTitle))
  const department = record.department ?? customFields.department
  if (department) subtitlePieces.push(String(department))
  const primaryEmail = pickValue(entity, 'primary_email', 'primaryEmail')
  if (primaryEmail) subtitlePieces.push(String(primaryEmail))
  const primaryPhone = pickValue(entity, 'primary_phone', 'primaryPhone')
  if (primaryPhone) subtitlePieces.push(String(primaryPhone))
  const summary = snippet(
    (pickValue(entity, 'description') as string | undefined) ??
      (customFields.summary as string | undefined) ??
      (customFields.description as string | undefined),
  )
  if (summary) subtitlePieces.push(summary)
  return {
    title: String(title),
    subtitle: subtitlePieces.length ? subtitlePieces.join(' · ') : undefined,
    icon: 'user',
    badge: pickValue(entity, 'display_name', 'displayName') ? 'Person' : undefined,
  }
}

function resolveCompanyPresenter(
  record: Record<string, unknown>,
  entity: Record<string, unknown> | null,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const fallbackEntityId = resolveCustomerEntityId(record)
  const title =
    (pickValue(entity, 'display_name', 'displayName') as string | undefined) ??
    (customFields.display_name as string | undefined) ??
    (customFields.displayName as string | undefined) ??
    (record.brand_name as string | undefined) ??
    (record.legal_name as string | undefined) ??
    (record.domain as string | undefined) ??
    (record.brandName as string | undefined) ??
    (record.legalName as string | undefined) ??
    (entity?.id && entity?.display_name ? entity.display_name as string : undefined) ??
    fallbackEntityId ??
    (record.id as string | undefined) ??
    'Company'
  const subtitlePieces: string[] = []
  const industry = record.industry
  if (industry) subtitlePieces.push(String(industry))
  const sizeBucket = record.size_bucket ?? record.sizeBucket
  if (sizeBucket) subtitlePieces.push(String(sizeBucket))
  if (entity) {
    const primaryEmail = pickValue(entity, 'primary_email', 'primaryEmail')
    if (primaryEmail) subtitlePieces.push(String(primaryEmail))
  }
  const summary = snippet(
    (pickValue(entity, 'description') as string | undefined) ??
      (customFields.summary as string | undefined) ??
      (customFields.description as string | undefined) ??
      (record.summary as string | undefined) ??
      (record.description as string | undefined),
  )
  if (summary) subtitlePieces.push(summary)
  if (!entity && (!title || title === fallbackEntityId)) {
    console.warn('[search.customers] Missing customer entity during company presenter build', {
      recordId: record.id ?? null,
      entityId: fallbackEntityId,
      recordKeys: Object.keys(record),
    })
  }
  return {
    title: String(title),
    subtitle: subtitlePieces.length ? subtitlePieces.join(' · ') : undefined,
    icon: 'building',
    badge: pickValue(entity, 'display_name', 'displayName') ? 'Company' : undefined,
  }
}

function logMissingPresenterTitle(
  kind: 'person' | 'company',
  record: Record<string, unknown>,
  entity: Record<string, unknown> | null,
  presenter: SearchResultPresenter,
) {
  const fallbackId = record.id ?? record.entity_id ?? resolveCustomerEntityId(record)
  if (!fallbackId) return
  if (presenter.title && presenter.title !== String(fallbackId)) return
  console.warn('[search.customers] Presenter fell back to record id', {
    kind,
    recordId: fallbackId,
    entityId: resolveCustomerEntityId(record),
    entityDisplayName: entity?.display_name ?? null,
  })
}

// =============================================================================
// Search Module Configuration
// =============================================================================

export const searchConfig: SearchModuleConfig = {
  entities: [
    // =========================================================================
    // Person Profile
    // =========================================================================
    {
      entityId: 'customers:customer_person_profile',
      enabled: true,
      priority: 10,

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        assertTenantContext(ctx)
        const lines: string[] = []
        const record = ctx.record
        appendLine(lines, 'Preferred name', record.preferred_name ?? record.preferredName ?? ctx.customFields.preferred_name)
        appendLine(lines, 'First name', record.first_name ?? record.firstName ?? ctx.customFields.first_name)
        appendLine(lines, 'Last name', record.last_name ?? record.lastName ?? ctx.customFields.last_name)
        appendLine(lines, 'Job title', record.job_title ?? record.jobTitle ?? ctx.customFields.job_title)
        appendLine(lines, 'Department', record.department ?? record.department_name ?? record.departmentName ?? ctx.customFields.department)
        appendLine(lines, 'Seniority', record.seniority ?? record.seniority_level ?? record.seniorityLevel ?? ctx.customFields.seniority)
        appendLine(lines, 'Timezone', record.timezone ?? record.time_zone ?? record.timeZone ?? ctx.customFields.timezone)
        appendLine(lines, 'LinkedIn', record.linked_in_url ?? record.linkedInUrl ?? ctx.customFields.linked_in_url)
        appendLine(lines, 'Twitter', record.twitter_url ?? record.twitterUrl ?? ctx.customFields.twitter_url)

        const { entity, entityId, profileCustomFields, entityCustomFields, entityOnlyCustomFields } =
          await hydrateProfileContext(ctx, 'person')
        appendCustomFieldLines(lines, profileCustomFields, 'Person custom')
        if (Object.keys(entityOnlyCustomFields).length) {
          appendCustomFieldLines(lines, entityOnlyCustomFields, 'Customer custom')
        }
        if (!entity) {
          console.warn('[search.customers] Failed to load customer entity for person profile', {
            recordId: record.id,
            entityId,
            recordKeys: Object.keys(record),
          })
        }
        appendCustomerEntityLines(lines, entity, 'Customer')
        ensureFallbackLines(lines, record)
        if (!lines.length) return null

        if (!entityId) {
          console.warn('[search.customers] person profile missing entity id', {
            recordId: record.id,
            recordKeys: Object.keys(record),
          })
        }

        const presenter = resolvePersonPresenter(record, entity, ctx.customFields)
        logMissingPresenterTitle('person', record, entity, presenter)
        const presenterLabel = pickLabel(presenter.title) ?? 'Open person'
        const links: SearchResultLink[] = []
        if (entityId) {
          const href = buildCustomerUrl('person', entityId)
          if (href) {
            links.push({ href, label: presenterLabel, kind: 'primary' })
          }
        }

        return {
          text: lines,
          presenter,
          links,
          checksumSource: {
            record: ctx.record,
            customFields: profileCustomFields,
            entity,
            entityCustomFields,
          },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        assertTenantContext(ctx)
        const entity = await getCustomerEntity(ctx, resolveCustomerEntityId(ctx.record))
        return resolvePersonPresenter(ctx.record, entity, ctx.customFields)
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const entityId = resolveCustomerEntityId(ctx.record)
        return buildCustomerUrl('person', entityId)
      },

      resolveLinks: async (ctx: SearchBuildContext): Promise<SearchResultLink[] | null> => {
        const entityId = resolveCustomerEntityId(ctx.record)
        if (!entityId) return null
        const href = buildCustomerUrl('person', entityId)
        if (!href) return null
        return [{ href: `${href}/edit`, label: 'Edit', kind: 'secondary' }]
      },

      fieldPolicy: {
        searchable: [
          'preferred_name',
          'first_name',
          'last_name',
          'job_title',
          'department',
          'seniority',
          'timezone',
          'linked_in_url',
          'twitter_url',
        ],
        hashOnly: ['primary_email', 'primary_phone', 'personal_email'],
        excluded: ['date_of_birth', 'government_id', 'ssn', 'tax_id'],
      },
    },

    // =========================================================================
    // Company Profile
    // =========================================================================
    {
      entityId: 'customers:customer_company_profile',
      enabled: true,
      priority: 10,

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        assertTenantContext(ctx)
        const lines: string[] = []
        const record = ctx.record
        appendLine(lines, 'Legal name', record.legal_name ?? record.legalName ?? ctx.customFields.legal_name)
        appendLine(lines, 'Brand name', record.brand_name ?? record.brandName ?? ctx.customFields.brand_name)
        appendLine(lines, 'Domain', record.domain ?? record.website_domain ?? record.websiteDomain ?? ctx.customFields.domain)
        appendLine(lines, 'Website', record.website_url ?? record.websiteUrl ?? ctx.customFields.website_url)
        appendLine(lines, 'Industry', record.industry ?? ctx.customFields.industry)
        appendLine(lines, 'Company size', record.size_bucket ?? record.sizeBucket ?? ctx.customFields.size_bucket)
        appendLine(lines, 'Annual revenue', record.annual_revenue ?? record.annualRevenue ?? ctx.customFields.annual_revenue)

        const { entity, entityId, profileCustomFields, entityCustomFields, entityOnlyCustomFields } =
          await hydrateProfileContext(ctx, 'company')
        appendCustomFieldLines(lines, profileCustomFields, 'Company custom')
        if (Object.keys(entityOnlyCustomFields).length) {
          appendCustomFieldLines(lines, entityOnlyCustomFields, 'Customer custom')
        }
        appendCustomerEntityLines(lines, entity, 'Primary')
        ensureFallbackLines(lines, record)
        if (!lines.length) return null

        const presenter = resolveCompanyPresenter(record, entity, ctx.customFields)
        logMissingPresenterTitle('company', record, entity, presenter)
        const primaryLabel = pickLabel(presenter.title) ?? 'Open company'
        const links: SearchResultLink[] = []
        if (entityId) {
          const href = buildCustomerUrl('company', entityId)
          if (href) {
            links.push({ href, label: primaryLabel, kind: 'primary' })
          }
        }

        return {
          text: lines,
          presenter,
          links,
          checksumSource: {
            record: ctx.record,
            customFields: profileCustomFields,
            entity,
            entityCustomFields,
          },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        assertTenantContext(ctx)
        const entity = await getCustomerEntity(ctx, resolveCustomerEntityId(ctx.record))
        return resolveCompanyPresenter(ctx.record, entity, ctx.customFields)
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const entityId = resolveCustomerEntityId(ctx.record)
        return buildCustomerUrl('company', entityId)
      },

      resolveLinks: async (ctx: SearchBuildContext): Promise<SearchResultLink[] | null> => {
        const entityId = resolveCustomerEntityId(ctx.record)
        if (!entityId) return null
        const href = buildCustomerUrl('company', entityId)
        if (!href) return null
        return [{ href: `${href}/edit`, label: 'Edit', kind: 'secondary' }]
      },

      fieldPolicy: {
        searchable: [
          'legal_name',
          'brand_name',
          'display_name',
          'domain',
          'website_url',
          'industry',
          'size_bucket',
          'description',
        ],
        hashOnly: ['tax_id', 'registration_number'],
        excluded: ['bank_account', 'billing_info', 'credit_info'],
      },
    },

    // =========================================================================
    // Customer Comment
    // =========================================================================
    {
      entityId: 'customers:customer_comment',
      enabled: true,
      priority: 6,

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        assertTenantContext(ctx)
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id as string ?? ctx.record.entityId as string)
        const lines: string[] = []
        if (parent?.display_name) lines.push(`Customer: ${parent.display_name}`)
        lines.push(`Note: ${ctx.record.body ?? ''}`)
        if (ctx.record.appearance_icon) lines.push(`Icon: ${ctx.record.appearance_icon}`)
        if (ctx.record.appearance_color) lines.push(`Color: ${ctx.record.appearance_color}`)

        const presenter: SearchResultPresenter | undefined = parent?.display_name
          ? {
              title: parent.display_name as string,
              subtitle: snippet(ctx.record.body),
              icon: parent.kind === 'person' ? 'user' : 'building',
            }
          : undefined

        return {
          text: lines,
          presenter,
          checksumSource: {
            body: ctx.record.body,
            entityId: ctx.record.entity_id ?? null,
            updatedAt: ctx.record.updated_at ?? ctx.record.updatedAt ?? null,
          },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        assertTenantContext(ctx)
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id as string ?? ctx.record.entityId as string)
        const title = (parent?.display_name as string | undefined) ?? 'Customer note'
        return {
          title,
          subtitle: snippet(ctx.record.body),
          icon: 'sticky-note',
        }
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        assertTenantContext(ctx)
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id as string ?? ctx.record.entityId as string)
        const base = buildCustomerUrl(parent?.kind as string ?? null, (parent?.id ?? ctx.record.entity_id ?? ctx.record.entityId) as string)
        return base ? `${base}#notes` : null
      },

      resolveLinks: async (ctx: SearchBuildContext): Promise<SearchResultLink[] | null> => {
        assertTenantContext(ctx)
        const links: SearchResultLink[] = []
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id as string ?? ctx.record.entityId as string)
        const parentUrl = buildCustomerUrl(parent?.kind as string ?? null, (parent?.id ?? ctx.record.entity_id ?? ctx.record.entityId) as string)
        if (parentUrl) {
          links.push({ href: parentUrl, label: (parent?.display_name as string | undefined) ?? 'View customer', kind: 'primary' })
        }
        if (ctx.record.deal_id) {
          const dealUrl = `/backend/customers/deals/${encodeURIComponent(ctx.record.deal_id as string)}`
          links.push({ href: dealUrl, label: 'Open deal', kind: 'secondary' })
        }
        return links.length ? links : null
      },

      fieldPolicy: {
        searchable: ['body'],
        hashOnly: [],
        excluded: [],
      },
    },

    // =========================================================================
    // Customer Deal
    // =========================================================================
    {
      entityId: 'customers:customer_deal',
      enabled: true,
      priority: 8,

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const lines: string[] = []
        const record = ctx.record
        appendLine(lines, 'Title', record.title)
        appendLine(lines, 'Stage', record.pipeline_stage)
        appendLine(lines, 'Status', record.status)
        appendLine(lines, 'Source', record.source)
        const value = formatDealValue(record)
        if (value) appendLine(lines, 'Value', value)
        if (!lines.length) return null

        const subtitleParts: string[] = []
        if (record.pipeline_stage) subtitleParts.push(String(record.pipeline_stage))
        if (record.status) subtitleParts.push(String(record.status))
        if (value) subtitleParts.push(value)

        return {
          text: lines,
          presenter: {
            title: String(record.title ?? 'Deal'),
            subtitle: subtitleParts.join(' · ') || undefined,
            icon: 'briefcase',
            badge: 'Deal',
          },
          checksumSource: {
            title: record.title,
            status: record.status,
            stage: record.pipeline_stage,
            value: value,
          },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        const { record } = ctx
        const title = pickString(record.title as string, 'Deal')
        const subtitleParts: string[] = []
        if (record.pipeline_stage) subtitleParts.push(String(record.pipeline_stage))
        if (record.status) subtitleParts.push(String(record.status))
        const amount = record.value_amount ?? record.valueAmount
        const currency = record.value_currency ?? record.valueCurrency
        if (amount) {
          subtitleParts.push(currency ? `${amount} ${currency}` : String(amount))
        }

        return {
          title: title ?? 'Deal',
          subtitle: subtitleParts.length ? subtitleParts.join(' · ') : undefined,
          icon: 'briefcase',
          badge: 'Deal',
        }
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const id = ctx.record.id
        if (!id) return null
        return `/backend/customers/deals/${encodeURIComponent(String(id))}`
      },

      resolveLinks: async (ctx: SearchBuildContext): Promise<SearchResultLink[] | null> => {
        const id = ctx.record.id
        if (!id) return null
        return [
          {
            href: `/backend/customers/deals/${encodeURIComponent(String(id))}/edit`,
            label: 'Edit',
            kind: 'secondary',
          },
        ]
      },

      fieldPolicy: {
        searchable: ['title', 'description', 'pipeline_stage', 'status', 'source'],
        hashOnly: [],
        excluded: ['value_amount', 'value_currency'],
      },
    },

    // =========================================================================
    // Customer Activity
    // =========================================================================
    {
      entityId: 'customers:customer_activity',
      enabled: true,
      priority: 5,

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        assertTenantContext(ctx)
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id as string ?? ctx.record.entityId as string)
        const lines: string[] = []
        if (parent?.display_name) lines.push(`Customer: ${parent.display_name}`)
        if (ctx.record.activity_type) lines.push(`Type: ${ctx.record.activity_type}`)
        if (ctx.record.subject) lines.push(`Subject: ${ctx.record.subject}`)
        if (ctx.record.body) lines.push(`Body: ${ctx.record.body}`)

        const presenter: SearchResultPresenter = {
          title: ctx.record.subject ? String(ctx.record.subject) : `Activity: ${ctx.record.activity_type ?? 'update'}`,
          subtitle: (parent?.display_name as string | undefined) ?? snippet(ctx.record.body),
          icon: 'bolt',
        }

        return {
          text: lines,
          presenter,
          checksumSource: {
            subject: ctx.record.subject,
            body: ctx.record.body,
            entityId: ctx.record.entity_id ?? null,
            updatedAt: ctx.record.updated_at ?? ctx.record.updatedAt ?? null,
          },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        assertTenantContext(ctx)
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id as string ?? ctx.record.entityId as string)
        return {
          title: ctx.record.subject ? String(ctx.record.subject) : `Activity: ${ctx.record.activity_type ?? 'update'}`,
          subtitle: (parent?.display_name as string | undefined) ?? snippet(ctx.record.body),
          icon: 'bolt',
          badge: 'Activity',
        }
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        assertTenantContext(ctx)
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id as string ?? ctx.record.entityId as string)
        const base = buildCustomerUrl(parent?.kind as string ?? null, (parent?.id ?? ctx.record.entity_id ?? ctx.record.entityId) as string)
        return base ? `${base}#activity-${ctx.record.id ?? ctx.record.activity_id ?? ''}` : null
      },

      resolveLinks: async (ctx: SearchBuildContext): Promise<SearchResultLink[] | null> => {
        const links: SearchResultLink[] = []
        if (ctx.record.deal_id) {
          links.push({
            href: `/backend/customers/deals/${encodeURIComponent(ctx.record.deal_id as string)}`,
            label: 'Open deal',
            kind: 'secondary',
          })
        }
        return links.length ? links : null
      },

      fieldPolicy: {
        searchable: ['subject', 'body', 'activity_type'],
        hashOnly: [],
        excluded: [],
      },
    },

    // =========================================================================
    // Customer Todo Link
    // =========================================================================
    {
      entityId: 'customers:customer_todo_link',
      enabled: true,
      priority: 4,

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        assertTenantContext(ctx)
        const todo = await getLinkedTodo(ctx) as Record<string, unknown> | null
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id as string ?? ctx.record.entityId as string)
        const lines: string[] = []
        if (todo?.title) lines.push(`Todo: ${todo.title}`)
        if (todo?.is_done !== undefined) lines.push(`Status: ${todo.is_done ? 'Done' : 'Open'}`)
        if (parent?.display_name) lines.push(`Customer: ${parent.display_name}`)
        if (!lines.length) return null

        return {
          text: lines,
          presenter: todo?.title
            ? { title: todo.title as string, subtitle: parent?.display_name as string | undefined, icon: 'check-square' }
            : undefined,
          checksumSource: {
            todoId: ctx.record.todo_id ?? ctx.record.todoId,
            todoSource: ctx.record.todo_source ?? ctx.record.todoSource,
            entityId: ctx.record.entity_id ?? ctx.record.entityId,
          },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        assertTenantContext(ctx)
        const todo = await getLinkedTodo(ctx) as Record<string, unknown> | null
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id as string ?? ctx.record.entityId as string)
        return {
          title: (todo?.title as string | undefined) ?? 'Customer task',
          subtitle: parent?.display_name as string | undefined,
          icon: 'check-square',
        }
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        assertTenantContext(ctx)
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id as string ?? ctx.record.entityId as string)
        const base = buildCustomerUrl(parent?.kind as string ?? null, (parent?.id ?? ctx.record.entity_id ?? ctx.record.entityId) as string)
        return base ? `${base}#tasks` : null
      },

      resolveLinks: async (ctx: SearchBuildContext): Promise<SearchResultLink[] | null> => {
        const todoId = ctx.record.todo_id ?? ctx.record.todoId
        if (!todoId) return null
        return [{
          href: `/backend/todos/${encodeURIComponent(todoId as string)}/edit`,
          label: 'Open todo',
          kind: 'secondary',
        }]
      },

      fieldPolicy: {
        searchable: [],
        hashOnly: [],
        excluded: [],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
