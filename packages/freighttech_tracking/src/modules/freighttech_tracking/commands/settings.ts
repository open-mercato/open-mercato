import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/core'
import { FreighttechTrackingSettings } from '../data/entities'
import { settingsUpsertSchema, type SettingsUpsertInput } from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'

export async function freighttechApiKey(em: EntityManager, params: { tenantId: string; organizationId: string }) {
  const settings = await loadFreighttechTrackingSettings(em, params)
  return settings?.apiKey
}

export async function loadFreighttechTrackingSettings(
  em: EntityManager,
  params: { tenantId: string; organizationId: string }
): Promise<FreighttechTrackingSettings | null> {
  return em.findOne(FreighttechTrackingSettings, {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
  })
}

const saveFreighttechTrackingSettingsCommand: CommandHandler<
  SettingsUpsertInput,
  {
    settingsId: string
    apiKey: string
    apiBaseUrl: string
  }
> = {
  id: 'freighttech_tracking.settings.save',
  async execute(rawInput, ctx) {
    const input = settingsUpsertSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let settings = await loadFreighttechTrackingSettings(em, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })

    const apiKey = input.apiKey.trim()
    const apiBaseUrl = input.apiBaseUrl.trim()

    if (!settings) {
      settings = em.create(FreighttechTrackingSettings, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        apiKey: apiKey,
        apiBaseUrl: apiBaseUrl
      })
      em.persist(settings)
    } else {
      settings.apiKey = apiKey
      settings.apiBaseUrl = apiBaseUrl
      settings.updatedAt = new Date()
    }

    await em.flush()

    return {
      settingsId: settings.id,
      apiKey: settings.apiKey,
      apiBaseUrl: settings.apiBaseUrl,
    }
  },
}

registerCommand(saveFreighttechTrackingSettingsCommand)
