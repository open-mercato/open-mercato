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
const personProfileCache = new WeakMap<Record<string, any>, ProfileDetails | null>()
const companyProfileCache = new WeakMap<Record<string, any>, ProfileDetails | null>()
const todoCache = new WeakMap<Record<string, any>, any>()

type ProfileDetails = {
  base: Record<string, any>
  customFields: Record<string, any>
}

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

function splitRecordAndCustomFields(raw: Record<string, any>): ProfileDetails {
  const base: Record<string, any> = {}
  const customFields: Record<string, any> = {}
  const multiFlags = new Map<string, boolean>()
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('cf:') && key.endsWith('__is_multi')) {
      const cfKey = key.slice(3, -'__is_multi'.length)
      multiFlags.set(cfKey, Boolean(value))
    }
  }
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('cf:')) {
      if (key.endsWith('__is_multi')) continue
      const cfKey = key.slice(3)
      const isMulti = multiFlags.get(cfKey)
      if (Array.isArray(value)) {
        customFields[cfKey] = value
      } else if (value === null || value === undefined) {
        customFields[cfKey] = null
      } else if (isMulti) {
        customFields[cfKey] = [value]
      } else {
        customFields[cfKey] = value
      }
    } else {
      base[key] = value
    }
  }
  return { base, customFields }
}

async function loadProfile(ctx: VectorContext, entityId: string, profileEntityId: string): Promise<ProfileDetails | null> {
  if (!ctx.queryEngine) return null
  const res = await ctx.queryEngine.query(profileEntityId, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId ?? undefined,
    filters: { entity_id: entityId },
    includeCustomFields: true,
  })
  const raw = res.items[0]
  if (!raw) return null
  return splitRecordAndCustomFields(raw as Record<string, any>)
}

async function getCustomerEntity(ctx: VectorContext, entityId?: string | null) {
  if (!entityId) return null
  if (customerEntityCache.has(ctx.record)) {
    return customerEntityCache.get(ctx.record)
  }
  const entity = await loadRecord(ctx, 'customers:customer_entity', entityId)
  customerEntityCache.set(ctx.record, entity ?? null)
  return entity ?? null
}

function resolveEntityId(record: Record<string, any>): string | null {
  return record.id ?? record.entity_id ?? record.customer_entity_id ?? null
}

function resolveCustomerEntityId(record: Record<string, any>): string | null {
  return record.entity_id ?? record.customer_entity_id ?? record.entityId ?? null
}

async function getPersonProfile(ctx: VectorContext) {
  if (personProfileCache.has(ctx.record)) {
    return personProfileCache.get(ctx.record)
  }
  const entityId = resolveEntityId(ctx.record)
  if (!entityId) {
    personProfileCache.set(ctx.record, null)
    return null
  }
  const profile = await loadProfile(ctx, entityId, 'customers:customer_person_profile')
  personProfileCache.set(ctx.record, profile)
  return profile
}

async function getCompanyProfile(ctx: VectorContext) {
  if (companyProfileCache.has(ctx.record)) {
    return companyProfileCache.get(ctx.record)
  }
  const entityId = resolveEntityId(ctx.record)
  if (!entityId) {
    companyProfileCache.set(ctx.record, null)
    return null
  }
  const profile = await loadProfile(ctx, entityId, 'customers:customer_company_profile')
  companyProfileCache.set(ctx.record, profile)
  return profile
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

export const vectorConfig: VectorModuleConfig = {
  defaultDriverId: 'pgvector',
  entities: [
    {
      entityId: 'customers:customer_entity',
      buildSource: async (ctx) => {
        const lines: string[] = []
        const record = ctx.record
        appendLine(lines, 'Customer', record.display_name ?? record.name ?? record.title ?? record.id)
        appendLine(lines, 'Description', record.description)
        appendLine(lines, 'Status', record.status)
        appendLine(lines, 'Lifecycle stage', record.lifecycle_stage)
        appendLine(lines, 'Primary email', record.primary_email)
        appendLine(lines, 'Primary phone', record.primary_phone)
        appendCustomFieldLines(lines, ctx.customFields, 'Customer custom')

        const rawKind = record.kind ?? record.customer_kind ?? null
        const normalizedKind = typeof rawKind === 'string' ? rawKind.toLowerCase() : null

        let profileDetails: ProfileDetails | null = null
        if (normalizedKind === 'person') {
          profileDetails = await getPersonProfile(ctx)
          if (profileDetails) {
            const base = profileDetails.base
            appendLine(lines, 'Preferred name', base.preferred_name)
            appendLine(lines, 'First name', base.first_name)
            appendLine(lines, 'Last name', base.last_name)
            appendLine(lines, 'Job title', base.job_title)
            appendLine(lines, 'Department', base.department)
            appendLine(lines, 'Seniority', base.seniority)
            appendLine(lines, 'Timezone', base.timezone)
            appendLine(lines, 'LinkedIn', base.linked_in_url)
            appendLine(lines, 'Twitter', base.twitter_url)
            appendCustomFieldLines(lines, profileDetails.customFields, 'Person custom')
          }
        } else {
          profileDetails = await getCompanyProfile(ctx)
          if (profileDetails) {
            const base = profileDetails.base
            appendLine(lines, 'Legal name', base.legal_name)
            appendLine(lines, 'Brand name', base.brand_name)
            appendLine(lines, 'Domain', base.domain)
            appendLine(lines, 'Website', base.website_url)
            appendLine(lines, 'Industry', base.industry)
            appendLine(lines, 'Company size', base.size_bucket)
            appendLine(lines, 'Annual revenue', base.annual_revenue)
            appendCustomFieldLines(lines, profileDetails.customFields, 'Company custom')
          }
        }

        return {
          input: lines,
          presenter: null,
          checksumSource: {
            record: ctx.record,
            customFields: ctx.customFields,
            profile: profileDetails,
          },
          payload: normalizedKind ? { kind: normalizedKind } : null,
        }
      },
      formatResult: async (ctx) => {
        const { record } = ctx
        const title = String(record.display_name ?? record.title ?? record.name ?? record.id ?? 'Customer')
        const subtitleParts: string[] = []
        if (record.kind === 'person') {
          if (record.primary_email) subtitleParts.push(String(record.primary_email))
          if (record.primary_phone) subtitleParts.push(String(record.primary_phone))
          const profile = await getPersonProfile(ctx)
          const profileBase = profile?.base ?? {}
          if (profileBase.job_title) subtitleParts.push(String(profileBase.job_title))
          if (profileBase.department) subtitleParts.push(String(profileBase.department))
        } else if (record.kind === 'company') {
          if (record.status) subtitleParts.push(String(record.status))
          if (record.lifecycle_stage) subtitleParts.push(String(record.lifecycle_stage))
          const profile = await getCompanyProfile(ctx)
          const profileBase = profile?.base ?? {}
          if (profileBase.industry) subtitleParts.push(String(profileBase.industry))
        }
        const description = snippet(record.description ?? record.summary)
        if (description) subtitleParts.push(description)
        const icon = record.kind === 'person' ? 'user' : 'building'
        const subtitle = subtitleParts.filter(Boolean).join(' · ') || undefined
        return {
          title,
          subtitle,
          icon,
        } as VectorResultPresenter
      },
      resolveUrl: async ({ record }) => buildCustomerUrl(record.kind ?? record.customer_kind ?? null, record.id ?? record.entity_id),
    },
    {
      entityId: 'customers:customer_person_profile',
      buildSource: async (ctx) => {
        const lines: string[] = []
        const record = ctx.record
        appendLine(lines, 'Preferred name', record.preferred_name ?? ctx.customFields.preferred_name)
        appendLine(lines, 'First name', record.first_name ?? ctx.customFields.first_name)
        appendLine(lines, 'Last name', record.last_name ?? ctx.customFields.last_name)
        appendLine(lines, 'Job title', record.job_title ?? ctx.customFields.job_title)
        appendLine(lines, 'Department', record.department ?? ctx.customFields.department)
        appendLine(lines, 'Seniority', record.seniority ?? ctx.customFields.seniority)
        appendLine(lines, 'Timezone', record.timezone ?? ctx.customFields.timezone)
        appendLine(lines, 'LinkedIn', record.linked_in_url ?? ctx.customFields.linked_in_url)
        appendLine(lines, 'Twitter', record.twitter_url ?? ctx.customFields.twitter_url)
        appendCustomFieldLines(lines, ctx.customFields, 'Person custom')

        const entity = await getCustomerEntity(ctx, resolveCustomerEntityId(record))
        if (entity) {
          appendLine(lines, 'Customer', entity.display_name ?? entity.id)
          appendLine(lines, 'Customer email', entity.primary_email)
          appendLine(lines, 'Customer phone', entity.primary_phone)
          appendLine(lines, 'Lifecycle stage', entity.lifecycle_stage)
          appendLine(lines, 'Status', entity.status)
        }

        if (!lines.length) return null

        const entityId = resolveCustomerEntityId(record)
        const links: VectorLinkDescriptor[] = []
        if (entityId) {
          const href = buildCustomerUrl('person', entityId)
          if (href) {
            links.push({ href, label: entity?.display_name ?? record.preferred_name ?? 'Open person', kind: 'primary' })
          }
        }

        const checksumSource = {
          record: ctx.record,
          customFields: ctx.customFields,
          entity,
        }

        return {
          input: lines,
          presenter: null,
          links,
          checksumSource,
          payload: { kind: 'person' },
        }
      },
      formatResult: async (ctx) => {
        const entity = await getCustomerEntity(ctx, resolveCustomerEntityId(ctx.record))
        const nameParts = [ctx.record.first_name, ctx.record.last_name].filter(Boolean).join(' ')
        const title =
          entity?.display_name ??
          ctx.record.preferred_name ??
          (nameParts ? nameParts : undefined) ??
          (ctx.record.id ? String(ctx.record.id) : undefined) ??
          'Person'
        const subtitleParts: string[] = []
        if (ctx.record.job_title) subtitleParts.push(String(ctx.record.job_title))
        if (ctx.record.department) subtitleParts.push(String(ctx.record.department))
        if (entity?.primary_email) subtitleParts.push(String(entity.primary_email))
        if (entity?.primary_phone) subtitleParts.push(String(entity.primary_phone))
        const description = snippet(entity?.description)
        if (description) subtitleParts.push(description)
        const subtitleJoined = subtitleParts.filter(Boolean).join(' · ')
        return {
          title,
          subtitle: subtitleJoined ? subtitleJoined : undefined,
          icon: 'user',
          badge: entity?.display_name ? 'Person' : undefined,
        } satisfies VectorResultPresenter
      },
      resolveUrl: async ({ record }) => buildCustomerUrl('person', resolveCustomerEntityId(record)),
    },
    {
      entityId: 'customers:customer_company_profile',
      buildSource: async (ctx) => {
        const lines: string[] = []
        const record = ctx.record
        appendLine(lines, 'Legal name', record.legal_name ?? ctx.customFields.legal_name)
        appendLine(lines, 'Brand name', record.brand_name ?? ctx.customFields.brand_name)
        appendLine(lines, 'Domain', record.domain ?? ctx.customFields.domain)
        appendLine(lines, 'Website', record.website_url ?? ctx.customFields.website_url)
        appendLine(lines, 'Industry', record.industry ?? ctx.customFields.industry)
        appendLine(lines, 'Company size', record.size_bucket ?? ctx.customFields.size_bucket)
        appendLine(lines, 'Annual revenue', record.annual_revenue ?? ctx.customFields.annual_revenue)
        appendCustomFieldLines(lines, ctx.customFields, 'Company custom')

        const entity = await getCustomerEntity(ctx, resolveCustomerEntityId(record))
        if (entity) {
          appendLine(lines, 'Customer', entity.display_name ?? entity.id)
          appendLine(lines, 'Status', entity.status)
          appendLine(lines, 'Lifecycle stage', entity.lifecycle_stage)
          appendLine(lines, 'Primary email', entity.primary_email)
          appendLine(lines, 'Primary phone', entity.primary_phone)
        }

        if (!lines.length) return null

        const entityId = resolveCustomerEntityId(record)
        const links: VectorLinkDescriptor[] = []
        if (entityId) {
          const href = buildCustomerUrl('company', entityId)
          if (href) {
            links.push({ href, label: entity?.display_name ?? record.brand_name ?? 'Open company', kind: 'primary' })
          }
        }

        const checksumSource = {
          record: ctx.record,
          customFields: ctx.customFields,
          entity,
        }

        return {
          input: lines,
          presenter: null,
          links,
          checksumSource,
          payload: { kind: 'company' },
        }
      },
      formatResult: async (ctx) => {
        const entity = await getCustomerEntity(ctx, resolveCustomerEntityId(ctx.record))
        const title =
          entity?.display_name ??
          ctx.record.brand_name ??
          ctx.record.legal_name ??
          ctx.record.domain ??
          (ctx.record.id ? String(ctx.record.id) : undefined) ??
          'Company'
        const subtitleParts: string[] = []
        if (ctx.record.industry) subtitleParts.push(String(ctx.record.industry))
        if (ctx.record.size_bucket) subtitleParts.push(String(ctx.record.size_bucket))
        if (entity?.primary_email) subtitleParts.push(String(entity.primary_email))
        const description = snippet(entity?.description ?? ctx.customFields.summary)
        if (description) subtitleParts.push(description)
        const subtitleJoined = subtitleParts.filter(Boolean).join(' · ')
        return {
          title,
          subtitle: subtitleJoined ? subtitleJoined : undefined,
          icon: 'building',
          badge: entity?.display_name ? 'Company' : undefined,
        } satisfies VectorResultPresenter
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
