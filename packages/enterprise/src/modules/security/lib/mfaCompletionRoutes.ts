import { registerMfaPendingAccessRoutes } from '@open-mercato/shared/lib/auth/mfaPendingAccess'

const CANONICAL_MFA_COMPLETION_ROUTES = [
  { path: '/api/security/mfa/prepare', methods: ['POST'] },
  { path: '/api/security/mfa/verify', methods: ['POST'] },
  { path: '/api/security/mfa/recovery', methods: ['POST'] },
]

let registered = false

/**
 * Register the canonical MFA challenge-completion routes with the platform-wide pending-token
 * allowlist. The enterprise security module owns these routes, so it owns their registration:
 * shared stays generic (SPEC-ENT-007 § Amendment 2026-08-21). Idempotent; runs once per process
 * on first import of this module — which happens at security-module bootstrap and, as a
 * belt-and-braces guarantee, on every load of the completion route modules themselves, so the
 * routes are always registered before request authentication resolves.
 */
export function registerCanonicalMfaCompletionRoutes(): void {
  if (registered) return
  registerMfaPendingAccessRoutes(CANONICAL_MFA_COMPLETION_ROUTES)
  registered = true
}

registerCanonicalMfaCompletionRoutes()
