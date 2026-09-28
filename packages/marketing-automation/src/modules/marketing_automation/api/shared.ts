import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

/**
 * The command context an authored change runs under.
 *
 * Unlike the campaign engine's own context (which is a system actor), this one carries the real
 * user: authoring a campaign is a human action and belongs in the audit log with a name on it.
 */
export function buildRequestCommandContext(
  container: AwilixContainer,
  // `AuthContext` itself includes `| null` in this codebase, so the non-null form is the
  // caller's promise that it already rejected an unauthenticated request.
  auth: NonNullable<AuthContext>,
  // Threaded so `enforceCommandOptimisticLock` can read the expected-version header. Without it a
  // command that relies on the header alone (delete) silently skips the check entirely.
  request?: Request,
): CommandRuntimeContext {
  return {
    container,
    auth,
    request,
    organizationScope: null,
    selectedOrganizationId: auth.orgId ?? null,
    organizationIds: auth.orgId ? [auth.orgId] : null,
  }
}
