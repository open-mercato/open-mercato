import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ContractorCreditLimit } from '../../data/entities'
import { contractorCreditLimitUpsertSchema } from '../../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    contractorId: z.string().uuid().optional(),
    isUnlimited: z.coerce.boolean().optional(),
    creditExceeded: z.coerce.boolean().optional(),
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
    entity: ContractorCreditLimit,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: listSchema,
    fields: [
      'id',
      'contractor_id',
      'credit_limit',
      'currency_code',
      'is_unlimited',
      'current_exposure',
      'last_calculated_at',
      'requires_approval_above',
      'approved_by_id',
      'approved_at',
      'notes',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      creditLimit: 'credit_limit',
      currentExposure: 'current_exposure',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: z.infer<typeof listSchema>) => {
      const filters: Record<string, unknown> = {}
      if (query.contractorId) filters.contractor_id = { $eq: query.contractorId }
      if (typeof query.isUnlimited === 'boolean') filters.is_unlimited = { $eq: query.isUnlimited }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => {
      const creditLimit = parseFloat(item.credit_limit as string || '0')
      const currentExposure = parseFloat(item.current_exposure as string || '0')
      const availableCredit = Math.max(0, creditLimit - currentExposure)
      const exposurePercentage = creditLimit > 0 ? (currentExposure / creditLimit) * 100 : 0
      const isOverLimit = !item.is_unlimited && currentExposure > creditLimit

      return {
        id: item.id,
        contractorId: item.contractor_id,
        creditLimit: item.credit_limit,
        currencyCode: item.currency_code ?? 'USD',
        isUnlimited: item.is_unlimited ?? false,
        currentExposure: item.current_exposure ?? '0',
        availableCredit: availableCredit.toFixed(2),
        exposurePercentage: exposurePercentage.toFixed(1),
        isOverLimit,
        lastCalculatedAt: item.last_calculated_at ?? null,
        requiresApprovalAbove: item.requires_approval_above ?? null,
        approvedById: item.approved_by_id ?? null,
        approvedAt: item.approved_at ?? null,
        notes: item.notes ?? null,
        organizationId: item.organization_id,
        tenantId: item.tenant_id,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }
    },
  },
  actions: {
    create: {
      commandId: 'contractors.credit-limits.upsert',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return contractorCreditLimitUpsertSchema.extend({
          contractorId: z.string().uuid(),
        }).parse(scoped)
      },
      response: ({ result }) => ({ id: result?.creditLimitId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'contractors.credit-limits.upsert',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return contractorCreditLimitUpsertSchema.extend({
          contractorId: z.string().uuid(),
        }).parse(scoped)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'contractors.credit-limits.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('contractors.validation.creditLimitIdRequired', 'Credit limit id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
