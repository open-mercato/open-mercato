import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { normalizeEnvString, resolveDefaultEmailFromAddress } from '@open-mercato/shared/lib/email/config'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ensureSystemEmailChannel } from '@open-mercato/core/modules/communication_channels/lib/ensure-system-email-channel'
import { resendCapabilities } from '../capabilities'

const logger = createLogger('channel_resend')

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
  if (!apiKey || !fromAddress) {
    // A key with no from-address is the trap worth naming: `.env.example` documents RESEND_API_KEY
    // prominently but the from-address separately, so this combination looks configured and seeds
    // nothing. Say so rather than returning null in silence.
    if (apiKey && !fromAddress) {
      logger.warn('RESEND_API_KEY is set but no from-address is configured; skipping Resend preset', {
        remedy: 'set NOTIFICATIONS_EMAIL_FROM, EMAIL_FROM, or ADMIN_EMAIL',
      })
    }
    return null
  }
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

  await ensureSystemEmailChannel(ctx.em, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    providerKey: 'resend',
    externalIdentifier: preset.fromAddress,
    displayName: 'Resend system email',
    capabilities: { ...resendCapabilities },
  })
}
