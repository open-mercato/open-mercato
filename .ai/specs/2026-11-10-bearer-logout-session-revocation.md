# Bearer logout revokes the selected staff session

## TLDR
Staff API clients must be able to revoke their authenticated session by sending their existing bearer JWT to `POST /api/auth/logout`. The route currently selects only cookies, so a bearer-only call redirects while its session remains usable.

## Proposed solution
Use the same case-insensitive bearer selection and cookie fallback as staff authentication, then reuse the route's existing verified staff JWT `sid` revocation path. Preserve cookie-based logout, anonymous redirects and sibling sessions.

## Migration & Backward Compatibility
The route, response, cookie and token formats remain unchanged. No database migration or consumer upgrade is required. Existing bearer-only callers gain the expected session revocation; cookie-based callers retain their current behavior. No deprecation or removed public surface is proposed.

## Architecture and data model
The auth module's existing logout route performs credential selection, `verifyJwt` verifies claims, and `AuthService.deleteSessionById` revokes the selected session. Refresh-cookie revocation continues through `deleteSessionByToken`. No entities, migrations, DI keys, permissions or cross-module relationships are added.

## API contracts and failure cases
- `POST /api/auth/logout` accepts the existing optional bearer header and existing session cookies; its redirect remains 303 to the safe login URL.
- A nonempty bearer credential takes precedence over an unrelated auth cookie. Empty or absent bearer credentials fall back to the auth cookie.
- Invalid, expired, customer or sessionless bearer tokens cannot select a staff session for deletion. A supplied refresh cookie still follows the existing revocation path.
- A request with no credentials remains a redirect without clearing cookies. Revocation failures retain existing telemetry and cookie cleanup.

## Integration and UI coverage
`packages/core/src/modules/auth/__integration__/TC-AUTH-067-logout-without-access-token.spec.ts` creates its own role/user and exercises login, logout, protected profile and refresh routes. Its bearer case verifies access and refresh rejection after logout and continued usability of another session. The same suite covers refresh-only, unusable-access and cookieless requests, including repeated logout and fixture cleanup. Unit cases in `api/__tests__/logout.test.ts` cover bearer casing, mixed-credential precedence, unusable tokens and preserved cookie behavior. Browser QA must retain normal login/logout, locales and mobile coverage; API-only credentials require direct API verification. Existing PARTIAL browser evidence is supporting evidence until required gaps are completed.

## Risks and impact review
Selecting an unverified or customer token could revoke an unrelated session; only verified staff claims are used, with negative regression cases. Cookie behavior could regress when credentials coexist; precedence and refresh-only regressions cover that boundary. This fix adds no amount, stock, architecture or authorization-grant changes. Removing a public run inventory does not erase earlier Git history or change any security-advisory state.

## Implementation plan
1. Select bearer credentials before the existing auth cookie and preserve existing revocation behavior.
2. Ship unit and self-contained integration coverage for revocation, negative credentials and sibling-session preservation.
3. Keep public documentation scoped to this fix; complete ordinary review, current-head CI and required QA before merging.

## Final compliance report
The implementation and existing tests match this specification. No new entity needs optimistic locking, no discovery file is introduced, and public session/token formats remain intact. Source approval and CI remain independent of formal QA; this document grants no approval.

The target branch's current 303 See Other logout redirect and navigation regression remain intact after the conflict resolution.

## Changelog
- 2026-11-10: Document the existing bearer logout contribution and replace its public run inventory with scoped contract and coverage documentation.
