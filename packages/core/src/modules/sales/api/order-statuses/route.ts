import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as F from '@open-mercato/core/generated/entities/dictionary_entry'
import { statusDictionaryCreateSchema, statusDictionaryUpdateSchema } from '../../data/validators'
import { getSalesDictionaryDefinition, ensureSalesDictionary, type SalesDictionaryKind } from '../../lib/dictionaries'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import {
  createPagedListResponseSchema,
  createSalesCrudOpenApi,
  defaultDeleteRequestSchema,
} from '../openapi'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const kind: SalesDictionaryKind = 'order-status'
const definition = getSalesDictionaryDefinition(kind)

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
  POST: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
}

const dictionaryItemSchema = z.object({
  id: z.string().uuid(),
  value: z.string(),
  label: z.string().nullable(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const dictionaryListResponseSchema = createPagedListResponseSchema(dictionaryItemSchema)

async function resolveDictionaryId(ctx: any): Promise<string> {
  if (!ctx.auth || !ctx.auth.tenantId) {
    throw new CrudHttpError(401, { error: 'Tenant context is required.' })
  }
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: 'Organization context is required.' })
  }
  const em = ctx.container.resolve<EntityManager>('em')
  const dictionary = await ensureSalesDictionary({
    em,
    tenantId: ctx.auth.tenantId,
    organizationId,
    kind,
  })
  return dictionary.id
}

const crud = makeCrudRoute({
  metadata,
  orm: {
    entity: DictionaryEntry,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: null,
  },
  list: {
    schema: listSchema,
    entityId: E.dictionaries.dictionary_entry,
    fields: [
      F.id,
      F.value,
      F.label,
      F.color,
      F.icon,
      F.organization_id,
      F.tenant_id,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      id: F.id,
      value: F.value,
      label: F.label,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query, ctx) => {
      const dictionaryId = await resolveDictionaryId(ctx)
      const filters: Record<string, unknown> = {
        dictionary_id: dictionaryId,
      }
      if (query.search && query.search.trim().length > 0) {
        const term = `%${query.search.trim().replace(/%/g, '\\%')}%`
        filters.$or = [
          { [F.value]: { $ilike: term } },
          { [F.label]: { $ilike: term } },
        ]
      }
      return filters
    },
    transformItem: (item: any) => ({
      id: item.id,
      value: item.value,
      label: item.label,
      color: item.color ?? null,
      icon: item.icon ?? null,
      organizationId: item.organization_id ?? null,
      tenantId: item.tenant_id ?? null,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }),
  },
  actions: {
    create: {
      commandId: `${definition.commandPrefix}.create`,
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(statusDictionaryCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.entryId ?? null }),
      status: 201,
    },
    update: {
      commandId: `${definition.commandPrefix}.update`,
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(statusDictionaryUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: `${definition.commandPrefix}.delete`,
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Order status',
  pluralName: 'Order statuses',
  description: 'Manage the lifecycle states available for sales orders.',
  querySchema: listSchema,
  listResponseSchema: dictionaryListResponseSchema,
  create: { schema: statusDictionaryCreateSchema },
  update: { schema: statusDictionaryUpdateSchema },
  del: { schema: defaultDeleteRequestSchema },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
