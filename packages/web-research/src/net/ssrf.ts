import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { WebResearchError } from '../contract/errors'

export type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>

const defaultLookup: LookupFn = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true })
  return records.map((record) => ({ address: record.address, family: record.family }))
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  return value >>> 0
}

function isPrivateIpv4(address: string): boolean {
  const value = ipv4ToInt(address)
  if (value === null) return true
  const inRange = (base: string, maskBits: number): boolean => {
    const baseValue = ipv4ToInt(base)
    if (baseValue === null) return false
    const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0
    return (value & mask) === (baseValue & mask)
  }
  return (
    inRange('0.0.0.0', 8) ||
    inRange('10.0.0.0', 8) ||
    inRange('100.64.0.0', 10) ||
    inRange('127.0.0.0', 8) ||
    inRange('169.254.0.0', 16) ||
    inRange('172.16.0.0', 12) ||
    inRange('192.0.0.0', 24) ||
    inRange('192.168.0.0', 16) ||
    inRange('198.18.0.0', 15) ||
    inRange('224.0.0.0', 4) ||
    inRange('240.0.0.0', 4)
  )
}

function normalizeIpv6(address: string): string {
  const zoneIndex = address.indexOf('%')
  return (zoneIndex === -1 ? address : address.slice(0, zoneIndex)).toLowerCase()
}

function parseHextets(segment: string): number[] | null {
  if (segment === '') return []
  const parsed: number[] = []
  for (const part of segment.split(':')) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null
    parsed.push(Number.parseInt(part, 16))
  }
  return parsed
}

/** Expands any IPv6 spelling (`::`, embedded dotted-quad) to its eight hextets. */
function expandIpv6(raw: string): number[] | null {
  let address = raw
  const dotted = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(address)
  if (dotted) {
    const value = ipv4ToInt(dotted[1])
    if (value === null) return null
    const high = ((value >>> 16) & 0xffff).toString(16)
    const low = (value & 0xffff).toString(16)
    address = `${address.slice(0, dotted.index)}:${high}:${low}`
  }
  const halves = address.split('::')
  if (halves.length > 2) return null
  const head = parseHextets(halves[0] ?? '')
  if (head === null) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const tail = parseHextets(halves[1] ?? '')
  if (tail === null) return null
  const missing = 8 - head.length - tail.length
  if (missing < 0) return null
  return [...head, ...Array<number>(missing).fill(0), ...tail]
}

function hextetsToIpv4(high: number, low: number): string {
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`
}

/**
 * Recovers the IPv4 address tunnelled inside an IPv6 one. This is load-bearing:
 * `new URL('http://[::ffff:127.0.0.1]/').hostname` is `::ffff:7f00:1`, so a guard
 * that only pattern-matches the dotted-quad spelling never fires and loopback —
 * and the cloud metadata endpoint — walk straight through.
 */
function embeddedIpv4(hextets: readonly number[]): string | null {
  const [first, second, third, fourth, fifth, sixth, seventh, eighth] = hextets
  const zeroPrefix = first === 0 && second === 0 && third === 0 && fourth === 0 && fifth === 0
  if (zeroPrefix && (sixth === 0xffff || sixth === 0)) return hextetsToIpv4(seventh, eighth)
  const nat64 =
    first === 0x0064 && second === 0xff9b && third === 0 && fourth === 0 && fifth === 0 && sixth === 0
  if (nat64) return hextetsToIpv4(seventh, eighth)
  return null
}

function isPrivateIpv6(address: string): boolean {
  const normalized = normalizeIpv6(address)
  if (normalized === '::1' || normalized === '::') return true
  const hextets = expandIpv6(normalized)
  if (hextets === null) return true
  const embedded = embeddedIpv4(hextets)
  if (embedded !== null) return isPrivateIpv4(embedded)
  const first = hextets[0]
  if ((first & 0xfe00) === 0xfc00) return true
  if ((first & 0xffc0) === 0xfe80) return true
  if ((first & 0xff00) === 0xff00) return true
  return false
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family === 6) return isPrivateIpv6(address)
  return true
}

/** `localhost` and anything under it never reach DNS. */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost')
}

export type AssertPublicUrlOptions = {
  readonly lookup?: LookupFn
  /**
   * Whether an unresolvable host is a hard failure. Defaults to `true` — unlike
   * reference implementations that fail open here, we pin the connection to the
   * addresses this check returns, so no addresses means no pinning, and letting
   * the request proceed would silently drop a control rather than merely fail.
   */
  readonly failClosed?: boolean
  /**
   * Hosts permitted to resolve to a non-public address.
   *
   * An allowlist rather than a blanket "allow private", because the two are not
   * remotely equivalent: a boolean opens every internal address to whatever URL
   * a model or a search result happens to produce, while this only unblocks
   * destinations an operator named. It exists because a service the operator
   * runs themselves — a SearXNG instance on the container network, a self-hosted
   * scraper — is otherwise unreachable by design.
   *
   * Matching is exact host or a dot-boundary suffix, so `internal.example.com`
   * covers `search.internal.example.com` but never `notinternal.example.com`.
   */
  readonly allowPrivateHosts?: readonly string[]
}

/** Exact host or a dot-boundary suffix; never a bare substring. */
export function isPrivateHostAllowed(hostname: string, allowlist: readonly string[] | undefined): boolean {
  if (!allowlist || allowlist.length === 0) return false
  const host = hostname.toLowerCase()
  return allowlist.some((entry) => {
    const allowed = entry.trim().toLowerCase()
    if (allowed.length === 0) return false
    return host === allowed || host.endsWith(`.${allowed}`)
  })
}

export type VettedUrl = {
  readonly url: URL
  /** Vetted addresses to pin the connection to; empty only when failClosed is off. */
  readonly addresses: readonly string[]
}

export async function assertPublicUrl(
  rawUrl: string,
  label = 'request',
  options: AssertPublicUrlOptions = {},
): Promise<VettedUrl> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new WebResearchError('ssrf_blocked', `Invalid URL for ${label}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebResearchError('ssrf_blocked', `Blocked URL scheme for ${label}: ${parsed.protocol}`)
  }
  if (parsed.username || parsed.password) {
    throw new WebResearchError('ssrf_blocked', `Credentials in URL are not allowed for ${label}`)
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  const privateAllowed = isPrivateHostAllowed(hostname, options.allowPrivateHosts)

  if (!privateAllowed && isLoopbackHostname(hostname)) {
    throw new WebResearchError('ssrf_blocked', `Blocked loopback host for ${label}: ${hostname}`)
  }

  if (isIP(hostname)) {
    if (!privateAllowed && isPrivateAddress(hostname)) {
      throw new WebResearchError('ssrf_blocked', `Blocked non-public address for ${label}: ${hostname}`)
    }
    return { url: parsed, addresses: [hostname] }
  }

  const lookup = options.lookup ?? defaultLookup
  const failClosed = options.failClosed ?? true
  let records: Array<{ address: string; family: number }>
  try {
    records = await lookup(hostname)
  } catch {
    if (failClosed) {
      throw new WebResearchError('ssrf_blocked', `Could not resolve host for ${label}: ${hostname}`)
    }
    return { url: parsed, addresses: [] }
  }
  if (records.length === 0) {
    if (failClosed) {
      throw new WebResearchError('ssrf_blocked', `Host did not resolve for ${label}: ${hostname}`)
    }
    return { url: parsed, addresses: [] }
  }
  for (const { address } of records) {
    if (!privateAllowed && isPrivateAddress(address)) {
      throw new WebResearchError(
        'ssrf_blocked',
        `Host ${hostname} resolves to non-public address ${address} for ${label}`,
      )
    }
  }
  return { url: parsed, addresses: records.map((record) => record.address) }
}
