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
