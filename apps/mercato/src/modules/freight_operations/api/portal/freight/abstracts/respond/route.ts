import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { FreightTripAbstract } from '../../../../../data/entities'
import { abstractRespondSchema } from '../../../../../data/validators'
import { FREIGHT_ABSTRACT_ENTITY_ID } from '../../../../../commands/entities'
import '../../../../../commands/abstracts'

const logger = createLogger('freight_operations')

export const metadata = {
  path: '/portal/freight/abstracts/respond',
  POST: { requireAuth: false },
}

export async function POST(req: Request) {
  try {
    const auth = await getCustomerAuthFromRequest(req)
    if (!auth) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    const container = await createRequestContainer()
    const rbac = container.resolve('customerRbacService') as CustomerRbacService
    const allowed = await rbac.userHasAllFeatures(auth.sub, ['portal.freight.respond'], {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const raw = await req.json().catch(() => ({}))
    const parsed = abstractRespondSchema.parse(raw)
    const em = container.resolve('em') as EntityManager
    const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
    const abstract = await findOneWithDecryption(
      em,
      FreightTripAbstract,
      { id: parsed.id, ...scope, deletedAt: null },
      {},
      scope,
    ) as FreightTripAbstract | null
    const customerIds = [auth.customerEntityId, auth.personEntityId].filter(Boolean)
    if (!abstract || !customerIds.includes(abstract.customerId)) {
      return NextResponse.json({ error: 'Abstract not found' }, { status: 404 })
    }

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
    const { result } = await commandBus.execute(
      'freight_operations.abstracts.respond',
      { input: { ...parsed, origin: 'customer_portal' }, ctx },
    )
    const typed = result as { abstractId: string; status: string }
    return NextResponse.json({ ok: true, abstractId: typed.abstractId, status: typed.status })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    logger.error('freight_operations.portal_abstract_respond.failed', { err })
    return NextResponse.json({ error: 'Failed to record the response' }, { status: 400 })
  }
}

export const openApi = {
  tag: 'Freight Operations',
  summary: 'Customer portal abstract response',
  methods: {
    POST: {
      summary: 'Accept or dispute a submitted trip abstract from the customer portal',
      requestBody: { contentType: 'application/json', schema: abstractRespondSchema },
      responses: [{
        status: 200,
        description: 'Response recorded',
        schema: z.object({ ok: z.boolean(), abstractId: z.string().uuid(), status: z.string() }),
      }],
      errors: [
        { status: 401, description: 'Authentication required' },
        { status: 403, description: 'Missing portal.freight.respond' },
        { status: 404, description: 'Abstract not found for this customer' },
      ],
    },
  },
}

