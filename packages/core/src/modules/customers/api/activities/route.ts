/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerActivity, CustomerDictionaryEntry, CustomerDeal } from '../../data/entities'
import { activityCreateSchema, activityUpdateSchema } from '../../data/validators'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '../utils'
import { User } from '@open-mercato/core/modules/auth/data/entities'
const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    entityId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
    activityType: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.activities.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CustomerActivity,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: {
    entityType: E.customers.customer_activity,
  },
  list: {
    schema: listSchema,
    entityId: E.customers.customer_activity,
    fields: [
      'id',
      'entity_id',
      'deal_id',
      'activity_type',
      'subject',
      'body',
      'occurred_at',
      'author_user_id',
      'organization_id',
      'tenant_id',
      'created_at',
      'appearance_icon',
      'appearance_color',
    ],
    decorateCustomFields: {
      entityIds: E.customers.customer_activity,
    },
    sortFieldMap: {
      occurredAt: 'occurred_at',
      createdAt: 'created_at',
    },
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      if (query.entityId) filters.entity_id = { $eq: query.entityId }
      if (query.dealId) filters.deal_id = { $eq: query.dealId }
      if (query.activityType) filters.activity_type = { $eq: query.activityType }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => {
      const record = (item ?? {}) as Record<string, unknown>
      const toIsoString = (value: unknown): string | null => {
        if (value == null) return null
        if (value instanceof Date) return value.toISOString()
        if (typeof value === 'string') {
          const trimmed = value.trim()
          if (!trimmed.length) return null
          const date = new Date(trimmed)
          return Number.isNaN(date.getTime()) ? trimmed : date.toISOString()
        }
        return null
      }
      const readString = (value: unknown): string | null => (typeof value === 'string' ? value : null)
      const idValue = readString(record.id) ?? (record.id != null ? String(record.id) : '')
      const activityType =
        readString(record['activity_type']) ??
        readString(record['activityType']) ??
        ''
      const subject =
        readString(record.subject) ??
        (record.subject == null ? null : String(record.subject))
      const body =
        readString(record.body) ??
        (record.body == null ? null : String(record.body))
      const authorUserId =
        readString(record['author_user_id']) ?? readString(record['authorUserId']) ?? null
      const appearanceIconRaw =
        readString(record['appearance_icon']) ?? readString(record['appearanceIcon'])
      const appearanceColorRaw =
        readString(record['appearance_color']) ?? readString(record['appearanceColor'])
      const organizationId =
        readString(record['organization_id']) ?? readString(record['organizationId'])
      const tenantId =
        readString(record['tenant_id']) ?? readString(record['tenantId'])
      const output: Record<string, unknown> = {
        id: idValue,
        entityId: readString(record['entity_id']) ?? readString(record['entityId']) ?? null,
        dealId: readString(record['deal_id']) ?? readString(record['dealId']) ?? null,
        activityType,
        subject,
        body,
        occurredAt: toIsoString(record['occurred_at'] ?? record['occurredAt']),
        createdAt: toIsoString(record['created_at'] ?? record['createdAt']),
        authorUserId,
        organizationId,
        tenantId,
        appearanceIcon: appearanceIconRaw && appearanceIconRaw.trim().length ? appearanceIconRaw : null,
        appearanceColor: appearanceColorRaw && appearanceColorRaw.trim().length ? appearanceColorRaw : null,
      }
      for (const [key, value] of Object.entries(record)) {
        if (key.startsWith('cf_') || key.startsWith('cf:')) {
          output[key] = value
        }
      }
      return output
    },
  },
  actions: {
    create: {
      commandId: 'customers.activities.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(activityCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.activityId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'customers.activities.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(activityUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.activities.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('customers.errors.activity_required', 'Activity id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items = Array.isArray(payload.items) ? payload.items : []
      if (!items.length) return
      type ActivityRecord = {
        id: string
        activityType: string
        subject?: string | null
        body?: string | null
        occurredAt?: string | null
        createdAt?: string | null
        organizationId?: string | null
        tenantId?: string | null
        appearanceIcon?: string | null
        appearanceColor?: string | null
        activityTypeLabel?: string | null
        authorUserId?: string | null
        authorName?: string | null
        authorEmail?: string | null
        dealId?: string | null
        dealTitle?: string | null
        customFields?: Array<{
          key: string
          label: string
          value: unknown
          kind: string | null
          multi: boolean
        }>
      } & Record<string, unknown>
      const typedItems = items as ActivityRecord[]

      // Resolve dictionary appearance defaults
      const tenantId = ctx.auth?.tenantId ?? null
      const normalizedValues = new Set<string>()
      const organizationIds = new Set<string>()
      const dealIds = new Set<string>()
      typedItems.forEach((item) => {
        const rawType = typeof item.activityType === 'string' ? item.activityType : ''
        const normalized = rawType.trim().toLowerCase()
        if (normalized) normalizedValues.add(normalized)
        const orgId = typeof item.organizationId === 'string' ? item.organizationId : null
        if (orgId) organizationIds.add(orgId)
        const dealId = typeof item.dealId === 'string' ? item.dealId.trim() : ''
        if (dealId.length) dealIds.add(dealId)
      })
      if (normalizedValues.size) {
        try {
          const em = ctx.container.resolve('em') as any
          const normalizedList = Array.from(normalizedValues)
          const orgList = Array.from(organizationIds)
          const where: Record<string, unknown> = {
            kind: 'activity_type',
            normalizedValue: { $in: normalizedList as any },
          }
          const andClauses: Record<string, unknown>[] = []
          if (tenantId) {
            andClauses.push({ $or: [{ tenantId: tenantId as any }, { tenantId: null }] })
          } else {
            andClauses.push({ tenantId: null })
          }
          if (orgList.length) {
            andClauses.push({ $or: [{ organizationId: { $in: orgList as any } }, { organizationId: null }] })
          } else {
            andClauses.push({ organizationId: null })
          }
          if (andClauses.length) where.$and = andClauses
          const entries: CustomerDictionaryEntry[] = await em.find(CustomerDictionaryEntry, where)
          type Bucket = { global?: CustomerDictionaryEntry; byOrg: Map<string, CustomerDictionaryEntry> }
          const entryMap = new Map<string, Bucket>()
          entries.forEach((entry) => {
            let normalized: string | null = null
            if (typeof entry.normalizedValue === 'string') {
              const trimmed = entry.normalizedValue.trim()
              if (trimmed.length) normalized = trimmed
            }
            if (!normalized && typeof entry.value === 'string') {
              const trimmedValue = entry.value.trim()
              if (trimmedValue.length) normalized = trimmedValue.toLowerCase()
            }
            if (!normalized) return
            const bucket = entryMap.get(normalized) ?? { global: undefined, byOrg: new Map<string, CustomerDictionaryEntry>() }
            if (entry.organizationId) {
              bucket.byOrg.set(entry.organizationId, entry)
            } else if (!bucket.global) {
              bucket.global = entry
            }
            entryMap.set(normalized, bucket)
          })
          typedItems.forEach((item) => {
            const rawType = typeof item.activityType === 'string' ? item.activityType : ''
            const normalized = rawType.trim().toLowerCase()
            if (!normalized) return
            const bucket = entryMap.get(normalized)
            if (!bucket) return
            const orgId = typeof item.organizationId === 'string' ? item.organizationId : null
            const entry = (orgId && bucket.byOrg.get(orgId)) ?? bucket.global
            if (!entry) return
            const label =
              typeof entry.label === 'string' && entry.label.trim().length ? entry.label.trim() : rawType
            item.activityTypeLabel = label
            const icon =
              typeof entry.icon === 'string' && entry.icon.trim().length ? entry.icon.trim() : null
            if (!item.appearanceIcon || (typeof item.appearanceIcon === 'string' && !item.appearanceIcon.trim().length)) {
              item.appearanceIcon = icon
            }
            const color =
              typeof entry.color === 'string' && entry.color.trim().length ? entry.color.trim().toLowerCase() : null
            if (!item.appearanceColor || (typeof item.appearanceColor === 'string' && !item.appearanceColor.trim().length)) {
              item.appearanceColor = color
            }
          })
        } catch (err) {
          console.warn('[customers.activities] Failed to resolve dictionary appearance', err)
        }
      }

      if (dealIds.size) {
        try {
          const em = ctx.container.resolve('em') as any
          const deals = await em.find(CustomerDeal, { id: { $in: Array.from(dealIds) as any } })
          const map = new Map<string, string>()
          deals.forEach((deal) => {
            if (deal && typeof deal.id === 'string') {
              map.set(deal.id, typeof deal.title === 'string' ? deal.title : '')
            }
          })
          typedItems.forEach((item) => {
            const dealId = typeof item.dealId === 'string' ? item.dealId.trim() : ''
            if (!dealId.length) return
            item.dealTitle = map.get(dealId) ?? null
          })
        } catch (err) {
          console.warn('[customers.activities] Failed to resolve deal titles', err)
        }
      }

      // Resolve author metadata
      const authorIds = Array.from(
        new Set(
          typedItems
            .map((item) => (typeof item.authorUserId === 'string' ? item.authorUserId : null))
            .filter((id): id is string => !!id),
        ),
      )
      if (authorIds.length) {
        try {
          const em = ctx.container.resolve('em') as any
          const users = await em.find(User, { id: { $in: authorIds } })
          const map = new Map<string, { name: string | null; email: string | null }>()
          users.forEach((user) => {
            map.set(user.id, {
              name: user.name ?? null,
              email: user.email ?? null,
            })
          })
          typedItems.forEach((item) => {
            if (!item.authorUserId) return
            const info = map.get(item.authorUserId)
            item.authorName = info?.name ?? null
            item.authorEmail = info?.email ?? null
          })
        } catch (err) {
          console.warn('[customers.activities] Failed to resolve author metadata', err)
        }
      }

    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET
