import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  buildOptimisticLockConflictBody,
  enforceCommandOptimisticLockWithGuards,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { InsightsProcessSettings } from '../data/entities'
import { xraySettingsSaveSchema, type XraySettingsSaveInput } from '../data/validators'
import {
  XRAY_K_ANONYMITY_MIN,
  XRAY_SETTINGS_DEFAULTS,
  XRAY_SETTINGS_RESOURCE_KIND,
  findXraySettingsRecord,
  toXraySettingsSnapshot,
  type XraySettingsSnapshot,
} from '../lib/projection/settings'
import { canonicalIanaTimeZone } from '../lib/analytics/window'
import { resolveWorkflowDraftService } from '../lib/workflowsBridge'

export const XRAY_SETTINGS_SAVE_COMMAND_ID = 'insights.xray.settings.save'

export type SaveXraySettingsResult = XraySettingsSnapshot & { settingsId: string }

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) return true
  if (!error || typeof error !== 'object') return false
  return (error as { code?: string }).code === '23505'
}

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null
  return Number.isNaN(value.getTime()) ? null : value.toISOString()
}

function settingsChanges(input: XraySettingsSaveInput): Partial<InsightsProcessSettings> {
  const changes: Partial<InsightsProcessSettings> = {}
  if (input.enabled !== undefined) changes.enabled = input.enabled
  if (input.retentionDays !== undefined) changes.retentionDays = input.retentionDays
  if (input.kAnonymity !== undefined) changes.kAnonymity = Math.max(input.kAnonymity, XRAY_K_ANONYMITY_MIN)
  if (input.debounceSeconds !== undefined) changes.debounceSeconds = input.debounceSeconds
  if (input.individualsEnabled !== undefined) changes.individualsEnabled = input.individualsEnabled
  if (input.timeZone !== undefined) changes.timeZone = canonicalIanaTimeZone(input.timeZone) ?? XRAY_SETTINGS_DEFAULTS.timeZone
  if (input.suggestionMinSupport !== undefined) changes.suggestionMinSupport = input.suggestionMinSupport
  if (input.conformanceWorkflowId !== undefined) changes.conformanceWorkflowId = input.conformanceWorkflowId
  if (input.activityStepMap !== undefined) changes.activityStepMap = input.activityStepMap
  return changes
}

/**
 * A conformance workflow must be a stored definition of the same tenant AND organization, read
 * through the workflows module's soft-optional `workflowDraftService` (422 when it is absent or
 * the definition does not resolve in that scope; the error never says which).
 */
async function assertConformanceWorkflow(ctx: CommandRuntimeContext, input: XraySettingsSaveInput): Promise<void> {
  const workflowId = input.conformanceWorkflowId
  if (workflowId === undefined || workflowId === null) return
  const { translate } = await resolveTranslations()
  const service = resolveWorkflowDraftService(ctx.container)
  if (!service) {
    throw new CrudHttpError(422, {
      error: translate('insights.xray.errors.workflows_unavailable', 'Workflows are not available, so a conformance workflow cannot be set.'),
      code: 'workflows_unavailable',
    })
  }
  const definition = await service.getDefinitionForScope(workflowId, { tenantId: input.tenantId, organizationId: input.organizationId })
  if (!definition) {
    throw new CrudHttpError(422, {
      error: translate('insights.xray.errors.conformance_workflow_not_found', 'The conformance workflow does not exist in this organization.'),
      code: 'conformance_workflow_not_found',
    })
  }
}

async function conflictWithCurrent(em: EntityManager, input: XraySettingsSaveInput, expected: Date | null): Promise<never> {
  const winner = await findXraySettingsRecord(em.fork(), { tenantId: input.tenantId, organizationId: input.organizationId })
  const currentIso = toIso(winner?.updatedAt ?? null)
  const expectedIso = toIso(expected)
  if (currentIso && expectedIso) throw new CrudHttpError(409, buildOptimisticLockConflictBody(currentIso, expectedIso))
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(409, { error: translate('insights.xray.errors.settingsConflict', 'The settings were changed by someone else. Reload and try again.') })
}

/**
 * Saves the Process X-Ray settings of one organization. Optimistic locking: the version
 * header (`updatedAt`) is checked against the stored row, and the write itself is a
 * compare-and-set on `updated_at`, so a concurrent save between the check and the write
 * still answers 409 instead of being lost. A first save creates the row; two concurrent
 * first saves resolve to one row and a 409 for the loser.
 */
const saveXraySettingsCommand: CommandHandler<XraySettingsSaveInput, SaveXraySettingsResult> = {
  id: XRAY_SETTINGS_SAVE_COMMAND_ID,
  async prepare(rawInput, ctx) {
    const input = xraySettingsSaveSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findXraySettingsRecord(em, { tenantId: input.tenantId, organizationId: input.organizationId })
    return { before: record ? toXraySettingsSnapshot(record) : null }
  },
  async execute(rawInput, ctx) {
    const input = xraySettingsSaveSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    await assertConformanceWorkflow(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const existing = await findXraySettingsRecord(em, scope)
    const changes = settingsChanges(input)
    if (existing) {
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: XRAY_SETTINGS_RESOURCE_KIND,
        resourceId: existing.id,
        current: existing.updatedAt,
        request: ctx.request ?? null,
      })
      const loadedUpdatedAt = existing.updatedAt
      const updatedAt = new Date(Math.max(Date.now(), (loadedUpdatedAt?.getTime() ?? 0) + 1))
      const affected = await em.nativeUpdate(
        InsightsProcessSettings,
        { id: existing.id, tenantId: scope.tenantId, organizationId: scope.organizationId, updatedAt: loadedUpdatedAt },
        { ...changes, deletedAt: null, updatedAt },
      )
      if (affected !== 1) await conflictWithCurrent(em, input, loadedUpdatedAt)
      const saved = await findXraySettingsRecord(em.fork(), scope)
      if (!saved) throw new CrudHttpError(404, { error: 'not_found' })
      return { ...toXraySettingsSnapshot(saved), settingsId: saved.id }
    }
    const now = new Date()
    const created = em.create(InsightsProcessSettings, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      enabled: XRAY_SETTINGS_DEFAULTS.enabled,
      retentionDays: XRAY_SETTINGS_DEFAULTS.retentionDays,
      kAnonymity: XRAY_SETTINGS_DEFAULTS.kAnonymity,
      debounceSeconds: XRAY_SETTINGS_DEFAULTS.debounceSeconds,
      individualsEnabled: XRAY_SETTINGS_DEFAULTS.individualsEnabled,
      timeZone: XRAY_SETTINGS_DEFAULTS.timeZone,
      suggestionMinSupport: XRAY_SETTINGS_DEFAULTS.suggestionMinSupport,
      conformanceWorkflowId: XRAY_SETTINGS_DEFAULTS.conformanceWorkflowId,
      activityStepMap: XRAY_SETTINGS_DEFAULTS.activityStepMap,
      ...changes,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(created)
    try {
      await em.flush()
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      await conflictWithCurrent(em, input, null)
    }
    return { ...toXraySettingsSnapshot(created), settingsId: created.id }
  },
  buildLog: async ({ input, result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = (snapshots.before as XraySettingsSnapshot | null | undefined) ?? null
    return {
      actionLabel: translate('insights.xray.audit.settingsSave', 'Update Process X-Ray settings'),
      resourceKind: XRAY_SETTINGS_RESOURCE_KIND,
      resourceId: result.settingsId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: before,
      snapshotAfter: result,
    }
  },
}

registerCommand(saveXraySettingsCommand)

export const xraySettingsCommands = [saveXraySettingsCommand]

export { saveXraySettingsCommand }
