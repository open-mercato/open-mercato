import { NextResponse } from 'next/server'
import { z } from 'zod'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { XERO_GRANT_RESOURCE_ID, XERO_GRANT_RESOURCE_KIND, XERO_INTEGRATION_ID } from '../../../lib/constants'
import { authorizeXeroRoute, CREDENTIALS_MANAGE_FEATURE } from '../../../lib/route-auth'
import { isXeroSeamEnabled } from '../../../lib/testing/seam'
import { XERO_OPENAPI_TAG, xeroErrorSchema, xeroRuleOneErrors } from '../../openapi'

/**
 * TEST-ONLY driver of the Xero test seam, gated by OM_ENABLE_TEST_OAUTH_GRANTS (404 for every
 * caller while it is off, before any fake is loaded). It touches only the caller's own
 * organization, and no response carries a token or the Client Secret.
 */
export const metadata = {
  path: '/sync_xero/test-fakes',
  POST: { requireAuth: true, requireFeatures: [CREDENTIALS_MANAGE_FEATURE] },
}

function notFound(): Response {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function POST(req: Request): Promise<Response> {
  if (!isXeroSeamEnabled()) return notFound()
  const control = await import('../../../lib/testing/seam-control')

  const authorized = await authorizeXeroRoute(req)
  if (!authorized.ok) return authorized.response
  const { container, scope, userId } = authorized.context

  const parsed = control.seamActionSchema.safeParse(await readJsonSafe(req, null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request body', code: 'invalid_request' }, { status: 400 })

  const guard = await runRouteMutationGuards({
    container,
    req,
    auth: { userId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    input: {
      resourceKind: XERO_GRANT_RESOURCE_KIND,
      resourceId: XERO_GRANT_RESOURCE_ID,
      operation: 'custom',
      mutationPayload: { integrationId: XERO_INTEGRATION_ID, action: parsed.data.action },
    },
  })
  if (!guard.ok) return guard.response

  const context = { container, scope, userId }
  try {
    const action = parsed.data
    let result: Record<string, unknown>
    if (action.action === 'start') result = await control.startSeam(context)
    else if (action.action === 'seed') result = await control.seedSeam(context, action)
    else if (action.action === 'inject') result = control.injectSeam(context, action)
    else if (action.action === 'authorize') result = control.authorizeSeam(context, action)
    else if (action.action === 'counters') result = control.seamCounters(context)
    else result = await control.resetSeam(context)
    await guard.runAfterSuccess()
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof control.SeamConflictError) {
      return NextResponse.json({ error: 'The Xero test seam refused the action', code: error.reason }, { status: 409 })
    }
    throw error
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: XERO_OPENAPI_TAG,
  summary: 'Test-only Xero seam driver',
  methods: {
    POST: {
      summary: 'Test-only: start, seed, inject, authorize, count or reset the Xero fakes (OM_ENABLE_TEST_OAUTH_GRANTS)',
      description:
        'start runs a fake authorization server and a fake Xero API for the caller\'s organization and saves a Client Configuration whose Client ID starts with om_test_seam_. It answers 409 for an organization outside the seam that holds Xero state. reset erases only the seam\'s rows and stops the fakes; it answers 409 for an organization outside the seam.',
      tags: [XERO_OPENAPI_TAG],
      requestBody: { schema: z.object({ action: z.enum(['start', 'seed', 'inject', 'authorize', 'counters', 'reset']) }).passthrough() },
      responses: [{ status: 200, description: 'The action result; never a token or a secret', schema: z.record(z.string(), z.unknown()) }],
      errors: [
        ...xeroRuleOneErrors(),
        { status: 404, description: 'OM_ENABLE_TEST_OAUTH_GRANTS is off (production default)', schema: xeroErrorSchema },
        { status: 409, description: 'real_xero_state, not_seam_organization or not_started', schema: xeroErrorSchema },
      ],
    },
  },
}

export default POST
