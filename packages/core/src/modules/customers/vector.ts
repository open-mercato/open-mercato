import type { QueryCustomFieldSource, QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { VectorLinkDescriptor, VectorModuleConfig, VectorResultPresenter } from '@open-mercato/shared/modules/vector'

type VectorContext = {
  record: Record<string, any>
  customFields: Record<string, any>
  tenantId: string
  organizationId?: string | null
  queryEngine?: QueryEngine
}

type CustomerProfileKind = 'person' | 'company'

type LoadedCustomerEntity = {
  entity: Record<string, any> | null
  customFields: Record<string, any>
}

const entityIdCache = new Map<string, LoadedCustomerEntity | null>()
const profileEntityCache = new WeakMap<Record<string, any>, Partial<Record<CustomerProfileKind, LoadedCustomerEntity | null>>>()
const todoCache = new WeakMap<Record<string, any>, any>()

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

function extractCustomFieldMap(source: Record<string, any> | null | undefined): Record<string, any> {
  if (!source) return {}
  const result: Record<string, any> = {}
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

function normalizeCustomerEntity(row: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {
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

function getProfileCache(record: Record<string, any>): Partial<Record<CustomerProfileKind, LoadedCustomerEntity | null>> {
  let cache = profileEntityCache.get(record)
  if (!cache) {
    cache = {}
    profileEntityCache.set(record, cache)
  }
  return cache
}

type CustomerEntityQueryOptions = {
  entityId?: string | null
  profileKind?: CustomerProfileKind
  profileId?: string | null
}

async function loadCustomerEntityBundle(ctx: VectorContext, opts: CustomerEntityQueryOptions): Promise<LoadedCustomerEntity | null> {
  if (!ctx.queryEngine) return null
  const filters: Record<string, any> = {}
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
    const row = result.items[0] as Record<string, any> | undefined
    if (!row) return null
    const entity = normalizeCustomerEntity(row)
    const customFields = extractCustomFieldMap(row)
    return { entity, customFields }
  } catch (error) {
    console.warn('[vector.customers] Failed to load customer entity via QueryEngine', {
      entityId: resolvedEntityId ?? null,
      profileKind: opts.profileKind ?? null,
      profileId: resolvedProfileId ?? null,
      error: error instanceof Error ? error.message : error,
    })
    return null
  }
}

async function loadCustomerEntityForProfile(ctx: VectorContext, kind: CustomerProfileKind): Promise<LoadedCustomerEntity | null> {
  const cache = getProfileCache(ctx.record)
  if (cache[kind] !== undefined) return cache[kind] ?? null
  const entityIdHint = resolveCustomerEntityId(ctx.record)
  if (!entityIdHint) {
    cache[kind] = null
    return null
  }
  const loaded = await loadCustomerEntityBundle(ctx, { entityId: entityIdHint, profileKind: kind })
  cache[kind] = loaded ?? null
  const resolvedId = loaded?.entity?.id ?? entityIdHint
  if (resolvedId) {
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

async function loadCustomerEntityById(ctx: VectorContext, entityId: string | null | undefined): Promise<LoadedCustomerEntity | null> {
  const resolvedId = typeof entityId === 'string' && entityId.length ? entityId : null
  if (!resolvedId) return null
  if (entityIdCache.has(resolvedId)) {
    return entityIdCache.get(resolvedId) ?? null
  }
  const loaded = await loadCustomerEntityBundle(ctx, { entityId: resolvedId })
  entityIdCache.set(resolvedId, loaded ?? null)
  return loaded ?? null
}

async function getCustomerEntity(ctx: VectorContext, entityId?: string | null): Promise<Record<string, any> | null> {
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
    if (inline.id) {
      entityIdCache.set(inline.id, { entity: inline, customFields: {} })
    }
    return inline
  }
  const resolvedId = entityId ?? resolveCustomerEntityId(ctx.record)
  const loaded = await loadCustomerEntityById(ctx, resolvedId)
  return loaded?.entity ?? null
}

async function loadRecord(ctx: VectorContext, entityId: string, recordId?: string | null) {
  if (!recordId || !ctx.queryEngine) return null
  const res = await ctx.queryEngine.query(entityId, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId ?? undefined,
    filters: { id: recordId },
    includeCustomFields: true,
    page: { page: 1, pageSize: 1 },
  })
  return res.items[0] as Record<string, any> | undefined
}

function resolveCustomerEntityId(record: Record<string, any>): string | null {
  const direct =
    record.customer_entity_id ??
    record.entityId ??
    record.entity_id ??
    record.customerEntityId ??
    record.customerEntityID ??
    (typeof record.entity === 'object' && record.entity ? record.entity.id : undefined) ??
    (typeof record.customer_entity === 'object' && record.customer_entity ? record.customer_entity.id : undefined)
  const value = typeof direct === 'string' && direct.length ? direct : null
  return value
}

function getInlineCustomerEntity(record: Record<string, any>): Record<string, any> | null {
  const inline =
    (typeof record.entity === 'object' && record.entity) ||
    (typeof record.customer_entity === 'object' && record.customer_entity) ||
    null
  return inline ?? null
}

async function getLinkedTodo(ctx: VectorContext) {
  if (todoCache.has(ctx.record)) {
    return todoCache.get(ctx.record)
  }
  const sourceRaw = typeof ctx.record.todo_source === 'string' ? ctx.record.todo_source : 'example:todo'
  const [moduleId, entityName] = sourceRaw.split(':')
  const entityId = moduleId && entityName ? `${moduleId}:${entityName}` : 'example:todo'
  const todo = await loadRecord(ctx, entityId, ctx.record.todo_id ?? ctx.record.todoId)
  todoCache.set(ctx.record, todo ?? null)
  return todo ?? null
}

function buildCustomerUrl(kind: string | null | undefined, id?: string | null) {
  if (!id) return null
  const encoded = encodeURIComponent(id)
  if (kind === 'person') return `/backend/customers/people/${encoded}`
  if (kind === 'company') return `/backend/customers/companies/${encoded}`
  return `/backend/customers/companies/${encoded}`
}

function formatDealValue(record: Record<string, any>): string | undefined {
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

function appendCustomFieldLines(lines: string[], customFields: Record<string, any>, prefix: string) {
  for (const [key, value] of Object.entries(customFields)) {
    if (value === null || value === undefined) continue
    const label = prefix ? `${prefix} ${friendlyLabel(key)}` : friendlyLabel(key)
    appendLine(lines, label, value)
  }
}

function pickValue(source: Record<string, any> | null | undefined, ...keys: string[]): unknown {
  if (!source) return undefined
  for (const key of keys) {
    if (key in source && source[key] != null) return source[key]
  }
  return undefined
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

function ensureFallbackLines(lines: string[], record: Record<string, any>, options: { includeId?: boolean } = {}) {
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

export const vectorConfig: VectorModuleConfig = {
  defaultDriverId: 'pgvector',
  entities: [
    {
      entityId: 'customers:customer_person_profile',
      buildSource: async (ctx) => {
        const lines: string[] = []
        const record = ctx.record
        appendLine(
          lines,
          'Preferred name',
          record.preferred_name ?? record.preferredName ?? ctx.customFields.preferred_name,
        )
        appendLine(
          lines,
          'First name',
          record.first_name ?? record.firstName ?? ctx.customFields.first_name,
        )
        appendLine(
          lines,
          'Last name',
          record.last_name ?? record.lastName ?? ctx.customFields.last_name,
        )
        appendLine(
          lines,
          'Job title',
          record.job_title ?? record.jobTitle ?? ctx.customFields.job_title,
        )
        appendLine(
          lines,
          'Department',
          record.department ?? record.department_name ?? record.departmentName ?? ctx.customFields.department,
        )
        appendLine(
          lines,
          'Seniority',
          record.seniority ?? record.seniority_level ?? record.seniorityLevel ?? ctx.customFields.seniority,
        )
        appendLine(
          lines,
          'Timezone',
          record.timezone ?? record.time_zone ?? record.timeZone ?? ctx.customFields.timezone,
        )
        appendLine(
          lines,
          'LinkedIn',
          record.linked_in_url ?? record.linkedInUrl ?? ctx.customFields.linked_in_url,
        )
        appendLine(
          lines,
          'Twitter',
          record.twitter_url ?? record.twitterUrl ?? ctx.customFields.twitter_url,
        )
        const profileCustomFields = ctx.customFields ?? {}
        appendCustomFieldLines(lines, profileCustomFields, 'Person custom')

        const loaded = await loadCustomerEntityForProfile(ctx, 'person')
        let entity = loaded?.entity ?? getInlineCustomerEntity(record)
        if (entity?.id) {
          record.entity_id ??= entity.id
          record.entityId ??= entity.id
        }
        const entityCustomFields = loaded?.customFields ?? {}
        if (Object.keys(entityCustomFields).length) {
          const profileKeys = new Set(Object.keys(profileCustomFields))
          const entityOnlyCustomFields = Object.fromEntries(
            Object.entries(entityCustomFields).filter(([key]) => !profileKeys.has(key)),
          )
          if (Object.keys(entityOnlyCustomFields).length) {
            appendCustomFieldLines(lines, entityOnlyCustomFields, 'Customer custom')
          }
        }
        const entityId = entity?.id ?? resolveCustomerEntityId(record)
        if (!entity) {
          console.warn('[vector.customers] Failed to load customer entity for person profile', {
            recordId: record.id,
            entityId,
            recordKeys: Object.keys(record),
          })
        }
        if (entity) {
          appendLine(lines, 'Customer', pickValue(entity, 'display_name', 'displayName') ?? entity.id)
          appendLine(lines, 'Customer email', pickValue(entity, 'primary_email', 'primaryEmail'))
          appendLine(lines, 'Customer phone', pickValue(entity, 'primary_phone', 'primaryPhone'))
          appendLine(lines, 'Lifecycle stage', pickValue(entity, 'lifecycle_stage', 'lifecycleStage'))
          appendLine(lines, 'Status', pickValue(entity, 'status'))
        }

        ensureFallbackLines(lines, record)
        if (!lines.length) return null

        if (!entityId) {
          console.warn('[vector.customers] person profile missing entity id', {
            recordId: record.id,
            recordKeys: Object.keys(record),
          })
        }
        const firstName = record.first_name ?? record.firstName
        const lastName = record.last_name ?? record.lastName
        const nameParts = [firstName, lastName].filter(Boolean).join(' ')
        const primaryLabel =
          pickLabel(
            pickValue(entity, 'display_name', 'displayName'),
            record.preferred_name,
            record.preferredName,
            nameParts,
            entityId,
            record.id,
            'Open person',
          ) ?? 'Open person'
        const presenter = resolvePersonPresenter(record, entity, ctx.customFields)
        logMissingPresenterTitle('person', record, entity, presenter)
        const presenterLabel = pickLabel(presenter.title, primaryLabel) ?? primaryLabel
        const links: VectorLinkDescriptor[] = []
        if (entityId) {
          const href = buildCustomerUrl('person', entityId)
          if (href) {
            links.push({ href, label: presenterLabel, kind: 'primary' })
          }
        }

        const checksumSource = {
          record: ctx.record,
          customFields: profileCustomFields,
          entity,
          entityCustomFields,
        }

        return {
          input: lines,
          presenter,
          links,
          checksumSource,
          payload: {
            kind: 'person',
            entityId: entityId ?? null,
            name: presenter.title,
          },
        }
      },
      formatResult: async (ctx) => {
        const entity = await getCustomerEntity(ctx, resolveCustomerEntityId(ctx.record))
        return resolvePersonPresenter(ctx.record, entity, ctx.customFields)
      },
      resolveUrl: async ({ record }) => buildCustomerUrl('person', resolveCustomerEntityId(record)),
    },
    {
      entityId: 'customers:customer_company_profile',
      buildSource: async (ctx) => {
        const lines: string[] = []
        const record = ctx.record
        appendLine(lines, 'Legal name', record.legal_name ?? record.legalName ?? ctx.customFields.legal_name)
        appendLine(lines, 'Brand name', record.brand_name ?? record.brandName ?? ctx.customFields.brand_name)
        appendLine(lines, 'Domain', record.domain ?? record.website_domain ?? record.websiteDomain ?? ctx.customFields.domain)
        appendLine(lines, 'Website', record.website_url ?? record.websiteUrl ?? ctx.customFields.website_url)
        appendLine(lines, 'Industry', record.industry ?? ctx.customFields.industry)
        appendLine(lines, 'Company size', record.size_bucket ?? record.sizeBucket ?? ctx.customFields.size_bucket)
        appendLine(
          lines,
          'Annual revenue',
          record.annual_revenue ?? record.annualRevenue ?? ctx.customFields.annual_revenue,
        )
        const profileCustomFields = ctx.customFields ?? {}
        appendCustomFieldLines(lines, profileCustomFields, 'Company custom')

        const loaded = await loadCustomerEntityForProfile(ctx, 'company')
        let entity = loaded?.entity ?? getInlineCustomerEntity(record)
        if (entity?.id) {
          record.entity_id ??= entity.id
          record.entityId ??= entity.id
        }
        const entityCustomFields = loaded?.customFields ?? {}
        if (Object.keys(entityCustomFields).length) {
          const profileKeys = new Set(Object.keys(profileCustomFields))
          const entityOnlyCustomFields = Object.fromEntries(
            Object.entries(entityCustomFields).filter(([key]) => !profileKeys.has(key)),
          )
          if (Object.keys(entityOnlyCustomFields).length) {
            appendCustomFieldLines(lines, entityOnlyCustomFields, 'Customer custom')
          }
        }
        const entityId = entity?.id ?? resolveCustomerEntityId(record)
        if (entity) {
          appendLine(lines, 'Customer', pickValue(entity, 'display_name', 'displayName') ?? entity.id)
          appendLine(lines, 'Status', pickValue(entity, 'status'))
          appendLine(lines, 'Lifecycle stage', pickValue(entity, 'lifecycle_stage', 'lifecycleStage'))
          appendLine(lines, 'Primary email', pickValue(entity, 'primary_email', 'primaryEmail'))
          appendLine(lines, 'Primary phone', pickValue(entity, 'primary_phone', 'primaryPhone'))
        }

        ensureFallbackLines(lines, record)
        if (!lines.length) return null

        const presenter = resolveCompanyPresenter(record, entity, ctx.customFields)
        logMissingPresenterTitle('company', record, entity, presenter)
        const primaryLabel =
          pickLabel(
            presenter.title,
            pickValue(entity, 'display_name', 'displayName'),
            ctx.customFields.display_name,
            ctx.customFields.displayName,
            record.brand_name,
            record.legal_name,
            record.domain,
            record.brandName,
            record.legalName,
            ctx.customFields.brand_name,
            ctx.customFields.brandName,
            ctx.customFields.legal_name,
            ctx.customFields.legalName,
            entityId,
            record.id,
            'Open company',
          ) ?? 'Open company'
        const links: VectorLinkDescriptor[] = []
        if (entityId) {
          const href = buildCustomerUrl('company', entityId)
          if (href) {
            links.push({ href, label: primaryLabel, kind: 'primary' })
          }
        }

        const checksumSource = {
          record: ctx.record,
          customFields: profileCustomFields,
          entity,
          entityCustomFields,
        }

        return {
          input: lines,
          presenter,
          links,
          checksumSource,
          payload: {
            kind: 'company',
            entityId: entityId ?? null,
            name: presenter.title,
          },
        }
      },
      formatResult: async (ctx) => {
        const entity = await getCustomerEntity(ctx, resolveCustomerEntityId(ctx.record))
        return resolveCompanyPresenter(ctx.record, entity, ctx.customFields)
      },
      resolveUrl: async ({ record }) => buildCustomerUrl('company', resolveCustomerEntityId(record)),
    },
    {
      entityId: 'customers:customer_comment',
      buildSource: async (ctx) => {
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id ?? ctx.record.entityId)
        const lines: string[] = []
        if (parent?.display_name) lines.push(`Customer: ${parent.display_name}`)
        lines.push(`Note: ${ctx.record.body ?? ''}`)
        if (ctx.record.appearance_icon) lines.push(`Icon: ${ctx.record.appearance_icon}`)
        if (ctx.record.appearance_color) lines.push(`Color: ${ctx.record.appearance_color}`)
        const presenter: VectorResultPresenter | null = parent?.display_name
          ? {
              title: parent.display_name,
              subtitle: snippet(ctx.record.body),
              icon: parent.kind === 'person' ? 'user' : 'building',
            }
          : null
        return {
          input: lines,
          presenter,
          checksumSource: {
            body: ctx.record.body,
            entityId: ctx.record.entity_id ?? null,
            updatedAt: ctx.record.updated_at ?? ctx.record.updatedAt ?? null,
          },
        }
      },
      formatResult: async (ctx) => {
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id ?? ctx.record.entityId)
        const title = parent?.display_name ?? 'Customer note'
        return {
          title,
          subtitle: snippet(ctx.record.body),
          icon: 'sticky-note',
        }
      },
      resolveUrl: async (ctx) => {
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id ?? ctx.record.entityId)
        const base = buildCustomerUrl(parent?.kind ?? null, parent?.id ?? ctx.record.entity_id ?? ctx.record.entityId)
        return base ? `${base}#notes` : null
      },
      resolveLinks: async (ctx) => {
        const links: VectorLinkDescriptor[] = []
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id ?? ctx.record.entityId)
        const parentUrl = buildCustomerUrl(parent?.kind ?? null, parent?.id ?? ctx.record.entity_id ?? ctx.record.entityId)
        if (parentUrl) {
          links.push({ href: parentUrl, label: parent?.display_name ?? 'View customer', kind: 'primary' })
        }
        if (ctx.record.deal_id) {
          const dealUrl = `/backend/customers/deals/${encodeURIComponent(ctx.record.deal_id)}`
          links.push({ href: dealUrl, label: 'Open deal', kind: 'secondary' })
        }
        return links.length ? links : null
      },
    },
    {
      entityId: 'customers:customer_activity',
      buildSource: async (ctx) => {
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id ?? ctx.record.entityId)
        const lines: string[] = []
        if (parent?.display_name) lines.push(`Customer: ${parent.display_name}`)
        if (ctx.record.activity_type) lines.push(`Type: ${ctx.record.activity_type}`)
        if (ctx.record.subject) lines.push(`Subject: ${ctx.record.subject}`)
        if (ctx.record.body) lines.push(`Body: ${ctx.record.body}`)
        const presenter: VectorResultPresenter | null = {
          title: ctx.record.subject ? String(ctx.record.subject) : `Activity: ${ctx.record.activity_type ?? 'update'}`,
          subtitle: parent?.display_name ?? snippet(ctx.record.body),
          icon: 'bolt',
        }
        return {
          input: lines,
          presenter,
          checksumSource: {
            subject: ctx.record.subject,
            body: ctx.record.body,
            entityId: ctx.record.entity_id ?? null,
            updatedAt: ctx.record.updated_at ?? ctx.record.updatedAt ?? null,
          },
        }
      },
      formatResult: async (ctx) => {
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id ?? ctx.record.entityId)
        return {
          title: ctx.record.subject ? String(ctx.record.subject) : `Activity: ${ctx.record.activity_type ?? 'update'}`,
          subtitle: parent?.display_name ?? snippet(ctx.record.body),
          icon: 'bolt',
        }
      },
      resolveUrl: async (ctx) => {
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id ?? ctx.record.entityId)
        const base = buildCustomerUrl(parent?.kind ?? null, parent?.id ?? ctx.record.entity_id ?? ctx.record.entityId)
        return base ? `${base}#activity-${ctx.record.id ?? ctx.record.activity_id ?? ''}` : null
      },
      resolveLinks: async (ctx) => {
        const links: VectorLinkDescriptor[] = []
        if (ctx.record.deal_id) {
          links.push({
            href: `/backend/customers/deals/${encodeURIComponent(ctx.record.deal_id)}`,
            label: 'Open deal',
            kind: 'secondary',
          })
        }
        return links.length ? links : null
      },
    },
    {
      entityId: 'customers:customer_deal',
      formatResult: async ({ record }) => {
        const subtitleParts: string[] = []
        if (record.pipeline_stage) subtitleParts.push(String(record.pipeline_stage))
        if (record.status) subtitleParts.push(String(record.status))
        const value = formatDealValue(record)
        if (value) subtitleParts.push(value)
        return {
          title: String(record.title ?? 'Deal'),
          subtitle: subtitleParts.join(' · ') || undefined,
          icon: 'briefcase',
        }
      },
      resolveUrl: async ({ record }) => `/backend/customers/deals/${encodeURIComponent(record.id ?? '')}`,
      resolveLinks: async () => null,
    },
    {
      entityId: 'customers:customer_todo_link',
      buildSource: async (ctx) => {
        const todo = await getLinkedTodo(ctx)
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id ?? ctx.record.entityId)
        const lines: string[] = []
        if (todo?.title) lines.push(`Todo: ${todo.title}`)
        if (todo?.is_done !== undefined) lines.push(`Status: ${todo.is_done ? 'Done' : 'Open'}`)
        if (parent?.display_name) lines.push(`Customer: ${parent.display_name}`)
        if (!lines.length) return null
        return {
          input: lines,
          presenter: todo?.title ? { title: todo.title, subtitle: parent?.display_name, icon: 'check-square' } : null,
          checksumSource: {
            todoId: ctx.record.todo_id ?? ctx.record.todoId,
            todoSource: ctx.record.todo_source ?? ctx.record.todoSource,
            entityId: ctx.record.entity_id ?? ctx.record.entityId,
          },
        }
      },
      formatResult: async (ctx) => {
        const todo = await getLinkedTodo(ctx)
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id ?? ctx.record.entityId)
        return {
          title: todo?.title ?? 'Customer task',
          subtitle: parent?.display_name ?? undefined,
          icon: 'check-square',
        }
      },
      resolveUrl: async (ctx) => {
        const parent = await getCustomerEntity(ctx, ctx.record.entity_id ?? ctx.record.entityId)
        const base = buildCustomerUrl(parent?.kind ?? null, parent?.id ?? ctx.record.entity_id ?? ctx.record.entityId)
        return base ? `${base}#tasks` : null
      },
      resolveLinks: async (ctx) => {
        const todoId = ctx.record.todo_id ?? ctx.record.todoId
        if (!todoId) return null
        return [{
          href: `/backend/todos/${encodeURIComponent(todoId)}/edit`,
          label: 'Open todo',
          kind: 'secondary',
        }]
      },
    },
  ],
}

export default vectorConfig
export const config = vectorConfig
function resolvePersonPresenter(
  record: Record<string, any>,
  entity: Record<string, any> | null,
  customFields: Record<string, any>,
): VectorResultPresenter {
  const fallbackEntityId = resolveCustomerEntityId(record)
  const firstName = record.first_name ?? record.firstName ?? customFields.first_name ?? customFields.firstName ?? ''
  const lastName = record.last_name ?? record.lastName ?? customFields.last_name ?? customFields.lastName ?? ''
  const nameParts = [firstName, lastName].filter(Boolean).join(' ')
  const title =
    (pickValue(entity, 'display_name', 'displayName') as string | undefined) ??
    record.preferred_name ??
    record.preferredName ??
    (nameParts.length ? nameParts : undefined) ??
    fallbackEntityId ??
    record.id ??
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
      customFields.summary ??
      customFields.description,
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
  record: Record<string, any>,
  entity: Record<string, any> | null,
  customFields: Record<string, any>,
): VectorResultPresenter {
  const fallbackEntityId = resolveCustomerEntityId(record)
  const title =
    (pickValue(entity, 'display_name', 'displayName') as string | undefined) ??
    customFields.display_name ??
    customFields.displayName ??
    record.brand_name ??
    record.legal_name ??
    record.domain ??
    record.brandName ??
    record.legalName ??
    (entity?.id && entity?.display_name ? entity.display_name : undefined) ??
    fallbackEntityId ??
    record.id ??
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
      customFields.summary ??
      customFields.description ??
      record.summary ??
      record.description,
  )
  if (summary) subtitlePieces.push(summary)
  if (!entity && (!title || title === fallbackEntityId)) {
    console.warn('[vector.customers] Missing customer entity during company presenter build', {
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
  record: Record<string, any>,
  entity: Record<string, any> | null,
  presenter: VectorResultPresenter,
) {
  const fallbackId = record.id ?? record.entity_id ?? resolveCustomerEntityId(record)
  if (!fallbackId) return
  if (presenter.title && presenter.title !== String(fallbackId)) return
  console.warn('[vector.customers] Presenter fell back to record id', {
    kind,
    recordId: fallbackId,
    entityId: resolveCustomerEntityId(record),
    entityDisplayName: entity?.display_name ?? null,
  })
}
