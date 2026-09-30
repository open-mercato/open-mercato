import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { normalizeEnvString, resolveDefaultEmailFromAddress } from '@open-mercato/shared/lib/email/config'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ensureSystemEmailChannel } from '@open-mercato/core/modules/communication_channels/lib/ensure-system-email-channel'
import { isSelectedSystemEmailProvider } from '@open-mercato/core/modules/communication_channels/lib/system-email-provider-config'
import { smtpCapabilities } from '../capabilities'
import { SMTP_TLS_MODES, type SmtpTlsMode } from './credentials'

const logger = createLogger('channel_smtp')

const DEFAULT_PORT = 587
const IMPLICIT_TLS_PORT = 465

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

export type SmtpEnvPreset = {
  host: string
  port: number
  tls: SmtpTlsMode
  user: string
  password: string
  fromAddress: string
}

function resolvePort(): number {
  const raw = normalizeEnvString(process.env.SMTP_PORT)
  if (!raw) return DEFAULT_PORT
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : DEFAULT_PORT
}

function resolveTlsMode(port: number): SmtpTlsMode {
  const raw = normalizeEnvString(process.env.SMTP_TLS)?.toLowerCase()
  if (raw && (SMTP_TLS_MODES as readonly string[]).includes(raw)) return raw as SmtpTlsMode
  // Port 465 is implicit TLS by convention and speaks no STARTTLS, so defaulting
  // it to `starttls` would hand every operator who only set SMTP_PORT=465 a
  // connection that hangs on the greeting.
  return port === IMPLICIT_TLS_PORT ? 'tls' : 'starttls'
}

export function readSmtpEnvPreset(): SmtpEnvPreset | null {
  const host = normalizeEnvString(process.env.SMTP_HOST)
  const user = normalizeEnvString(process.env.SMTP_USER)
  const password = normalizeEnvString(process.env.SMTP_PASSWORD)
  const fromAddress = resolveDefaultEmailFromAddress()
  if (!host || !user || !password || !fromAddress) {
    // A partially-filled SMTP block looks configured and seeds nothing, so name
    // what is missing instead of returning null in silence.
    if (host && !(user && password && fromAddress)) {
      logger.warn('SMTP_HOST is set but the SMTP preset is incomplete; skipping SMTP preset', {
        missing: [
          ...(user ? [] : ['SMTP_USER']),
          ...(password ? [] : ['SMTP_PASSWORD']),
          ...(fromAddress ? [] : ['NOTIFICATIONS_EMAIL_FROM, EMAIL_FROM, or ADMIN_EMAIL']),
        ],
      })
    }
    return null
  }
  const port = resolvePort()
  return { host, port, tls: resolveTlsMode(port), user, password, fromAddress }
}

export async function applySmtpEnvPreset(ctx: PresetScope): Promise<void> {
  // Only the provider this instance actually selected seeds anything, so a leftover
  // SMTP_HOST on an instance that moved to `SYSTEM_EMAIL_PROVIDER=resend` no longer
  // advertises an Enabled SMTP integration and a connected channel nothing sends through.
  if (!isSelectedSystemEmailProvider('smtp')) return
  const preset = readSmtpEnvPreset()
  if (!preset) return

  let credentialsService: CredentialsServiceLike
  try {
    credentialsService = ctx.container.resolve('integrationCredentialsService') as CredentialsServiceLike
  } catch {
    return
  }

  await credentialsService.save('channel_smtp', preset, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    userId: null,
  })

  try {
    const integrationStateService = ctx.container.resolve('integrationStateService') as IntegrationStateServiceLike
    await integrationStateService.upsert('channel_smtp', { isEnabled: true }, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  } catch (err) {
    logger.warn('Failed to enable the SMTP integration state; Integrations will read Disabled while email is live', {
      err,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  }

  await ensureSystemEmailChannel(ctx.em, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    providerKey: 'smtp',
    externalIdentifier: preset.fromAddress,
    displayName: 'SMTP system email',
    capabilities: { ...smtpCapabilities },
  })
}
