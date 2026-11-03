# Extension Verification

Load this reference after implementing the selected mechanism.

- Confirm no installed/generated file changed and app module ownership is clear.
- Confirm resolved host tokens match the installed version and generated facts.
- Test host present and absent, authorized/denied/wildcard users, two scopes, and direct API access without UI.
- Test list/detail/create/update/delete/action legs that the extension touches.
- Test timeout/failure fallback, retry/idempotency, cache hit/miss, and search/index behavior where relevant.
- Run `yarn generate`, focused tests, typecheck, and affected integration flow.
- Disable/replace branches must remove stale navigation/cache/registry behavior and retain a safe backend landing route.
