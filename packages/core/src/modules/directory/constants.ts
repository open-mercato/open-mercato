/**
 * Re-export bridge. These values live in `@open-mercato/shared/lib/scope/cookies` so
 * that `shared` — which must not depend on `core` — can read the selection cookies
 * without inlining its own copies of the names and the sentinel.
 *
 * This import path is a public contract surface (BACKWARD_COMPATIBILITY.md §4), so it
 * keeps exporting exactly what it always did, plus the two cookie names that had no
 * canonical home before.
 */
export {
  ALL_ORGANIZATIONS_COOKIE_VALUE,
  SELECTED_ORGANIZATION_COOKIE,
  SELECTED_TENANT_COOKIE,
  isAllOrganizationsSelection,
} from '@open-mercato/shared/lib/scope/cookies'
export type { ScopeCookieName } from '@open-mercato/shared/lib/scope/cookies'
