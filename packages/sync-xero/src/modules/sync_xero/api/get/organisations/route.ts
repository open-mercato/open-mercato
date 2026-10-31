import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { listAllOrganisations, listConsentOrganisations } from '../../../lib/connections'
import { parseXeroProviderData } from '../../../lib/provider-data'
import { authorizeXeroRoute, CREDENTIALS_MANAGE_FEATURE } from '../../../lib/route-auth'
import { interactiveFailureResponse, xeroErrorResponse, seamFailureResponse } from '../../../lib/route-errors'
import { createInteractiveXeroClient, grantSelection, loadPreviousOrganisations, resolveXeroRouteGrant, type XeroRouteGrant } from '../../../lib/route-grant'
import { XERO_OPENAPI_TAG, xeroErrorSchema, xeroRuleOneErrors } from '../../openapi'

export const metadata = {
  path: '/sync_xero/organisations',
  GET: { requireAuth: true, requireFeatures: [CREDENTIALS_MANAGE_FEATURE] },
}

const querySchema = z.object({ scope: z.enum(['consent', 'all']).default('consent') })

export async function GET(req: Request): Promise<Response> {
  const authorized = await authorizeXeroRoute(req)
  if (!authorized.ok) return authorized.response
  const { container, scope } = authorized.context

  const query = querySchema.safeParse({ scope: new URL(req.url).searchParams.get('scope') ?? undefined })
  if (!query.success) return xeroErrorResponse(400, 'invalid_request')

  let grant: XeroRouteGrant
  try {
    grant = await resolveXeroRouteGrant(container, scope)
  } catch (error) {
    const response = await seamFailureResponse(error)
    if (response) return response
    throw error
  }
  const inspection = await grant.grantService.inspectGrant(grant.descriptor, grant.owner)
  if (inspection.status === 'none') return xeroErrorResponse(409, 'not_connected')
  if (inspection.status === 'unavailable') return xeroErrorResponse(409, 'xero.account_unavailable')

  try {
    const client = createInteractiveXeroClient(grant)
    const listing = query.data.scope === 'all'
      ? { organisations: await listAllOrganisations(client), filtered: false }
      : await listConsentOrganisations(client)
    return NextResponse.json({
      organisations: listing.organisations,
      filtered: listing.filtered,
      selected: parseXeroProviderData(grantSelection(inspection).providerData)?.xeroOrganisationId ?? null,
      previous: await loadPreviousOrganisations(grant, scope, inspection),
    })
  } catch (error) {
    const response = await interactiveFailureResponse(error)
    if (response) return response
    throw error
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: XERO_OPENAPI_TAG,
  summary: 'Xero Organisations of the connection',
  methods: {
    GET: {
      summary: 'List the Xero Organisations the connection can use',
      description:
        'scope=consent lists the Organisations of the last consent round (filtered by its authEventId, or the unfiltered list when Xero kept the earlier connection records); scope=all lists every Organisation of the grant. One attempt with a 5 s timeout. previous names the Organisations existing mappings refer to, with their counts.',
      tags: [XERO_OPENAPI_TAG],
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Organisations, whether the list was filtered to the consent round, the selected Organisation and the previous ones',
          schema: z.object({
            organisations: z.array(z.object({ xeroOrganisationId: z.string(), xeroConnectionId: z.string(), name: z.string() })),
            filtered: z.boolean(),
            selected: z.string().nullable(),
            previous: z.array(
              z.object({ xeroOrganisationId: z.string(), name: z.string().nullable(), companyCount: z.number(), invoiceCount: z.number() }),
            ),
          }),
        },
      ],
      errors: [
        ...xeroRuleOneErrors(),
        { status: 409, description: 'not_connected; xero.client_misconfigured when Xero rejects the Client ID or Secret; xero.account_unavailable when the grant can no longer be used or Xero rejects its token or access (reconnect)', schema: xeroErrorSchema },
        { status: 503, description: 'xero.unavailable: Xero failed, timed out or rate-limited the single attempt; transient or platform_unavailable when no token could be obtained right now', schema: xeroErrorSchema },
      ],
    },
  },
}

export default GET
