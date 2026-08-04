import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { TillioCredentialsService } from '../../../lib/operators-store'
import { detachOperator } from '../../../lib/operators'

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

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as TillioCredentialsService
  const scope: IntegrationScope = { organizationId: auth.orgId, tenantId: auth.tenantId }

  const result = await detachOperator({ credentialsService, scope }, parsedParams.data.id)
  return NextResponse.json({ ok: true, detached: result.detached })
}
