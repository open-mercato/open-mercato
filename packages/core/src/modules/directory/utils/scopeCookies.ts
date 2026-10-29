/**
 * Re-export bridge. The parsers live in `@open-mercato/shared/lib/scope/cookies`, next
 * to the cookie names they read, so `shared` and `core` cannot drift apart on what a
 * blank selection cookie means. That module documents the blank-value semantic these
 * two have always had: blank reads the same as absent, i.e. "no selection".
 *
 * This import path is a public contract surface (BACKWARD_COMPATIBILITY.md §4) and is
 * additionally re-exported from `./organizationScope`; both keep working unchanged.
 */
export {
  parseSelectedOrganizationCookie,
  parseSelectedTenantCookie,
} from '@open-mercato/shared/lib/scope/cookies'
