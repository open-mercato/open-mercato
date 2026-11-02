# Pluggable Password Hashing with Opt-in Argon2id

## TLDR

Staff (`auth`) and customer-portal (`customer_accounts`) passwords are hashed with `bcryptjs` cost 10, hard-coded at about a dozen call sites. This spec puts every password hash and verify behind one `passwordHasher` service in `@open-mercato/shared`, adds Argon2id as an opt-in algorithm (`OM_PASSWORD_HASH=argon2id`), and upgrades stored bcrypt hashes to Argon2id after a successful login. The default stays `bcrypt` cost 10: existing installs hash, verify and store exactly as before.

## Overview

- **Owner modules:** the service lives in `@open-mercato/shared` (`lib/auth/passwordHasher.ts`) because `auth`, `customer_accounts` and `onboarding` all hash or read `User`/`CustomerUser` password hashes and must agree on the format. `auth` registers it in DI as `passwordHasher`.
- **Consumers:** `auth` (login, password reset, user create/update commands, CLI `add-user`/`set-password`, setup), `customer_accounts` (login, signup, invitations, password change/reset, setup, demo accounts), `onboarding` (pending password hash that becomes the new user's hash).
- **Out of scope:** non-password secrets hashed with bcrypt (API keys, MFA OTP and recovery codes, SCIM tokens, checkout link passwords, agent client secrets). They are random high-entropy values, not user-chosen passwords, so the Argon2id rationale (memory-hard resistance to offline guessing) does not apply.

## Problem Statement

1. bcrypt cost 10 is below current OWASP guidance for new systems; Argon2id is the recommended default. Operators with compliance requirements cannot switch, because the algorithm is hard-coded in every call site.
2. Switching naively would lock out every existing user. A switch must keep existing bcrypt hashes valid and migrate them without forcing password resets.
3. The login flows equalize timing with a fixed bcrypt dummy hash (issues #2242, #2694). Any algorithm change must keep that property.

## Proposed Solution

`PasswordHasher` interface:

| Method | Behaviour |
|---|---|
| `hash(password)` | Hashes with the configured algorithm (`bcrypt` cost 10, or Argon2id with the configured parameters). |
| `verify(password, storedHash)` | Detects the algorithm from the stored hash prefix — `$argon2id$` Argon2id, anything else goes to bcrypt exactly as before (`$2a$`/`$2b$`/`$2y$`; bcryptjs rejects non-hash values) — so both kinds verify under either configuration. |
| `needsRehash(storedHash)` | `true` when the stored algorithm differs from the configured one, or an Argon2id hash has other parameters than configured. bcrypt hashes are never flagged while the algorithm is `bcrypt`, so the default writes nothing. |
| `equalizeTiming(password)` | Runs one dummy verification with the configured algorithm. Login branches without a stored hash call it instead of a hard-coded bcrypt compare. |

Configuration (read once per process):

| Env | Default | Meaning |
|---|---|---|
| `OM_PASSWORD_HASH` | `bcrypt` | `bcrypt` or `argon2id`. Other values log a warning and fall back to `bcrypt`. |
| `OM_PASSWORD_ARGON2_MEMORY_KIB` | `19456` | Argon2id memory cost (KiB). |
| `OM_PASSWORD_ARGON2_TIME_COST` | `2` | Argon2id iterations. |
| `OM_PASSWORD_ARGON2_PARALLELISM` | `1` | Argon2id lanes. |

Rehash on login: after a fully successful staff login (`POST /api/auth/login`) or customer-portal login (`customer_accounts` `api/login.ts`), when `needsRehash` is true the password is hashed again and stored with a compare-and-swap update (`WHERE id = ? AND password_hash = <old hash>`), so a concurrent password change is never overwritten. The rehash is best effort: an error is logged and reported (`auth.password_rehash_failed`, `customer_accounts.password_rehash_failed`) and the login still succeeds. The update does not touch `updated_at`, so it never causes an optimistic-lock conflict for an admin editing the same user.

Dependency: `@node-rs/argon2` (napi-rs, Rust `argon2` crate). Prebuilt binaries for linux gnu/musl x64/arm64 (the `node:24-alpine` image), macOS and Windows ship as per-platform optional dependencies — no `node-gyp`, no install scripts. Next.js externalizes it by default (`server-external-packages`). It is imported lazily, only when a process hashes or verifies an Argon2id password, so bcrypt-only installs never load it. Considered: `argon2` (node-gyp-build prebuilds, heavier install surface, same speed) and `hash-wasm` (pure WASM, portable, but slower per hash at the same parameters, which costs login latency or forces weaker parameters).

Pluggability: `getPasswordHasher()` returns the process-wide instance built from env; `setPasswordHasher(custom)` replaces it (for example from an app's `di.ts`), and the `passwordHasher` DI registration always resolves the current instance.

## Architecture

```
auth / customer_accounts / onboarding call sites
        │  getPasswordHasher()
        ▼
@open-mercato/shared/lib/auth/passwordHasher
        ├── bcryptjs (static, as today)
        └── @node-rs/argon2 (lazy import, argon2id only)
```

No cross-module ORM relation is added; each module keeps updating its own entity.

## Data Models

None. `users.password_hash` and `customer_users.password_hash` are text columns that already hold variable-length strings; Argon2id PHC strings (~97 chars) fit.

## API Contracts

No route, request or response change. New public helpers in `@open-mercato/shared/lib/auth/passwordHasher` (additive): `PasswordHasher`, `getPasswordHasher`, `setPasswordHasher`, `createPasswordHasher`, `resolvePasswordHasherConfig`, `detectPasswordHashAlgorithm`. New DI key `passwordHasher` (additive). New optional methods `AuthService.rehashPasswordIfNeeded` and `CustomerUserService.rehashPasswordIfNeeded` (additive).

## Migration & Backward Compatibility

- Default unchanged: `bcrypt` cost 10 for new hashes, same timing-equalizer hash cost, no writes on login.
- Existing hashes keep working under both settings; no migration, no forced reset.
- Turning `argon2id` on: new and changed passwords use Argon2id; bcrypt hashes upgrade on the next successful login.
- Turning it back off: Argon2id hashes keep verifying and are re-hashed to bcrypt on the next login, so a rollback path exists.
- Downgrading Open Mercato to a version without this service after users were migrated breaks their login (old code only understands bcrypt). Switch back to `bcrypt` and let users log in first, or reset their passwords.
- Enterprise: `packages/enterprise` `security/services/PasswordService.ts` (change password, sudo re-auth) verifies `User.passwordHash` with `bcryptjs` directly and is outside the scope of external contributions. Until it uses `getPasswordHasher()`, those enterprise flows reject Argon2id hashes; do not enable `argon2id` together with the enterprise security module.
- No contract surface in `BACKWARD_COMPATIBILITY.md` is removed, renamed or narrowed.

## Integration Coverage

No API or UI path changes shape. Unit tests cover the new behaviour: hasher (both algorithms verify, wrong password fails, unknown formats, `needsRehash`, default config, env parsing, lazy load failure), `AuthService` and `CustomerUserService` rehash (success, compare-and-swap, failure never throws), and the updated timing-equalizer tests.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Timing side channel during migration: under `argon2id`, accounts still on bcrypt verify at bcrypt cost while absent accounts pay Argon2id cost | Medium | login enumeration | Default unchanged; the window closes as users log in; documented | Low, opt-in only |
| Native binary missing on an exotic platform | Medium | argon2id installs | Lazy load with a clear error naming the package; bcrypt installs never load it | Operator must stay on bcrypt there |
| Argon2id memory use under login bursts (19 MiB per concurrent hash) | Low | server memory | Rate limits already bound login concurrency; parameters configurable | Low |
| Enterprise PasswordService rejects Argon2id hashes | Medium | enterprise change-password / sudo | Documented; enterprise maintainers to switch to `getPasswordHasher()` | Until then, do not combine |

## Final Compliance Report

- Tenant scoping: rehash updates by primary key plus old hash on the already-resolved user; no new query surface.
- No generated files, migrations, ACL features or events changed.
- Errors in the best-effort rehash are logged and reported through `getTelemetryRuntime()?.reportError`.

## Changelog

- 2026-11-02: Spec created with the implementation (opt-in Argon2id, transparent rehash, default bcrypt).
