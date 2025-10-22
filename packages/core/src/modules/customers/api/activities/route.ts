/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerActivity } from '../../data/entities'
import { activityCreateSchema, activityUpdateSchema } from '../../data/validators'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '../utils'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { parseWithCustomFields } from '@open-mercato/shared/lib/commands/helpers'

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
    transformItem: (item: any) => {
      if (!item) return item
      const toIso = (value: unknown): string | null => {
        if (!value) return null
        if (typeof value === 'string') {
          const trimmed = value.trim()
          if (!trimmed) return null
          const parsed = new Date(trimmed)
          return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
        }
        if (value instanceof Date) {
          const ms = value.getTime()
          return Number.isNaN(ms) ? null : value.toISOString()
        }
        return null
      }
      const toStringOrNull = (value: unknown): string | null => {
        if (typeof value === 'string') {
          const trimmed = value.trim()
          return trimmed.length ? trimmed : null
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
          return String(value)
        }
        return null
      }
      const normalizedId = toStringOrNull(item.id) ?? ''
      return {
        id: normalizedId,
        entityId: toStringOrNull(item.entity_id),
        dealId: toStringOrNull(item.deal_id),
        activityType: toStringOrNull(item.activity_type) ?? '',
        subject: toStringOrNull(item.subject),
        body: toStringOrNull(item.body),
        occurredAt: toIso(item.occurred_at),
        authorUserId: toStringOrNull(item.author_user_id),
        createdAt: toIso(item.created_at) ?? new Date().toISOString(),
        appearanceIcon: toStringOrNull(item.appearance_icon),
        appearanceColor: toStringOrNull(item.appearance_color),
        organizationId: toStringOrNull(item.organization_id),
        tenantId: toStringOrNull(item.tenant_id),
      }
    },
  },
  actions: {
    create: {
      commandId: 'customers.activities.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { parsed, custom } = parseWithCustomFields(activityCreateSchema, scoped)
        return Object.keys(custom).length ? { ...parsed, customFields: custom } : parsed
      },
      response: ({ result }) => ({ id: result?.activityId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'customers.activities.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { parsed, custom } = parseWithCustomFields(activityUpdateSchema, scoped)
        return Object.keys(custom).length ? { ...parsed, customFields: custom } : parsed
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
        authorUserId?: string | null
        authorName?: string | null
        authorEmail?: string | null
        organizationId?: string | null
        tenantId?: string | null
        customFields?: Array<{
          key: string
          label: string
          value: unknown
          kind: string | null
          multi: boolean
        }>
      }
      const typedItems = items as ActivityRecord[]

      const recordIds = typedItems
        .map((item) => (typeof item.id === 'string' && item.id.trim().length ? item.id : null))
        .filter((value): value is string => value !== null)
      let valuesById: Record<string, Record<string, unknown>> = {}
      if (recordIds.length) {
        try {
          const em = ctx.container.resolve('em') as any
          const tenantIdByRecord: Record<string, string | null> = {}
          const organizationIdByRecord: Record<string, string | null> = {}
          typedItems.forEach((item) => {
            if (!item.id) return
            tenantIdByRecord[item.id] = item.tenantId ?? null
            organizationIdByRecord[item.id] = item.organizationId ?? null
          })
          valuesById = await loadCustomFieldValues({
            em,
            entityId: E.customers.customer_activity,
            recordIds,
            tenantIdByRecord,
            organizationIdByRecord,
            tenantFallbacks: [ctx.auth?.tenantId ?? null].filter((value): value is string => typeof value === 'string' && value.length > 0),
          })
        } catch (err) {
          console.warn('[customers.activities] Failed to load custom field values', err)
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

      // Attach custom field metadata
      const customKeys = new Set<string>()
      typedItems.forEach((item) => {
        const raw = valuesById[item.id] ?? {}
        Object.keys(raw).forEach((key) => {
          if (key.startsWith('cf_')) {
            const normalized = key.slice(3)
            if (normalized) customKeys.add(normalized)
          }
        })
      })
      if (!customKeys.size) {
        typedItems.forEach((item) => {
          item.customFields = []
        })
        return
      }

      const parseConfig = (input: unknown): Record<string, any> => {
        if (!input) return {}
        if (typeof input === 'string') {
          try {
            const parsed = JSON.parse(input)
            return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : {}
          } catch {
            return {}
          }
        }
        if (typeof input === 'object') return input as Record<string, any>
        return {}
      }

      const pickDefinition = (
        defsByKey: Map<string, CustomFieldDef[]>,
        fieldKey: string,
        organizationId: string | null,
        tenantId: string | null,
      ): CustomFieldDef | null => {
        const options = defsByKey.get(fieldKey)
        if (!options || !options.length) return null
        const active = options.filter((opt) => opt.isActive !== false && !opt.deletedAt)
        const candidates = active.length ? active : options
        if (organizationId && tenantId) {
          const exact = candidates.find(
            (opt) => opt.organizationId === organizationId && opt.tenantId === tenantId,
          )
          if (exact) return exact
        }
        if (organizationId) {
          const orgMatch = candidates.find(
            (opt) =>
              opt.organizationId === organizationId &&
              (!tenantId || opt.tenantId == null || opt.tenantId === tenantId),
          )
          if (orgMatch) return orgMatch
        }
        if (tenantId) {
          const tenantMatch = candidates.find(
            (opt) => opt.organizationId == null && opt.tenantId === tenantId,
          )
          if (tenantMatch) return tenantMatch
        }
        const global = candidates.find((opt) => opt.organizationId == null && opt.tenantId == null)
        return global ?? candidates[0] ?? null
      }

      try {
        const em = ctx.container.resolve('em') as any
        const defs = await em.find(
          CustomFieldDef,
          {
            entityId: E.customers.customer_activity as any,
            key: { $in: Array.from(customKeys) as any },
            deletedAt: null,
            $and: [
              {
                $or: [
                  { tenantId: ctx.auth?.tenantId ?? undefined as any },
                  { tenantId: null },
                ],
              },
            ],
          } as any,
        )
        const defsByKey = new Map<string, CustomFieldDef[]>()
        defs.forEach((def) => {
          const key = String(def.key)
          const list = defsByKey.get(key) ?? []
          list.push(def)
          defsByKey.set(key, list)
        })

        typedItems.forEach((item) => {
          const raw = valuesById[item.id] ?? {}
          const entries: ActivityRecord['customFields'] = []
          Object.entries(raw).forEach(([prefixedKey, value]) => {
            const rawKey = prefixedKey.startsWith('cf_') ? prefixedKey.slice(3) : prefixedKey
            if (!rawKey) return
            const def = pickDefinition(defsByKey, rawKey, item.organizationId ?? null, item.tenantId ?? null)
            const config = def ? parseConfig(def.configJson) : {}
            const label =
              typeof config.label === 'string' && config.label.trim().length
                ? config.label.trim()
                : rawKey
            entries.push({
              key: rawKey,
              label,
              value,
              kind: def?.kind ?? null,
              multi: Boolean(config.multi),
            })
          })
          entries.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
          item.customFields = entries
        })
      } catch (err) {
        console.warn('[customers.activities] Failed to enrich custom fields', err)
        typedItems.forEach((item) => {
          item.customFields = []
        })
      }
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET
