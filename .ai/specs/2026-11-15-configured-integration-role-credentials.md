# Configured integration role credentials
Status: proposed
Issue: #8475

## Problem and outcome
Native integration helpers use configured superadmin credentials but hard-code admin and employee seed credentials. Disposable deployments initialized with custom actors fail authentication before product assertions run. Native helpers must consume the same optional role-specific initialization variables.

## Scope and decisions
At module import, DEFAULT_CREDENTIALS resolves OM_INIT_ADMIN_EMAIL, OM_INIT_ADMIN_PASSWORD, OM_INIT_EMPLOYEE_EMAIL and OM_INIT_EMPLOYEE_PASSWORD through the existing loadEnvValue helper. Process environment wins over the existing app/root env-file lookup. Unset or empty resolved values retain admin@acme.com / employee@acme.com and the existing seeded password. Each field resolves independently. Superadmin behavior and explicit login argument behavior remain unchanged.

No application passwords are created or changed. No credentials may appear in diagnostics, screenshots, plans or tracker comments. Configuration must be supplied before importing the helper; changing environment after import requires a new worker.

## Migration & Backward Compatibility
Additive support for variables already used by the initializer. Existing exports, role names, login signatures and seeded fallback behavior remain stable. No migration, production dependency, API, database or permission changes. Operators opt in by providing environment variables to the native test process; no action is needed for seeded runs.

## Implementation plan
1. Add optional admin/employee resolution alongside existing superadmin resolution.
2. Add isolated module-load regression tests for defaults, process overrides, env-file fallback, precedence, partial configuration and explicit login behavior.
3. Document the four variables in the native integration CLI guide and validate the unchanged customer-account create-organization scenario when a disposable app is available.

## Integration coverage
The changed surface is a test helper, with no affected product API or UI routes. Existing TC-CACC-CREATE-ORG-001 remains the end-to-end consumer; its fixtures/assertions must remain unchanged. Unit tests verify role credential resolution without logging credential values. A controlled login request regression verifies the resolved credentials reach /api/auth/login. Live native scenario results must be disclosed separately from unit results.

## Risks and validation
Environment files can contain secrets; never print their content. Existing first-nonempty-env-file lookup semantics are preserved rather than changed globally. Run core helper tests and applicable build/typecheck gates. Existing unrelated gate failures must remain explicit.

## Open questions
None. Autonomous default: reuse existing OM_INIT role variables, avoiding a second configuration vocabulary.

## Changelog
- 2026-11-15: Defined additive native role-credential configuration before implementation.
