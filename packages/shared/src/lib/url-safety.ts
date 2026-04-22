import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isBlockedHostname, isPrivateIpAddress } from './network'

export type UrlSafetyReason =
  | 'invalid_url'
  | 'forbidden_protocol'
  | 'credentials_in_url'
  | 'missing_host'
  | 'blocked_hostname'
  | 'private_ip_literal'
  | 'private_ip_resolved'
  | 'dns_resolution_failed'
  | 'dns_resolution_empty'

export class UnsafeOutboundUrlError extends Error {
  public readonly reason: UrlSafetyReason

  constructor(reason: UrlSafetyReason, message?: string) {
    super(message ?? `Outbound URL rejected: ${reason}`)
    this.name = 'UnsafeOutboundUrlError'
    this.reason = reason
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export type ParsedOutboundUrl = {
  url: URL
  hostname: string
}

export type UrlSafetyErrorFactory = (reason: UrlSafetyReason, message: string) => Error

const defaultErrorFactory: UrlSafetyErrorFactory = (reason, message) =>
  new UnsafeOutboundUrlError(reason, message)

export type ParseOutboundUrlOptions = {
  errorFactory?: UrlSafetyErrorFactory
  subject?: string
}

export function parseOutboundUrl(
  rawUrl: string,
  options: ParseOutboundUrlOptions = {},
): ParsedOutboundUrl {
  const subject = options.subject ?? 'URL'
  const factory = options.errorFactory ?? defaultErrorFactory
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw factory('invalid_url', `${subject} is not a valid URL`)
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw factory(
      'forbidden_protocol',
      `${subject} protocol "${url.protocol.replace(':', '')}" is not allowed; use http or https`,
    )
  }
  if (url.username || url.password) {
    throw factory('credentials_in_url', `${subject} must not embed basic-auth credentials`)
  }
  let hostname = url.hostname.trim().toLowerCase()
  if (!hostname) {
    throw factory('missing_host', `${subject} must include a hostname`)
  }
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1)
  }
  return { url, hostname }
}

export type HostLookup = (
  hostname: string,
) => Promise<ReadonlyArray<{ address: string; family: number }>>

export type AssertStaticUrlOptions = ParseOutboundUrlOptions & {
  allowPrivate?: boolean
}

export function assertStaticallySafeOutboundUrl(
  rawUrl: string,
  options: AssertStaticUrlOptions = {},
): void {
  const subject = options.subject ?? 'URL'
  const factory = options.errorFactory ?? defaultErrorFactory
  const { hostname } = parseOutboundUrl(rawUrl, options)
  if (options.allowPrivate) return

  if (isBlockedHostname(hostname)) {
    throw factory('blocked_hostname', `${subject} host "${hostname}" is not allowed`)
  }
  if (isIP(hostname) && isPrivateIpAddress(hostname)) {
    throw factory(
      'private_ip_literal',
      `${subject} host "${hostname}" resolves to a private or reserved IP range`,
    )
  }
}

export type AssertSafeOutboundUrlOptions = AssertStaticUrlOptions & {
  lookupHost?: HostLookup
}

export async function assertSafeOutboundUrl(
  rawUrl: string,
  options: AssertSafeOutboundUrlOptions = {},
): Promise<void> {
  const subject = options.subject ?? 'URL'
  const factory = options.errorFactory ?? defaultErrorFactory
  const { hostname } = parseOutboundUrl(rawUrl, options)
  if (options.allowPrivate) return

  if (isBlockedHostname(hostname)) {
    throw factory('blocked_hostname', `${subject} host "${hostname}" is not allowed`)
  }

  if (isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) {
      throw factory(
        'private_ip_literal',
        `${subject} host "${hostname}" resolves to a private or reserved IP range`,
      )
    }
    return
  }

  const resolver: HostLookup =
    options.lookupHost ??
    (async (host) => {
      const records = await lookup(host, { all: true, verbatim: true })
      return records
    })

  let addresses: ReadonlyArray<{ address: string; family: number }>
  try {
    addresses = await resolver(hostname)
  } catch (error) {
    throw factory(
      'dns_resolution_failed',
      `${subject} host "${hostname}" could not be resolved: ${
        error instanceof Error ? error.message : 'lookup failed'
      }`,
    )
  }

  if (!addresses || addresses.length === 0) {
    throw factory(
      'dns_resolution_empty',
      `${subject} host "${hostname}" has no DNS A/AAAA records`,
    )
  }

  for (const record of addresses) {
    if (isPrivateIpAddress(record.address)) {
      throw factory(
        'private_ip_resolved',
        `${subject} host "${hostname}" resolves to a private or reserved IP address (${record.address})`,
      )
    }
  }
}
