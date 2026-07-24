export type AutoLoginCredentials = {
  email: string
  password: string
  tenantId: string | null
}

function readEnvValue(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Reads the optional demo-autologin credentials from env. When both
 * `OM_AUTOLOGIN_EMAIL` and `OM_AUTOLOGIN_PASSWORD` are set, the homepage hands
 * unauthenticated visitors to the autologin route which signs them in and drops
 * them into the app. Unset (the default) → `null` → normal login flow.
 *
 * `OM_AUTOLOGIN_TENANT` is optional and only needed when the same email exists
 * across multiple tenants. Pure: pass the env bag so it stays testable.
 */
export function resolveAutoLoginCredentials(
  env: Record<string, string | undefined> = process.env,
): AutoLoginCredentials | null {
  const email = readEnvValue(env, 'OM_AUTOLOGIN_EMAIL')
  const password = env.OM_AUTOLOGIN_PASSWORD ?? ''
  if (!email || !password) return null
  const tenantId = readEnvValue(env, 'OM_AUTOLOGIN_TENANT')
  return { email, password, tenantId: tenantId || null }
}

/** True when demo autologin credentials are configured via env. */
export function isAutoLoginEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return resolveAutoLoginCredentials(env) !== null
}
