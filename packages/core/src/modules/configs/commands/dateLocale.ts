import { LockMode, type EntityManager } from '@mikro-orm/postgresql'
import {
  getTransactionLifetime,
  onTransactionLifetimeComplete,
  registerCommand,
  type CommandHandler,
  type CommandReplayAuthorizationArgs,
  type CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import { ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { conflict, forbidden } from '@open-mercato/shared/lib/crud/errors'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { NormalizedDateLocaleSettingsRecord } from '@open-mercato/shared/lib/date-locale/types'
import { ModuleConfig } from '../data/entities'
import type { ModuleConfigService } from '../lib/module-config-service'
import {
  DATE_LOCALE_CONFIG_MODULE,
  DATE_LOCALE_CONFIG_NAME,
  normalizeStoredDateLocaleSettings,
  readTenantDateLocaleSettings,
} from '../lib/date-locale-settings'

export const DATE_LOCALE_UPDATE_COMMAND_ID = 'configs.date_locale.update'
export const DATE_LOCALE_RESOURCE_KIND = 'configs.date_locale'
export const DATE_LOCALE_MANAGE_FEATURE = 'configs.date_locale.manage'

export type UpdateDateLocaleSettingsInput = {
  tenantId: string
  settings: NormalizedDateLocaleSettingsRecord
}

type DateLocaleSnapshot = {
  tenantId: string
  settings: NormalizedDateLocaleSettingsRecord
}

type ReplayRbac = {
  userHasAllFeaturesWithEntityManager(
    em: EntityManager,
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ): Promise<boolean>
}

function settingsEqual(left: unknown, right: unknown): boolean {
  const a = normalizeStoredDateLocaleSettings(left)
  const b = normalizeStoredDateLocaleSettings(right)
  return (Object.keys(a) as Array<keyof NormalizedDateLocaleSettingsRecord>).every((key) => a[key] === b[key])
}

function findSettingsRow(em: EntityManager, tenantId: string, lock: boolean): Promise<ModuleConfig | null> {
  return em.findOne(
    ModuleConfig,
    { moduleId: DATE_LOCALE_CONFIG_MODULE, name: DATE_LOCALE_CONFIG_NAME, tenantId },
    lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {},
  )
}

async function invalidateSettingsCache(container: { resolve: (name: string) => unknown }, tenantId: string) {
  const service = container.resolve('moduleConfigService') as ModuleConfigService
  await service.invalidate(DATE_LOCALE_CONFIG_MODULE, DATE_LOCALE_CONFIG_NAME, { tenantId })
}

async function writeSettings(
  ctx: CommandRuntimeContext,
  tenantId: string,
  settings: NormalizedDateLocaleSettingsRecord,
) {
  const em = ctx.transactionalEm
  if (!em) {
    const service = ctx.container.resolve('moduleConfigService') as ModuleConfigService
    await service.setValue(DATE_LOCALE_CONFIG_MODULE, DATE_LOCALE_CONFIG_NAME, settings, { tenantId })
    return
  }
  const row = await findSettingsRow(em, tenantId, true)
  if (row) {
    row.valueJson = settings
    row.updatedAt = new Date()
  } else {
    em.persist(em.create(ModuleConfig, {
      moduleId: DATE_LOCALE_CONFIG_MODULE,
      name: DATE_LOCALE_CONFIG_NAME,
      valueJson: settings,
      tenantId,
      organizationId: null,
    }))
  }
  await em.flush()
  await invalidateSettingsCache(ctx.container, tenantId)
  if (getTransactionLifetime(em)) {
    onTransactionLifetimeComplete(em, async () => invalidateSettingsCache(ctx.container, tenantId))
  }
}

/**
 * Undo and redo run inside the replay transaction (`atomicReplay`), so this check and the write
 * that follows commit together. The actor must still hold the manage feature: undo only requires
 * `audit_logs.undo_self`, which a user keeps after losing access to these settings. The stored
 * settings, read under a row lock, must still be the ones the logged change left behind (undo) or
 * restored (redo); otherwise replaying would overwrite a newer change made by someone else.
 */
async function authorizeDateLocaleReplay({ operation, ctx, logEntry }: CommandReplayAuthorizationArgs<unknown>) {
  const { translate } = await resolveTranslations()
  const payload = extractUndoPayload<UndoPayload<DateLocaleSnapshot>>(logEntry)
  const expected = operation === 'undo' ? payload?.after : payload?.before
  const tenantId = expected?.tenantId ?? logEntry.tenantId ?? null
  const em = ctx.transactionalEm
  if (!em) throw new Error('[internal] Date & time settings replay requires a transactional EntityManager')
  if (!tenantId || !expected) {
    throw conflict(translate('configs.dateLocale.errors.replayStale', 'These settings changed after this action, so it cannot be replayed.'))
  }
  ensureTenantScope(ctx, tenantId)
  if (ctx.systemActor !== true) {
    const actorId = ctx.auth?.sub
    if (!actorId) throw forbidden()
    const rbac = ctx.container.resolve('rbacService') as ReplayRbac
    const allowed = await rbac.userHasAllFeaturesWithEntityManager(em, actorId, [DATE_LOCALE_MANAGE_FEATURE], {
      tenantId,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    })
    if (!allowed) throw forbidden()
  }
  const row = await findSettingsRow(em, tenantId, true)
  if (!settingsEqual(row?.valueJson ?? null, expected.settings)) {
    throw conflict(translate('configs.dateLocale.errors.replayStale', 'These settings changed after this action, so it cannot be replayed.'))
  }
}

/**
 * Replaces a tenant's date & time settings. Runs as a command so every change lands in the action
 * log with the previous values and can be undone. Input is validated by the route.
 */
const updateDateLocaleSettingsCommand: CommandHandler<UpdateDateLocaleSettingsInput, { tenantId: string }> = {
  id: DATE_LOCALE_UPDATE_COMMAND_ID,
  atomicReplay: true,
  authorizeReplay: authorizeDateLocaleReplay,
  async prepare(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    const current = await readTenantDateLocaleSettings(ctx.container, input.tenantId)
    return { before: { tenantId: input.tenantId, settings: current.settings } satisfies DateLocaleSnapshot }
  },
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    await writeSettings(ctx, input.tenantId, input.settings)
    return { tenantId: input.tenantId }
  },
  captureAfter: async (input) => ({ tenantId: input.tenantId, settings: input.settings }) satisfies DateLocaleSnapshot,
  buildLog: async ({ snapshots, ctx }) => {
    const before = (snapshots.before as DateLocaleSnapshot | undefined) ?? null
    const after = (snapshots.after as DateLocaleSnapshot | undefined) ?? null
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('configs.audit.dateLocale.update', 'Update date & time settings'),
      resourceKind: DATE_LOCALE_RESOURCE_KIND,
      resourceId: after.tenantId,
      tenantId: after.tenantId,
      organizationId: ctx.selectedOrganizationId ?? null,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies UndoPayload<DateLocaleSnapshot>,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<DateLocaleSnapshot>>(logEntry)
    const before = payload?.before
    if (!before) return
    ensureTenantScope(ctx, before.tenantId)
    await writeSettings(ctx, before.tenantId, before.settings)
  },
}

registerCommand(updateDateLocaleSettingsCommand)
