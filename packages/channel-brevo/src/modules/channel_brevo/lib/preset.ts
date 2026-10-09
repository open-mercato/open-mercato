import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { normalizeEnvString, resolveDefaultEmailFromAddress } from '@open-mercato/shared/lib/email/config'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ensureSystemEmailChannel } from '@open-mercato/core/modules/communication_channels/lib/ensure-system-email-channel'
import { isSelectedSystemEmailProvider } from '@open-mercato/core/modules/communication_channels/lib/system-email-provider-config'
import { brevoCapabilities } from '../capabilities'

const logger = createLogger('channel_brevo')

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

export function readBrevoEnvPreset(): { apiKey: string; fromAddress: string } | null {
  const apiKey = normalizeEnvString(process.env.OM_INTEGRATION_BREVO_API_KEY)
  const fromAddress = normalizeEnvString(process.env.OM_INTEGRATION_BREVO_FROM_ADDRESS)
    ?? resolveDefaultEmailFromAddress()
  if (!apiKey || !fromAddress) {
    if (apiKey && !fromAddress) {
      logger.warn('Brevo API key is set but no from-address is configured; skipping Brevo preset', {
        remedy: 'set OM_INTEGRATION_BREVO_FROM_ADDRESS, NOTIFICATIONS_EMAIL_FROM, EMAIL_FROM, or ADMIN_EMAIL',
      })
    }
    return null
  }
  return { apiKey, fromAddress }
}

export async function applyBrevoEnvPreset(ctx: PresetScope): Promise<void> {
  if (!isSelectedSystemEmailProvider('brevo')) return
  const preset = readBrevoEnvPreset()
  if (!preset) return

  let credentialsService: CredentialsServiceLike
  try {
    credentialsService = ctx.container.resolve('integrationCredentialsService') as CredentialsServiceLike
  } catch {
    return
  }

  await credentialsService.save('channel_brevo', preset, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    userId: null,
  })

  try {
    const integrationStateService = ctx.container.resolve('integrationStateService') as IntegrationStateServiceLike
    await integrationStateService.upsert('channel_brevo', { isEnabled: true }, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  } catch (err) {
    logger.warn('Failed to enable the Brevo integration state; Integrations will read Disabled while email is live', {
      err,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  }

  await ensureSystemEmailChannel(ctx.em, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    providerKey: 'brevo',
    externalIdentifier: preset.fromAddress,
    displayName: 'Brevo system email',
    capabilities: { ...brevoCapabilities },
  })
}
