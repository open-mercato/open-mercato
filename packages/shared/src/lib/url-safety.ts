import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Agent, type Dispatcher } from 'undici'
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
  await resolveSafeOutboundUrl(rawUrl, options)
}

export type ResolvedHostAddress = { address: string; family: number }

export type ResolveSafeOutboundUrlResult = {
  url: URL
  hostname: string
  /**
   * The validated DNS records, in lookup order. `null` when the hostname is an IP literal
   * (no DNS lookup performed) or when `allowPrivate` short-circuited validation.
   */
  addresses: ReadonlyArray<ResolvedHostAddress> | null
}

/**
 * Validates an outbound URL exactly like `assertSafeOutboundUrl()` and additionally returns
 * the resolved DNS records so the caller can pin the subsequent connection to the same
 * address. This is what `safeOutboundFetch()` uses internally to defeat DNS rebinding —
 * call it directly only if you need to drive the fetch yourself.
 */
export async function resolveSafeOutboundUrl(
  rawUrl: string,
  options: AssertSafeOutboundUrlOptions = {},
): Promise<ResolveSafeOutboundUrlResult> {
  const subject = options.subject ?? 'URL'
  const factory = options.errorFactory ?? defaultErrorFactory
  const { url, hostname } = parseOutboundUrl(rawUrl, options)
  if (options.allowPrivate) return { url, hostname, addresses: null }

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
    return { url, hostname, addresses: null }
  }

  const resolver: HostLookup =
    options.lookupHost ??
    (async (host) => {
      const records = await lookup(host, { all: true, verbatim: true })
      return records
    })

  let addresses: ReadonlyArray<ResolvedHostAddress>
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

  return { url, hostname, addresses }
}

export type SafeOutboundFetchOptions = AssertSafeOutboundUrlOptions & {
  /**
   * Test/seam injection. When provided, `safeOutboundFetch` calls `fetchImpl(url, init)` after
   * URL validation instead of using the global `fetch` with a DNS-pinned dispatcher. Tests do
   * not actually open sockets, so DNS pinning is unnecessary and would just complicate mocking.
   */
  fetchImpl?: typeof fetch
}

/**
 * Validates an outbound URL and performs `fetch()` with the connection pinned to a
 * pre-validated IP address, so DNS cannot be re-resolved between validation and connect
 * (DNS rebinding). Always defaults to `redirect: 'manual'` — callers MUST decide what to
 * do with 3xx responses (re-validate the redirect target before following).
 *
 * For IP literal hosts and `allowPrivate=true`, no DNS pinning is performed because there
 * is no DNS lookup to defeat.
 */
export async function safeOutboundFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: SafeOutboundFetchOptions = {},
): Promise<Response> {
  const { url, hostname, addresses } = await resolveSafeOutboundUrl(rawUrl, options)
  void url

  const mergedInit: RequestInit = {
    redirect: 'manual',
    ...init,
  }

  const fetchImpl = options.fetchImpl
  if (fetchImpl) {
    return fetchImpl(rawUrl, mergedInit)
  }

  if (!addresses || addresses.length === 0) {
    return globalThis.fetch(rawUrl, mergedInit)
  }

  const dispatcher: Dispatcher = new Agent({
    connect: {
      lookup: createPinnedDnsLookup(hostname, addresses[0]),
    },
  })

  try {
    return await globalThis.fetch(rawUrl, { ...mergedInit, dispatcher } as RequestInit & {
      dispatcher: Dispatcher
    })
  } finally {
    dispatcher.close().catch(() => {})
  }
}

export type PinnedDnsLookup = (
  host: string,
  opts: unknown,
  cb: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
) => void

/**
 * Builds a `dns.lookup`-shaped callback that always returns the supplied pre-validated
 * address for the expected hostname, and refuses to resolve any other hostname. Used as
 * `Agent.connect.lookup` to bind an outbound TCP connect to an IP that has already been
 * validated, so attacker-controlled DNS cannot rebind between validation and connect.
 */
export function createPinnedDnsLookup(
  expectedHostname: string,
  pinned: ResolvedHostAddress,
): PinnedDnsLookup {
  return (host, _opts, cb) => {
    if (host !== expectedHostname) {
      const err: NodeJS.ErrnoException = new Error(
        `Refusing DNS lookup for unexpected host "${host}" (expected "${expectedHostname}")`,
      )
      err.code = 'EREFUSED'
      cb(err, '', 0)
      return
    }
    cb(null, pinned.address, pinned.family)
  }
}
