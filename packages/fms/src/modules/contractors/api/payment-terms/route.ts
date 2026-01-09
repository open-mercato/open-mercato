import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ContractorPaymentTerms } from '../../data/entities'
import { contractorPaymentTermsUpsertSchema } from '../../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    contractorId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['contractors.view'] },
  POST: { requireAuth: true, requireFeatures: ['contractors.manage_financial'] },
  PUT: { requireAuth: true, requireFeatures: ['contractors.manage_financial'] },
  DELETE: { requireAuth: true, requireFeatures: ['contractors.manage_financial'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ContractorPaymentTerms,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: listSchema,
    fields: [
      'id',
      'contractor_id',
      'payment_days',
      'payment_method',
      'currency_code',
      'bank_name',
      'bank_account_number',
      'bank_routing_number',
      'iban',
      'swift_bic',
      'notes',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: z.infer<typeof listSchema>) => {
      const filters: Record<string, unknown> = {}
      if (query.contractorId) filters.contractor_id = { $eq: query.contractorId }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: item.id,
      contractorId: item.contractor_id,
      paymentDays: item.payment_days ?? 30,
      paymentMethod: item.payment_method ?? null,
      currencyCode: item.currency_code ?? 'USD',
      bankName: item.bank_name ?? null,
      bankAccountNumber: item.bank_account_number ? '****' : null,
      bankRoutingNumber: item.bank_routing_number ? '****' : null,
      iban: item.iban ? maskIban(item.iban as string) : null,
      swiftBic: item.swift_bic ?? null,
      notes: item.notes ?? null,
      organizationId: item.organization_id,
      tenantId: item.tenant_id,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }),
  },
  actions: {
    create: {
      commandId: 'contractors.payment-terms.upsert',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return contractorPaymentTermsUpsertSchema.extend({
          contractorId: z.string().uuid(),
        }).parse(scoped)
      },
      response: ({ result }) => ({ id: result?.paymentTermsId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'contractors.payment-terms.upsert',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return contractorPaymentTermsUpsertSchema.extend({
          contractorId: z.string().uuid(),
        }).parse(scoped)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'contractors.payment-terms.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('contractors.validation.paymentTermsIdRequired', 'Payment terms id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

function maskIban(iban: string): string {
  if (iban.length <= 8) return '****'
  return iban.slice(0, 4) + '****' + iban.slice(-4)
}

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
