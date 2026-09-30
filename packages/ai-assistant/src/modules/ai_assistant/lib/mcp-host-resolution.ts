/**
 * Shared bind-address resolution for the MCP servers (issue #2659, #2670). Loopback by
 * default; an explicit CLI flag or env var opts into a wider bind. Pulled out as pure
 * functions so the precedence and the loopback-alias set are unit-testable without
 * starting a listener.
 */

export const DEFAULT_MCP_HOST = '127.0.0.1'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * True for every hostname that already means "this machine only" — used to skip the
 * "binding beyond loopback" warning for a caller who wrote `localhost`/`::1` instead of
 * the canonical `127.0.0.1`, which is not the wider-exposure case that warning is for.
 */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase())
}

/**
 * Precedence: an explicit value (CLI flag or constructor option) wins, then the env var,
 * then the loopback default. Both inputs are trimmed; an empty string is treated as unset,
 * consistent with how the rest of the CLI reads optional string args/env vars.
 */
export function resolveMcpHost(explicitHost: string | undefined, envHost: string | undefined): string {
  const explicit = explicitHost?.trim()
  if (explicit) return explicit
  const fromEnv = envHost?.trim()
  if (fromEnv) return fromEnv
  return DEFAULT_MCP_HOST
}
