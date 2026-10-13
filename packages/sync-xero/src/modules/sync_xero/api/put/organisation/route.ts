import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readOptimisticLockExpected } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { OAuthGrantError } from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import { listAllOrganisations, type XeroOrganisationOption } from '../../../lib/connections'
import { XERO_GRANT_RESOURCE_ID, XERO_GRANT_RESOURCE_KIND, XERO_INTEGRATION_ID } from '../../../lib/constants'
import { decideOrganisationChange, toXeroProviderData } from '../../../lib/organisation'
import { ensureDefaultSchedules } from '../../../lib/schedules'
import { authorizeXeroRoute, CREDENTIALS_MANAGE_FEATURE } from '../../../lib/route-auth'
import { interactiveFailureResponse, xeroErrorResponse, seamFailureResponse } from '../../../lib/route-errors'
import { createInteractiveXeroClient, loadPreviousOrganisations, resolveXeroRouteGrant, type XeroRouteGrant } from '../../../lib/route-grant'
import { XERO_OPENAPI_TAG, xeroErrorSchema, xeroRuleOneErrors, xeroScheduleSchema } from '../../openapi'

export const metadata = {
  path: '/sync_xero/organisation',
  PUT: { requireAuth: true, requireFeatures: [CREDENTIALS_MANAGE_FEATURE] },
}

const bodySchema = z.strictObject({
  xeroOrganisationId: z.guid(),
  confirmChange: z.boolean().optional(),
})

async function grantWriteFailureResponse(error: unknown): Promise<Response | null> {
  if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
  if (!(error instanceof OAuthGrantError)) return null
  if (error.code === 'not_connected') return xeroErrorResponse(409, 'not_connected')
  if (error.code === 'transient') return xeroErrorResponse(503, 'transient')
  if (error.code === 'platform_unavailable') return xeroErrorResponse(503, 'platform_unavailable')
  return null
}

export async function PUT(req: Request): Promise<Response> {
  const authorized = await authorizeXeroRoute(req)
  if (!authorized.ok) return authorized.response
  const { container, scope, userId } = authorized.context

  const body = bodySchema.safeParse(await readJsonSafe(req, null))
  if (!body.success) return xeroErrorResponse(400, 'invalid_request')

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

  let choice: XeroOrganisationOption | undefined
  try {
    const organisations = await listAllOrganisations(createInteractiveXeroClient(grant))
    choice = organisations.find((organisation) => organisation.xeroOrganisationId === body.data.xeroOrganisationId)
  } catch (error) {
    const response = await interactiveFailureResponse(error)
    if (response) return response
    throw error
  }
  if (!choice) return xeroErrorResponse(422, 'xero.organisation_not_authorised')

  const decision = decideOrganisationChange(choice.xeroOrganisationId, await loadPreviousOrganisations(grant, scope, inspection))
  if (decision.kind === 'blocked') {
    return xeroErrorResponse(409, 'xero.organisation_switch_blocked', {
      previous: decision.previous.map(({ xeroOrganisationId, name, invoiceCount }) => ({ xeroOrganisationId, name, invoiceCount })),
    })
  }
  if (decision.kind === 'confirm' && body.data.confirmChange !== true) {
    return xeroErrorResponse(409, 'xero.organisation_change_confirmation_required', {
      next: { xeroOrganisationId: choice.xeroOrganisationId, name: choice.name },
      previous: decision.previous.map(({ xeroOrganisationId, name, companyCount }) => ({ xeroOrganisationId, name, companyCount })),
    })
  }

  const providerData = toXeroProviderData(choice)
  const guard = await runRouteMutationGuards({
    container,
    req,
    auth: { userId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    input: {
      resourceKind: XERO_GRANT_RESOURCE_KIND,
      resourceId: XERO_GRANT_RESOURCE_ID,
      operation: 'update',
      mutationPayload: { integrationId: XERO_INTEGRATION_ID, providerData },
    },
  })
  if (!guard.ok) return guard.response

  let revisedAt: Date
  try {
    revisedAt = (
      await grant.grantService.updateProviderData(grant.descriptor, grant.owner, providerData, {
        expectedRevisedAt: readOptimisticLockExpected(req),
        actorUserId: userId,
      })
    ).revisedAt
  } catch (error) {
    const response = await grantWriteFailureResponse(error)
    if (response) return response
    throw error
  }
  await guard.runAfterSuccess()
  const ensured = await ensureDefaultSchedules({ container, scope, guard: { req, userId } })

  return NextResponse.json({
    organisation: { id: providerData.xeroOrganisationId, name: providerData.xeroOrganisationName },
    revisedAt: revisedAt.toISOString(),
    schedules: ensured.schedules,
  })
}

const previousSchema = z.object({ xeroOrganisationId: z.string(), name: z.string().nullable() })

export const openApi: OpenApiRouteDoc = {
  tag: XERO_OPENAPI_TAG,
  summary: 'Choose the Xero Organisation',
  methods: {
    PUT: {
      summary: 'Save the Xero Organisation the organization syncs with',
      description:
        'Re-reads the grant\'s Organisations (one attempt, 5 s) and saves the chosen one as the grant\'s External Account. Choosing an Organisation other than the previous ones needs confirmChange, and is refused while invoices are mapped under a previous one. Then it creates the hourly default schedule of every xero.* entity type that has none. Send the grant revision (revisedAt) in x-om-ext-optimistic-lock-expected-updated-at.',
      tags: [XERO_OPENAPI_TAG],
      requestBody: { schema: bodySchema },
      responses: [
        {
          status: 200,
          description: 'The saved Organisation and the new grant revision',
          schema: z.object({ organisation: z.object({ id: z.string(), name: z.string() }), revisedAt: z.string(), schedules: z.array(xeroScheduleSchema) }),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid body, or no organization could be resolved (code organization_scope_required)', schema: xeroErrorSchema },
        ...xeroRuleOneErrors().filter((entry) => entry.status !== 400),
        {
          status: 409,
          description:
            'optimistic_lock_conflict (stale revision); not_connected; xero.client_misconfigured; xero.account_unavailable; xero.organisation_change_confirmation_required with next and previous[] (companyCount); xero.organisation_switch_blocked with previous[] (invoiceCount)',
          schema: xeroErrorSchema.extend({ next: previousSchema.optional(), previous: z.array(previousSchema).optional() }),
        },
        { status: 422, description: 'xero.organisation_not_authorised: the Organisation is not part of the grant', schema: xeroErrorSchema },
        { status: 503, description: 'xero.unavailable (Xero failed within the single attempt), transient or platform_unavailable', schema: xeroErrorSchema },
      ],
    },
  },
}

export default PUT
