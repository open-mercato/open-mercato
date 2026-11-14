import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, notFound, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Code } from '../../../../data/entities'
import type { PromotionCodeGenerationService } from '../../../../services/code-generation'

// Release 4 PLAN.md Step 6.4 / SPEC-055 §API Contracts `POST
// /api/promotions/codes/[id]/generate`: "Triggers background generation of remaining
// dynamic codes to reach `amount`. Returns `{ jobId }`." Non-CRUD custom write route —
// wired through the mutation-guard registry per `packages/core/AGENTS.md` → "API Routes"
// (`runRouteMutationGuards`, the same helper `api/order/route.ts`/`api/[id]/tree/route.ts`
// use), not `makeCrudRoute`.

const logger = createLogger('promotions')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['promotions.codes.manage'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

type RouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

async function resolveRouteContext(req: Request): Promise<RouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('promotions.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth) ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('promotions.errors.organization_required', 'Organization context is required') })
  }
  return {
    ctx: {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: organizationId,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    },
    tenantId: auth.tenantId,
    organizationId,
    translate,
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: codeId } = paramsSchema.parse(await params)
    const context = await resolveRouteContext(req)

    const em = (context.ctx.container.resolve('em') as EntityManager).fork()
    // §API Contracts intro: "every referenced promotionId/codeId is checked for
    // tenant/organization ownership before use (a mismatch answers identically to 'not
    // found')."
    const code = await em.findOne(Code, {
      id: codeId,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      deletedAt: null,
    })
    if (!code) throw notFound(context.translate('promotions.errors.code_not_found', 'Promotion code not found'))
    if (code.type !== 'dynamic') {
      throw new CrudHttpError(422, {
        error: context.translate('promotions.errors.code_not_dynamic', 'Only dynamic codes can be generated'),
      })
    }

    const userId = context.ctx.auth?.sub
    if (!userId) {
      throw new CrudHttpError(401, { error: context.translate('promotions.errors.unauthorized', 'Unauthorized') })
    }

    // State-changing action endpoint — mapped to `update` per
    // `packages/core/AGENTS.md` → "API Routes" ("state-changing action endpoints usually
    // use update"). `resourceKind` matches what `api/codes/route.ts`'s `makeCrudRoute`
    // auto-derives for this entity (`promotions.code`, from the `promotions.code.update`
    // command id), so this route benefits from the same registered guard set.
    const guarded = await runRouteMutationGuards({
      container: context.ctx.container,
      req,
      auth: { userId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: {
        resourceKind: 'promotions.code',
        resourceId: code.id,
        operation: 'update',
        mutationPayload: null,
      },
    })
    if (!guarded.ok) return guarded.response

    const generationService = context.ctx.container.resolve('promotionCodeGenerationService') as PromotionCodeGenerationService
    const { jobId } = await generationService.triggerGeneration(code.id, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })

    await guarded.runAfterSuccess()

    return NextResponse.json({ jobId })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('promotions.errors.invalidInput', 'Invalid input'), issues: err.issues }, { status: 400 })
    }
    logger.error('promotions.codes.generate failed', { err })
    return NextResponse.json(
      { error: translate('promotions.errors.generation_trigger_failed', 'Failed to trigger code generation') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Promotions',
  summary: 'Trigger background generation of a dynamic code pool',
  methods: {
    POST: {
      summary: 'Triggers background generation of remaining dynamic codes to reach `amount`',
      responses: [
        { status: 200, description: 'Generation job enqueued', schema: z.object({ jobId: z.string() }) },
        { status: 404, description: 'Promotion code not found (or not visible to the caller)' },
        { status: 422, description: 'The code is not a dynamic pool' },
      ],
    },
  },
}
