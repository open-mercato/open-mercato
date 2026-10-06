import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { loadOrganizationDomainMappings } from '../../lib/domainMappingSummaries'
import { resolveBrandingRouteContext } from '../../lib/storeBrandingRoute'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ecommerce.stores.view'] },
}

const logger = createLogger('ecommerce').child({ component: 'domain-mappings-route' })

export async function GET(req: Request) {
  try {
    const context = await resolveBrandingRouteContext(req)
    const mappings = await loadOrganizationDomainMappings(context.container, {
      organizationId: context.organizationId,
      tenantId: context.tenantId,
    })
    if (!mappings) return NextResponse.json({ error: 'Domain mappings are unavailable' }, { status: 503 })
    const items = [...mappings].sort((left, right) => left.hostname.localeCompare(right.hostname))
    return NextResponse.json({ items, total: items.length }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('ecommerce.domain-mappings.GET failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const domainMappingItemSchema = z.object({
  id: z.string().uuid(),
  hostname: z.string(),
  status: z
    .string()
    .describe('customer_accounts domain status: pending, verified, active, dns_failed or tls_failed. Only active serves.'),
  lastDnsCheckAt: z.string().nullable(),
  dnsFailureReason: z.string().nullable(),
  tlsFailureReason: z.string().nullable(),
})

const errorSchema = z.object({ error: z.string() }).passthrough()

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce',
  summary: 'Domain mappings available to store bindings',
  methods: {
    GET: {
      summary: 'List the domain mappings of the selected organization',
      description:
        'Read-only list of the customer_accounts domain mappings (any status) of the selected organization, read through domainMappingService. Backs the domain picker of the store Domains tab, so that managing store bindings does not require the customer_accounts domain permission. Requires ecommerce.stores.view.',
      tags: ['Ecommerce'],
      responses: [
        {
          status: 200,
          description: 'Domain mappings of the selected organization',
          schema: z.object({ items: z.array(domainMappingItemSchema), total: z.number().int() }),
        },
      ],
      errors: [
        { status: 400, description: 'No organization is selected', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing ecommerce.stores.view', schema: errorSchema },
        { status: 503, description: 'The domain mapping service is not available', schema: errorSchema },
      ],
    },
  },
}
