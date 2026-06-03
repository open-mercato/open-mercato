import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { normalizeEnvString, resolveDefaultEmailFromAddress } from '@open-mercato/shared/lib/email/config'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
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

export function readSesEnvPreset(): { region?: string; fromAddress: string; configurationSetName?: string } | null {
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

  const dscope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
  const existing = await findOneWithDecryption(
    ctx.em,
    CommunicationChannel,
    {
      providerKey: 'ses',
      channelType: 'email',
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: null,
      deletedAt: null,
    },
    undefined,
    dscope,
  )

  if (existing) {
    existing.displayName = 'Amazon SES system email'
    existing.externalIdentifier = preset.fromAddress
    existing.capabilities = { ...sesCapabilities }
    existing.isActive = true
    existing.status = 'connected'
    existing.lastError = null
    await ctx.em.flush()
    return
  }

  const channel = ctx.em.create(CommunicationChannel, {
    providerKey: 'ses',
    channelType: 'email',
    displayName: 'Amazon SES system email',
    externalIdentifier: preset.fromAddress,
    capabilities: { ...sesCapabilities },
    isActive: true,
    status: 'connected',
    userId: null,
    pollIntervalSeconds: null,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
  })
  await ctx.em.persist(channel).flush()
}
