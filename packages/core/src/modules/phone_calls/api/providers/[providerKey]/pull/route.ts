import { NextResponse } from 'next/server'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { AwilixContainer } from 'awilix'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import {
  PHONE_CALLS_PROVIDER_PULL_COMMAND_ID,
  type PullProviderResult,
} from '../../../../commands/calls'

const GUARD_RESOURCE_KIND = 'phone_calls.provider_pull'

export const metadata = {
  path: '/phone_calls/providers/[providerKey]/pull',
  POST: {
    requireAuth: true,
    requireFeatures: ['phone_calls.manage', 'integrations.manage'],
  },
}

type RouteContext = {
  params: Promise<{ providerKey: string }> | { providerKey: string }
}

type PullScope = { tenantId: string; organizationId: string; auth: AuthContext | null }

async function runPull(
  container: AwilixContainer,
  scope: PullScope,
  providerKey: string,
  body: Record<string, unknown>,
): Promise<PullProviderResult> {
  const commandBus = container.resolve('commandBus') as CommandBus
  const { result } = await commandBus.execute<unknown, PullProviderResult>(
    PHONE_CALLS_PROVIDER_PULL_COMMAND_ID,
    {
      input: {
        providerKey,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        integrationId: body.integrationId,
        from: body.from,
        to: body.to,
        cursor: body.cursor,
        limit: body.limit,
      },
      ctx: {
        container,
        auth: scope.auth,
        organizationScope: null,
        selectedOrganizationId: scope.organizationId,
        organizationIds: [scope.organizationId],
      },
    },
  )
  return result
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const { providerKey } = await context.params
  if (!providerKey) {
    return NextResponse.json({ error: 'Missing providerKey' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  const userId = auth?.sub
  const tenantId = auth?.tenantId
  const organizationId = auth?.orgId
  if (!userId || !tenantId || !organizationId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const container = await createRequestContainer()

  const guard = await runRouteMutationGuards({
    container,
    req,
    auth: { userId, tenantId, organizationId },
    input: {
      resourceKind: GUARD_RESOURCE_KIND,
      resourceId: providerKey,
      operation: 'custom',
      mutationPayload: { providerKey, integrationId: body.integrationId ?? null },
    },
  })
  if (!guard.ok) return guard.response

  try {
    const result = await runPull(container, { tenantId, organizationId, auth }, providerKey, body)
    await guard.runAfterSuccess()
    return NextResponse.json(result)
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }
}

export const openApi = {
  tags: ['PhoneCalls'],
  methods: {
    POST: {
      summary: 'Pull phone calls from a provider and ingest them',
      tags: ['PhoneCalls'],
      responses: [
        { status: 200, description: 'Pull completed; returns ingest tally' },
        { status: 400, description: 'Missing providerKey or provider not registered' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}

export default POST
