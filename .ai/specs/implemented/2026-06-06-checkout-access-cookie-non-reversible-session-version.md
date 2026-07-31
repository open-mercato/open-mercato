# security(checkout): derive checkout access cookie sessionVersion to stop bcrypt hash leak

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | izqzmyli (rajan.bor@boringcode.pl) |
| **Created** | 2026-06-06 |
| **Related** | [#2675](https://github.com/open-mercato/open-mercato/issues/2675), [packages/checkout/AGENTS.md](../../packages/checkout/AGENTS.md), `report.md` finding #37 (MEDIUM) |

## TLDR

**Key Points:**
- `signCheckoutAccessToken` JSON-stringifies the payload and base64url-encodes it. The HMAC signature authenticates the payload but does **not** encrypt it, so the payload segment is fully decodable by anyone with the cookie.
- Both real callers pass the checkout link's bcrypt `passwordHash` as `sessionVersion`, so the bcrypt hash ends up verbatim inside the cookie — ready for offline cracking if the cookie ever leaks through a side channel.
- Fix: derive the embedded `sessionVersion` with `HMAC-SHA256(serverSecret, normalizedInput)` before embedding. The verify path applies the same derivation before comparing. The bcrypt hash never leaves the server; rotation semantics (changing `link.passwordHash` invalidates outstanding cookies) are preserved because the input still drives the output.

**Scope:**
- Modify only `packages/checkout/src/modules/checkout/lib/utils.ts` (`signCheckoutAccessToken`, `verifyCheckoutAccessToken`, new internal helper `deriveCheckoutAccessSessionVersion`).
- Add unit tests in `packages/checkout/src/modules/checkout/lib/__tests__/utils.test.ts` proving the payload no longer contains a bcrypt-shaped string, that rotation still works, and that null inputs are handled defensively.
- No DB migration, no schema change, no caller signature change, no API contract change.

**Concerns:**
- The fix changes the cookie payload shape. Any cookie issued before the upgrade verifies against the new code path the same way as a rotated hash would: the embedded raw bcrypt-hash string does not equal `HMAC(secret, bcrypt-hash)`, so verification fails and the user re-authenticates with the password. That is the same UX as a normal password change and is acceptable for a 1-hour cookie.
- The server secret used for the derivation is identical to the one used for the HMAC signature (`AUTH_SECRET` → `NEXTAUTH_SECRET` → `JWT_SECRET` → `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`). Rotating the secret invalidates outstanding cookies in both directions — same as before.

## Overview

The checkout password cookie (`om_checkout_access`) gates access to password-protected checkout links after a customer authenticates at `POST /checkout/pay/[slug]/verify-password`. The cookie has good transport properties (`httpOnly`, `secure`, `sameSite=strict`) but its payload is reversible — a `cookie = base64url(JSON({slug, linkId, sessionVersion, exp})).HMAC(payload)` format where the signature only authenticates the payload, not its confidentiality. With `sessionVersion = link.passwordHash`, the bcrypt hash is observable to anyone who momentarily holds the cookie.

This spec replaces the embedded raw `sessionVersion` with an HMAC-SHA256 digest of it, keyed by the same server secret already used for the HMAC signature. The bcrypt hash never leaves the server; the rotation invariant (changing the input invalidates outstanding cookies) is preserved because the HMAC is deterministic.

## Problem Statement

`packages/checkout/src/modules/checkout/lib/utils.ts` (lines 267–308 on `upstream/develop` @ 115785d8d):

```ts
export function signCheckoutAccessToken(
  slug: string,
  options?: { linkId?: string | null; sessionVersion?: Date | string | null },
): string {
  const payload = Buffer.from(JSON.stringify({
    slug,
    linkId: options?.linkId ?? null,
    sessionVersion: normalizeCheckoutAccessSessionVersion(options?.sessionVersion), // <-- raw input embedded
    exp: Date.now() + (60 * 60 * 1000),
  }), 'utf-8').toString('base64url')
  const signature = createHmac('sha256', getCheckoutAccessTokenSecret()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}
```

Both callers (`api/pay/[slug]/verify-password/route.ts:51` and `api/pay/[slug]/route.ts:56`) pass `link.passwordHash` as `sessionVersion`. The bcrypt hash is therefore embedded verbatim in the cookie payload, recoverable by a base64url decode of the first dot-segment.

### Impact (from issue #2675)

A leaked cookie reveals the link's bcrypt password hash. The cookie expires in 1 hour, but the **hash** is a far more durable compromise: an attacker can run offline brute-force against weak/short merchant-chosen passwords and survive password-derivative session bumps. Disclosing password hashes to clients is a long-standing anti-pattern.

## Proposed Solution

Add an internal helper that derives a non-reversible representation of `sessionVersion` before embedding:

```ts
function deriveCheckoutAccessSessionVersion(value: Date | string | null | undefined): string | null {
  const normalized = normalizeCheckoutAccessSessionVersion(value)
  if (normalized == null) return null
  return createHmac('sha256', getCheckoutAccessTokenSecret()).update(normalized).digest('base64url')
}
```

`signCheckoutAccessToken` calls `deriveCheckoutAccessSessionVersion` in place of `normalizeCheckoutAccessSessionVersion` when building the payload. `verifyCheckoutAccessToken` applies the same derivation to `options.sessionVersion` before equality-comparing it to `parsed.sessionVersion`.

### Why this preserves the existing security model

- **Rotation invariant**: if `link.passwordHash` changes, `HMAC(secret, oldHash) ≠ HMAC(secret, newHash)`. The verify path compares against `HMAC(secret, currentHash)`, so old cookies are rejected. Same behavior as today.
- **Authenticity**: the HMAC signature over the entire payload (independent of the derivation) still authenticates the payload exactly as before. The signature key is the same secret as the derivation key; rotating the secret invalidates outstanding cookies via either path.
- **Pre-image resistance**: recovering `link.passwordHash` from `HMAC(secret, hash)` requires the secret. The server secret is the same one already trusted by the existing HMAC signature flow; if it leaks, the cookie was forgeable anyway, so introducing the same secret as a derivation key does not widen the attack surface.

### Why option (c) over (a) / (b) from the issue

The issue's author offered three options:
- (a) Add a new `password_session_id` column regenerated on password change.
- (b) Monotonic counter bumped on password change.
- (c) Derived value `HMAC(secret, passwordHash)`.

Option (c) is the minimum-surface fix. (a) requires a new column, a migration, and updates to every code path that mutates `passwordHash` to also rotate the new column — that's three files at minimum and a release-time concern. (b) needs the same wiring plus a monotonic counter. (c) is one self-contained edit in `utils.ts` with no DB/migration/wiring footprint and keeps the public function signatures byte-identical. Rotation correctness is identical for the cookie semantics that matter (1-hour TTL + invalidation on password change).

## Architecture

```
+-----------------------------------------------------+
| signCheckoutAccessToken(slug, { sessionVersion })   |
| 1. normalize input (Date|string → string|null)      |
| 2. derive HMAC(secret, normalized) → embedded value | <-- NEW
| 3. JSON.stringify + base64url → payload             |
| 4. HMAC(secret, payload) → signature                |
| 5. emit `${payload}.${signature}` cookie            |
+-----------------------------------------------------+
                       |
                       | leaked cookie → attacker base64url-decodes payload
                       |
                       v
+-----------------------------------------------------+
| Attacker sees `sessionVersion = HMAC(secret, hash)` |
| Cannot recover bcrypt `hash` without `secret`       |
+-----------------------------------------------------+

+-----------------------------------------------------+
| verifyCheckoutAccessToken(token, slug, { sV })      |
| 1. timing-safe HMAC signature check                 |
| 2. decode payload                                   |
| 3. slug + linkId + exp checks                       |
| 4. expected = HMAC(secret, normalize(sV))           | <-- NEW (mirrors sign)
| 5. embedded === expected (string ===)               |
+-----------------------------------------------------+
```

## Data Models

No data-model changes.

## API Contracts

No HTTP/API contract changes.

- `signCheckoutAccessToken` keeps its `(slug, options?)` signature.
- `verifyCheckoutAccessToken` keeps its `(token, slug, options?)` signature.
- Cookie name (`om_checkout_access`), attributes (`httpOnly`, `secure`, `sameSite=strict`, `path=/`, `maxAge=3600`) all unchanged.

### Wire-format change (cookie payload only)

The payload segment's `sessionVersion` field changes from the raw input string (typically a bcrypt hash) to a base64url-encoded HMAC-SHA256 digest of that input. The format is still a string; consumers that only read it via `verifyCheckoutAccessToken` (the only consumers in the codebase) keep working without changes. There is no consumer in the repo that decodes the cookie manually.

## UI/UX

N/A — server-side helper only.

## Configuration

No env vars added. Uses the existing `getCheckoutAccessTokenSecret()` resolver (`AUTH_SECRET` → `NEXTAUTH_SECRET` → `JWT_SECRET` → `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`).

## Alternatives Considered

1. **Encrypt the payload (AES-GCM) instead of just signing it.** Rejected — bigger surface, requires careful nonce management, and changes the cookie format from `payload.sig` to opaque ciphertext. The non-reversible derivation already solves the leak with a much smaller diff.
2. **Issue (a) — new `password_session_id` column.** Rejected — requires migration + entity edit + all `passwordHash` mutators bumping the new column. Out of proportion for a medium-priority fix.
3. **Issue (b) — monotonic counter.** Same downside as (a) plus the counter is an additional concurrency hazard if two requests rotate the password near-simultaneously.
4. **Issue defense-in-depth: reject bcrypt-shaped inputs in `signCheckoutAccessToken`.** Rejected — the existing callers legitimately pass `link.passwordHash` which IS bcrypt-shaped. Rejecting bcrypt-shaped input would break the two existing call sites without delivering extra safety, because the derivation step already strips the leak. The intended invariant — "the embedded value is never bcrypt-shaped" — is enforced by a unit test instead.

## Implementation Approach

### Phase 1 — Apply the fix (single commit)

Edit `packages/checkout/src/modules/checkout/lib/utils.ts`:

1. Add the internal helper `deriveCheckoutAccessSessionVersion(value)` right after `normalizeCheckoutAccessSessionVersion`. Two lines of body: normalize, then HMAC if non-null.
2. Replace the `sessionVersion: normalizeCheckoutAccessSessionVersion(options?.sessionVersion)` line in `signCheckoutAccessToken` with `sessionVersion: deriveCheckoutAccessSessionVersion(options?.sessionVersion)`.
3. Replace the `parsed.sessionVersion === normalizeCheckoutAccessSessionVersion(options.sessionVersion)` line in `verifyCheckoutAccessToken` with `parsed.sessionVersion === deriveCheckoutAccessSessionVersion(options.sessionVersion)`.

### Phase 2 — Tests (same commit)

Extend `packages/checkout/src/modules/checkout/lib/__tests__/utils.test.ts` with a new `describe('access cookie payload does not expose the raw sessionVersion (#2675)', …)` block:

- Embeds a bcrypt-shaped `sessionVersion`, decodes the payload, asserts the decoded `sessionVersion` is non-null, is not equal to the input, and does **not** match `/^\$2[abxy]\$/`.
- Verifies a freshly signed cookie against the same `passwordHash`.
- Rotates `passwordHash` and asserts verification against the new hash returns `false` (old cookie rejected).
- Null `sessionVersion` is preserved as null; a verify call that omits the `sessionVersion` constraint still returns `true` for a same-slug + linkId + exp match.
- Two different bcrypt hashes yield two different embedded digests (rotation semantics intact).

### Phase 3 — Validation

```bash
yarn workspace @open-mercato/checkout test
yarn typecheck
```

No `yarn db:generate`. No `yarn generate`. No new locale strings.

## Migration Path

- Outstanding cookies issued before the upgrade will fail verification after the upgrade because the embedded raw bcrypt hash does not equal the newly derived HMAC. Affected users see the standard re-prompt at the password page — same UX as a password change. The cookie TTL is 1 hour so the blast radius is bounded.
- No data migration. No config flag.
- No deprecation needed — the public function signatures are byte-identical.

## Backward Compatibility

| Surface | Classification | Impact |
|---------|----------------|--------|
| `signCheckoutAccessToken(slug, options)` signature | UNCHANGED | Same types, same returns |
| `verifyCheckoutAccessToken(token, slug, options)` signature | UNCHANGED | Same types, same returns |
| Cookie name, attributes, TTL | UNCHANGED | `om_checkout_access`, `httpOnly`/`secure`/`sameSite=strict`, 1h |
| Cookie inner `sessionVersion` value | CHANGED | `bcrypt hash` → `HMAC-SHA256(secret, bcrypt hash)`. Consumed only via `verifyCheckoutAccessToken`; the verify side applies the same derivation. No in-repo consumer decodes the payload directly. |
| Server secret resolver | UNCHANGED | Same chain `AUTH_SECRET → NEXTAUTH_SECRET → JWT_SECRET → TENANT_DATA_ENCRYPTION_FALLBACK_KEY` |
| DB schema | UNCHANGED | No migration |
| Events / DI / ACL | UNCHANGED | None of these participate in the cookie flow |

No `BACKWARD_COMPATIBILITY.md` contract surface is touched.

## Risks & Impact Review

| # | Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|----------|----------|---------------|------------|---------------|
| R1 | Outstanding cookies issued before the upgrade fail verification once the new code is deployed | Low | Active checkout sessions at deploy time | Cookie TTL is 1 hour; users re-enter the password (same UX as a normal password change) | None — bounded by 1h TTL |
| R2 | Server secret leak now also leaks the derivation key | Negligible — same key was already used for the HMAC signature | All cookies | If the signing secret leaks, cookies were already forgeable; introducing the same key as a derivation key does not widen the attack surface | None new |
| R3 | The derivation is deterministic so identical inputs produce identical outputs — does this enable correlation across links/users? | Low | Cross-link correlation | An attacker who already controls two cookies for the same `passwordHash` (e.g. the same merchant-chosen password on two different links) can observe that both embed the same digest. They learn nothing about the underlying password since the digest is a one-way function | Same correlation was possible in the pre-fix code (raw bcrypt hashes embedded equal each other for the same input). Strict improvement, no regression |
| R4 | Future contributor adds a new caller that decodes the cookie payload assuming a bcrypt-formatted `sessionVersion` | Low | Future code | Spec linked from PR; new bcrypt-prefix-rejection test serves as a red-line example; type signature unchanged so no compile-time surface affected | Out of scope; addressed by general code-review discipline |
| R5 | Existing unit tests in `utils.test.ts` pass arbitrary strings (ISO timestamps) as `sessionVersion` | None | Existing tests | Sign and verify apply the same derivation, so equality holds. All 17 existing tests continue to pass | None |

## Final Compliance Report

| Check | Result | Notes |
|-------|--------|-------|
| `BACKWARD_COMPATIBILITY.md` contract surfaces touched | None | Public signatures + cookie name/attributes unchanged; inner-payload value shape is implementation detail with no in-repo consumer outside `verifyCheckoutAccessToken` itself |
| `packages/checkout/AGENTS.md` "Never expose secrets to clients" | Satisfied | Cookie no longer embeds the bcrypt hash |
| AGENTS.md "Never hard-code user-facing strings" | Not applicable here | No user-facing strings added |
| AGENTS.md "Hash passwords with bcryptjs (cost >=10), never log credentials" | Strengthened | The cookie was a passive credential disclosure channel; closing it tightens the existing rule |
| Encryption helper rule (`findWithDecryption`/`findOneWithDecryption`) | Not applicable | No entity reads/writes touched |
| Validators (zod) updates | None | No schema change |
| Migrations / `yarn db:generate` | None required | No DB change |
| Generators / `yarn generate` | None required | No auto-discovered file changed |
| Integration coverage | Unit tests added | No HTTP/UI surface changed; sign/verify symmetry is exhaustively unit-tested. Existing checkout integration tests (which use `verifyCheckoutAccessToken` indirectly) keep covering the legitimate password flow |
| Locale / i18n | None | No user-facing string added |
| Default role features / ACL sync | None | No new feature declared |
| `runCrudCommandWrite` opportunistic migration | Skipped | This is a pure crypto helper, not a command write |

## Changelog

### 2026-06-06
- Initial draft.
