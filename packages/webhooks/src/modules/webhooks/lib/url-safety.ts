import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import {
  isBlockedHostname,
  isPrivateIpAddress,
} from '@open-mercato/shared/lib/network'

export { isPrivateIpAddress } from '@open-mercato/shared/lib/network'

export class UnsafeWebhookUrlError extends Error {
  public readonly reason: string

  constructor(reason: string, message?: string) {
    super(message ?? `Webhook URL rejected: ${reason}`)
    this.name = 'UnsafeWebhookUrlError'
    this.reason = reason
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

type ParsedWebhookUrl = {
  url: URL
  hostname: string
}

export function parseWebhookUrl(rawUrl: string): ParsedWebhookUrl {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new UnsafeWebhookUrlError('invalid_url', 'Webhook URL is not a valid URL')
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeWebhookUrlError(
      'forbidden_protocol',
      `Webhook URL protocol "${url.protocol.replace(':', '')}" is not allowed; use http or https`,
    )
  }
  if (url.username || url.password) {
    throw new UnsafeWebhookUrlError(
      'credentials_in_url',
      'Webhook URL must not embed basic-auth credentials',
    )
  }
  let hostname = url.hostname.trim().toLowerCase()
  if (!hostname) {
    throw new UnsafeWebhookUrlError('missing_host', 'Webhook URL must include a hostname')
  }
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1)
  }
  return { url, hostname }
}

export type AssertStaticWebhookUrlDeps = {
  allowPrivate?: boolean
}

export function assertStaticallySafeWebhookUrl(
  rawUrl: string,
  deps: AssertStaticWebhookUrlDeps = {},
): void {
  const { hostname } = parseWebhookUrl(rawUrl)
  const allowPrivate = deps.allowPrivate ?? isAllowPrivateWebhookUrlsEnabled()
  if (allowPrivate) return

  if (isBlockedHostname(hostname)) {
    throw new UnsafeWebhookUrlError(
      'blocked_hostname',
      `Webhook URL host "${hostname}" is not allowed`,
    )
  }
  const family = isIP(hostname)
  if (family && isPrivateIpAddress(hostname)) {
    throw new UnsafeWebhookUrlError(
      'private_ip_literal',
      `Webhook URL host "${hostname}" resolves to a private or reserved IP range`,
    )
  }
}

export function isAllowPrivateWebhookUrlsEnabled(): boolean {
  const raw = process.env.OM_WEBHOOKS_ALLOW_PRIVATE_URLS
  if (!raw) return false
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

export type AssertSafeWebhookDeliveryDeps = {
  lookupHost?: (hostname: string) => Promise<ReadonlyArray<{ address: string; family: number }>>
  allowPrivate?: boolean
}

export async function assertSafeWebhookDeliveryUrl(
  rawUrl: string,
  deps: AssertSafeWebhookDeliveryDeps = {},
): Promise<void> {
  const { hostname } = parseWebhookUrl(rawUrl)
  const allowPrivate = deps.allowPrivate ?? isAllowPrivateWebhookUrlsEnabled()
  if (allowPrivate) return

  if (isBlockedHostname(hostname)) {
    throw new UnsafeWebhookUrlError(
      'blocked_hostname',
      `Webhook URL host "${hostname}" is not allowed`,
    )
  }

  if (isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) {
      throw new UnsafeWebhookUrlError(
        'private_ip_literal',
        `Webhook URL host "${hostname}" resolves to a private or reserved IP range`,
      )
    }
    return
  }

  const resolver = deps.lookupHost ?? (async (host: string) => {
    const records = await lookup(host, { all: true, verbatim: true })
    return records
  })

  let addresses: ReadonlyArray<{ address: string; family: number }>
  try {
    addresses = await resolver(hostname)
  } catch (error) {
    throw new UnsafeWebhookUrlError(
      'dns_resolution_failed',
      `Webhook URL host "${hostname}" could not be resolved: ${error instanceof Error ? error.message : 'lookup failed'}`,
    )
  }

  if (!addresses || addresses.length === 0) {
    throw new UnsafeWebhookUrlError(
      'dns_resolution_empty',
      `Webhook URL host "${hostname}" has no DNS A/AAAA records`,
    )
  }

  for (const record of addresses) {
    if (isPrivateIpAddress(record.address)) {
      throw new UnsafeWebhookUrlError(
        'private_ip_resolved',
        `Webhook URL host "${hostname}" resolves to a private or reserved IP address (${record.address})`,
      )
    }
  }
}
