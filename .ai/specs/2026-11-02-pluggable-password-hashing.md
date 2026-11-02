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
| `verify(password, storedHash)` | Detects the algorithm from the stored hash prefix — `$argon2id$` Argon2id, anything else goes to bcrypt exactly as before (`$2a$`/`$2b$`/`$2y$`; bcryptjs rejects non-hash values) — so both kinds verify under either configuration. Failed verification always performs both bcrypt and Argon2id work, independent of the stored algorithm. |
| `needsRehash(storedHash)` | `true` when the stored algorithm differs from the configured one, or an Argon2id hash has another version, cost, salt length or output length. bcrypt hashes are never flagged while the algorithm is `bcrypt`, so the default writes nothing. |
| `equalizeTiming(password)` | Runs the same bcrypt-plus-Argon2id failure profile without account data. Login branches without a stored hash call it instead of a hard-coded bcrypt compare. |

Configuration (read once per process):

| Env | Default | Meaning |
|---|---|---|
| `OM_PASSWORD_HASH` | `bcrypt` | `bcrypt` or `argon2id`. Other values log a warning and fall back to `bcrypt`. |
| `OM_PASSWORD_ARGON2_MEMORY_KIB` | `19456` | Argon2id memory cost (KiB). |
| `OM_PASSWORD_ARGON2_TIME_COST` | `2` | Argon2id iterations. |
| `OM_PASSWORD_ARGON2_PARALLELISM` | `1` | Argon2id lanes. |

Rehash on login: after a fully successful staff login (`POST /api/auth/login`) or customer-portal login (`customer_accounts` `api/login.ts`), when `needsRehash` is true the password is hashed again and stored with a compare-and-swap update (`WHERE id = ? AND password_hash = <old hash>`), so a concurrent password change is never overwritten. The rehash is best effort: an error is logged and reported (`auth.password_rehash_failed`, `customer_accounts.password_rehash_failed`) and the login still succeeds. The update does not touch `updated_at`, so it never causes an optimistic-lock conflict for an admin editing the same user.

Dependency: `@node-rs/argon2` (napi-rs, Rust `argon2` crate). Prebuilt binaries for linux gnu/musl x64/arm64 (the `node:24-alpine` image), macOS and Windows ship as per-platform optional dependencies — no `node-gyp`, no install scripts. Next.js externalizes it by default (`server-external-packages`). It is imported lazily on the first Argon2id hash or failed/dummy password verification. Considered: `argon2` (node-gyp-build prebuilds, heavier install surface, same speed) and `hash-wasm` (pure WASM, portable, but slower per hash at the same parameters, which costs login latency or forces weaker parameters).

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

- Default storage behavior is unchanged: new hashes remain bcrypt cost 10 and successful bcrypt logins do not write. Failed and absent-account checks intentionally add Argon2id work to keep mixed-algorithm authentication timing uniform.
- Existing hashes keep working under both settings; no migration, no forced reset.
- Turning `argon2id` on: new and changed passwords use Argon2id; bcrypt hashes upgrade on the next successful login.
- Turning it back off: Argon2id hashes keep verifying and are re-hashed to bcrypt on the next login, so a rollback path exists.
- Downgrading Open Mercato to a version without this service after users were migrated breaks their login (old code only understands bcrypt). Switch back to `bcrypt` and let users log in first, or reset their passwords.
- Enterprise change-password and sudo re-authentication resolve the same shared hasher, so both bcrypt and Argon2id hashes work and password changes use the configured algorithm.
- No contract surface in `BACKWARD_COMPATIBILITY.md` is removed, renamed or narrowed.

## Integration Coverage

No API or UI path changes shape. Unit tests cover the hasher (both algorithms verify, algorithm-independent failed-auth work, unknown formats, complete `needsRehash` policy, safe config parsing, lazy load failure), `AuthService` and `CustomerUserService` rehash (success, tenant/organization-scoped compare-and-swap, failure never throws), enterprise change-password and sudo verification, and the updated timing-equalizer paths. A PostgreSQL integration test covers both staff and portal login rehash followed by a session flush while a concurrent password reset wins.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Timing side channel during mixed-algorithm migration | Medium | login enumeration | Failed and absent-account checks both perform bcrypt and Argon2id verification work, independent of stored/configured algorithm | Low; infrastructure jitter and stored historical cost parameters can still vary |
| Native binary missing on an exotic platform | Medium | password verification | Prebuilt binaries cover supported deployment platforms; lazy-load failure surfaces a clear operator error instead of silently weakening the mixed-algorithm timing profile | The built-in hasher requires a supported binary even when bcrypt is configured; an unsupported platform needs a compatible custom hasher |
| Argon2id memory use under login bursts (19 MiB per concurrent hash) | Low | server memory | Rate limits already bound login concurrency; parameters configurable | Low |

## Final Compliance Report

- Tenant scoping: rehash updates include primary key, tenant ID, organization ID and old hash from the already-resolved user; no new query surface.
- No generated files, migrations, ACL features or events changed.
- Errors in the best-effort rehash are logged and reported through `getTelemetryRuntime()?.reportError`.

## Changelog

- 2026-11-02: Spec created with the implementation (opt-in Argon2id, transparent rehash, default bcrypt).
- 2026-11-02: Review hardening added scoped CAS updates, managed-entity flush safety, mixed-algorithm timing work, enterprise compatibility, safe Argon2 bounds, complete PHC policy checks and PostgreSQL race coverage.
