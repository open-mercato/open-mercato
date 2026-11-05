import { z } from 'zod'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createSalesCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { withScopedPayload } from '../utils'
import { SalesDocumentAddress, SalesOrder, SalesQuote } from '../../data/entities'
import {
  documentAddressCreateSchema,
  documentAddressDeleteSchema,
  documentAddressUpdateSchema,
} from '../../data/validators'
import { E } from '#generated/entities.ids.generated'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    documentId: z.string().uuid(),
    documentKind: z.enum(['order', 'quote']).optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true },
  POST: { requireAuth: true },
  PUT: { requireAuth: true },
  DELETE: { requireAuth: true },
}

export const metadata = routeMetadata

type DocumentKind = 'order' | 'quote'
type DocumentAddressAccess = 'view' | 'manage'
type Translate = (key: string, fallback?: string) => string

const DOCUMENT_ADDRESS_FEATURES: Record<DocumentKind, Record<DocumentAddressAccess, string>> = {
  order: { view: 'sales.orders.view', manage: 'sales.orders.manage' },
  quote: { view: 'sales.quotes.view', manage: 'sales.quotes.manage' },
}

function toDocumentKind(value: unknown): DocumentKind | null {
  return value === 'order' || value === 'quote' ? value : null
}

async function resolveDocumentKindForRead(query: { documentId?: string; documentKind?: DocumentKind }, ctx: CrudCtx) {
  if (query.documentKind) return query.documentKind

  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId =
    ctx.selectedOrganizationId ??
    ctx.auth?.orgId ??
    (Array.isArray(ctx.organizationIds) && ctx.organizationIds.length === 1 ? ctx.organizationIds[0] : null)
  if (!query.documentId || !tenantId || !organizationId) return null

  const em = ctx.container.resolve('em') as EntityManager
  const scope = { tenantId, organizationId }
  const order = await findOneWithDecryption(em, SalesOrder, { id: query.documentId, tenantId, organizationId }, {}, scope)
  if (order) return 'order'
  const quote = await findOneWithDecryption(em, SalesQuote, { id: query.documentId, tenantId, organizationId }, {}, scope)
  if (quote) return 'quote'
  return null
}

async function ensureDocumentAddressReadAccess(query: { documentId?: string; documentKind?: DocumentKind }, ctx: CrudCtx) {
  const documentKind = await resolveDocumentKindForRead(query, ctx)
  const requiredFeatures = documentKind
    ? [DOCUMENT_ADDRESS_FEATURES[documentKind].view]
    : [DOCUMENT_ADDRESS_FEATURES.order.view, DOCUMENT_ADDRESS_FEATURES.quote.view]
  await ensureDocumentAddressAccess(ctx, requiredFeatures)
  return documentKind
}

async function resolveExistingAddressKind(
  ctx: CrudCtx,
  id: string,
  scope: { tenantId: string; organizationId: string },
): Promise<DocumentKind | null> {
  const em = ctx.container.resolve('em') as EntityManager
  const address = await findOneWithDecryption(
    em,
    SalesDocumentAddress,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )
  return toDocumentKind(address?.documentKind)
}

async function ensureDocumentAddressAccess(
  ctx: CrudCtx,
  requiredFeatures: string[],
  translate?: Translate,
): Promise<void> {
  const resolvedTranslate = translate ?? (await resolveTranslations()).translate
  const auth = ctx.auth
  if (!auth?.sub) {
    throw new CrudHttpError(401, { error: resolvedTranslate('api.errors.unauthorized', 'Unauthorized') })
  }

  let rbac: RbacService | null = null
  try {
    rbac = ctx.container.resolve('rbacService') as RbacService
  } catch {
    rbac = null
  }

  const ok = rbac
    ? await rbac.userHasAllFeatures(auth.sub, requiredFeatures, {
        tenantId: auth.tenantId ?? null,
        organizationId: ctx.selectedOrganizationId ?? auth.orgId ?? null,
      })
    : false
  if (!ok) {
    throw new CrudHttpError(403, {
      error: resolvedTranslate('api.errors.forbidden', 'Forbidden'),
      requiredFeatures,
    })
  }
}

async function ensureDocumentAddressKindAccess(
  ctx: CrudCtx,
  documentKind: DocumentKind,
  access: DocumentAddressAccess,
  translate?: Translate,
): Promise<void> {
  await ensureDocumentAddressAccess(ctx, [DOCUMENT_ADDRESS_FEATURES[documentKind][access]], translate)
}

async function ensureDocumentAddressMutationAccess(
  ctx: CrudCtx,
  input: { id: string; documentKind: DocumentKind; tenantId: string; organizationId: string },
  options: { includeTargetKind: boolean; translate?: Translate },
): Promise<void> {
  const existingKind = await resolveExistingAddressKind(ctx, input.id, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })
  const featureKinds = new Set<DocumentKind>()
  if (existingKind) featureKinds.add(existingKind)
  if (!existingKind || options.includeTargetKind) featureKinds.add(input.documentKind)

  await ensureDocumentAddressAccess(
    ctx,
    [...featureKinds].map((kind) => DOCUMENT_ADDRESS_FEATURES[kind].manage),
    options.translate,
  )
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  hooks: {
    beforeList: async (query, ctx) => {
      await ensureDocumentAddressReadAccess(query, ctx)
    },
  },
  orm: {
    entity: SalesDocumentAddress,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.sales.sales_document_address },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_document_address,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'document_id',
      'document_kind',
      'customer_address_id',
      'name',
      'purpose',
      'company_name',
      'address_line1',
      'address_line2',
      'building_number',
      'flat_number',
      'city',
      'region',
      'postal_code',
      'country',
      'latitude',
      'longitude',
      'order_id',
      'quote_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: any, ctx) => {
      const documentKind = await resolveDocumentKindForRead(query, ctx)
      const filters: Record<string, any> = {
        document_id: { $eq: query.documentId },
      }

      if (query.documentKind ?? documentKind) filters.document_kind = { $eq: query.documentKind ?? documentKind }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'sales.document-addresses.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const input = documentAddressCreateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
        await ensureDocumentAddressKindAccess(ctx, input.documentKind, 'manage', translate)
        return input
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'sales.document-addresses.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const input = documentAddressUpdateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
        await ensureDocumentAddressMutationAccess(ctx, input, { includeTargetKind: true, translate })
        return input
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'sales.document-addresses.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        const documentId =
          parsed?.body?.documentId ??
          parsed?.query?.documentId ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('documentId') : null)
        const documentKind =
          parsed?.body?.documentKind ??
          parsed?.query?.documentKind ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('documentKind') : null)
        if (!id || !documentId || !documentKind) {
          throw new CrudHttpError(400, {
            error: translate('sales.documents.detail.error', 'Document not found or inaccessible.'),
          })
        }
        const input = documentAddressDeleteSchema.parse(withScopedPayload({ id, documentId, documentKind }, ctx, translate))
        await ensureDocumentAddressMutationAccess(ctx, input, { includeTargetKind: false, translate })
        return input
      },
      response: () => ({ ok: true }),
    },
  },
})

const { GET, POST, PUT, DELETE } = crud

export { GET, POST, PUT, DELETE }

const documentAddressSchema = z.object({
  id: z.string().uuid(),
  document_id: z.string().uuid(),
  document_kind: z.enum(['order', 'quote']),
  customer_address_id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
  address_line1: z.string(),
  address_line2: z.string().nullable().optional(),
  building_number: z.string().nullable().optional(),
  flat_number: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  postal_code: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Document address',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(documentAddressSchema),
  create: {
    schema: documentAddressCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: 'Creates a sales document address linked to an order or quote.',
  },
  update: {
    schema: documentAddressUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a sales document address.',
  },
  del: {
    schema: documentAddressDeleteSchema.pick({ id: true, documentId: true, documentKind: true }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a sales document address.',
  },
})
