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
import { Material, MaterialSalesProfile } from '../../../../data/entities'
import { upsertMaterialSalesProfileSchema } from '../../../../data/validators'
// Side-effect command registration:
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

function toSerializable(profile: MaterialSalesProfile) {
  return {
    id: profile.id,
    material_id: profile.materialId,
    organization_id: profile.organizationId,
    tenant_id: profile.tenantId,
    gtin: profile.gtin ?? null,
    commodity_code: profile.commodityCode ?? null,
    is_active: profile.isActive,
    created_at: profile.createdAt.toISOString(),
    updated_at: profile.updatedAt.toISOString(),
  }
}

// ── GET /api/materials/[id]/sales-profile ────────────────────────────────────

export async function GET(req: Request, routeCtx: RouteCtx) {
  try {
    const materialId = decodeId(routeCtx.params?.id).trim()
    if (!materialId) {
      return NextResponse.json({ error: 'Invalid material id' }, { status: 400 })
    }
    const { container, ctx, translate } = await buildContext(req)
    const em = container.resolve('em') as EntityManager

    // Verify the material exists in the caller's scope (also blocks cross-org probing).
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

    const profile = await em.findOne(MaterialSalesProfile, { materialId, deletedAt: null })
    if (!profile) {
      return NextResponse.json(
        { profile: null, exists: false },
        { status: 200 },
      )
    }
    return NextResponse.json({ profile: toSerializable(profile), exists: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: 'Failed to load sales profile' }, { status: 500 })
  }
}

// ── PUT /api/materials/[id]/sales-profile ────────────────────────────────────

export async function PUT(req: Request, routeCtx: RouteCtx) {
  try {
    const materialId = decodeId(routeCtx.params?.id).trim()
    if (!materialId) {
      return NextResponse.json({ error: 'Invalid material id' }, { status: 400 })
    }
    const { ctx, translate } = await buildContext(req)
    if (!ctx.selectedOrganizationId) {
      throw new CrudHttpError(400, {
        error: translate('materials.errors.organization_required', 'Organization context is required'),
      })
    }

    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    const parsed = upsertMaterialSalesProfileSchema.parse({
      organizationId: ctx.selectedOrganizationId,
      tenantId: ctx.auth!.tenantId!,
      gtin: body.gtin ?? null,
      commodityCode: body.commodityCode ?? null,
      isActive: body.isActive,
    })

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<
      { materialId: string; organizationId: string; tenantId: string; gtin?: string | null; commodityCode?: string | null; isActive?: boolean },
      { profileId: string; wasCreate: boolean }
    >('materials.sales_profile.upsert', {
      input: { ...parsed, materialId },
      ctx,
    })

    return NextResponse.json({ ok: true, id: result.profileId, created: result.wasCreate }, {
      status: result.wasCreate ? 201 : 200,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid sales profile payload', details: err.flatten() }, { status: 422 })
    }
    return NextResponse.json({ error: 'Failed to upsert sales profile' }, { status: 500 })
  }
}

// ── DELETE /api/materials/[id]/sales-profile ─────────────────────────────────

export async function DELETE(req: Request, routeCtx: RouteCtx) {
  try {
    const materialId = decodeId(routeCtx.params?.id).trim()
    if (!materialId) {
      return NextResponse.json({ error: 'Invalid material id' }, { status: 400 })
    }
    const { ctx, translate } = await buildContext(req)
    if (!ctx.selectedOrganizationId) {
      throw new CrudHttpError(400, {
        error: translate('materials.errors.organization_required', 'Organization context is required'),
      })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute<
      { materialId: string; organizationId: string; tenantId: string },
      { profileId: string }
    >('materials.sales_profile.delete', {
      input: {
        materialId,
        organizationId: ctx.selectedOrganizationId,
        tenantId: ctx.auth!.tenantId!,
      },
      ctx,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: 'Failed to delete sales profile' }, { status: 500 })
  }
}

// ── OpenAPI ──────────────────────────────────────────────────────────────────

const salesProfileResponseSchema = z.object({
  id: z.string().uuid(),
  material_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  gtin: z.string().nullable(),
  commodity_code: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})

const upsertBodySchema = z.object({
  gtin: z.string().nullable().optional(),
  commodityCode: z.string().nullable().optional(),
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
  summary: 'Material sales profile (1:1 child of Material)',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Read sales profile',
      description:
        'Returns the sales profile for a material if one exists, otherwise `{ profile: null, exists: false }` with HTTP 200. Use this to render the "Listed for sales" tab state.',
      responses: [
        {
          status: 200,
          description: 'Sales profile present or absent',
          schema: z.union([
            z.object({ profile: salesProfileResponseSchema, exists: z.literal(true) }),
            z.object({ profile: z.null(), exists: z.literal(false) }),
          ]),
        },
        { status: 404, description: 'Material not found in caller scope', schema: z.object({ error: z.string() }) },
      ],
    },
    PUT: {
      summary: 'Upsert sales profile',
      description:
        'Creates or updates the sales profile. Creating one materializes `Material.is_sellable=true` via subscriber. Returns 201 on first create, 200 on subsequent updates.',
      requestBody: { required: true, content: { 'application/json': { schema: upsertBodySchema } } },
      responses: [
        { status: 200, description: 'Sales profile updated', schema: upsertResponseSchema },
        { status: 201, description: 'Sales profile created', schema: upsertResponseSchema },
        { status: 422, description: 'Validation error', schema: z.object({ error: z.string(), details: z.unknown() }) },
      ],
    },
    DELETE: {
      summary: 'Soft-delete sales profile',
      description:
        'Soft-deletes the sales profile. Subscriber clears `Material.is_sellable` to false. No-op if no profile exists.',
      responses: [
        { status: 200, description: 'Sales profile deleted', schema: okResponseSchema },
        { status: 404, description: 'No sales profile exists for this material', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
