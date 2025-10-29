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
  const entity = await loadRecord(ctx, 'customers:customer_entity', entityId)
  customerEntityCache.set(ctx.record, entity ?? null)
  return entity ?? null
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

export const vectorConfig: VectorModuleConfig = {
  defaultDriverId: 'pgvector',
  entities: [
    {
      entityId: 'customers:customer_entity',
      formatResult: async ({ record }) => {
        const title = String(record.display_name ?? record.title ?? record.name ?? record.id ?? 'Customer')
        const subtitleParts: string[] = []
        if (record.kind === 'person') {
          if (record.primary_email) subtitleParts.push(String(record.primary_email))
          if (record.primary_phone) subtitleParts.push(String(record.primary_phone))
          if (record.job_title) subtitleParts.push(String(record.job_title))
        } else if (record.kind === 'company') {
          if (record.status) subtitleParts.push(String(record.status))
          if (record.lifecycle_stage) subtitleParts.push(String(record.lifecycle_stage))
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
