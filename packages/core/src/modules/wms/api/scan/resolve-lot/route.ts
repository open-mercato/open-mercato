import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { scanResolveLotSchema } from '../../../data/validators'
import { resolveLotByNumber } from '../../../lib/scanResolve'

const logger = createLogger('wms')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.view'] },
}

const successSchema = z.object({
  ok: z.literal(true),
  lotId: z.string().uuid(),
  lotNumber: z.string(),
  expiresAt: z.string().nullable(),
})
const errorSchema = z.object({ error: z.string() })

export async function POST(request: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(request)
    if (!auth?.tenantId) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }
    const organizationScope = await resolveOrganizationScopeForRequest({
      container,
      auth,
      request,
    })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, { error: 'organization_scope_required' })
    }
    const body = await readJsonSafe<Record<string, unknown>>(request, {})
    const parsed = scanResolveLotSchema.parse(body)
    if (parsed.tenantId !== auth.tenantId && !auth.isSuperAdmin) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    // Scope organization from auth/session — never trust body organizationId for cross-org reads.
    const scoped = {
      ...parsed,
      tenantId: auth.tenantId,
      organizationId,
    }
    const em = (container.resolve('em') as EntityManager).fork()
    const resolved = await resolveLotByNumber(em, scoped)
    return NextResponse.json({
      ok: true as const,
      lotId: resolved.lotId,
      lotNumber: resolved.lotNumber,
      expiresAt: resolved.expiresAt,
    })
  } catch (error) {
    if (error instanceof CrudHttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 })
    }
    logger.error('scan resolve-lot failed', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Resolve scanned lot number',
  methods: {
    POST: {
      summary: 'Resolve lot by catalog variant + lot number',
      description:
        'Returns the canonical lot id and expiry for a scanned lot number. Organization is taken from the authenticated session scope, not the request body.',
      requestBody: { contentType: 'application/json', schema: scanResolveLotSchema },
      responses: [{ status: 200, description: 'Lot resolved', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Lot not found', schema: errorSchema },
      ],
    },
  },
}
