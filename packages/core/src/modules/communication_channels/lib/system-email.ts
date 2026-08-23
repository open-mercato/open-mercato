import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ResolvedEmailPayload } from '@open-mercato/shared/lib/email/send'
import { normalizeEnvString } from '@open-mercato/shared/lib/email/config'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ChannelAdapterRegistry } from './registry'
import { htmlToText } from './email-mime'
import { getSystemEmailProviderConfigResolver } from './system-email-provider-config'
import { isTestChannelSeedingEnabled, TEST_SEED_PROVIDER_KEY } from './test-seed'
import { ensureSystemEmailChannel } from './ensure-system-email-channel'
import { CommunicationChannel } from '../data/entities'

export const DEFAULT_SYSTEM_EMAIL_PROVIDER = 'resend'

const logger = createLogger('communication_channels')

type CredentialsServiceLike = {
  resolve: (
    integrationId: string,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<Record<string, unknown> | null>
}

type ResolvedSystemEmailChannel = Pick<CommunicationChannel, 'providerKey' | 'channelType' | 'organizationId'>

/**
 * Outcome of resolving which channel a system email should go out through.
 *
 * `hasTenantChannel` drives the credential posture and is the whole point of the split: a tenant that
 * has an explicitly configured Hub channel MUST fail closed when its credentials are missing (never
 * silently borrow the instance-wide env key), while a tenant with no channel at all is an instance
 * that simply has not been migrated onto the Communications Hub yet and MUST keep working off env.
 */
type ResolvedSystemEmailTarget = {
  channel: ResolvedSystemEmailChannel
  hasTenantChannel: boolean
}

function resolveSystemEmailProvider(): string {
  return normalizeEnvString(process.env.SYSTEM_EMAIL_PROVIDER) ?? DEFAULT_SYSTEM_EMAIL_PROVIDER
}

export function isSystemEmailTransportConfigured(): boolean {
  return getSystemEmailProviderConfigResolver(resolveSystemEmailProvider())?.isConfigured() ?? false
}

async function renderReactEmail(react: ResolvedEmailPayload['react']): Promise<string | undefined> {
  if (!react) return undefined
  const { renderToStaticMarkup } = await import('react-dom/server')
  const markup = renderToStaticMarkup(react)
  return markup.startsWith('<!doctype html>') || markup.startsWith('<!DOCTYPE html>')
    ? markup
    : `<!doctype html>${markup}`
}

async function resolveEmailBody(payload: ResolvedEmailPayload): Promise<{
  html?: string
  text?: string
  body: string
  bodyFormat: 'text' | 'html'
}> {
  const html = payload.html ?? (await renderReactEmail(payload.react))
  const text = payload.text ?? (html ? htmlToText(html) : undefined)
  if (html) return { html, text, body: html, bodyFormat: 'html' }
  if (text) return { text, body: text, bodyFormat: 'text' }
  throw new Error('EMAIL_BODY_NOT_CONFIGURED: provide react, html, or text')
}

/**
 * Locate the tenant's system email channel.
 *
 * Two probes, both inside the caller's own scope: the caller's organization first, then the
 * organization-agnostic (`organization_id IS NULL`) row that represents a genuinely tenant-wide
 * channel. A channel belonging to a *different* organization is deliberately never used — organization
 * is a scoping boundary, and borrowing another organization's channel would send through credentials
 * that organization owns. A caller whose organization has no channel falls through to the
 * instance-wide environment credentials instead, which cross no boundary at all.
 */
async function findTenantSystemEmailChannel(
  em: EntityManager,
  payload: ResolvedEmailPayload,
  providerKey: string,
): Promise<CommunicationChannel | null> {
  const tenantId = payload.tenantId as string
  const dscope = { tenantId, organizationId: payload.organizationId ?? null }
  const base = {
    providerKey,
    channelType: 'email',
    tenantId,
    userId: null,
    deletedAt: null,
  }

  const organizationScopes: Array<string | null> = [payload.organizationId ?? null]
  if (payload.organizationId) organizationScopes.push(null)

  for (const organizationId of organizationScopes) {
    const found = await findOneWithDecryption(
      em,
      CommunicationChannel,
      { ...base, organizationId },
      undefined,
      dscope,
    )
    if (found) return found
  }
  return null
}

async function resolveSystemEmailChannel(
  em: EntityManager,
  payload: ResolvedEmailPayload,
): Promise<ResolvedSystemEmailTarget> {
  const providerKey = resolveSystemEmailProvider()
  const envTarget: ResolvedSystemEmailTarget = {
    channel: {
      providerKey,
      channelType: 'email',
      organizationId: payload.organizationId ?? null,
    },
    hasTenantChannel: false,
  }

  if (!payload.tenantId) {
    return { ...envTarget, channel: { ...envTarget.channel, organizationId: null } }
  }

  const dscope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId ?? null,
  }
  const explicitChannelId = normalizeEnvString(process.env.SYSTEM_EMAIL_CHANNEL_ID)

  // An operator who pinned SYSTEM_EMAIL_CHANNEL_ID asked for exactly one channel. Honour that
  // literally and never widen the search or fall back to env — a silent substitution would send
  // through a provider the operator deliberately did not choose.
  const channel = explicitChannelId
    ? await findOneWithDecryption(
        em,
        CommunicationChannel,
        {
          id: explicitChannelId,
          channelType: 'email',
          tenantId: payload.tenantId,
          userId: null,
          deletedAt: null,
        },
        undefined,
        dscope,
      )
    : await findTenantSystemEmailChannel(em, payload, providerKey)

  if (channel) {
    if (!channel.isActive || channel.status !== 'connected') {
      throw new Error(`SYSTEM_EMAIL_CHANNEL_UNAVAILABLE: channel is ${channel.status}`)
    }
    return { channel, hasTenantChannel: true }
  }

  if (explicitChannelId) {
    throw new Error(
      `SYSTEM_EMAIL_CHANNEL_NOT_CONFIGURED: SYSTEM_EMAIL_CHANNEL_ID '${explicitChannelId}' matches no active channel`,
    )
  }

  if (isTestChannelSeedingEnabled() && providerKey === TEST_SEED_PROVIDER_KEY) {
    return {
      channel: { providerKey: TEST_SEED_PROVIDER_KEY, channelType: 'email', organizationId: payload.organizationId ?? null },
      hasTenantChannel: false,
    }
  }

  // No channel row for this tenant. This is the ordinary state of an instance that upgraded into the
  // Communications Hub: tenants predate the feature, so nothing ever seeded a channel for them.
  // Do not decide here — `sendSystemEmail` still has to check whether the tenant configured the
  // provider through the integrations UI before it considers the instance-wide env credentials.
  return envTarget
}

function resolveEnvCredentials(providerKey: string, fromAddress: string): Record<string, unknown> {
  return getSystemEmailProviderConfigResolver(providerKey)?.resolveCredentials({ fromAddress }) ?? { fromAddress }
}

/**
 * Decide which credentials a tenant-scoped send uses.
 *
 * Three cases, in priority order:
 *
 * 1. The tenant has credentials stored for the provider (seeded, or saved through
 *    `/backend/integrations/channel_<provider>`) — always win. When no Hub channel row exists yet we
 *    also create one, so configuring the integration in the admin UI produces a usable channel
 *    instead of credentials nothing reads.
 * 2. The tenant has a configured channel but no credentials — **fail closed**. Borrowing the
 *    instance key here would send a tenant's mail through a provider account it did not choose.
 * 3. The tenant has neither — fall back to the instance-wide env credentials. This is the pre-Hub
 *    behaviour and the upgrade path: env credentials are instance-wide by definition, so this leaks
 *    nothing across tenants, and without it every tenant that predates the Hub loses all mail.
 */
async function resolveTenantCredentials(
  container: AppContainer,
  em: EntityManager,
  payload: ResolvedEmailPayload,
  channel: ResolvedSystemEmailChannel,
  hasTenantChannel: boolean,
): Promise<Record<string, unknown>> {
  const tenantId = payload.tenantId as string
  const organizationId = channel.organizationId ?? payload.organizationId ?? tenantId
  const credentialsService = container.resolve('integrationCredentialsService') as CredentialsServiceLike
  const resolvedCredentials = await credentialsService.resolve(`channel_${channel.providerKey}`, {
    tenantId,
    organizationId,
    userId: null,
  })

  if (resolvedCredentials) {
    if (!hasTenantChannel) {
      await ensureSystemEmailChannel(em, {
        tenantId,
        organizationId,
        providerKey: channel.providerKey,
        externalIdentifier: typeof resolvedCredentials.fromAddress === 'string' ? resolvedCredentials.fromAddress : payload.from,
      })
    }
    return resolvedCredentials
  }

  if (hasTenantChannel) {
    throw new Error(
      `SYSTEM_EMAIL_CREDENTIALS_NOT_CONFIGURED: configure tenant credentials for '${channel.providerKey}'`,
    )
  }

  if (!isSystemEmailTransportConfigured()) {
    throw new Error('SYSTEM_EMAIL_CHANNEL_NOT_CONFIGURED: configure a tenant-wide email channel')
  }

  logger.warn('Sending system email with instance-wide environment credentials', {
    tenantId,
    providerKey: channel.providerKey,
    reason: 'no tenant email channel or credentials configured',
    remedy: `run 'yarn mercato seed:defaults --module channel_${channel.providerKey}' to move this tenant onto the Communications Hub`,
  })
  return resolveEnvCredentials(channel.providerKey, payload.from)
}

/**
 * Choose the address a system email actually leaves from.
 *
 * The tenant's configured sender wins whenever the caller did not name one itself. `sendEmail` always
 * fills `from` in — from `NOTIFICATIONS_EMAIL_FROM` / `EMAIL_FROM` / `ADMIN_EMAIL` — so an adapter that
 * merely falls back to its credentials when `from` is missing would never reach the tenant's value, and
 * the "From address" saved in the integrations UI would be inert. A caller that passed an explicit
 * `from` meant it, and keeps it.
 */
function resolveOutboundFromAddress(
  payload: ResolvedEmailPayload,
  credentials: Record<string, unknown>,
): string {
  if (!payload.fromIsInstanceDefault) return payload.from
  const configured = credentials.fromAddress
  return typeof configured === 'string' && configured.trim().length > 0 ? configured : payload.from
}

export async function sendSystemEmail(
  container: AppContainer,
  payload: ResolvedEmailPayload,
): Promise<void> {
  const em = (container.resolve('em') as EntityManager).fork()
  const { channel, hasTenantChannel } = await resolveSystemEmailChannel(em, payload)
  const registry = container.resolve('channelAdapterRegistry') as ChannelAdapterRegistry
  const adapter = registry.get(channel.providerKey)
  if (!adapter) {
    throw new Error(
      `[internal] No ChannelAdapter registered for providerKey '${channel.providerKey}'. Enable the provider module.`,
    )
  }

  const credentials = payload.tenantId
    ? await resolveTenantCredentials(container, em, payload, channel, hasTenantChannel)
    : resolveEnvCredentials(channel.providerKey, payload.from)

  const body = await resolveEmailBody(payload)
  const converted = await adapter.convertOutbound({
    body: body.body,
    bodyFormat: body.bodyFormat,
    channelMetadata: {
      to: payload.to,
      subject: payload.subject,
      from: resolveOutboundFromAddress(payload, credentials),
      replyTo: payload.replyTo,
      attachments: payload.attachments,
    },
  })

  const sendResult = await adapter.sendMessage({
    content: converted.content,
    credentials,
    scope: {
      tenantId: payload.tenantId ?? 'system',
      organizationId: payload.organizationId ?? payload.tenantId ?? 'system',
    },
    metadata: converted.metadata,
  })

  if (sendResult.status === 'failed') {
    throw new Error(sendResult.error ?? `SYSTEM_EMAIL_SEND_FAILED: ${channel.providerKey}`)
  }
}
