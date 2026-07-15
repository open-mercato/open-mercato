// SSRF guard for the user-supplied Tillio API URL. `apiUrl` comes from integration
// credentials, so before createTillioClient ever fetches it we reject non-http(s)
// schemes and hosts that are loopback / private / link-local IP literals (cloud
// metadata endpoints, internal services). A hostname that DNS-resolves to a private
// address would still need a resolution-time guard; that is intentionally out of
// scope here (documented as a follow-up).

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

function parseIpv4Octets(hostname: string): number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN))
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null
  return octets
}

function isPrivateOrLocalIpv4(octets: number[]): boolean {
  const [first, second] = octets
  if (first === 0) return true // 0.0.0.0/8 "this" network
  if (first === 127) return true // loopback 127.0.0.0/8
  if (first === 10) return true // RFC1918 10.0.0.0/8
  if (first === 172 && second >= 16 && second <= 31) return true // RFC1918 172.16.0.0/12
  if (first === 192 && second === 168) return true // RFC1918 192.168.0.0/16
  if (first === 169 && second === 254) return true // link-local 169.254.0.0/16 (metadata)
  return false
}

function isPrivateOrLocalIpv6(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === '::1' || host === '::') return true // loopback / unspecified
  if (host.startsWith('fe80')) return true // link-local fe80::/10
  if (host.startsWith('fc') || host.startsWith('fd')) return true // unique-local fc00::/7
  const mappedDotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mappedDotted) {
    const octets = parseIpv4Octets(mappedDotted[1]!)
    if (octets && isPrivateOrLocalIpv4(octets)) return true
  }
  // Node normalizes ::ffff:127.0.0.1 to its hex form (::ffff:7f00:1).
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedHex) {
    const high = parseInt(mappedHex[1]!, 16)
    const low = parseInt(mappedHex[2]!, 16)
    const octets = [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff]
    if (isPrivateOrLocalIpv4(octets)) return true
  }
  return false
}

export function assertPublicTillioApiUrl(rawUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Tillio API URL is not a valid URL.')
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('Tillio API URL must use the http or https protocol.')
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (!hostname) {
    throw new Error('Tillio API URL is missing a host.')
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Tillio API URL host is not allowed (loopback).')
  }
  const ipv4 = parseIpv4Octets(hostname)
  if (ipv4) {
    if (isPrivateOrLocalIpv4(ipv4)) {
      throw new Error('Tillio API URL host resolves to a private or loopback address.')
    }
  } else if (hostname.includes(':') && isPrivateOrLocalIpv6(hostname)) {
    throw new Error('Tillio API URL host resolves to a private or loopback address.')
  }
}
