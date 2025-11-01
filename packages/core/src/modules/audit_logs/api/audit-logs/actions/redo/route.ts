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
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['audit_logs.redo_self'] },
}

type RedoRequestBody = {
  logId?: string
}

const redoRequestSchema = z.object({
  logId: z.string().min(1).describe('Identifier of the previously undone action log'),
})

const redoResponseSchema = z.object({
  ok: z.literal(true),
  logId: z.string().nullable().describe('Identifier of the new redo log entry, if available'),
  undoToken: z.string().nullable().describe('New undo token associated with the redone action'),
})

const errorSchema = z.object({
  error: z.string(),
})

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as RedoRequestBody | null
  const logId = typeof body?.logId === 'string' ? body.logId.trim() : ''
  if (!logId) return NextResponse.json({ error: 'Invalid log id' }, { status: 400 })

  const container = await createRequestContainer()
  const commandBus = (container.resolve('commandBus') as CommandBus)
  const logs = (container.resolve('actionLogService') as ActionLogService)
  let rbac: RbacService | null = null
  try {
    rbac = (container.resolve('rbacService') as RbacService)
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
    const contextRecord = log.contextJson && typeof log.contextJson === 'object' ? (log.contextJson as Record<string, unknown>) : null
    const cacheAliasesRaw = Array.isArray(contextRecord?.cacheAliases as unknown[])
      ? (contextRecord!.cacheAliases as unknown[])
      : []
    const cacheAliases = cacheAliasesRaw
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim())
    const metadata: CommandLogMetadata = {
      tenantId: log.tenantId,
      organizationId: log.organizationId,
      actorUserId: auth.sub,
      actionLabel: log.actionLabel,
      resourceKind: log.resourceKind,
      resourceId: log.resourceId,
      context: cacheAliases.length ? { cacheAliases } : undefined,
    }
    const resolvedInput = resolveRedoInput(log.commandPayload, log)
    if (!resolvedInput) {
      return NextResponse.json({ error: 'Redo data unavailable for this action' }, { status: 400 })
    }
    const commandInput = resolvedInput
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

function resolveRedoInput(payload: unknown, log: ActionLog): unknown | null {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && '__redoInput' in payload) {
    const envelope = payload as { __redoInput?: unknown }
    return envelope.__redoInput ?? {}
  }
  const updateFallback = deriveUpdateInput(log)
  if (updateFallback) return updateFallback
  return null
}

function deriveUpdateInput(log: ActionLog): Record<string, unknown> | null {
  if (!log.commandId.endsWith('.update')) return null
  if (!log.resourceId) return null
  const changes = log.changesJson
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return { id: log.resourceId }
  const payload: Record<string, unknown> = { id: log.resourceId }
  for (const [key, value] of Object.entries(changes)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'to' in value) {
      payload[key] = (value as Record<string, unknown>).to
    } else {
      payload[key] = value
    }
  }
  return payload
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Redo a previously undone action',
  description: 'Replays the command associated with a recently undone action, reapplying the change and issuing a fresh undo token.',
  methods: {
    POST: {
      summary: 'Redo by action log id',
      description:
        'Redoes the latest undone command owned by the caller. Requires the action to still be eligible for redo within tenant and organization scope.',
      requestBody: {
        contentType: 'application/json',
        schema: redoRequestSchema,
      },
      responses: [
        { status: 200, description: 'Redo executed successfully', schema: redoResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Log not eligible for redo', schema: errorSchema },
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Redo blocked by scope checks', schema: errorSchema },
      ],
    },
  },
}
