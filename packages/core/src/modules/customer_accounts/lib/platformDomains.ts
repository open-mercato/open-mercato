/**
 * Parse the `PLATFORM_DOMAINS` env into a normalized list of platform hostnames.
 *
 * Platform hosts are the deployment's own domains (admin app, marketing site,
 * loopback). Custom-domain routing MUST treat platform hosts as non-tenant
 * traffic, so domain registration, resolver lookups, and tenant-context
 * fallbacks all share the same view of which hosts are platform-owned.
 */
export function platformDomains(): string[] {
  return (process.env.PLATFORM_DOMAINS ?? 'localhost,openmercato.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}
