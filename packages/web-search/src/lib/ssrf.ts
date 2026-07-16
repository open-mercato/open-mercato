import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { WebSearchProviderError } from './errors'

/** Resolves a hostname to one or more IP addresses. Injectable for tests. */
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
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null
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
    inRange('0.0.0.0', 8) ||        // "this" network
    inRange('10.0.0.0', 8) ||       // private
    inRange('100.64.0.0', 10) ||    // CGNAT
    inRange('127.0.0.0', 8) ||      // loopback
    inRange('169.254.0.0', 16) ||   // link-local + cloud metadata (169.254.169.254)
    inRange('172.16.0.0', 12) ||    // private
    inRange('192.0.0.0', 24) ||     // IETF protocol assignments
    inRange('192.168.0.0', 16) ||   // private
    inRange('198.18.0.0', 15) ||    // benchmarking
    inRange('224.0.0.0', 4) ||      // multicast
    inRange('240.0.0.0', 4)         // reserved
  )
}

function normalizeIpv6(address: string): string {
  const zoneIndex = address.indexOf('%')
  return (zoneIndex === -1 ? address : address.slice(0, zoneIndex)).toLowerCase()
}

function isPrivateIpv6(address: string): boolean {
  const normalized = normalizeIpv6(address)
  if (normalized === '::1' || normalized === '::') return true
  // IPv4-mapped (::ffff:a.b.c.d) — evaluate the embedded IPv4.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIpv4(mapped[1])
  const firstHextet = parseInt(normalized.split(':')[0] || '0', 16)
  if (Number.isNaN(firstHextet)) return true
  if ((firstHextet & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((firstHextet & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((firstHextet & 0xff00) === 0xff00) return true // ff00::/8 multicast
  return false
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family === 6) return isPrivateIpv6(address)
  return true // not a literal IP → treat as unsafe (must be resolved first)
}

export type AssertPublicUrlOptions = {
  lookup?: LookupFn
}

/**
 * Always-on SSRF guard. Enforces http(s), rejects credentials in the URL, and
 * resolves the hostname then requires *every* resolved address to be public
 * (defeats DNS rebinding at check time). Throws WebSearchProviderError on any
 * violation. This runs at the socket boundary and cannot be disabled by config.
 */
export async function assertPublicUrl(rawUrl: string, options: AssertPublicUrlOptions = {}): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new WebSearchProviderError('ssrf_blocked', 'Invalid URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebSearchProviderError('ssrf_blocked', `Blocked URL scheme: ${parsed.protocol}`)
  }
  if (parsed.username || parsed.password) {
    throw new WebSearchProviderError('ssrf_blocked', 'Credentials in URL are not allowed')
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new WebSearchProviderError('ssrf_blocked', `Blocked non-public address: ${hostname}`)
    }
    return parsed
  }

  const lookup = options.lookup ?? defaultLookup
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await lookup(hostname)
  } catch {
    throw new WebSearchProviderError('ssrf_blocked', `Could not resolve host: ${hostname}`)
  }
  if (addresses.length === 0) {
    throw new WebSearchProviderError('ssrf_blocked', `Host did not resolve: ${hostname}`)
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new WebSearchProviderError('ssrf_blocked', `Host ${hostname} resolves to non-public address ${address}`)
    }
  }
  return parsed
}
