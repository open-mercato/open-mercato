# SSO authority ceiling

Extends: .ai/specs/enterprise/implemented/SPEC-ENT-002-2026-02-19-sso-directory-sync.md
Extends: .ai/specs/enterprise/implemented/SPEC-ENT-004-2026-02-19-sso-directory-sync.md

## TLDR

Issue #9014 allows an SSO config manager to grant permissions they cannot grant through auth commands and to impersonate existing accounts through a controlled identity provider. Store the config's authorizing user and apply their current grant ceiling during configuration, account linking, role synchronization, and final session issuance. SCIM additionally applies the token creator's current authority, including directory reads.

## Approved decision

On 2026-11-15 the operator approved nullable config authority tracking and a migration file, including reauthorization of existing configurations. No migration will be applied locally. All implementation remains inside the enterprise SSO module and reuses canonical core authorization helpers.

## Proposed solution

The server records the authenticated actor on successful configuration writes. A shared authorization service resolves the organization's real tenant, rejects missing or deleted authors, and checks mapping targets using the live role ACLs and canonical grant checks. Existing identity links receive the same account ceiling check as first-time email links. Legacy configurations and tokens without author provenance fail closed until explicitly reauthorized or replaced.

## Delta

- **Modified: configuration writes.** WHEN an actor creates, updates, activates, or changes domains, THEN every final mapping target must belong to the organization's tenant and be grantable by that actor. An issuer-only edit cannot retain mappings above the editor's authority. Disabling or deleting an unsafe configuration remains available for recovery.
- **Modified: SSO authentication.** WHEN an IdP assertion matches an existing email or identity, THEN its account's live role and direct ACL grants must fit the configuration author's current authority. A renamed privileged role, post-link promotion, missing author, or revoked permission cannot bypass this check.
- **Modified: SCIM mutations.** WHEN a token creates, links, changes, or deactivates an account, THEN both its creator and the config author must authorize the operation. A token issued by a weaker actor cannot borrow the config author's privileges. Directory reads also require current config/token authorship; the account privilege ceiling applies to mutations.
- **Added: final-session check.** WHEN provider configuration or privilege state changes during a callback, THEN final session issuance rechecks eligibility under the shared authorization locks and refuses stale provider configuration.

## Architecture

`SsoAuthorizationService` is an enterprise service injected through the existing DI container. It uses `RbacService` transaction-bound reads, canonical role/ACL/super-admin target checks, encryption-aware entity reads, and the existing authorization lock hierarchy. Configuration rows are locked before authorization rows. Existing-account operations discover the complete actor/target/role footprint before acquiring those locks together. Configuration and identity writes use the same transaction manager as the checks.

The SSO callback snapshots the provider configuration version before exchanging its assertion. The account-resolution and final-session transactions compare that snapshot with the locked current config. Password authentication retains its SSO deactivation checks and rechecks the credential snapshot under the user lock. It requires no config authority provenance.

Authorization returns the exact immutable mapped-role ID footprint to the role writer. Both pre-lock and post-refresh resolution must stay within it; a concurrently renamed role cannot enter a grant through another name lookup. Ambiguous normalized role names fail closed. New transaction-owned config/identity events are published after commit; event or telemetry failures cannot undo a committed write or create an unhandled rejection.

## Data model

Add nullable UUID `sso_configs.authorization_user_id`, represented by optional `SsoConfig.authorizationUserId`. It is a scalar reference, with no cross-module ORM relationship. No value is backfilled from an untrusted historic config or request payload. Existing `scim_tokens.created_by` records the authenticated issuing user and is propagated internally into SCIM scope. Tokens missing this value must be replaced.

The migration adds only the nullable config column. Existing `updated_at` continues versioning config edits. No migration is applied by this implementation task.

## API contracts

HTTP methods, request schemas, public response fields, ACL feature IDs, and event IDs remain unchanged. Provenance is server-managed and is not accepted from the body. `POST /api/sso/config`, `PUT /api/sso/config/:id`, activation/domain writes, and SCIM user/token mutations may now return the existing 403 error shape for authorization failures. OIDC failure retains the generic `sso_failed` redirect. SCIM failures retain its standard error resource.

New federated sessions store the issuing SSO configuration ID and version in nullable `sessions.sso_provenance`. Staff access-token validation and session refresh recheck the same configuration and current author and account authority against a fresh read-only PostgreSQL repeatable-read snapshot. Concurrent checks share neither the configuration row lock nor authorization writer locks. A check sees all authority changes committed before its snapshot starts. Disabled, deleted or modified configurations, lost authority and deactivated accounts deny both credentials. Users can sign in again after an authorized administrator resolves the configuration or authority issue. Password sessions use the existing path. Operators must review and revoke historical SSO sessions because those rows have no issuing configuration provenance.

## UI/UX

The existing settings page reports translated authorization refusals when saving general settings or role mappings, activating a configuration, or issuing a SCIM token. Administrators re-save an existing configuration through its current edit form, then revoke/reissue SCIM tokens. Existing translated error surfaces show the authorization failure without disclosing a target account's privileges.

## Migration & Backward Compatibility

Deploy the additive migration before application code. An authorized administrator must review the issuer, credentials, domains, and complete role mappings, then save every legacy config. Reissue legacy SCIM tokens under an authorized human account. Clients do not change payloads or URLs; direct service consumers must supply the server-authenticated actor and preserve the injected authorization checks.

Continuing to accept provenance-free mappings or account links would retain the exploit, so there is no insecure compatibility fallback. This security removal requires a named human maintainer's emergency compatibility approval before merge; automated review cannot grant it. The task's explicit schema approval authorizes implementation, not that merge waiver.

Operators must audit historical SSO role grants, linked identities, direct user ACLs, and sessions for unauthorized elevation. This prospective guard does not automatically undo historic grants or invalidate all sessions. Deploying old code reintroduces the vulnerability even if the column remains.

## Edge cases and failure scenarios

Missing/deleted/non-human/unconfirmed/deprovisioned authors, removed config/SCIM management permissions, unknown or cross-tenant mappings, protected targets, and null provenance fail closed. Author deactivation is evaluated in the author's own tenant/organization under the existing user locks. API-key principals are rejected before UUID user queries. A role named `superadmin` without privileged ACL flags is evaluated by its actual grants. A role with another name and `isSuperAdmin` is protected. Direct user grants count even when no privileged role is assigned. Nullable config tenants are resolved against the owning organization before provisioning.

## Risks & Impact Review

| Risk | Severity | Mitigation and residual impact |
| --- | --- | --- |
| Existing enterprise SSO stops until reauthorized | High | Document review/save and token replacement; keep password break-glass access and config disable/delete available. |
| Revoked authority reused by cached RBAC | High | Use transaction-bound uncached ACL reads under shared authorization locks. |
| Author/target/config changes race with session creation | High | Lock config before the complete authorization footprint; compare provider snapshot at final issuance. |
| Historical attacker-created grants survive | High | Require operator audit and session revocation; no automatic destructive remediation. |
| Test environment cannot exercise real PostgreSQL concurrency | Medium | Ship self-contained native integration coverage and disclose any unexecuted checks; retain manual QA gate. |

## Implementation plan

1. Characterize unchecked mappings, existing-account linking, stale identity links, and missing provenance with regression tests.
2. Add nullable config provenance, migration/snapshot, shared authorization checks, and config-write enforcement.
3. Enforce authority during SSO role synchronization and session issuance, and propagate SCIM token authorship through existing-account mutations.
4. Validate focused tests and the configured gate, document operator recovery, independently review, and publish one implementation PR.

## Integration coverage

- Configuration create/update, retained mappings on issuer edits, activation/domain changes, and legacy re-save.
- SCIM token provenance, creation/linking to protected targets, and PATCH/DELETE on subsequently elevated targets.
- OIDC first email link, existing identity link, JIT role mapping, and final-session config/authority drift.
- Concurrent protected staff requests for two users of one configuration complete while a separate transaction holds its row lock. Protected staff API and session refresh reject both users’ existing federated credentials after the issuing author loses authority. Password login and refresh continue.
- The SSO settings page displays the translated server refusal for a rejected save.
- Same-tenant organization isolation, nullable config tenant resolution, direct user ACL elevation, author demotion/deletion, and normalized role-name matching.

`TC-SSO-008-authority-ceiling.spec.ts` contains three self-contained native API scenarios for mapping/provenance enforcement, protected and subsequently elevated SCIM targets, cross-organization identity GET denial in both directions, and legacy recovery. Unit tests exercise OIDC linking/final-session denial, authorization-to-sync role drift, disabled authors, and transaction/event failure paths. Native runtime execution and real PostgreSQL concurrency remain unverified locally; no migration was applied.

## Final Compliance Report

Root, enterprise, auth, shared, and integration-test guides were reviewed. The design uses enterprise ownership, scalar cross-module IDs, tenant/organization scopes, canonical grant helpers, DI, translated errors, and existing routes/events. Schema implementation was explicitly approved on 2026-11-15; local migration application is excluded. Validation and independent review remain required. Named human compatibility sign-off and manual QA remain merge gates.

## Changelog

- 2026-11-15: Implemented approved provenance and live authority checks, exact mapped-role footprints, protected account/session/SCIM handling, migration/snapshot, regression coverage, and operator recovery documentation. Independent source review closed the role-selection race and related boundary issues. Validation, human compatibility sign-off, QA, and rollout are tracked separately.

- 2026-11-20: Added authority revalidation when using or refreshing federated sessions, plus translated error feedback in SSO settings. Switched access and refresh validation to a read-only snapshot and added concurrent request coverage.
