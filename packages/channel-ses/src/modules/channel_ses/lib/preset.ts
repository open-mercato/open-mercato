import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { normalizeEnvString, resolveDefaultEmailFromAddress } from '@open-mercato/shared/lib/email/config'
import { ensureSystemEmailChannel } from '@open-mercato/core/modules/communication_channels/lib/ensure-system-email-channel'
import { sesCapabilities } from '../capabilities'

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

  await ensureSystemEmailChannel(ctx.em, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    providerKey: 'ses',
    externalIdentifier: preset.fromAddress,
    displayName: 'Amazon SES system email',
    capabilities: { ...sesCapabilities },
  })
}
