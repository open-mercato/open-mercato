/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  lifecycleTransitionSchema,
  materialLifecycleStateSchema,
  type LifecycleTransitionInput,
} from '../../../../data/validators'
import '../../../../commands'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['materials.material.manage'] },
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

export async function POST(req: Request, routeCtx: RouteCtx) {
  try {
    const materialId = decodeId(routeCtx.params?.id).trim()
    if (!materialId) {
      return NextResponse.json({ error: 'Invalid material id' }, { status: 400 })
    }
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
    if (!ctx.selectedOrganizationId) {
      throw new CrudHttpError(400, {
        error: translate('materials.errors.organization_required', 'Organization context is required'),
      })
    }

    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    const parsed = lifecycleTransitionSchema.parse({
      organizationId: ctx.selectedOrganizationId,
      tenantId: auth.tenantId,
      materialId,
      toState: body.toState ?? body.to_state,
      reason: body.reason ?? null,
      replacementMaterialId: body.replacementMaterialId ?? body.replacement_material_id ?? null,
    })

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<
      LifecycleTransitionInput,
      { materialId: string; eventId: string; fromState: string; toState: string }
    >('materials.material.lifecycle_change', { input: parsed, ctx })

    return NextResponse.json({
      ok: true,
      materialId: result.materialId,
      eventId: result.eventId,
      fromState: result.fromState,
      toState: result.toState,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid lifecycle payload', details: err.flatten() }, { status: 422 })
    }
    return NextResponse.json({ error: 'Failed to change lifecycle state' }, { status: 500 })
  }
}

const lifecycleResponseSchema = z.object({
  ok: z.boolean(),
  materialId: z.string().uuid(),
  eventId: z.string().uuid(),
  fromState: materialLifecycleStateSchema,
  toState: materialLifecycleStateSchema,
})

const lifecycleBodySchema = z.object({
  toState: materialLifecycleStateSchema,
  reason: z.string().max(2000).optional().nullable(),
  replacementMaterialId: z.string().uuid().optional().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Materials',
  summary: 'Material lifecycle transition',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Transition lifecycle state',
      description:
        'Moves the material between lifecycle states per the spec state machine: draft→active→phase_out→obsolete (plus phase_out→active reverse). Same-state requests return 409. Invalid transitions return 409 with an `allowed` hint. `replacementMaterialId` only applies when transitioning to obsolete; it is silently dropped on other transitions. Appends a row to `material_lifecycle_events` and emits `materials.material.lifecycle_changed`.',
      requestBody: { required: true, content: { 'application/json': { schema: lifecycleBodySchema } } },
      responses: [
        { status: 200, description: 'Lifecycle transition applied', schema: lifecycleResponseSchema },
        { status: 404, description: 'Material not found in caller scope', schema: z.object({ error: z.string() }) },
        {
          status: 409,
          description: 'No-op (same state) or invalid transition',
          schema: z.object({ error: z.string(), details: z.unknown().optional() }),
        },
        {
          status: 422,
          description: 'Replacement material missing or self-reference',
          schema: z.object({ error: z.string(), details: z.unknown().optional() }),
        },
      ],
    },
  },
}
