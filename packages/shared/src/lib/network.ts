import { isIP } from 'node:net'

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'broadcasthost',
])

export function isPrivateIpAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIPv4(address)
  if (family === 6) return isPrivateIPv6(address)
  return false
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return true
  if (BLOCKED_HOSTNAMES.has(normalized)) return true
  if (normalized.endsWith('.localhost')) return true
  if (normalized.endsWith('.internal')) return true
  if (normalized.endsWith('.local')) return true
  return false
}

export function isPrivateUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  const hostname = normalizeHostname(url.hostname)
  if (isBlockedHostname(hostname)) return true
  return isPrivateIpAddress(hostname)
}

function normalizeHostname(hostname: string): string {
  let normalized = hostname.trim().toLowerCase()
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1)
  }
  while (normalized.endsWith('.')) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map((part) => Number(part))
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false

  const [a, b, c] = octets
  if (a === 0) return true
  if (a === 10) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true
  if (a === 192 && b === 168) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51 && c === 100) return true
  if (a === 203 && b === 0 && c === 113) return true
  if (a >= 224) return true
  return false
}

function isPrivateIPv6(address: string): boolean {
  const segments = expandIPv6(address)
  if (!segments) return false

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
