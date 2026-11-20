import { assertPublicUrl, type LookupFn } from '@open-mercato/web-research'
import { OTEL_EXPORT_ENV } from './exportSettings'

type EnvLike = Record<string, string | undefined>

export const OTEL_TENANT_ENDPOINT_BLOCKED = 'endpoint_blocked' as const

export type VetTenantOtlpEndpointResult =
  | { ok: true; url: string; addresses: string[] }
  | { ok: false; errorCode: typeof OTEL_TENANT_ENDPOINT_BLOCKED }

export type VetTenantOtlpEndpointOptions = {
  lookup?: LookupFn
}

/**
 * Hosts an operator permits to resolve to a non-public address, from the
 * comma-separated `OM_AGENT_OTEL_EXPORT_PRIVATE_HOSTS` (exact host or
 * dot-boundary suffix). Empty by default: every private address is denied.
 */
export function readOtelExportPrivateHosts(env: EnvLike = process.env): string[] {
  const raw = env[OTEL_EXPORT_ENV.privateHosts]
  if (typeof raw !== 'string') return []
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry !== ''),
    ),
  )
}

/**
 * SSRF gate for a tenant-supplied OTLP endpoint. Accepts only an http(s) URL
 * without userinfo whose host — literal or every DNS answer — is a public
 * address (loopback, link-local/metadata, private, CGNAT, multicast and
 * IPv4-mapped/NAT64/6to4 tunnels of those are rejected) unless the host is
 * allow-listed in `OM_AGENT_OTEL_EXPORT_PRIVATE_HOSTS`. Returns the vetted
 * addresses so the caller pins the connection to them, closing the
 * DNS-rebinding window. Never throws, and never logs or returns the reason, so
 * the endpoint does not leak through errors.
 */
export async function vetTenantOtlpEndpoint(
  url: string,
  env: EnvLike = process.env,
  options: VetTenantOtlpEndpointOptions = {},
): Promise<VetTenantOtlpEndpointResult> {
  try {
    const vetted = await assertPublicUrl(url, 'otel export', {
      allowPrivateHosts: readOtelExportPrivateHosts(env),
      failClosed: true,
      ...(options.lookup ? { lookup: options.lookup } : {}),
    })
    if (vetted.addresses.length === 0) return { ok: false, errorCode: OTEL_TENANT_ENDPOINT_BLOCKED }
    return { ok: true, url: vetted.url.toString(), addresses: [...vetted.addresses] }
  } catch {
    return { ok: false, errorCode: OTEL_TENANT_ENDPOINT_BLOCKED }
  }
}
