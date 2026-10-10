import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { GlJournalEntry, JOURNAL_ENTRY_STATUSES, JOURNAL_ENTRY_TYPES } from '../../data/entities'
import { createJournalEntrySchema, updateJournalEntrySchema } from '../../data/validators'
import { createPagedListResponseSchema, createFinancialCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { FINANCIAL_ENTRY_ENTITY_ID } from '../../commands/ledger'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    search: z.string().optional(),
    status: z.enum(JOURNAL_ENTRY_STATUSES).optional(),
    entryType: z.enum(JOURNAL_ENTRY_TYPES).optional(),
    periodId: z.string().uuid().optional(),
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

export const metadata = { path: '/financial/journal-entries', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: GlJournalEntry,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: { entityType: FINANCIAL_ENTRY_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: FINANCIAL_ENTRY_ENTITY_ID,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'entry_number',
      'entry_date',
      'posting_date',
      'period_id',
      'entry_type',
      'description',
      'reference',
      'currency_code',
      'exchange_rate',
      'status',
      'posted_at',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      entryNumber: 'entry_number',
      entryDate: 'entry_date',
      postingDate: 'posting_date',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query) => {
      const base: Record<string, unknown> = {
        ...(query.id ? { id: { $eq: query.id } } : {}),
        ...(query.ids
          ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } }
          : {}),
        ...(query.status ? { status: { $eq: query.status } } : {}),
        ...(query.entryType ? { entry_type: { $eq: query.entryType } } : {}),
        ...(query.periodId ? { period_id: { $eq: query.periodId } } : {}),
      }
      if (!query.search) return base
      const needle = `%${escapeLikePattern(query.search)}%`
      return {
        ...base,
        $or: [
          { entry_number: { $ilike: needle } },
          { reference: { $ilike: needle } },
          { description: { $ilike: needle } },
        ],
      }
    },
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'financial.journal_entries.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createJournalEntrySchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'financial.journal_entries.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updateJournalEntrySchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'financial.journal_entries.delete',
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

const entryListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  entry_number: z.string(),
  entry_date: z.string(),
  posting_date: z.string(),
  period_id: z.string().uuid(),
  entry_type: z.enum(JOURNAL_ENTRY_TYPES),
  description: z.string(),
  reference: z.string().nullable().optional(),
  currency_code: z.string(),
  exchange_rate: z.string(),
  status: z.enum(JOURNAL_ENTRY_STATUSES),
  posted_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createFinancialCrudOpenApi({
  resourceName: 'Journal entry',
  pluralName: 'Journal entries',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(entryListItemSchema),
  create: { schema: createJournalEntrySchema, description: 'Creates a draft journal entry with balanced debit/credit lines.' },
  update: { schema: updateJournalEntrySchema, responseSchema: defaultOkResponseSchema, description: 'Updates a draft journal entry.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Deletes a draft journal entry.' },
})
