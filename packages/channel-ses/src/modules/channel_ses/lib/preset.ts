import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { normalizeEnvString, resolveDefaultEmailFromAddress } from '@open-mercato/shared/lib/email/config'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ensureSystemEmailChannel } from '@open-mercato/core/modules/communication_channels/lib/ensure-system-email-channel'
import { isSelectedSystemEmailProvider } from '@open-mercato/core/modules/communication_channels/lib/system-email-provider-config'
import { sesCapabilities } from '../capabilities'

const logger = createLogger('channel_ses')

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

export function readSesEnvPreset(): { region: string; fromAddress: string; configurationSetName?: string } | null {
  const fromAddress = resolveDefaultEmailFromAddress()
  const region = normalizeEnvString(process.env.AWS_SES_REGION) || normalizeEnvString(process.env.AWS_REGION)
  if (!fromAddress || !region) return null
  const configurationSetName = normalizeEnvString(process.env.AWS_SES_CONFIGURATION_SET)
  return {
    fromAddress,
    region,
    ...(configurationSetName ? { configurationSetName } : {}),
  }
}

export async function applySesEnvPreset(ctx: PresetScope): Promise<void> {
  // Only the provider this instance actually selected seeds anything. `AWS_REGION` is not an email
  // variable here — `.env.example` ships it uncommented for vector search, and every AWS runtime
  // injects it — so without this gate a Resend instance would advertise an Enabled SES integration
  // and a `status: 'connected'` SES channel nobody configured. That is the same misleading admin
  // state #5531 was filed for, pointed the other way.
  if (!isSelectedSystemEmailProvider('ses')) return
  const preset = readSesEnvPreset()
  if (!preset) return

  let credentialsService: CredentialsServiceLike
  try {
    credentialsService = ctx.container.resolve('integrationCredentialsService') as CredentialsServiceLike
  } catch {
    return
  }

  await credentialsService.save('channel_ses', preset, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    userId: null,
  })

  try {
    const integrationStateService = ctx.container.resolve('integrationStateService') as IntegrationStateServiceLike
    await integrationStateService.upsert('channel_ses', { isEnabled: true }, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  } catch (err) {
    logger.warn('Failed to enable the SES integration state; Integrations will read Disabled while email is live', {
      err,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  }

  await ensureSystemEmailChannel(ctx.em, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    providerKey: 'ses',
    externalIdentifier: preset.fromAddress,
    displayName: 'Amazon SES system email',
    capabilities: { ...sesCapabilities },
  })
}
