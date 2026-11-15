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
import { asnReceiveLineSchema, scanReceiveSchema } from '../../../data/validators'
import { resolveScanReceiveCommandInput } from '../../../lib/scanResolve'
import { executeWmsCustomPostRoute } from '../../inventory/helpers'

const logger = createLogger('wms')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.receive_inventory'] },
}

const successSchema = z.object({
  ok: z.literal(true),
  movementIds: z.array(z.string().uuid()),
  putawayTaskIds: z.array(z.string().uuid()),
  receivedQty: z.number().optional(),
  asnUpdatedAt: z.string().datetime().optional(),
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
    const parsed = scanReceiveSchema.parse(body)
    if (parsed.tenantId !== auth.tenantId && !auth.isSuperAdmin) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    // Scope organization from auth/session — never trust body organizationId for
    // ASN/location resolve (same contract as resolve-location / resolve-lot).
    const scoped = {
      ...parsed,
      tenantId: auth.tenantId,
      organizationId,
    }
    const em = (container.resolve('em') as EntityManager).fork()
    const commandInput = await resolveScanReceiveCommandInput(em, scoped)
    const scopedRequest = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(commandInput),
    })
    return executeWmsCustomPostRoute({
      request: scopedRequest,
      routePath: 'wms/scan/receive',
      inputSchema: asnReceiveLineSchema,
      commandId: 'wms.asns.receive-line',
      describeResource: (input) => ({
        resourceKind: 'wms.asn',
        resourceId: input.asnId,
      }),
      mapSuccess: (result: {
        movementIds: string[]
        putawayTaskIds: string[]
        receivedQty?: number
        asnUpdatedAt?: string
      }) => ({
        ok: true,
        movementIds: result.movementIds,
        putawayTaskIds: result.putawayTaskIds,
        receivedQty: result.receivedQty,
        asnUpdatedAt: result.asnUpdatedAt,
      }),
    })
  } catch (error) {
    if (error instanceof CrudHttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 })
    }
    logger.error('scan receive failed', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Scan-assisted ASN receive',
  methods: {
    POST: {
      summary: 'Receive ASN line from scanned location/lot codes',
      description:
        'Resolves scanned location (and optional lot) codes, then executes the same command path as POST /api/wms/asns/:id/receive. Organization is taken from the authenticated session scope, not the request body. Both QC-pass and QC-fail require absolute targetReceivedQty for retry-safe attempts (optional idempotencyKey is an extra stabilizer only).',
      requestBody: { contentType: 'application/json', schema: scanReceiveSchema },
      responses: [{ status: 200, description: 'ASN line received', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'ASN or location not found', schema: errorSchema },
        { status: 409, description: 'Invalid receipt state', schema: errorSchema },
        { status: 422, description: 'Tracking or QC transition invalid', schema: errorSchema },
      ],
    },
  },
}
