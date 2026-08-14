import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { TillioCredentialsService } from '../../../lib/operators-store'
import {
  detachOperator,
  TILLIO_OPERATOR_RESOURCE_KIND,
  TillioRevocationFailedError,
} from '../../../lib/operators'

const idParamsSchema = z.object({ id: z.string().trim().min(1) })

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['tillio.manage', 'integrations.manage'] },
}

export const openApi = {
  tags: ['Tillio'],
  summary: 'Detach a Tillio operator',
}

export async function DELETE(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }

  const rawParams = (ctx.params && typeof (ctx.params as Promise<unknown>).then === 'function')
    ? await (ctx.params as Promise<{ id?: string }>)
    : (ctx.params as { id?: string } | undefined)

  const parsedParams = idParamsSchema.safeParse(rawParams)
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, message: 'Invalid operator id' }, { status: 400 })
  }
  const operatorId = parsedParams.data.id
  const force = parseBooleanWithDefault(new URL(req.url).searchParams.get('force'), false)

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as TillioCredentialsService
  const scope: IntegrationScope = { organizationId: auth.orgId, tenantId: auth.tenantId }

  const guarded = await runRouteMutationGuards({
    container,
    req,
    auth: { userId: auth.sub, tenantId: auth.tenantId, organizationId: auth.orgId },
    input: {
      resourceKind: TILLIO_OPERATOR_RESOURCE_KIND,
      resourceId: operatorId,
      operation: 'delete',
      mutationPayload: { operatorId, force },
    },
  })
  if (!guarded.ok) return guarded.response

  try {
    const result = await detachOperator({ credentialsService, scope }, operatorId, { force })
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true, detached: result.detached, revoked: result.revoked })
  } catch (err) {
    if (err instanceof TillioRevocationFailedError) {
      return NextResponse.json(
        {
          ok: false,
          code: err.environmentMissing ? 'environment_not_ready' : 'revocation_failed',
          section: err.environmentMissing ? 'environment' : 'operator',
          message: err.message,
          canForce: true,
        },
        { status: 502 },
      )
    }
    return NextResponse.json(
      { ok: false, section: 'operator', message: 'Failed to detach the operator.' },
      { status: 500 },
    )
  }
}
