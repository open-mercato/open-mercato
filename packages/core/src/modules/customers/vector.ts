import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { VectorLinkDescriptor, VectorModuleConfig, VectorResultPresenter } from '@open-mercato/shared/modules/vector'

type VectorContext = {
  record: Record<string, any>
  customFields: Record<string, any>
  tenantId: string
  organizationId?: string | null
  queryEngine?: QueryEngine
}

const customerEntityCache = new WeakMap<Record<string, any>, any>()
const todoCache = new WeakMap<Record<string, any>, any>()

async function loadRecord(ctx: VectorContext, entityId: string, recordId?: string | null) {
  if (!recordId || !ctx.queryEngine) return null
  const res = await ctx.queryEngine.query(entityId, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId ?? undefined,
    filters: { id: recordId },
    includeCustomFields: true,
  })
  return res.items[0] as Record<string, any> | undefined
}

async function getCustomerEntity(ctx: VectorContext, entityId?: string | null) {
  if (!entityId) return null
  if (customerEntityCache.has(ctx.record)) {
    return customerEntityCache.get(ctx.record)
  }
  const inline = getInlineCustomerEntity(ctx.record)
  if (inline) {
    customerEntityCache.set(ctx.record, inline)
    return inline
  }
  const entity = await loadRecord(ctx, 'customers:customer_entity', entityId)
  customerEntityCache.set(ctx.record, entity ?? null)
  return entity ?? null
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
        appendCustomFieldLines(lines, ctx.customFields, 'Person custom')

        let entity = getInlineCustomerEntity(record)
        if (!entity) {
          entity = await getCustomerEntity(ctx, resolveCustomerEntityId(record))
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

        const entityId = resolveCustomerEntityId(record)
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
          customFields: ctx.customFields,
          entity,
        }

        return {
          input: lines,
          presenter,
          links,
          checksumSource,
          payload: {
            kind: 'person',
            entityId: resolveCustomerEntityId(record) ?? entityId ?? null,
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
        appendCustomFieldLines(lines, ctx.customFields, 'Company custom')

        let entity = getInlineCustomerEntity(record)
        if (!entity) {
          entity = await getCustomerEntity(ctx, resolveCustomerEntityId(record))
        }
        if (entity) {
          appendLine(lines, 'Customer', pickValue(entity, 'display_name', 'displayName') ?? entity.id)
          appendLine(lines, 'Status', pickValue(entity, 'status'))
          appendLine(lines, 'Lifecycle stage', pickValue(entity, 'lifecycle_stage', 'lifecycleStage'))
          appendLine(lines, 'Primary email', pickValue(entity, 'primary_email', 'primaryEmail'))
          appendLine(lines, 'Primary phone', pickValue(entity, 'primary_phone', 'primaryPhone'))
        }

        ensureFallbackLines(lines, record)
        if (!lines.length) return null

        const entityId = resolveCustomerEntityId(record)
        const presenter = resolveCompanyPresenter(record, entity, ctx.customFields)
        logMissingPresenterTitle('company', record, entity, presenter)
        const primaryLabel =
          pickLabel(
            presenter.title,
            pickValue(entity, 'display_name', 'displayName'),
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
          customFields: ctx.customFields,
          entity,
        }

        return {
          input: lines,
          presenter,
          links,
          checksumSource,
          payload: {
            kind: 'company',
            entityId,
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
    record.brand_name ??
    record.legal_name ??
    record.domain ??
    record.brandName ??
    record.legalName ??
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
