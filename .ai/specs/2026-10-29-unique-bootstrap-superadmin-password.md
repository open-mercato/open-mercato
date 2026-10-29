# Unique Bootstrap Superadmin Password

## TLDR

Issue [#7809](https://github.com/open-mercato/open-mercato/issues/7809) identifies predictable superadmin credentials in first-run Docker and CLI initialization. Require an explicit, non-placeholder password that passes the configured password policy before dependency installation, generation, or database writes; first-party automated bootstrap callers must supply unique credentials.

## Overview

The change covers `mercato init`, starter and generated-app full-app Compose flows, and existing automated bootstrap callers that would otherwise rely on the removed default. Development variants and legacy root duplicates are included. Existing accounts require operator review and rotation; initialization does not change their passwords automatically.

## Problem Statement

The starter and generated-app Compose files resolve an omitted `OM_INIT_SUPERADMIN_PASSWORD` to `password`. Independently, the CLI defaults the superadmin email to `superadmin@acme.com`, defaults its password to `secret`, and enables password-policy bypass unless explicitly disabled. An operator following first-run setup can therefore create a privileged account with a known credential. Public exposure depends on deployment networking; the issue was identified from configuration and code, without accessing a deployment.

Password resolution currently occurs after initialization has already performed install/generation/migration work, and after table deletion in reinstall mode. Rejecting credentials only in the downstream auth command would fail too late.

The cross-platform starter also writes `secret` into new root `.env` files and copies it into the app environment. Existing ephemeral and package-preview initialization callers rely on omitted credentials. Those callers must supply unique values so the strengthened CLI does not break their bootstrap flows.

## Proposed Solution

Remove the `secret` CLI fallback and `password` Compose fallback. Resolve and validate the bootstrap password before dependency installation, generation, migration, or destructive reinstall operations. Initialization policy-bypass flags cannot disable superadmin password validation.

Use the existing shared password-policy implementation rather than inventing a separate policy. Reject known bootstrap placeholders independently of configurable policy strength. Apply the same rules in every environment so a deployment cannot regain the predictable default by changing `NODE_ENV`.

Generating a new default inside `mercato init` is outside this fix: it would require a new delivery and retrieval contract. Direct callers supply credentials through existing environment/CLI inputs. The cross-platform starter can use its existing machine-local environment-file mechanism, and ephemeral/preview callers can supply a credential for their disposable run.

## Architecture

The CLI owns credential resolution and early validation. An explicit `--password` takes precedence over `OM_INIT_SUPERADMIN_PASSWORD`; an explicit empty argument is invalid rather than an invitation to fall back. Validation failures return a non-zero result and do not print the rejected password. Normal initialization may perform a read-only existing-user probe first so an established Docker database can follow its existing migration-recovery path. Database creation/mutation and installation/generation remain gated by valid credentials; reinstall validates before any database access or deletion.

After validation, initialization calls the existing auth setup command with the validated password and without a policy-bypass argument. Tenant creation, password hashing, role seeding, and derived demo-account behavior continue through their existing implementations. The standalone `mercato auth setup` command retains its own documented flags.

All four canonical full-app Compose files pass an empty value when the bootstrap variable is unset. The two legacy root duplicates mirror their starter equivalents. Required Compose interpolation is intentionally avoided: an already-initialized stack following its normal marker/migration path does not need a bootstrap credential merely to restart.

`packages/starter/src/env-setup.mjs` replaces its fixed password with a value containing 32 random bytes from the existing `secretHex` helper plus characters guaranteeing the default policy's required classes. It writes the same generated value to root/app environments through existing fill-missing-only helpers; reruns and explicit company defaults never rotate it. Setup logs a fingerprint for this key. The generated value is 68 characters long and satisfies the default policy. Rather than importing workspace TypeScript dependencies into this pre-install, Node-stdlib-only package or duplicating policy parsing, custom minimum lengths above 68 require an explicit compliant value.

Railway deployment generates a unique 68-character bootstrap password alongside its protected secrets when neither local nor existing Railway variables provide a nonblank value. Existing values are preserved; `--write-env` persists generated values in the ignored local environment file, including blank placeholders. Dry-run and completion output disclose only the variable name and retrieval location. For custom minimum lengths above 68, operators provide a compliant explicit value. Both application `.env.example` files document the required credential for local setup and greenfield/reinstall paths.

Both hybrid and Docker starter success summaries use one formatter that reads the email and points to `OM_INIT_SUPERADMIN_PASSWORD` in root/app `.env` files without reading or printing the password. The environment-file writer creates new files with owner-only read/write mode (`0600`) on POSIX; existing permissions remain unchanged. Operators retrieve the credential locally from those files. The existing initial `mercato init` completion output is outside this summary change.

The integration runner and dev-ephemeral entrypoint supply an ephemeral password when the environment key is absent or blank, preserving nonblank explicit values for CLI validation. Snapshot/package-preview initialization similarly receives a run-specific credential. These are compatibility updates to existing consumers of `mercato init`, with no new bootstrap mode or pipeline behavior.

## Data Models

No entity, database column, migration, encryption map, or persisted credential format changes. Existing auth storage and hashing remain responsible for password persistence. The starter retains generated bootstrap credentials in its existing uncommitted environment files. No existing account password is overwritten or automatically rotated.

## API Contracts

No HTTP API, response schema, event, ACL feature, DI registration, or generated-registry contract changes.

`mercato init` and `yarn initialize` retain their command names and credential inputs. Their credential-validation behavior narrows: missing, empty, known-placeholder, and policy-invalid passwords fail before initialization side effects. The legacy init policy-bypass aliases cannot relax superadmin validation. `--help` remains free of initialization side effects.

## Edge Cases & Failure Scenarios

| Trigger | Required behavior |
|---------|-------------------|
| Variable and CLI password both omitted, empty, or whitespace-only | Abort before installation, generation, database creation/mutation, migrations, auth setup, or reinstall deletion; a normal-init read-only existing-user probe may precede validation |
| Known placeholder under a deliberately weakened policy | Reject the placeholder independently of the policy configuration |
| Explicit invalid CLI value with a valid environment password | Reject the explicit value; do not fall back silently |
| Invalid password with either init bypass alias | Reject using the same validation rules |
| Valid operator password | Forward it to existing auth setup without bypassing policy |
| Already-initialized Compose deployment with no bootstrap variable | Continue through the existing restart/migration path |
| Fresh starter environment | Generate a unique default-policy-compliant password, copy the same value into the app environment, and preserve it on reruns |
| Explicit starter/company credential, including a known placeholder | Preserve the configured value; CLI validation decides whether initialization can proceed |
| Custom minimum length above the starter's generated length | Supply an explicit compliant value; CLI validation remains authoritative |
| Ephemeral caller with a blank credential | Treat the blank placeholder as unset and generate a unique credential |
| Ephemeral caller with a nonblank invalid credential | Preserve it so CLI validation fails; do not silently replace operator configuration |
| Deployment previously initialized with a predictable credential | Require operator review and rotation through existing account-management/reset flows; changing the environment alone does not rotate it |

## Risks & Impact Review

| Severity | Scenario and affected area | Mitigation | Residual risk |
|----------|---------------------------|------------|---------------|
| High | Automation or development setup relies on omitted/default credentials and stops initializing | Document the new requirement and validate before expensive or destructive work | Operators must update initialization scripts and secret provisioning |
| High | Existing accounts retain earlier predictable credentials after upgrading | Explicit operator rotation instructions in upgrade and deployment docs | Upgrading alone cannot establish whether an old credential was exposed |
| High | A deprecation bridge preserves exploitable bootstrap behavior | Remove the vulnerable branches without a bypass toggle; require the security exception acknowledgment below | Human maintainer approval remains a merge prerequisite |
| Medium | A valid password is reused or guessable despite passing policy | Require a unique deployment password in operator instructions; reuse shared policy and reject known placeholders | Policy validation cannot prove uniqueness or randomness |
| Medium | A customized minimum exceeds the starter's generated 68-character password | Document explicit override through `.env` or company defaults; keep final shared-policy validation in the CLI | Operators with that custom minimum must supply a suitable value |
| Low | Compose validation incorrectly blocks established deployments | Pass through an empty variable and leave initialized restart/migration behavior intact | Custom entrypoints that always invoke init must supply a valid password |

## Migration & Backward Compatibility

The CLI credential inputs remain available, but the insecure default and init policy-bypass behavior are removed. This is an intentional security narrowing under [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md#emergency-security-exception).

The old default and bypass are the vulnerable provisioning paths themselves. Keeping them for a bridge release would keep issue #7809 reachable, so deprecation steps 1–3 cannot preserve those branches safely. The change is limited to this initialization requirement and necessary updates to existing first-party consumers; standalone `auth setup`, account storage, APIs, and schema are unchanged.

Before first initialization or deliberate reinstall, operators must supply a unique policy-compliant password using `OM_INIT_SUPERADMIN_PASSWORD` or explicit `--password`. Client automation must handle rejection as a non-zero command result and stop relying on init bypass flags. Initialized deployments can restart and migrate normally without supplying a bootstrap password. Operators must review accounts created by earlier flows and rotate any predictable or reused credentials through existing account-management or password-reset mechanisms. Updating the bootstrap environment does not alter an existing account; reinstall is not a credential-rotation mechanism.

The release must include the corresponding `UPGRADE_NOTES.md` instructions and dated compatibility entry. The PR must carry `security` and a **named human maintainer approval explicitly acknowledging the emergency waiver**. That acknowledgment remains pending; neither this specification nor automated review asserts it. Rolling back to the previous bootstrap implementation would restore the vulnerable behavior and is not a safe mitigation.

## Validation Coverage

Regression coverage must exercise the actual `mercato init` dispatch path in addition to any extracted validation helper:

- Missing, empty, whitespace-only, known-placeholder, and policy-invalid values fail; no install, generator, database-creation/mutation, or auth setup calls execute. Reinstall rejection precedes all database access; normal initialization may first probe for existing users read-only.
- Both legacy bypass aliases fail to permit invalid operator passwords.
- A compliant CLI password takes precedence and reaches auth setup without policy bypass; valid environment input also works.
- Starter, generated-app, development, and root Compose files contain no predictable fallback; root duplicates retain parity.
- Existing initialized restart/migration script behavior remains covered by the init-or-migrate tests.
- Fresh starter environments receive different compliant passwords with identical root/app copies; reruns and explicit credentials remain unchanged, and setup logs do not contain the password.
- Starter summary output for generated/configured credentials includes the email and environment-file location while excluding the password; both actual success callsites must use that formatter. POSIX tests verify new root/app environment files use `0600` and existing permissions remain unchanged.
- Ephemeral helper and caller tests cover absent/blank-key generation, preservation of nonblank explicit values, and forwarding into existing initialization flows.
- Railway tests cover unique policy-compliant generation, preservation, app-variable forwarding, ignored env-file persistence and repeatability, and dry-run redaction; local and standalone environment examples document the same key.
- The standalone compatibility-context test stays within its existing caps after the compatibility summary is shortened.

No API or UI paths change, so API/Playwright coverage is not added for this CLI/configuration fix. Run the affected CLI and script tests plus the configured repository validation gate; record actual results and environmental limits in the PR. This document does not claim those checks have passed.

## Final Compliance Report — 2026-10-29

| Rule source | Assessment |
|-------------|------------|
| Root `AGENTS.md`, CLI and create-app guides | Focused bootstrap scope; first-party callers and standalone templates covered; root Compose parity retained |
| Shared password policy | Existing validation implementation reused; no parallel policy or production dependency |
| Data/tenancy, CRUD, encryption maps, UI/design system, cache, events | Not applicable: no entities, queries, APIs, UI, cache, or event contracts change |
| `.ai/specs/AGENTS.md` | Required design, risk, compatibility, validation, changelog, and implementation-plan sections included; spec remains outside `implemented/` pending deployment |
| Emergency security exception | Disclosure documented; named human maintainer waiver acknowledgment remains required before merge |

## Changelog

### 2026-10-29

- Documented issue #7809's early credential validation, Compose pass-through, operator rotation guidance, and security compatibility exception requirements.
- Added the cross-platform starter's unique environment-file credential and necessary ephemeral/preview caller compatibility; retained the normal-init read-only existing-user recovery probe.
- Starter runtime regression verification: `node --test packages/starter/src/__tests__/starter.test.mjs` passed all 41 tests, including summary disclosure and new-file permissions. The new default-generation, uniqueness, preservation, and logging cases first demonstrated failures against the original writer.
- Independent final review found no remaining code findings and confirmed one cohesive bootstrap-security capability, including the necessary first-party caller updates. Targeted validation passed 145 CLI tests, 61 starter/Compose tests, and 7 caller-propagation tests; full-gate limits and human waiver acknowledgment are reported separately in the PR.

- PR review follow-up: resolve base-document conflicts; shorten the compatibility entry within existing harness budgets; provision and document Railway credentials, mirror local setup guidance in both env examples, and treat blank ephemeral credentials as unset.

### Review — 2026-10-29

- **Reviewer:** Agent; a fresh-context scope reviewer examined only this specification and found one cohesive capability, with no split required.
- **Security:** Shared-policy enforcement and placeholder rejection specified; human exception acknowledgment remains pending.
- **Performance:** Validation precedes expensive initialization and database writes; normal initialization retains a read-only existing-user probe, and no new runtime service is introduced.
- **Cache:** Not applicable; no cache behavior changes.
- **Commands:** Existing inputs retained; intentional validation narrowing disclosed.
- **Risks:** Initialization automation and existing credential rotation covered; rollback would restore vulnerable provisioning.
- **Verdict:** Implementation and targeted regression validation are complete; merge still requires full validation, QA, and the named human waiver acknowledgment.

## Phasing

Deliver one focused security fix covering CLI validation, Compose defaults, necessary first-party bootstrap callers, regression coverage, and operator migration documentation together.

## Implementation Plan

1. Add early superadmin credential resolution and shared-policy validation, with helper and CLI dispatch regression coverage proving invalid input cannot reach initialization side effects.
2. Remove predictable fallbacks from starter/generated-app full-app Compose variants and mirror legacy root duplicates; generate unique credentials in the cross-platform starter and existing disposable bootstrap callers, then verify preservation, forwarding, and parity.
3. Publish CLI, deployment, upgrade, and compatibility instructions; run the relevant tests and configured validation gate, then obtain the named human maintainer acknowledgment before merge.
