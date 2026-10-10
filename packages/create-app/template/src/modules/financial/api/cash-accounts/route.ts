import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'
import { CASH_ACCOUNT_KINDS, GlCashAccount } from '../../data/entities'
import { createCashAccountSchema, updateCashAccountSchema } from '../../data/validators'
import { createPagedListResponseSchema, createFinancialCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { FINANCIAL_CASH_ACCOUNT_ENTITY_ID } from '../../commands/money'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    search: z.string().optional(),
    kind: z.enum(CASH_ACCOUNT_KINDS).optional(),
    isActive: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['financial.payments.view'] },
  POST: { requireAuth: true, requireFeatures: ['financial.payments.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['financial.payments.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['financial.payments.manage'] },
}

export const metadata = { path: '/financial/cash-accounts', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: GlCashAccount,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: FINANCIAL_CASH_ACCOUNT_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: FINANCIAL_CASH_ACCOUNT_ENTITY_ID,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'code',
      'name',
      'kind',
      'account_id',
      'currency_code',
      'bank_name',
      'iban',
      'account_number',
      'is_active',
      'is_default',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      code: 'code',
      name: 'name',
      kind: 'kind',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query) => {
      const isActive = parseBooleanToken(query.isActive)
      const base: Record<string, unknown> = {
        ...(query.id ? { id: { $eq: query.id } } : {}),
        ...(query.ids ? { id: { $in: parseCommaSeparatedList(query.ids) } } : {}),
        ...(query.kind ? { kind: { $eq: query.kind } } : {}),
        ...(isActive === null ? {} : { is_active: { $eq: isActive } }),
      }
      if (!query.search) return base
      const needle = `%${escapeLikePattern(query.search)}%`
      return {
        ...base,
        $or: [
          { code: { $ilike: needle } },
          { name: { $ilike: needle } },
          { bank_name: { $ilike: needle } },
        ],
      }
    },
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'financial.cash_accounts.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createCashAccountSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'financial.cash_accounts.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updateCashAccountSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'financial.cash_accounts.delete',
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

const cashAccountListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  kind: z.enum(CASH_ACCOUNT_KINDS),
  account_id: z.string().uuid(),
  currency_code: z.string(),
  bank_name: z.string().nullable().optional(),
  iban: z.string().nullable().optional(),
  account_number: z.string().nullable().optional(),
  is_active: z.boolean(),
  is_default: z.boolean(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createFinancialCrudOpenApi({
  resourceName: 'CashAccount',
  pluralName: 'CashAccounts',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(cashAccountListItemSchema),
  create: { schema: createCashAccountSchema, description: 'Creates a cash or bank account.' },
  update: { schema: updateCashAccountSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a cash or bank account.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Archives a cash or bank account.' },
})
