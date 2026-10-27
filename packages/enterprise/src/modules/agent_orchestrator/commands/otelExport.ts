import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { otelExportSettingsSchema, type OtelExportSettings } from '../data/validators'
import { loadInvokerAcl } from '../lib/access/agentInvokeAccess'
import { invokerFromAuth } from '../lib/access/invokeDenial'
import {
  OTEL_EXPORT_CONFIG_MODULE,
  OTEL_EXPORT_CONFIG_NAME,
  resolveOtelExportDeployment,
} from '../lib/trace/otel/exportSettings'

export const UPDATE_OTEL_EXPORT_SETTINGS_COMMAND_ID = 'agent_orchestrator.otelExportSettings.update'
export const OTEL_EXPORT_SETTINGS_RESOURCE_KIND = 'agent_orchestrator.otel_export_settings'
export const OTEL_EXPORT_WRITE_FEATURES = ['agent_orchestrator.agents.manage'] as const
export const OTEL_EXPORT_CONTENT_WRITE_FEATURES = [
  'agent_orchestrator.agents.manage',
  'agent_orchestrator.trace.view_content',
] as const

export const OTEL_EXPORT_CONTENT_ERRORS = {
  notAllowed: 'content_export_not_allowed',
  unavailable: 'content_export_unavailable',
} as const

export type OtelExportContentError = (typeof OTEL_EXPORT_CONTENT_ERRORS)[keyof typeof OTEL_EXPORT_CONTENT_ERRORS]

const updateOtelExportSettingsSchema = z.object({
  tenantId: z.string().uuid(),
  settings: otelExportSettingsSchema,
})

export type UpdateOtelExportSettingsCommandInput = z.input<typeof updateOtelExportSettingsSchema>

export type UpdateOtelExportSettingsCommandResult = {
  settings: OtelExportSettings
  source: 'tenant'
  updatedAt: string | null
}

type OtelExportSettingsUndoPayload = {
  tenantId: string
  before: unknown
  after: OtelExportSettings | null
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
  const record = await service.getRecord(OTEL_EXPORT_CONFIG_MODULE, OTEL_EXPORT_CONFIG_NAME, { tenantId })
  if (!record || record.source === 'instance') return null
  return record
}

/**
 * Why the requested content mode cannot be saved, or `null` when it can.
 * `full` is refused while the deployment denies content export, and refused
 * otherwise too because content events are not exported yet.
 */
export function resolveOtelExportContentError(
  settings: Pick<OtelExportSettings, 'content'>,
  deployment: { contentAllowed: boolean },
): OtelExportContentError | null {
  if (settings.content !== 'full') return null
  return deployment.contentAllowed ? OTEL_EXPORT_CONTENT_ERRORS.unavailable : OTEL_EXPORT_CONTENT_ERRORS.notAllowed
}

/**
 * Whether the actor holds every listed feature in the given scope. Fails
 * closed on any ACL failure.
 */
export async function hasOtelExportFeatures(
  container: AwilixContainer,
  auth: CommandRuntimeContext['auth'],
  scope: { tenantId: string | null; organizationId: string | null },
  features: readonly string[],
): Promise<boolean> {
  if (!auth) return false
  try {
    const acl = await loadInvokerAcl(container, invokerFromAuth(auth), scope)
    return authorizeFeatures(features, {
      grantedFeatures: acl.features,
      unrestricted: acl.isSuperAdmin,
    })
  } catch {
    return false
  }
}

function assertTenantMatchesActor(ctx: CommandRuntimeContext, tenantId: string): void {
  const actorTenantId = ctx.auth?.tenantId ?? null
  if (actorTenantId !== null && actorTenantId !== tenantId) {
    throw new CrudHttpError(403, { error: '[internal] otel export settings belong to another tenant' })
  }
}

/**
 * Saves the tenant's OTel export settings. Undoable: the log carries the
 * tenant row's previous value, so opting in to export is audited and
 * reversible; undoing the first save clears the row back to the disabled
 * default.
 */
export const updateOtelExportSettingsCommand: CommandHandler<
  UpdateOtelExportSettingsCommandInput,
  UpdateOtelExportSettingsCommandResult
> = {
  id: UPDATE_OTEL_EXPORT_SETTINGS_COMMAND_ID,
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const input = updateOtelExportSettingsSchema.parse(rawInput)
    const service = resolveModuleConfig(ctx.container)
    const record = await readTenantRecord(service, input.tenantId)
    return { before: record?.value ?? null }
  },
  async execute(rawInput, ctx) {
    const input = updateOtelExportSettingsSchema.parse(rawInput)
    assertTenantMatchesActor(ctx, input.tenantId)
    const contentError = resolveOtelExportContentError(input.settings, resolveOtelExportDeployment())
    if (contentError) throw new CrudHttpError(422, { error: contentError })
    const service = resolveModuleConfig(ctx.container)
    const current = await readTenantRecord(service, input.tenantId)
    enforceCommandOptimisticLock({
      resourceKind: OTEL_EXPORT_SETTINGS_RESOURCE_KIND,
      resourceId: input.tenantId,
      current: current?.updatedAt ?? null,
      request: ctx.request ?? null,
    })
    const saved = await service.setValue(OTEL_EXPORT_CONFIG_MODULE, OTEL_EXPORT_CONFIG_NAME, input.settings, {
      tenantId: input.tenantId,
    })
    return { settings: input.settings, source: 'tenant', updatedAt: saved?.updatedAt ?? null }
  },
  async buildLog({ input, result, snapshots, ctx }) {
    const parsed = updateOtelExportSettingsSchema.parse(input)
    const { translate } = await resolveTranslations()
    const undo: OtelExportSettingsUndoPayload = {
      tenantId: parsed.tenantId,
      before: snapshots.before ?? null,
      after: result.settings,
    }
    return {
      actionLabel: translate('agent_orchestrator.audit.otelExportSettings.update', 'Update OTel export settings'),
      resourceKind: OTEL_EXPORT_SETTINGS_RESOURCE_KIND,
      resourceId: parsed.tenantId,
      tenantId: parsed.tenantId,
      organizationId: ctx.auth?.orgId ?? null,
      snapshotBefore: undo.before,
      snapshotAfter: undo.after,
      payload: { undo },
    }
  },
  async authorizeReplay({ ctx, logEntry }) {
    const payload = extractUndoPayload<OtelExportSettingsUndoPayload>(logEntry)
    if (!payload?.tenantId) {
      throw new CrudHttpError(400, { error: '[internal] otel export settings undo payload is missing' })
    }
    assertTenantMatchesActor(ctx, payload.tenantId)
    const allowed = await hasOtelExportFeatures(
      ctx.container,
      ctx.auth,
      {
        tenantId: payload.tenantId,
        organizationId: ctx.auth?.orgId ?? ctx.selectedOrganizationId ?? null,
      },
      OTEL_EXPORT_WRITE_FEATURES,
    )
    if (!allowed) {
      throw new CrudHttpError(403, { error: '[internal] missing otel export write features' })
    }
  },
  async undo({ ctx, logEntry }) {
    const payload = extractUndoPayload<OtelExportSettingsUndoPayload>(logEntry)
    if (!payload?.tenantId) return
    assertTenantMatchesActor(ctx, payload.tenantId)
    const service = resolveModuleConfig(ctx.container)
    await service.setValue(OTEL_EXPORT_CONFIG_MODULE, OTEL_EXPORT_CONFIG_NAME, payload.before ?? null, {
      tenantId: payload.tenantId,
    })
  },
}

registerCommand(updateOtelExportSettingsCommand)
