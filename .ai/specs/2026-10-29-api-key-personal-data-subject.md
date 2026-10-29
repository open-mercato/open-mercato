# API-key personal data subject

Issue: #7261

## Scope

Correct personal dashboard and profile reads for user-bound API keys without changing the authentication principal. `auth.sub` remains `api_key:<id>` for authorization, audit, and mutation guards. Personal data uses the bound `auth.userId`, validated against a live user in the key's tenant and, when present, organization. Unbound, malformed, deleted, and out-of-scope bindings receive 403 before personal data access.

## Behavior

- `GET /api/auth/profile` returns the bound user's email and name, with the key's existing roles.
- `GET /api/dashboards/layout` uses the bound user's layout and widget preferences, filtered by the key's effective features. API-key reads never persist pruning or defaults: a restricted key must not erase the user's broader saved layout.
- When the widget registry is temporarily empty, API-key reads return an empty transient layout without exposing saved widget settings. Interactive callers retain their existing recovery fallback.
- Dashboard layout PUT and item PATCH use the same data subject, but check permissions and run mutation guards under the API-key actor.
- Profile PUT requires an interactive session. It issues a user session cookie and must not exchange a restricted API key for the creator's full user session.
- Bearer/cookie behavior remains unchanged.

## Sibling audit

Sidebar preferences and variants already distinguish `auth.userId` from the actor. Feature checks, navigation, widget data permission checks, and admin widget assignment routes use `auth.sub` for authorization/audit and retain that behavior. No global subject rewrite is introduced.

## Migration & Backward Compatibility

Existing URLs, response shapes, authentication payloads, API-key actors, ACL features, and database schema remain stable. Previously failing personal API-key requests gain controlled behavior. There is no migration or dependency change.

## Validation

Route tests cover bound/unbound keys, malformed and stale bindings, tenant/organization denial, key-only permissions and roles, guard attribution, profile session-exchange denial, and unchanged interactive behavior. An API integration scenario creates its own user, role, and API keys, compares bearer/cookie and key reads on both endpoints, verifies a restricted key cannot configure the layout or update credentials, and cleans up fixtures.

## Changelog

- 2026-10-29: Documented the scoped correction and regression coverage for #7261.
- 2026-10-29: Verified and corrected the empty-registry API-key fallback after independent security review.
