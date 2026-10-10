import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { ACCOUNT_CLASSES, GlAccount, NORMAL_BALANCES } from '../../data/entities'
import { createAccountSchema, updateAccountSchema } from '../../data/validators'
import { createPagedListResponseSchema, createFinancialCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { FINANCIAL_ACCOUNT_ENTITY_ID } from '../../commands/ledger'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    search: z.string().optional(),
    accountClass: z.enum(ACCOUNT_CLASSES).optional(),
    isActive: z.string().optional(),
    countryCode: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
  POST: { requireAuth: true, requireFeatures: ['financial.write'] },
  PUT: { requireAuth: true, requireFeatures: ['financial.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['financial.write'] },
}

export const metadata = { path: '/financial/accounts', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: GlAccount,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: FINANCIAL_ACCOUNT_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: FINANCIAL_ACCOUNT_ENTITY_ID,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'code',
      'name',
      'description',
      'account_class',
      'account_type',
      'parent_id',
      'currency_code',
      'normal_balance',
      'is_active',
      'is_reconciliation_required',
      'country_code',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      code: 'code',
      name: 'name',
      accountClass: 'account_class',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query) => {
      const base: Record<string, unknown> = {
        ...(query.id ? { id: { $eq: query.id } } : {}),
        ...(query.ids
          ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } }
          : {}),
        ...(query.accountClass ? { account_class: { $eq: query.accountClass } } : {}),
        ...(query.countryCode ? { country_code: { $eq: query.countryCode } } : {}),
        ...(query.isActive === undefined ? {} : { is_active: { $eq: query.isActive === 'true' } }),
      }
      if (!query.search) return base
      const needle = `%${escapeLikePattern(query.search)}%`
      return {
        ...base,
        $or: [
          { code: { $ilike: needle } },
          { name: { $ilike: needle } },
          { description: { $ilike: needle } },
        ],
      }
    },
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'financial.accounts.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createAccountSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'financial.accounts.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updateAccountSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'financial.accounts.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return { id: resolveCrudRecordId(parsed, ctx, translate) }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const accountListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  account_class: z.enum(ACCOUNT_CLASSES),
  account_type: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  currency_code: z.string(),
  normal_balance: z.enum(NORMAL_BALANCES),
  is_active: z.boolean(),
  is_reconciliation_required: z.boolean(),
  country_code: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createFinancialCrudOpenApi({
  resourceName: 'Account',
  pluralName: 'Accounts',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(accountListItemSchema),
  create: { schema: createAccountSchema, description: 'Creates a general-ledger account.' },
  update: { schema: updateAccountSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a general-ledger account.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Archives a general-ledger account.' },
})
