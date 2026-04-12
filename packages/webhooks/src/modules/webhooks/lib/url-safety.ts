import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

export class UnsafeWebhookUrlError extends Error {
  public readonly reason: string

  constructor(reason: string, message?: string) {
    super(message ?? `Webhook URL rejected: ${reason}`)
    this.name = 'UnsafeWebhookUrlError'
    this.reason = reason
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'broadcasthost',
])

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

export function isPrivateIpAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIPv4(address)
  if (family === 6) return isPrivateIPv6(address)
  return false
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.')
  if (parts.length !== 4) return true
  const octets = parts.map((part) => Number(part))
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return true
  const [a, b] = octets
  if (a === 0) return true
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 0) return true
  if (a === 192 && b === 168) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51 && octets[2] === 100) return true
  if (a === 203 && b === 0 && octets[2] === 113) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a >= 224) return true
  if (a === 255 && b === 255 && octets[2] === 255 && octets[3] === 255) return true
  return false
}

function isPrivateIPv6(address: string): boolean {
  const segments = expandIPv6(address)
  if (!segments) return true

  if (segments.every((segment) => segment === 0)) return true
  if (segments.slice(0, 7).every((segment) => segment === 0) && segments[7] === 1) return true

  if (isIPv4CompatibleIPv6(segments)) return true

  const embedded = embeddedIPv4FromIPv6(segments)
  if (embedded && isPrivateIPv4(embedded)) return true

  const [a, b] = segments
  if ((a & 0xfe00) === 0xfc00) return true
  if ((a & 0xffc0) === 0xfe80) return true
  if ((a & 0xff00) === 0xff00) return true
  if (a === 0x2001 && b === 0x0db8) return true
  return false
}

function expandIPv6(address: string): number[] | null {
  let normalized = address.toLowerCase()
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':')
    if (lastColon === -1) return null
    const ipv4Segments = ipv4ToHexSegments(normalized.slice(lastColon + 1))
    if (!ipv4Segments) return null
    normalized = `${normalized.slice(0, lastColon)}:${ipv4Segments[0].toString(16)}:${ipv4Segments[1].toString(16)}`
  }

  const doubleColonParts = normalized.split('::')
  if (doubleColonParts.length > 2) return null

  const head = doubleColonParts[0] ? doubleColonParts[0].split(':') : []
  const tail = doubleColonParts[1] ? doubleColonParts[1].split(':') : []
  const headSegments = parseIPv6SegmentList(head)
  const tailSegments = parseIPv6SegmentList(tail)
  if (!headSegments || !tailSegments) return null

  if (doubleColonParts.length === 1) {
    return headSegments.length === 8 ? headSegments : null
  }

  const missing = 8 - headSegments.length - tailSegments.length
  if (missing < 1) return null
  return [
    ...headSegments,
    ...Array.from({ length: missing }, () => 0),
    ...tailSegments,
  ]
}

function parseIPv6SegmentList(parts: string[]): number[] | null {
  const segments: number[] = []
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null
    const value = Number.parseInt(part, 16)
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null
    segments.push(value)
  }
  return segments
}

function ipv4ToHexSegments(address: string): [number, number] | null {
  const octets = address.split('.').map((part) => Number(part))
  if (octets.length !== 4) return null
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null
  return [
    (octets[0] << 8) + octets[1],
    (octets[2] << 8) + octets[3],
  ]
}

function embeddedIPv4FromIPv6(segments: number[]): string | null {
  const firstFiveZero = segments.slice(0, 5).every((segment) => segment === 0)
  const isMapped = firstFiveZero && segments[5] === 0xffff
  const isNat64 = segments[0] === 0x0064
    && segments[1] === 0xff9b
    && segments.slice(2, 6).every((segment) => segment === 0)
  const isSixToFour = segments[0] === 0x2002

  if (isMapped || isNat64) {
    return ipv4FromHexSegments(segments[6], segments[7])
  }
  if (isSixToFour) {
    return ipv4FromHexSegments(segments[1], segments[2])
  }
  return null
}

function isIPv4CompatibleIPv6(segments: number[]): boolean {
  return segments.slice(0, 6).every((segment) => segment === 0)
}

function ipv4FromHexSegments(high: number, low: number): string {
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join('.')
}

function hostnameLooksBlocked(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true
  if (hostname === 'metadata.google.internal') return true
  if (hostname.endsWith('.localhost')) return true
  if (hostname.endsWith('.internal')) return true
  if (hostname.endsWith('.local')) return true
  return false
}

export function assertStaticallySafeWebhookUrl(rawUrl: string): void {
  const { hostname } = parseWebhookUrl(rawUrl)
  if (hostnameLooksBlocked(hostname)) {
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

  if (hostnameLooksBlocked(hostname)) {
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
