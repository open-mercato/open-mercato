import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { resolveFeatureCheckContext, resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['audit_logs.undo_self'] },
}

type UndoRequestBody = {
  undoToken?: string
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as UndoRequestBody | null
  const undoToken = body?.undoToken?.trim()
  if (!undoToken) return NextResponse.json({ error: 'Invalid undo token' }, { status: 400 })

  const container = await createRequestContainer()
  const commandBus = container.resolve<CommandBus>('commandBus')
  const logs = container.resolve<ActionLogService>('actionLogService')
  let rbac: RbacService | null = null
  try {
    rbac = container.resolve<RbacService>('rbacService')
  } catch {
    rbac = null
  }

  const { organizationId } = await resolveFeatureCheckContext({ container, auth, request: req })

  const canUndoTenant = rbac
    ? await rbac.userHasAllFeatures(auth.sub, ['audit_logs.undo_tenant'], {
        tenantId: auth.tenantId ?? null,
        organizationId,
      })
    : false

  const latest = await logs.latestUndoableForActor(auth.sub, {
    tenantId: auth.tenantId ?? null,
    organizationId: canUndoTenant ? organizationId ?? null : organizationId ?? auth.orgId ?? null,
  })

  if (!latest || latest.undoToken !== undoToken) {
    return NextResponse.json({ error: 'Undo token not available' }, { status: 400 })
  }

  try {
    const ctx = await createRuntimeContext(container, auth, req)
    await commandBus.undo(undoToken, ctx)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Undo failed', err)
    return NextResponse.json({ error: 'Undo failed' }, { status: 400 })
  }
}

async function createRuntimeContext(container: any, auth: any, request: Request): Promise<CommandRuntimeContext> {
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  return {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: scope.selectedId,
    organizationIds: scope.filterIds,
    request,
  }
}
