import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { isInternalHost } from './credentials'

export type HostLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>

const INTERNAL_RESOLVED_MESSAGE =
  'Host resolves to a private or loopback address. If this is intentional, an operator must set OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS=true.'

const UNRESOLVABLE_MESSAGE = 'Host did not resolve to any address.'

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/**
 * Resolve `host` to an IP and assert every resolved address is public, then pin
 * the connection to that IP. Closes the DNS-rebinding gap the string-only SSRF
 * guard (`isInternalHost`) leaves open: a public hostname that resolves — or is
 * rebound between validation and connect — to an internal address is rejected
 * here, and the returned IP is what the caller actually connects to (no second
 * lookup the attacker could race).
 *
 * - Literal IPs (already SSRF-checked by the credential schema) are returned
 *   unchanged with no `servername`.
 * - Hostnames are resolved to every A/AAAA record; if ANY resolved address is
 *   internal the call throws. The validated IP is returned as `host` and the
 *   original hostname as `servername`, so TLS SNI + certificate hostname
 *   verification still target the real host even though we dial the IP.
 * - Honors `OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS`: when set, resolution is
 *   skipped and the host is used verbatim (operators with a genuinely internal
 *   mail server).
 */
export async function resolveSafeHostAddress(
  host: string,
  options: { lookup?: HostLookup } = {},
): Promise<{ host: string; servername?: string }> {
  const trimmed = host.trim()
  if (parseBooleanWithDefault(process.env.OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS, false)) {
    return { host: trimmed }
  }
  if (isIP(stripBrackets(trimmed)) !== 0) {
    if (isInternalHost(trimmed)) throw new Error(`[internal] ${INTERNAL_RESOLVED_MESSAGE}`)
    return { host: trimmed }
  }
  const resolve =
    options.lookup ?? ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }))
  const records = await resolve(trimmed)
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`[internal] ${UNRESOLVABLE_MESSAGE}`)
  }
  for (const record of records) {
    if (isInternalHost(record.address)) {
      throw new Error(`[internal] ${INTERNAL_RESOLVED_MESSAGE}`)
    }
  }
  return { host: records[0].address, servername: trimmed }
}
