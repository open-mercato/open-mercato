import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { NormalizedDateLocaleSettingsRecord } from '@open-mercato/shared/lib/date-locale/types'
import type { ModuleConfigService } from '../lib/module-config-service'
import {
  DATE_LOCALE_CONFIG_MODULE,
  DATE_LOCALE_CONFIG_NAME,
  readTenantDateLocaleSettings,
} from '../lib/date-locale-settings'

export const DATE_LOCALE_UPDATE_COMMAND_ID = 'configs.date_locale.update'
export const DATE_LOCALE_RESOURCE_KIND = 'configs.date_locale'

export type UpdateDateLocaleSettingsInput = {
  tenantId: string
  settings: NormalizedDateLocaleSettingsRecord
}

type DateLocaleSnapshot = {
  tenantId: string
  settings: NormalizedDateLocaleSettingsRecord
}

async function writeSettings(
  container: { resolve: (name: string) => unknown },
  tenantId: string,
  settings: NormalizedDateLocaleSettingsRecord,
) {
  const service = container.resolve('moduleConfigService') as ModuleConfigService
  await service.setValue(DATE_LOCALE_CONFIG_MODULE, DATE_LOCALE_CONFIG_NAME, settings, { tenantId })
}

/**
 * Replaces a tenant's date & time settings. Runs as a command so every change lands in the action
 * log with the previous values and can be undone. Input is validated by the route.
 */
const updateDateLocaleSettingsCommand: CommandHandler<UpdateDateLocaleSettingsInput, { tenantId: string }> = {
  id: DATE_LOCALE_UPDATE_COMMAND_ID,
  async prepare(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    const current = await readTenantDateLocaleSettings(ctx.container, input.tenantId)
    return { before: { tenantId: input.tenantId, settings: current.settings } satisfies DateLocaleSnapshot }
  },
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    await writeSettings(ctx.container, input.tenantId, input.settings)
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
    await writeSettings(ctx.container, before.tenantId, before.settings)
  },
}

registerCommand(updateDateLocaleSettingsCommand)
