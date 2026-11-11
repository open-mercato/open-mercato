import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { SyncExternalIdMapping } from '@open-mercato/core/modules/integrations/data/entities'
import { isExplicitlyEmptyOrganizationScope } from '@open-mercato/shared/lib/auth/organizationScope'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { XERO_COMPANY_MAPPING_TYPE, XERO_INTEGRATION_ID } from '../../../../lib/constants'
import { buildXeroContactUrl } from '../../../../lib/external-ids'
import { xeroErrorResponse } from '../../../../lib/route-errors'
import { XERO_OPENAPI_TAG, xeroErrorSchema } from '../../../openapi'

export const metadata = {
  path: '/sync_xero/companies/[id]',
  GET: { requireAuth: true, requireFeatures: ['customers.companies.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

type RouteContext = { params?: { id?: string } | Promise<{ id?: string }> }

/**
 * The Company badge's link: the Company's `sync_xero` mapping, as a Xero deep link and the date the
 * claim stored it. The Company is read in the caller's organization scope, so a Company outside it
 * answers 404 exactly like a missing one; the mapping is then read in the Company's own organization.
 */
export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const params = paramsSchema.safeParse(await context.params)
  if (!params.success) return xeroErrorResponse(400, 'invalid_request')
  const auth = await getAuthFromRequest(req)
  if (!auth) return xeroErrorResponse(401, 'unauthorized')
  if (!auth.tenantId) return xeroErrorResponse(400, 'organization_scope_required')

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  if (isExplicitlyEmptyOrganizationScope(scope)) return xeroErrorResponse(404, 'not_found')
  const tenantId = scope?.tenantId ?? auth.tenantId
  const em = container.resolve<EntityManager>('em')

  const company = await findOneWithDecryption(
    em,
    CustomerEntity,
    {
      id: params.data.id,
      tenantId,
      kind: 'company',
      deletedAt: null,
      ...(Array.isArray(scope?.filterIds) ? { organizationId: { $in: scope.filterIds } } : {}),
    },
    {},
    { tenantId, organizationId: scope?.selectedId ?? null },
  )
  if (!company) return xeroErrorResponse(404, 'not_found')

  const mapping = await findOneWithDecryption(
    em,
    SyncExternalIdMapping,
    {
      integrationId: XERO_INTEGRATION_ID,
      internalEntityType: XERO_COMPANY_MAPPING_TYPE,
      internalEntityId: company.id,
      organizationId: company.organizationId,
      tenantId: company.tenantId,
      deletedAt: null,
    },
    { orderBy: { lastSyncedAt: 'desc' } },
    { tenantId: company.tenantId, organizationId: company.organizationId },
  )
  return NextResponse.json({
    link: mapping
      ? { externalUrl: buildXeroContactUrl(mapping.externalId), linkedSince: mapping.lastSyncedAt ? mapping.lastSyncedAt.toISOString() : null }
      : null,
  })
}

export default GET

export const openApi: OpenApiRouteDoc = {
  tag: XERO_OPENAPI_TAG,
  summary: 'Xero link of a Company',
  methods: {
    GET: {
      summary: 'Read the Xero link of a Company for its badge',
      description:
        'Answers the Xero deep link of the Contact the Company is synced from and the date the link was made, or link null for a Company without a Xero mapping. A Company outside the caller\'s organization scope answers 404.',
      tags: [XERO_OPENAPI_TAG],
      responses: [
        {
          status: 200,
          description: 'The Company\'s Xero link, or null',
          schema: z.object({ link: z.object({ externalUrl: z.string(), linkedSince: z.string().nullable() }).nullable() }),
        },
      ],
      errors: [
        { status: 400, description: 'invalid_request: the id is not a UUID; organization_scope_required: the session has no tenant', schema: xeroErrorSchema },
        { status: 401, description: 'unauthorized', schema: xeroErrorSchema },
        { status: 404, description: 'not_found: no such Company in the caller\'s organization scope', schema: xeroErrorSchema },
      ],
    },
  },
}
