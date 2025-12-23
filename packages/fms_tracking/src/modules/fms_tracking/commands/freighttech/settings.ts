import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/core'
import { FreighttechTrackingSettings } from '../../data/entities'
import { freighttechSettingsUpsertSchema, type FreighttechSettingsUpsertInput } from '../../data/validators'

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
  FreighttechSettingsUpsertInput, FreighttechSettingsUpsertInput
> = {
  id: 'fms_tracking.freighttech.settings.save',
  async execute(rawInput, ctx) {
    const auth = ctx.auth
    if (!auth?.orgId || !auth.tenantId) {
      throw Error("fms_tracking.freighttech.settings.save Failed, missing org or tenant id")
    }
    const input = freighttechSettingsUpsertSchema.parse(rawInput)

    const em = ctx.container.resolve<EntityManager>('em')
    let settings = await loadFreighttechTrackingSettings(em, {
      tenantId: auth?.tenantId,
      organizationId: auth?.orgId,
    })

    const apiKey = input.apiKey.trim()
    const apiBaseUrl = input.apiBaseUrl.trim()

    if (!settings) {
      settings = em.create(FreighttechTrackingSettings, {
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
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
      apiKey: settings.apiKey,
      apiBaseUrl: settings.apiBaseUrl,
    }
  },
}

registerCommand(saveFreighttechTrackingSettingsCommand)
