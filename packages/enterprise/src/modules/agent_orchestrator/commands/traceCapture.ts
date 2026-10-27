import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { traceCapturePolicySchema, type TraceCapturePolicy } from '../data/validators'
import { loadInvokerAcl } from '../lib/access/agentInvokeAccess'
import { invokerFromAuth } from '../lib/access/invokeDenial'
import {
  TRACE_CAPTURE_CONFIG_MODULE,
  TRACE_CAPTURE_CONFIG_NAME,
} from '../lib/trace/capturePolicy'

export const UPDATE_TRACE_CAPTURE_POLICY_COMMAND_ID = 'agent_orchestrator.traceCapturePolicy.update'
export const TRACE_CAPTURE_POLICY_RESOURCE_KIND = 'agent_orchestrator.trace_capture_policy'
export const TRACE_CAPTURE_WRITE_FEATURES = [
  'agent_orchestrator.agents.manage',
  'agent_orchestrator.trace.view_content',
] as const

const updateTraceCapturePolicySchema = z.object({
  tenantId: z.string().uuid(),
  policy: traceCapturePolicySchema,
})

export type UpdateTraceCapturePolicyCommandInput = z.input<typeof updateTraceCapturePolicySchema>

export type UpdateTraceCapturePolicyCommandResult = {
  policy: TraceCapturePolicy
  source: 'tenant'
  updatedAt: string | null
}

type TraceCapturePolicyUndoPayload = {
  tenantId: string
  before: unknown
  after: TraceCapturePolicy | null
}

type ModuleConfigRecordLike = {
  value: unknown
  source?: string
  updatedAt?: string
}

type ModuleConfigServiceLike = {
  getRecord(
    moduleId: string,
    name: string,
    scope?: { tenantId?: string | null },
  ): Promise<ModuleConfigRecordLike | null>
  setValue(
    moduleId: string,
    name: string,
    value: unknown,
    scope?: { tenantId?: string | null },
  ): Promise<ModuleConfigRecordLike | null>
}

function resolveModuleConfig(container: AwilixContainer): ModuleConfigServiceLike {
  try {
    return container.resolve('moduleConfigService') as ModuleConfigServiceLike
  } catch {
    throw new CrudHttpError(503, { error: '[internal] module configuration store is unavailable' })
  }
}

async function readTenantRecord(
  service: ModuleConfigServiceLike,
  tenantId: string,
): Promise<ModuleConfigRecordLike | null> {
  const record = await service.getRecord(TRACE_CAPTURE_CONFIG_MODULE, TRACE_CAPTURE_CONFIG_NAME, {
    tenantId,
  })
  if (!record || record.source === 'instance') return null
  return record
}

/**
 * Whether the actor may change the tenant's trace capture policy: it decides
 * whether prompts and responses are retained, so it needs both
 * `agents.manage` and `trace.view_content`. Fails closed on any ACL failure.
 */
export async function hasTraceCaptureWriteAccess(
  container: AwilixContainer,
  auth: CommandRuntimeContext['auth'],
  scope: { tenantId: string | null; organizationId: string | null },
): Promise<boolean> {
  if (!auth) return false
  const acl = await loadInvokerAcl(container, invokerFromAuth(auth), scope)
  return authorizeFeatures(TRACE_CAPTURE_WRITE_FEATURES, {
    grantedFeatures: acl.features,
    unrestricted: acl.isSuperAdmin,
  })
}

function assertTenantMatchesActor(ctx: CommandRuntimeContext, tenantId: string): void {
  const actorTenantId = ctx.auth?.tenantId ?? null
  if (actorTenantId !== null && actorTenantId !== tenantId) {
    throw new CrudHttpError(403, { error: '[internal] trace capture policy belongs to another tenant' })
  }
}

/**
 * Saves the tenant's trace capture policy. Undoable: the log carries the
 * tenant row's previous value, so widening capture to `full` is both audited
 * and reversible; undoing the first save clears the row back to the
 * deployment default.
 */
export const updateTraceCapturePolicyCommand: CommandHandler<
  UpdateTraceCapturePolicyCommandInput,
  UpdateTraceCapturePolicyCommandResult
> = {
  id: UPDATE_TRACE_CAPTURE_POLICY_COMMAND_ID,
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const input = updateTraceCapturePolicySchema.parse(rawInput)
    const service = resolveModuleConfig(ctx.container)
    const record = await readTenantRecord(service, input.tenantId)
    return { before: record?.value ?? null }
  },
  async execute(rawInput, ctx) {
    const input = updateTraceCapturePolicySchema.parse(rawInput)
    assertTenantMatchesActor(ctx, input.tenantId)
    const service = resolveModuleConfig(ctx.container)
    const current = await readTenantRecord(service, input.tenantId)
    enforceCommandOptimisticLock({
      resourceKind: TRACE_CAPTURE_POLICY_RESOURCE_KIND,
      resourceId: input.tenantId,
      current: current?.updatedAt ?? null,
      request: ctx.request ?? null,
    })
    const saved = await service.setValue(
      TRACE_CAPTURE_CONFIG_MODULE,
      TRACE_CAPTURE_CONFIG_NAME,
      input.policy,
      { tenantId: input.tenantId },
    )
    return { policy: input.policy, source: 'tenant', updatedAt: saved?.updatedAt ?? null }
  },
  async buildLog({ input, result, snapshots, ctx }) {
    const parsed = updateTraceCapturePolicySchema.parse(input)
    const { translate } = await resolveTranslations()
    const undo: TraceCapturePolicyUndoPayload = {
      tenantId: parsed.tenantId,
      before: snapshots.before ?? null,
      after: result.policy,
    }
    return {
      actionLabel: translate(
        'agent_orchestrator.audit.traceCapturePolicy.update',
        'Update trace capture policy',
      ),
      resourceKind: TRACE_CAPTURE_POLICY_RESOURCE_KIND,
      resourceId: parsed.tenantId,
      tenantId: parsed.tenantId,
      organizationId: ctx.auth?.orgId ?? null,
      snapshotBefore: undo.before,
      snapshotAfter: undo.after,
      payload: { undo },
    }
  },
  async authorizeReplay({ ctx, logEntry }) {
    const payload = extractUndoPayload<TraceCapturePolicyUndoPayload>(logEntry)
    if (!payload?.tenantId) {
      throw new CrudHttpError(400, { error: '[internal] trace capture policy undo payload is missing' })
    }
    assertTenantMatchesActor(ctx, payload.tenantId)
    const allowed = await hasTraceCaptureWriteAccess(ctx.container, ctx.auth, {
      tenantId: payload.tenantId,
      organizationId: ctx.auth?.orgId ?? ctx.selectedOrganizationId ?? null,
    })
    if (!allowed) {
      throw new CrudHttpError(403, { error: '[internal] missing trace capture write features' })
    }
  },
  async undo({ ctx, logEntry }) {
    const payload = extractUndoPayload<TraceCapturePolicyUndoPayload>(logEntry)
    if (!payload?.tenantId) return
    assertTenantMatchesActor(ctx, payload.tenantId)
    const service = resolveModuleConfig(ctx.container)
    await service.setValue(
      TRACE_CAPTURE_CONFIG_MODULE,
      TRACE_CAPTURE_CONFIG_NAME,
      payload.before ?? null,
      { tenantId: payload.tenantId },
    )
  },
}

registerCommand(updateTraceCapturePolicyCommand)
