/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Material, MaterialCatalogProductLink } from '../../../../data/entities'
import { upsertMaterialCatalogLinkSchema } from '../../../../data/validators'
import '../../../../commands'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['materials.material.view'] },
  PUT: { requireAuth: true, requireFeatures: ['materials.material.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['materials.material.manage'] },
}

const decodeId = (value: string | string[] | undefined): string => {
  if (!value) return ''
  const raw = Array.isArray(value) ? value[0] : value
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

type RouteCtx = { params: { id: string } }

async function buildContext(req: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('materials.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
  return { container, auth, ctx, translate }
}

function toSerializable(link: MaterialCatalogProductLink) {
  return {
    id: link.id,
    material_id: link.materialId,
    catalog_product_id: link.catalogProductId,
    organization_id: link.organizationId,
    tenant_id: link.tenantId,
    is_active: link.isActive,
    created_at: link.createdAt.toISOString(),
    updated_at: link.updatedAt.toISOString(),
  }
}

// ── GET /api/materials/[id]/catalog-link ─────────────────────────────────────

export async function GET(req: Request, routeCtx: RouteCtx) {
  try {
    const materialId = decodeId(routeCtx.params?.id).trim()
    if (!materialId) return NextResponse.json({ error: 'Invalid material id' }, { status: 400 })

    const { container, ctx, translate } = await buildContext(req)
    const em = container.resolve('em') as EntityManager

    const material = await em.findOne(Material, {
      id: materialId,
      tenantId: ctx.auth!.tenantId!,
      ...(ctx.selectedOrganizationId ? { organizationId: ctx.selectedOrganizationId } : {}),
      deletedAt: null,
    })
    if (!material) {
      return NextResponse.json(
        { error: translate('materials.material.errors.not_found', 'Material not found') },
        { status: 404 },
      )
    }

    const link = await em.findOne(MaterialCatalogProductLink, {
      materialId,
      deletedAt: null,
    })
    if (!link) return NextResponse.json({ link: null, exists: false }, { status: 200 })
    return NextResponse.json({ link: toSerializable(link), exists: true })
  } catch (err) {
    if (err instanceof CrudHttpError) return NextResponse.json(err.body, { status: err.status })
    return NextResponse.json({ error: 'Failed to load catalog link' }, { status: 500 })
  }
}

// ── PUT /api/materials/[id]/catalog-link ─────────────────────────────────────

export async function PUT(req: Request, routeCtx: RouteCtx) {
  try {
    const materialId = decodeId(routeCtx.params?.id).trim()
    if (!materialId) return NextResponse.json({ error: 'Invalid material id' }, { status: 400 })
    const { ctx, translate } = await buildContext(req)
    if (!ctx.selectedOrganizationId) {
      throw new CrudHttpError(400, {
        error: translate('materials.errors.organization_required', 'Organization context is required'),
      })
    }

    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    const parsed = upsertMaterialCatalogLinkSchema.parse({
      organizationId: ctx.selectedOrganizationId,
      tenantId: ctx.auth!.tenantId!,
      materialId,
      catalogProductId: body.catalogProductId,
      isActive: body.isActive,
    })

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof parsed, { linkId: string; wasCreate: boolean }>(
      'materials.catalog_link.upsert',
      { input: parsed, ctx },
    )
    return NextResponse.json(
      { ok: true, id: result.linkId, created: result.wasCreate },
      { status: result.wasCreate ? 201 : 200 },
    )
  } catch (err) {
    if (err instanceof CrudHttpError) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid catalog link payload', details: err.flatten() }, { status: 422 })
    }
    return NextResponse.json({ error: 'Failed to upsert catalog link' }, { status: 500 })
  }
}

// ── DELETE /api/materials/[id]/catalog-link ──────────────────────────────────

export async function DELETE(req: Request, routeCtx: RouteCtx) {
  try {
    const materialId = decodeId(routeCtx.params?.id).trim()
    if (!materialId) return NextResponse.json({ error: 'Invalid material id' }, { status: 400 })
    const { ctx, translate } = await buildContext(req)
    if (!ctx.selectedOrganizationId) {
      throw new CrudHttpError(400, {
        error: translate('materials.errors.organization_required', 'Organization context is required'),
      })
    }
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute<
      { materialId: string; organizationId: string; tenantId: string },
      { linkId: string | null }
    >('materials.catalog_link.remove', {
      input: {
        materialId,
        organizationId: ctx.selectedOrganizationId,
        tenantId: ctx.auth!.tenantId!,
      },
      ctx,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) return NextResponse.json(err.body, { status: err.status })
    return NextResponse.json({ error: 'Failed to remove catalog link' }, { status: 500 })
  }
}

const linkResponseSchema = z.object({
  id: z.string().uuid(),
  material_id: z.string().uuid(),
  catalog_product_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})

const upsertBodySchema = z.object({
  catalogProductId: z.string().uuid(),
  isActive: z.boolean().optional(),
})

const upsertResponseSchema = z.object({
  ok: z.boolean(),
  id: z.string().uuid(),
  created: z.boolean(),
})

const okResponseSchema = z.object({ ok: z.boolean() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Materials',
  summary: 'Material ↔ Catalog Product 1:1 link',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Read catalog link',
      description:
        'Returns the catalog product link for a material if one exists, otherwise `{ link: null, exists: false }`. Use this to render the "Linked product" panel state.',
      responses: [
        {
          status: 200,
          description: 'Link present or absent',
          schema: z.union([
            z.object({ link: linkResponseSchema, exists: z.literal(true) }),
            z.object({ link: z.null(), exists: z.literal(false) }),
          ]),
        },
        { status: 404, description: 'Material not found in caller scope', schema: z.object({ error: z.string() }) },
      ],
    },
    PUT: {
      summary: 'Upsert catalog link (re-link semantics)',
      description:
        'Creates or re-targets the 1:1 link. Server validates both the material and the catalog product live in the same org. Returns 201 on first create, 200 on subsequent updates. 409 if the catalog product is already linked to a different material.',
      requestBody: { required: true, content: { 'application/json': { schema: upsertBodySchema } } },
      responses: [
        { status: 200, description: 'Link updated', schema: upsertResponseSchema },
        { status: 201, description: 'Link created', schema: upsertResponseSchema },
        {
          status: 409,
          description: 'Catalog product already linked to a different material',
          schema: z.object({ error: z.string() }),
        },
        { status: 422, description: 'Validation error', schema: z.object({ error: z.string(), details: z.unknown() }) },
      ],
    },
    DELETE: {
      summary: 'Unlink material from catalog product',
      description:
        'Soft-deletes the link. No-op + 200 if no link exists. The catalog product itself is untouched.',
      responses: [
        { status: 200, description: 'Link removed (or absent)', schema: okResponseSchema },
      ],
    },
  },
}
