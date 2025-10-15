import { NextResponse } from 'next/server'
import { getAuthFromRequest, type AuthContext } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { resolveFeatureCheckContext, resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import type { CommandRuntimeContext, CommandLogMetadata } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { AwilixContainer } from 'awilix'
import type { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['audit_logs.redo_self'] },
}

type RedoRequestBody = {
  logId?: string
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as RedoRequestBody | null
  const logId = typeof body?.logId === 'string' ? body.logId.trim() : ''
  if (!logId) return NextResponse.json({ error: 'Invalid log id' }, { status: 400 })

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

  const canRedoTenant = rbac
    ? await rbac.userHasAllFeatures(auth.sub, ['audit_logs.redo_tenant'], {
        tenantId: auth.tenantId ?? null,
        organizationId,
      })
    : false

  const scopedOrgId = canRedoTenant ? organizationId ?? null : organizationId ?? auth.orgId ?? null
  const log = await logs.findById(logId)

  if (!log || log.executionState !== 'undone') {
    return NextResponse.json({ error: 'Redo target not available' }, { status: 400 })
  }
  if (log.actorUserId && log.actorUserId !== auth.sub) {
    return NextResponse.json({ error: 'Redo target not available' }, { status: 400 })
  }
  if (log.tenantId && auth.tenantId && log.tenantId !== auth.tenantId) {
    return NextResponse.json({ error: 'Redo target not available' }, { status: 400 })
  }
  if (log.organizationId && scopedOrgId && log.organizationId !== scopedOrgId) {
    return NextResponse.json({ error: 'Redo target not available' }, { status: 400 })
  }

  const latestUndone = await logs.latestUndoneForActor(auth.sub, {
    tenantId: auth.tenantId ?? null,
    organizationId: scopedOrgId,
  })
  if (!latestUndone || latestUndone.id !== log.id) {
    return NextResponse.json({ error: 'Redo target not available' }, { status: 400 })
  }

  try {
    const ctx = await createRuntimeContext(container, auth, req)
    const metadata: CommandLogMetadata = {
      tenantId: log.tenantId,
      organizationId: log.organizationId,
      actorUserId: auth.sub,
      actionLabel: log.actionLabel,
      resourceKind: log.resourceKind,
      resourceId: log.resourceId,
    }
    const commandInput = log.commandPayload ?? {}
    const { logEntry } = await commandBus.execute(log.commandId, {
      input: commandInput,
      ctx,
      metadata,
    })
    await logs.markRedone(log.id)
    const actionLog = asActionLog(logEntry)
    const response = NextResponse.json({
      ok: true,
      logId: actionLog?.id ?? null,
      undoToken: actionLog?.undoToken ?? null,
    })
    if (actionLog?.undoToken && actionLog.id) {
      const createdAt = actionLog.createdAt instanceof Date
        ? actionLog.createdAt.toISOString()
        : (typeof actionLog.createdAt === 'string' ? actionLog.createdAt : new Date().toISOString())
      response.headers.set('x-om-operation', serializeOperationMetadata({
        id: actionLog.id,
        undoToken: actionLog.undoToken,
        commandId: actionLog.commandId ?? log.commandId,
        actionLabel: actionLog.actionLabel ?? log.actionLabel ?? null,
        resourceKind: typeof actionLog.resourceKind === 'string' ? actionLog.resourceKind : log.resourceKind ?? null,
        resourceId: typeof actionLog.resourceId === 'string' ? actionLog.resourceId : log.resourceId ?? null,
        executedAt: createdAt,
      }))
    }
    return response
  } catch (err) {
    console.error('Redo failed', err)
    return NextResponse.json({ error: 'Redo failed' }, { status: 400 })
  }
}

async function createRuntimeContext(container: AwilixContainer, auth: AuthContext, request: Request): Promise<CommandRuntimeContext> {
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

function asActionLog(entry: unknown): ActionLog | null {
  if (!entry || typeof entry !== 'object') return null
  if (typeof (entry as { id?: unknown }).id !== 'string') return null
  return entry as ActionLog
}
