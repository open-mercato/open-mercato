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
import { scanResolveLocationSchema } from '../../../data/validators'
import { resolveLocationByCode } from '../../../lib/scanResolve'

const logger = createLogger('wms')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.view'] },
}

const successSchema = z.object({
  ok: z.literal(true),
  locationId: z.string().uuid(),
  code: z.string(),
  type: z.string(),
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
    const parsed = scanResolveLocationSchema.parse(body)
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
    const resolved = await resolveLocationByCode(em, scoped)
    return NextResponse.json({
      ok: true as const,
      locationId: resolved.locationId,
      code: resolved.code,
      type: resolved.type,
    })
  } catch (error) {
    if (error instanceof CrudHttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 })
    }
    logger.error('scan resolve-location failed', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Resolve scanned location code',
  methods: {
    POST: {
      summary: 'Resolve location by warehouse + barcode/code',
      description:
        'Returns the canonical location id and type for a scanned warehouse location code. Organization is taken from the authenticated session scope, not the request body.',
      requestBody: { contentType: 'application/json', schema: scanResolveLocationSchema },
      responses: [{ status: 200, description: 'Location resolved', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Location not found', schema: errorSchema },
      ],
    },
  },
}
