export type ExamplePortalAccount = {
  email: string
  displayName: string
  password: string
  roleSlug: string
}

/**
 * Portal accounts created by the module's `seedExamples` hook. Setup seeds from
 * this list and the admin demo-credentials endpoint reports against it, so the
 * advertised credentials can never drift from the seeded ones (#3198) and are
 * only surfaced for accounts that actually exist in the current scope (#5669).
 */
export const EXAMPLE_PORTAL_ACCOUNTS: readonly ExamplePortalAccount[] = [
  { email: 'alice.johnson@example.com', displayName: 'Alice Johnson', password: 'Password123!', roleSlug: 'portal_admin' },
  { email: 'bob.smith@example.com', displayName: 'Bob Smith', password: 'Password123!', roleSlug: 'buyer' },
  { email: 'carol.white@example.com', displayName: 'Carol White', password: 'Password123!', roleSlug: 'viewer' },
] as const


// Production demo accounts require an operator-managed secret. Their credentials
// are intentionally absent from the demo account listing.
export function resolveExamplePortalSeedPassword(
  account: ExamplePortalAccount,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.NODE_ENV?.trim().toLowerCase() !== 'production') return account.password

  const password = env.OM_INIT_PORTAL_DEMO_PASSWORD
  if (!password?.trim()) return undefined
  if (password.trim().length < 24 || Buffer.byteLength(password) > 72) {
    throw new Error('[internal] OM_INIT_PORTAL_DEMO_PASSWORD must contain at least 24 characters and at most 72 UTF-8 bytes')
  }
  return password
}

export function isPublicExamplePortalCredential(email: string, password: string): boolean {
  if (process.env.NODE_ENV?.trim().toLowerCase() !== 'production') return false
  return EXAMPLE_PORTAL_ACCOUNTS.some((account) => account.email === email.trim().toLowerCase() && account.password === password)
}
