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
import { putawayTaskCompleteSchema, scanPutawaySchema } from '../../../data/validators'
import { resolveScanPutawayCommandInput } from '../../../lib/scanResolve'
import { executeWmsCustomPostRoute } from '../../inventory/helpers'

const logger = createLogger('wms')

export const metadata = {
  // Same floor ACL as putaway-tasks/:id/complete (command enforces manage vs assignee).
  POST: { requireAuth: true, requireFeatures: ['wms.adjust_inventory'] },
}

const successSchema = z.object({
  ok: z.literal(true),
  movementId: z.string().uuid(),
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
    const parsed = scanPutawaySchema.parse(body)
    if (parsed.tenantId !== auth.tenantId && !auth.isSuperAdmin) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    // Scope organization from auth/session — never trust body organizationId for
    // task/location resolve (same contract as scan/receive and resolve-location/lot).
    const scoped = {
      ...parsed,
      tenantId: auth.tenantId,
      organizationId,
    }
    const em = (container.resolve('em') as EntityManager).fork()
    const commandInput = await resolveScanPutawayCommandInput(em, scoped)
    const scopedRequest = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(commandInput),
    })
    return executeWmsCustomPostRoute({
      request: scopedRequest,
      routePath: 'wms/scan/putaway',
      inputSchema: putawayTaskCompleteSchema,
      commandId: 'wms.putaway-tasks.complete',
      describeResource: (input) => ({
        resourceKind: 'wms.putawayTask',
        resourceId: input.id,
      }),
      mapSuccess: (result: { movementId: string }) => ({
        ok: true,
        movementId: result.movementId,
      }),
    })
  } catch (error) {
    if (error instanceof CrudHttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 })
    }
    logger.error('scan putaway failed', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Scan-assisted putaway complete',
  methods: {
    POST: {
      summary: 'Complete putaway from scanned target location code',
      description:
        'Resolves the scanned target location code, then executes the same command path as POST /api/wms/putaway-tasks/:id/complete. Organization is taken from the authenticated session scope, not the request body. Requires `wms.adjust_inventory`; managers with `wms.manage_putaway` may complete any task, operators only when assigned.',
      requestBody: { contentType: 'application/json', schema: scanPutawaySchema },
      responses: [{ status: 200, description: 'Putaway completed', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Task or location not found', schema: errorSchema },
        { status: 409, description: 'Invalid putaway state or insufficient stock', schema: errorSchema },
        { status: 422, description: 'Invalid or inactive location', schema: errorSchema },
      ],
    },
  },
}
