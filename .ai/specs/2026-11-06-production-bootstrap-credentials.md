# Production bootstrap credentials (#7809)

## TLDR
Production `mercato init` requires an explicit, non-placeholder superadmin password that satisfies the configured shared password policy. Non-production initialization keeps its existing defaults.

## Overview and Problem Statement
The CLI defaults to `secret`; starter and generated-app full-app Compose flows default to `password`. Init bypasses password policy by default, allowing production bootstrap with a predictable privileged credential. The user explicitly limited enforcement to production and authorized takeover of #7809 on 2026-11-06.

## Proposed Solution and Architecture
Resolve credentials in the CLI's existing init-secrets helper. Normalize `NODE_ENV` with trimming and lowercase, consistent with derived-account secrets. Only `production` enables enforcement. Reject missing, blank, and known built-in placeholder passwords and apply `getPasswordPolicy` / `validatePassword`. Production never forwards either password-policy bypass alias; non-production retains existing defaults and explicit flags.

Validate before database work for normal init and reinstall. For `--skip-if-initialized` without reinstall, allow the existing database preflight to return successfully without bootstrap credentials; validate before generators or account creation if initialization is needed. Operator diagnostics use locale dictionaries selected by LC_ALL, LC_MESSAGES, or LANG, with English fallback; the CLI build ships those dictionaries. Both full-app Compose distributions retain their development fallback, which the production guard rejects. The root compatibility duplicate stays aligned.

## Data Models and API Contracts
No schema, API, ACL, event, or direct `mercato auth setup` contract changes. Existing accounts are not modified. No new dependencies or provider configuration.

## Migration & Backward Compatibility
This intentionally narrows production CLI bootstrap behavior. Operators must set a unique `OM_INIT_SUPERADMIN_PASSWORD` or `--password` satisfying `OM_PASSWORD_*`; bypass flags no longer permit unsafe production initialization. Client scripts should handle a nonzero init result and provide credentials securely. Already-initialized skip checks remain unchanged. Non-production callers keep their defaults.

The emergency security exception in BACKWARD_COMPATIBILITY.md is requested for the production acceptance of built-in privileged credentials and policy bypass: bridging that production behavior would preserve the vulnerability. A named human maintainer must approve the waiver before merge. UPGRADE_NOTES.md documents migration and rotation of existing predictable credentials. No automatic rotation or database migration is performed.

## Risks & Impact Review
- High: deployments relying on built-in production credentials stop at initialization. Mitigation: actionable error and migration guidance; supply credentials before boot.
- High: databases initialized previously may retain exposed credentials. Mitigation: require operators to rotate them; this patch cannot infer prior exposure.
- Medium: treating production like development would bypass enforcement. Mitigation: both full-app distributions default NODE_ENV to production; production detection and non-production behavior have explicit tests.
- Low: repeated setup might unnecessarily require credentials. Mitigation: initialized-database skip returns before credential enforcement.

## Implementation and Validation Plan
- [x] Inspect current CLI and Compose paths and prior closed PR #8175.
- [x] Add production-only credential resolution and preserve non-production defaults.
- [x] Add unit and real CLI-path regression coverage for missing/placeholders, policy customization, argument precedence, bypass aliases, valid production bootstrap, reinstall safety, existing-database skip, and both Compose defaults.
- [ ] Complete available validation and PR review; record limitations in the PR.

No API or UI path changes; integration coverage exercises `run()` with isolated mocked database/module dependencies. No live migrations are applied.

## Final Compliance Report
Uses shared password-policy helpers, modifies no tenant data access, adds no dependencies, and preserves development behavior. Human maintainer security-exception approval and QA remain merge gates.

## Changelog
- 2026-11-06: Production-only fix and regression tests prepared for #7809.
