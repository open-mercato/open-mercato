import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readOptimisticLockExpected } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { OAuthGrantError } from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import type { OAuthDisconnectResult } from '@open-mercato/core/modules/integrations/lib/oauth/grant-service'
import { XERO_GRANT_RESOURCE_ID, XERO_GRANT_RESOURCE_KIND, XERO_INTEGRATION_ID } from '../../../lib/constants'
import { runDisconnectSteps, SKIPPED_DISCONNECT_STEPS } from '../../../lib/disconnect-steps'
import { authorizeXeroRoute, CREDENTIALS_MANAGE_FEATURE } from '../../../lib/route-auth'
import { xeroErrorResponse } from '../../../lib/route-errors'
import { resolveXeroRouteGrant } from '../../../lib/route-grant'
import { XERO_OPENAPI_TAG, xeroErrorSchema, xeroRuleOneErrors } from '../../openapi'

export const metadata = {
  path: '/sync_xero/disconnect',
  POST: { requireAuth: true, requireFeatures: [CREDENTIALS_MANAGE_FEATURE] },
}

const bodySchema = z.strictObject({
  force: z.boolean().optional(),
  removeClientCredentials: z.boolean().optional(),
})

async function disconnectFailureResponse(error: unknown): Promise<Response | null> {
  if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
  if (!(error instanceof OAuthGrantError)) return null
  if (error.code === 'disconnect_tokens_unreadable') return xeroErrorResponse(409, 'disconnect_tokens_unreadable')
  if (error.code === 'transient') return xeroErrorResponse(503, 'transient')
  if (error.code === 'platform_unavailable') return xeroErrorResponse(503, 'platform_unavailable')
  return null
}

export async function POST(req: Request): Promise<Response> {
  const authorized = await authorizeXeroRoute(req)
  if (!authorized.ok) return authorized.response
  const { container, scope, userId } = authorized.context

  const body = bodySchema.safeParse((await readJsonSafe(req, {})) ?? {})
  if (!body.success) return xeroErrorResponse(400, 'invalid_request')
  const force = body.data.force === true

  const guard = await runRouteMutationGuards({
    container,
    req,
    auth: { userId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    input: {
      resourceKind: XERO_GRANT_RESOURCE_KIND,
      resourceId: XERO_GRANT_RESOURCE_ID,
      operation: 'delete',
      mutationPayload: { integrationId: XERO_INTEGRATION_ID, force },
    },
  })
  if (!guard.ok) return guard.response

  const grant = await resolveXeroRouteGrant(container, scope)
  let result: OAuthDisconnectResult
  try {
    result = await grant.grantService.disconnect(grant.descriptor, grant.owner, {
      expectedRevisedAt: readOptimisticLockExpected(req),
      force,
      actorUserId: userId,
    })
  } catch (error) {
    const response = await disconnectFailureResponse(error)
    if (response) return response
    throw error
  }

  if (!result.erased) {
    return NextResponse.json({ erased: false, revocation: null, failureReason: null, steps: SKIPPED_DISCONNECT_STEPS })
  }
  await guard.runAfterSuccess()
  const steps = await runDisconnectSteps({
    container,
    req,
    userId,
    scope,
    removeClientCredentials: body.data.removeClientCredentials === true,
  })
  return NextResponse.json({ erased: true, revocation: result.revocation, failureReason: result.failureReason, steps })
}

const stepSchema = z.enum(['ok', 'failed', 'skipped'])

export const openApi: OpenApiRouteDoc = {
  tag: XERO_OPENAPI_TAG,
  summary: 'Disconnect Xero',
  methods: {
    POST: {
      summary: 'Erase the Xero grant and revoke it at Xero',
      description:
        'Erases the grant, then revokes its refresh token at Xero, which ends every grant of the same Xero user for the same Xero app. Then it runs one health check, disables the integration when the caller holds integrations.manage, and removes the Client ID and Secret when asked (other credential values stay). A failed follow-up step is reported in steps and never undoes the erase. force erases an unreadable grant without revoking it. Send the grant revision (revisedAt) in x-om-ext-optimistic-lock-expected-updated-at.',
      tags: [XERO_OPENAPI_TAG],
      requestBody: { schema: bodySchema },
      responses: [
        {
          status: 200,
          description: 'erased is false when no grant existed; revocation is the core outcome (confirmed, failed, unsupported, skipped_reconnected, skipped_invalidated)',
          schema: z.object({
            erased: z.boolean(),
            revocation: z.string().nullable(),
            failureReason: z.string().nullable(),
            steps: z.object({ healthCheck: stepSchema, disable: stepSchema, removeClientCredentials: stepSchema }),
          }),
        },
      ],
      errors: [
        ...xeroRuleOneErrors(),
        {
          status: 409,
          description: 'optimistic_lock_conflict (stale revision), or disconnect_tokens_unreadable (offer "Disconnect anyway" with force)',
          schema: xeroErrorSchema,
        },
        { status: 503, description: 'transient: the grant lock or the database was unavailable; nothing was erased', schema: xeroErrorSchema },
      ],
    },
  },
}

export default POST
