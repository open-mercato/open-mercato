// CIDR matching for known reverse-proxy IP ranges (Cloudflare, Fastly, custom).
// Used by the DNS verification fallback: if a domain's A record lands inside a
// known proxy range we fall back to a reverse-resolve over HTTPS, because the
// proxy hides the real origin from us.

const DEFAULT_CLOUDFLARE_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
]

type ParsedCidr = { network: number; mask: number; raw: string }

let cachedRanges: ParsedCidr[] | null = null

function parseIpv4(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let result = 0
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    const value = Number(part)
    if (value < 0 || value > 255) return null
    result = (result << 8) | value
  }
  // Force unsigned 32-bit
  return result >>> 0
}

function parseCidr(cidr: string): ParsedCidr | null {
  const [ip, prefixStr] = cidr.split('/')
  if (!ip || !prefixStr) return null
  const prefix = Number(prefixStr)
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return null
  const ipNum = parseIpv4(ip)
  if (ipNum === null) return null
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (ipNum & mask) >>> 0
  return { network, mask, raw: cidr }
}

function loadRanges(): ParsedCidr[] {
  if (cachedRanges) return cachedRanges
  const fromEnv = (process.env.KNOWN_PROXY_IP_RANGES ?? '').trim()
  const list = fromEnv
    ? fromEnv.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_CLOUDFLARE_RANGES
  cachedRanges = list.map(parseCidr).filter((v): v is ParsedCidr => v !== null)
  return cachedRanges
}

export function isInKnownProxyRange(ip: string): boolean {
  const ipNum = parseIpv4(ip)
  if (ipNum === null) return false
  for (const range of loadRanges()) {
    if (((ipNum & range.mask) >>> 0) === range.network) return true
  }
  return false
}

export function detectProxy(ip: string): string | null {
  if (!isInKnownProxyRange(ip)) return null
  // For now we only ship Cloudflare's published ranges by default. Operators
  // using a different proxy can override KNOWN_PROXY_IP_RANGES; we still
  // return 'unknown' for those so callers can phrase the diagnostic correctly.
  const fromEnv = process.env.KNOWN_PROXY_IP_RANGES
  if (!fromEnv) return 'cloudflare'
  return 'unknown'
}

export function resetProxyRangeCacheForTests(): void {
  cachedRanges = null
}
