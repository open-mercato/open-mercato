# Execution plan — pluggable password hashing (opt-in Argon2id)

Status: complete
Source doc: .ai/specs/2026-11-02-pluggable-password-hashing.md

## Goal

Route every user and customer-portal password hash/verify through one `passwordHasher` service, add opt-in Argon2id (`OM_PASSWORD_HASH=argon2id`) with transparent rehash of bcrypt hashes on successful login, and keep the default (`bcrypt`, cost 10) byte-for-byte compatible with today.

## Scope

- `packages/shared/src/lib/auth/passwordHasher.ts` — the service (hash / verify / needsRehash / equalizeTiming), env config, lazy `@node-rs/argon2` load.
- `auth` module: `services/authService.ts` (verify, reset, rehash), `api/login.ts` (rehash after success), `commands/users.ts`, `cli.ts`, `lib/setup-app.ts`, DI registration `passwordHasher`.
- `customer_accounts` module: `api/login.ts`, `api/signup.ts`, `api/admin/demo-accounts.ts`, `services/customerUserService.ts`, `services/customerInvitationService.ts`, `setup.ts`.
- `onboarding/lib/service.ts`: the pending hash becomes the new user's `passwordHash`.
- Env docs: `apps/mercato/.env.example`, `packages/create-app/template/.env.example`, docs page.

## Non-goals

- Non-password secrets hashed with bcrypt (API keys, MFA OTP/recovery codes, SCIM tokens, checkout link passwords, agent client secrets) stay on bcrypt.
- No schema, API, event or ACL change. No bcrypt cost change.
- `packages/enterprise/` is off-limits for external contributions (CONTRIBUTING.md). Its `security/services/PasswordService.ts` still verifies `User.passwordHash` with `bcryptjs`, so enterprise change-password and sudo re-auth reject Argon2id hashes until the enterprise team switches it to `getPasswordHasher()`. Flagged in the PR and docs; the default `bcrypt` is unaffected.

## Implementation Plan

### Phase 1: Spec and shared service

- 1.1 Spec `.ai/specs/2026-11-02-pluggable-password-hashing.md`.
- 1.2 `passwordHasher` in `@open-mercato/shared` + `@node-rs/argon2` dependency + unit tests.

### Phase 2: Call sites

- 2.1 `auth`: service, login rehash, commands, CLI, setup, DI registration + tests.
- 2.2 `customer_accounts`: login (timing + rehash), signup, demo accounts, services, setup + tests.
- 2.3 `onboarding` pending hash.

### Phase 3: Docs and gate

- 3.1 Env docs and docs page.
- 3.2 Full validation gate.

## Risks

- Timing equalizer: superseded — `verify` now spends one outcome-independent work profile per configured algorithm (see spec Risks).
- Downgrading OM below this version after enabling Argon2id breaks login for migrated users; documented (switch back to `bcrypt` first and let users log in, or reset passwords).
- Native module availability: `@node-rs/argon2` ships prebuilt binaries for linux gnu/musl x64/arm64, macOS, Windows; loaded lazily, so bcrypt-only installs never load it.

## Progress

PR: #8473

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Spec and shared service

- [x] 1.1 Spec — d82e0ffb9
- [x] 1.2 Shared passwordHasher service — 15a057846, fe8feff87, a985ca409

### Phase 2: Call sites

- [x] 2.1 auth call sites — 58d2e5f03
- [x] 2.2 customer_accounts call sites — 97e90e460
- [x] 2.3 onboarding pending hash — befc37d1d

### Phase 3: Docs and gate

- [x] 3.1 Env docs and docs page — c49bc163f, 20b0ad236
- [x] 3.2 Full validation gate — a985ca409
