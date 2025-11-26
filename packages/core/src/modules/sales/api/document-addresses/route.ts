import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { withScopedPayload } from '../utils'
import { SalesDocumentAddress, SalesOrder, SalesQuote } from '../../data/entities'
import {
  documentAddressCreateSchema,
  documentAddressDeleteSchema,
  type DocumentAddressCreateInput,
} from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true },
  POST: { requireAuth: true },
  DELETE: { requireAuth: true },
}

type RouteContext = {
  ctx: CommandRuntimeContext
  em: EntityManager
  translate: (key: string, fallback?: string) => string
  organizationId: string
  tenantId: string
}

async function resolveRouteContext(req: Request): Promise<RouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('sales.documents.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('sales.documents.errors.organization_required', 'Organization context is required.'),
    })
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  const em = container.resolve('em') as EntityManager

  return {
    ctx,
    em,
    translate,
    tenantId: auth.tenantId,
    organizationId,
  }
}

async function ensureKindPermission(
  ctx: CommandRuntimeContext,
  kind: 'order' | 'quote',
  mode: 'view' | 'manage',
  translate: (key: string, fallback?: string) => string
) {
  const rbac = ctx.container.resolve('rbacService') as RbacService | null
  const auth = ctx.auth
  if (!rbac || !auth?.sub) return
  const feature =
    kind === 'order'
      ? mode === 'manage'
        ? 'sales.orders.manage'
        : 'sales.orders.view'
      : mode === 'manage'
        ? 'sales.quotes.manage'
        : 'sales.quotes.view'
  const ok = await rbac.userHasAllFeatures(auth.sub, [feature], {
    tenantId: auth.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? auth.orgId ?? null,
  })
  if (!ok) {
    throw new CrudHttpError(403, {
      error: translate('sales.documents.errors.forbidden', 'You do not have access to this resource.'),
    })
  }
}

async function ensureDocument(
  em: EntityManager,
  kind: 'order' | 'quote',
  id: string,
  organizationId: string,
  tenantId: string,
  translate: (key: string, fallback?: string) => string
): Promise<SalesOrder | SalesQuote> {
  const repo = kind === 'order' ? SalesOrder : SalesQuote
  const entity = await em.findOne(repo, { id, organizationId, tenantId })
  if (!entity) {
    throw new CrudHttpError(404, {
      error: translate('sales.documents.detail.error', 'Document not found or inaccessible.'),
    })
  }
  return entity
}

const listQuerySchema = z.object({
  documentId: z.string().uuid(),
  documentKind: z.enum(['order', 'quote']),
})

export async function GET(req: Request) {
  try {
    const { ctx, em, translate, organizationId, tenantId } = await resolveRouteContext(req)
    const params = listQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams.entries()))
    await ensureKindPermission(ctx, params.documentKind, 'view', translate)
    await ensureDocument(em, params.documentKind, params.documentId, organizationId, tenantId, translate)
    const items = await em.find(
      SalesDocumentAddress,
      {
        documentId: params.documentId,
        documentKind: params.documentKind,
        organizationId,
        tenantId,
      },
      { orderBy: { createdAt: 'desc' } }
    )
    return NextResponse.json({
      items: items.map((entry) => ({
        id: entry.id,
        addressId: entry.addressId,
        addressSnapshot: entry.addressSnapshot ?? null,
      })),
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('sales.document-addresses.list failed', err)
    return NextResponse.json(
      { error: translate('sales.documents.detail.updateError', 'Failed to update document.') },
      { status: 400 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const { ctx, em, translate, organizationId, tenantId } = await resolveRouteContext(req)
    const payload = await req.json().catch(() => ({}))
    const scoped = withScopedPayload(payload, ctx, translate)
    const input = documentAddressCreateSchema.parse(scoped) as DocumentAddressCreateInput
    await ensureKindPermission(ctx, input.documentKind, 'manage', translate)
    const document = await ensureDocument(em, input.documentKind, input.documentId, organizationId, tenantId, translate)

    const existing = await em.findOne(SalesDocumentAddress, {
      documentId: document.id,
      documentKind: input.documentKind,
      addressId: input.addressId,
      organizationId,
      tenantId,
    })
    if (existing) {
      return NextResponse.json({
        id: existing.id,
        addressId: existing.addressId,
        addressSnapshot: existing.addressSnapshot ?? input.addressSnapshot ?? null,
      })
    }

    const record = em.create(SalesDocumentAddress, {
      documentId: document.id,
      documentKind: input.documentKind,
      addressId: input.addressId,
      addressSnapshot: input.addressSnapshot ?? null,
      organizationId,
      tenantId,
      order: input.documentKind === 'order' ? (document as SalesOrder) : null,
      quote: input.documentKind === 'quote' ? (document as SalesQuote) : null,
    })
    await em.persistAndFlush(record)

    return NextResponse.json({
      id: record.id,
      addressId: record.addressId,
      addressSnapshot: record.addressSnapshot ?? null,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('sales.document-addresses.create failed', err)
    return NextResponse.json(
      { error: translate('sales.documents.detail.updateError', 'Failed to update document.') },
      { status: 400 }
    )
  }
}

export async function DELETE(req: Request) {
  try {
    const { ctx, em, translate, organizationId, tenantId } = await resolveRouteContext(req)
    const payload = await req.json().catch(() => ({}))
    const scoped = withScopedPayload(payload, ctx, translate)
    const input = documentAddressDeleteSchema.parse(scoped)
    await ensureKindPermission(ctx, input.documentKind as 'order' | 'quote', 'manage', translate)
    await ensureDocument(em, input.documentKind as 'order' | 'quote', input.documentId, organizationId, tenantId, translate)

    const record = await em.findOne(SalesDocumentAddress, {
      id: input.id,
      documentId: input.documentId,
      documentKind: input.documentKind,
      organizationId,
      tenantId,
    })
    if (!record) {
      throw new CrudHttpError(404, {
        error: translate('sales.documents.detail.error', 'Document not found or inaccessible.'),
      })
    }
    await em.removeAndFlush(record)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('sales.document-addresses.delete failed', err)
    return NextResponse.json(
      { error: translate('sales.documents.detail.updateError', 'Failed to update document.') },
      { status: 400 }
    )
  }
}

const documentAddressSchema = z.object({
  id: z.string().uuid(),
  addressId: z.string().uuid(),
  addressSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Sales document addresses',
  methods: {
    GET: {
      summary: 'List addresses linked to a sales document',
      query: listQuerySchema,
      responses: [
        { status: 200, description: 'Addresses linked to the document', schema: z.object({ items: z.array(documentAddressSchema) }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
    POST: {
      summary: 'Assign an address to a sales document',
      requestBody: { contentType: 'application/json', schema: documentAddressCreateSchema },
      responses: [
        { status: 200, description: 'Assignment created', schema: documentAddressSchema },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
    DELETE: {
      summary: 'Unassign an address from a sales document',
      requestBody: { contentType: 'application/json', schema: documentAddressDeleteSchema },
      responses: [
        { status: 200, description: 'Assignment removed', schema: z.object({ ok: z.boolean() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
