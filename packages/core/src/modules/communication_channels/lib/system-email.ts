import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ResolvedEmailPayload } from '@open-mercato/shared/lib/email/send'
import { normalizeEnvString } from '@open-mercato/shared/lib/email/config'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ChannelAdapterRegistry } from './registry'
import { htmlToText } from './email-mime'
import { getSystemEmailProviderConfigResolver } from './system-email-provider-config'
import { CommunicationChannel } from '../data/entities'

export const DEFAULT_SYSTEM_EMAIL_PROVIDER = 'resend'

type CredentialsServiceLike = {
  resolve: (
    integrationId: string,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<Record<string, unknown> | null>
}

type ResolvedSystemEmailChannel = Pick<CommunicationChannel, 'providerKey' | 'channelType' | 'organizationId'>

function resolveSystemEmailProvider(): string {
  return normalizeEnvString(process.env.SYSTEM_EMAIL_PROVIDER) ?? DEFAULT_SYSTEM_EMAIL_PROVIDER
}

export function isSystemEmailTransportConfigured(): boolean {
  return getSystemEmailProviderConfigResolver(resolveSystemEmailProvider())?.isConfigured() ?? true
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

async function resolveSystemEmailChannel(
  em: EntityManager,
  payload: ResolvedEmailPayload,
): Promise<ResolvedSystemEmailChannel> {
  if (!payload.tenantId) {
    return {
      providerKey: resolveSystemEmailProvider(),
      channelType: 'email',
      organizationId: null,
    }
  }

  const dscope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId ?? null,
  }
  const explicitChannelId = normalizeEnvString(process.env.SYSTEM_EMAIL_CHANNEL_ID)
  const where = explicitChannelId
    ? {
        id: explicitChannelId,
        channelType: 'email',
        tenantId: payload.tenantId,
        organizationId: payload.organizationId ?? null,
        userId: null,
        deletedAt: null,
      }
    : {
        providerKey: resolveSystemEmailProvider(),
        channelType: 'email',
        tenantId: payload.tenantId,
        organizationId: payload.organizationId ?? null,
        userId: null,
        deletedAt: null,
      }

  const channel = await findOneWithDecryption(em, CommunicationChannel, where, undefined, dscope)
  if (!channel && !explicitChannelId && !payload.organizationId) {
    const fallback = await findOneWithDecryption(
      em,
      CommunicationChannel,
      {
        providerKey: resolveSystemEmailProvider(),
        channelType: 'email',
        tenantId: payload.tenantId,
        userId: null,
        deletedAt: null,
      },
      undefined,
      dscope,
    )
    if (fallback) {
      if (!fallback.isActive || fallback.status !== 'connected') {
        throw new Error(`SYSTEM_EMAIL_CHANNEL_UNAVAILABLE: channel is ${fallback.status}`)
      }
      return fallback
    }
  }
  if (!channel) {
    throw new Error('SYSTEM_EMAIL_CHANNEL_NOT_CONFIGURED: configure a tenant-wide email channel')
  }
  if (!channel.isActive || channel.status !== 'connected') {
    throw new Error(`SYSTEM_EMAIL_CHANNEL_UNAVAILABLE: channel is ${channel.status}`)
  }
  return channel
}

function resolveEnvCredentials(providerKey: string, fromAddress: string): Record<string, unknown> {
  return getSystemEmailProviderConfigResolver(providerKey)?.resolveCredentials({ fromAddress }) ?? { fromAddress }
}

export async function sendSystemEmail(
  container: AppContainer,
  payload: ResolvedEmailPayload,
): Promise<void> {
  const em = (container.resolve('em') as EntityManager).fork()
  const channel = await resolveSystemEmailChannel(em, payload)
  const registry = container.resolve('channelAdapterRegistry') as ChannelAdapterRegistry
  const adapter = registry.get(channel.providerKey)
  if (!adapter) {
    throw new Error(
      `[internal] No ChannelAdapter registered for providerKey '${channel.providerKey}'. Enable the provider module.`,
    )
  }

  let credentials: Record<string, unknown> = resolveEnvCredentials(channel.providerKey, payload.from)
  if (payload.tenantId) {
    try {
      const credentialsService = container.resolve('integrationCredentialsService') as CredentialsServiceLike
      credentials =
        (await credentialsService.resolve(`channel_${channel.providerKey}`, {
          tenantId: payload.tenantId,
          organizationId: channel.organizationId ?? payload.organizationId ?? payload.tenantId,
          userId: null,
        })) ?? credentials
    } catch {
      credentials = resolveEnvCredentials(channel.providerKey, payload.from)
    }
  }

  const body = await resolveEmailBody(payload)
  const converted = await adapter.convertOutbound({
    body: body.body,
    bodyFormat: body.bodyFormat,
    channelMetadata: {
      to: payload.to,
      subject: payload.subject,
      from: payload.from,
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
