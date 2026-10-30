import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isExplicitlyEmptyOrganizationScope } from '@open-mercato/shared/lib/auth/organizationScope'
import { isOrganizationReadAccessAllowed } from '@open-mercato/core/modules/directory/utils/organizationScopeGuard'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, notFound, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Code, GeneratedCode } from '../../../../data/entities'

// Release 4 PLAN.md Step 6.4 / SPEC-055 §API Contracts `GET
// /api/promotions/codes/[id]/generated`: "Paginated list of GeneratedCode records. Query:
// page, pageSize, active." Read-only, hand-rolled (not `makeCrudRoute`) the same way
// `api/[id]/route.ts`'s promotion-detail GET is hand-rolled — a nested, parent-scoped list
// has no CRUD-factory shape to borrow.

const logger = createLogger('promotions')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['promotions.codes.manage'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

const queryParamsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  active: z.string().optional(),
})

const generatedCodeItemSchema = z.object({
  id: z.string().uuid(),
  codeId: z.string().uuid(),
  code: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const generatedCodeListResponseSchema = z.object({
  items: z.array(generatedCodeItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
})

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: codeId } = paramsSchema.parse(await params)
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) {
      throw new CrudHttpError(401, { error: translate('promotions.errors.unauthorized', 'Unauthorized') })
    }
    const authenticatedAuth = auth as typeof auth & { tenantId: string }

    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth: authenticatedAuth, request: req })
    // §API Contracts intro: a cross-tenant/cross-org mismatch answers identically to "not
    // found" — no existence oracle.
    if (isExplicitlyEmptyOrganizationScope(scope)) {
      throw notFound(translate('promotions.errors.code_not_found', 'Promotion code not found'))
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const code = await em.findOne(Code, { id: codeId, tenantId: authenticatedAuth.tenantId, deletedAt: null })
    if (!code) {
      throw notFound(translate('promotions.errors.code_not_found', 'Promotion code not found'))
    }
    if (!isOrganizationReadAccessAllowed({ scope, auth: authenticatedAuth, organizationId: code.organizationId })) {
      throw notFound(translate('promotions.errors.code_not_found', 'Promotion code not found'))
    }

    const url = new URL(req.url)
    const query = queryParamsSchema.parse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      active: url.searchParams.get('active') ?? undefined,
    })

    const where: Record<string, unknown> = {
      codeId: code.id,
      tenantId: code.tenantId,
      organizationId: code.organizationId,
    }
    const activeFilter = parseBooleanToken(query.active)
    if (activeFilter !== null) where.active = activeFilter

    const [rows, total] = await Promise.all([
      em.find(GeneratedCode, where, {
        orderBy: { createdAt: 'desc' },
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }),
      em.count(GeneratedCode, where),
    ])

    const payload: z.infer<typeof generatedCodeListResponseSchema> = {
      items: rows.map((row) => ({
        id: row.id,
        codeId: row.codeId,
        code: row.code,
        active: row.active,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    }

    return NextResponse.json(payload)
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('promotions.errors.invalidInput', 'Invalid input'), issues: err.issues }, { status: 400 })
    }
    logger.error('promotions.codes.generated.list failed', { err })
    return NextResponse.json(
      { error: translate('promotions.errors.load_failed', 'Failed to load generated codes') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Promotions',
  summary: 'List the generated codes for a dynamic code pool',
  methods: {
    GET: {
      summary: 'Paginated list of GeneratedCode rows for a code id',
      responses: [
        { status: 200, description: 'Paginated generated-code list', schema: generatedCodeListResponseSchema },
        { status: 404, description: 'Promotion code not found (or not visible to the caller)' },
      ],
    },
  },
}
