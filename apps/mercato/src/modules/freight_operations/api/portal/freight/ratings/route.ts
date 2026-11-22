import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { driverRatingSchema } from '../../../../data/validators'
import '../../../../commands/driver'

const logger = createLogger('freight_operations')

export const metadata = {
  path: '/portal/freight/ratings',
  POST: { requireAuth: false },
}

export async function POST(req: Request) {
  try {
    const auth = await getCustomerAuthFromRequest(req)
    if (!auth) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    if (!auth.orgId) return NextResponse.json({ error: 'Organization context is required' }, { status: 400 })
    const customerId = auth.customerEntityId ?? auth.personEntityId
    if (!customerId) return NextResponse.json({ error: 'No customer is linked to this portal user' }, { status: 409 })

    const container = await createRequestContainer()
    const rbac = container.resolve('customerRbacService') as CustomerRbacService
    const allowed = await rbac.userHasAllFeatures(auth.sub, ['portal.freight.rate'], {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const raw = await readJsonSafe(req, {})
    const input = driverRatingSchema.parse(raw ?? {})
    const ctx: CommandRuntimeContext = {
      container,
      auth: {
        sub: auth.sub,
        tenantId: auth.tenantId,
        orgId: auth.orgId,
        isSuperAdmin: false,
        isApiKey: false,
      } as unknown as CommandRuntimeContext['auth'],
      organizationScope: null,
      selectedOrganizationId: auth.orgId,
      organizationIds: [auth.orgId],
      request: req,
    }
    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<
      Record<string, unknown>,
      { ratingId: string; rating: number }
    >('freight_operations.driver.rate', {
      input: { ...input, customerId },
      ctx,
    })
    return NextResponse.json({ ok: true, ratingId: result.ratingId, rating: result.rating })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    logger.error('freight_operations.portal_rating.failed', { err })
    return NextResponse.json({ error: 'Failed to save the rating' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Rate the driver of a delivered order',
  methods: {
    POST: {
      summary: 'Create or update the signed-in customer’s rating for an order’s driver',
      requestBody: { contentType: 'application/json', schema: driverRatingSchema },
      responses: [{
        status: 200,
        description: 'Rating saved',
        schema: z.object({
          ok: z.boolean(),
          ratingId: z.string().uuid(),
          rating: z.number(),
        }),
      }],
    },
  },
}
