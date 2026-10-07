import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { normalizeEnvString, resolveDefaultEmailFromAddress } from '@open-mercato/shared/lib/email/config'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ensureSystemEmailChannel } from '@open-mercato/core/modules/communication_channels/lib/ensure-system-email-channel'
import { isSelectedSystemEmailProvider } from '@open-mercato/core/modules/communication_channels/lib/system-email-provider-config'
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

type IntegrationStateServiceLike = {
  upsert: (
    integrationId: string,
    input: { isEnabled: boolean },
    scope: { organizationId: string; tenantId: string },
  ) => Promise<unknown>
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
  // Only the provider this instance actually selected seeds anything, so a leftover RESEND_API_KEY
  // on an instance that moved to `SYSTEM_EMAIL_PROVIDER=ses` no longer advertises an Enabled Resend
  // integration and a connected channel that nothing sends through. `resend` is the default, so the
  // documented `RESEND_API_KEY`-only setup is unaffected.
  if (!isSelectedSystemEmailProvider('resend')) return
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

  try {
    const integrationStateService = ctx.container.resolve('integrationStateService') as IntegrationStateServiceLike
    await integrationStateService.upsert('channel_resend', { isEnabled: true }, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  } catch (err) {
    logger.warn('Failed to enable the Resend integration state; Integrations will read Disabled while email is live', {
      err,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  }

  await ensureSystemEmailChannel(ctx.em, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    providerKey: 'resend',
    externalIdentifier: preset.fromAddress,
    displayName: 'Resend system email',
    capabilities: { ...resendCapabilities },
  })
}
