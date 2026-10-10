import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { normalizeEnvString, resolveDefaultEmailFromAddress } from '@open-mercato/shared/lib/email/config'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ensureSystemEmailChannel } from '@open-mercato/core/modules/communication_channels/lib/ensure-system-email-channel'
import { isSelectedSystemEmailProvider } from '@open-mercato/core/modules/communication_channels/lib/system-email-provider-config'
import { mailjetCapabilities } from '../capabilities'

const logger = createLogger('channel_mailjet')

type PresetScope = {
  em: EntityManager
  container: AppContainer
  tenantId: string
  organizationId: string
}

type CredentialsServiceLike = {
  save: (
    integrationId: string,
    credentials: Record<string, unknown>,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<void>
}

type IntegrationStateServiceLike = {
  upsert: (
    integrationId: string,
    input: { isEnabled: boolean },
    scope: { organizationId: string; tenantId: string },
  ) => Promise<unknown>
}

export function readMailjetEnvPreset(): { apiKey: string; secretKey: string; fromAddress: string } | null {
  const apiKey = normalizeEnvString(process.env.OM_INTEGRATION_MAILJET_API_KEY)
  const secretKey = normalizeEnvString(process.env.OM_INTEGRATION_MAILJET_SECRET_KEY)
  const fromAddress = normalizeEnvString(process.env.OM_INTEGRATION_MAILJET_FROM_ADDRESS)
    ?? resolveDefaultEmailFromAddress()
  if (!apiKey || !secretKey || !fromAddress) {
    const missing = [
      ...(!apiKey ? ['OM_INTEGRATION_MAILJET_API_KEY'] : []),
      ...(!secretKey ? ['OM_INTEGRATION_MAILJET_SECRET_KEY'] : []),
      ...(!fromAddress ? ['OM_INTEGRATION_MAILJET_FROM_ADDRESS or a shared email sender variable'] : []),
    ]
    logger.warn('Mailjet env preset is incomplete; skipping provider configuration', { missing })
    return null
  }
  return { apiKey, secretKey, fromAddress }
}

export async function applyMailjetEnvPreset(ctx: PresetScope): Promise<void> {
  if (!isSelectedSystemEmailProvider('mailjet')) return
  const preset = readMailjetEnvPreset()
  if (!preset) return

  let credentialsService: CredentialsServiceLike
  try {
    credentialsService = ctx.container.resolve('integrationCredentialsService') as CredentialsServiceLike
  } catch {
    return
  }

  await credentialsService.save('channel_mailjet', preset, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    userId: null,
  })

  try {
    const integrationStateService = ctx.container.resolve('integrationStateService') as IntegrationStateServiceLike
    await integrationStateService.upsert('channel_mailjet', { isEnabled: true }, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  } catch (err) {
    logger.warn('Failed to enable the Mailjet integration state; Integrations will read Disabled while email is live', {
      err,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  }

  await ensureSystemEmailChannel(ctx.em, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    providerKey: 'mailjet',
    externalIdentifier: preset.fromAddress,
    displayName: 'Mailjet system email',
    capabilities: { ...mailjetCapabilities },
  })
}
