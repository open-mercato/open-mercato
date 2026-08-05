import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { normalizeEnvString, resolveDefaultEmailFromAddress } from '@open-mercato/shared/lib/email/config'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import { resendCapabilities } from '../capabilities'

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

export function readResendEnvPreset(): { apiKey: string; fromAddress: string } | null {
  const apiKey = normalizeEnvString(process.env.RESEND_API_KEY)
  const fromAddress = resolveDefaultEmailFromAddress()
  if (!apiKey || !fromAddress) return null
  return { apiKey, fromAddress }
}

export async function applyResendEnvPreset(ctx: PresetScope): Promise<void> {
  const preset = readResendEnvPreset()
  if (!preset) return

  let credentialsService: CredentialsServiceLike
  try {
    credentialsService = ctx.container.resolve('integrationCredentialsService') as CredentialsServiceLike
  } catch {
    return
  }

  await credentialsService.save('channel_resend', preset, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    userId: null,
  })

  const dscope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
  const existing = await findOneWithDecryption(
    ctx.em,
    CommunicationChannel,
    {
      providerKey: 'resend',
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
    existing.displayName = 'Resend system email'
    existing.externalIdentifier = preset.fromAddress
    existing.capabilities = { ...resendCapabilities }
    existing.isActive = true
    existing.status = 'connected'
    existing.lastError = null
    await ctx.em.flush()
    return
  }

  const channel = ctx.em.create(CommunicationChannel, {
    providerKey: 'resend',
    channelType: 'email',
    displayName: 'Resend system email',
    externalIdentifier: preset.fromAddress,
    capabilities: { ...resendCapabilities },
    isActive: true,
    status: 'connected',
    userId: null,
    pollIntervalSeconds: null,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
  })
  await ctx.em.persist(channel).flush()
}
