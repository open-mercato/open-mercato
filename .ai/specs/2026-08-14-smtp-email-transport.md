# SMTP Transport for Transactional Email

## TLDR

**Key Points:**
- Adds an **SMTP (nodemailer) transport** to the system transactional email pipeline in `packages/shared/src/lib/email/`, alongside the existing hardcoded Resend path.
- `sendEmail()` stays the single façade with its **signature unchanged** — all 17 files that import it (26 call sites: auth reset/invite/users command, notifications, messages, checkout, sales quotes, customer_accounts, onboarding, enterprise security) keep working with zero edits.
- Transport resolution, in priority order: (1) `EMAIL_STRATEGY` env (`resend` | `smtp`), (2) auto-detection — `RESEND_API_KEY` set → resend, else `SMTP_HOST` set → smtp, (3) neither configured → current behavior (throw `RESEND_API_KEY is not set`).
- The SMTP path renders the React Email element to HTML + plaintext via `@react-email/render` and maps the existing base64 attachment shape to nodemailer's format. Both provider SDKs are imported lazily inside their transports — Resend-only deployments never load nodemailer, and SMTP-only deployments never load the Resend SDK.
- **TLS is required by default.** `SMTP_SECURE=false` means STARTTLS-required (`requireTLS: true`, `rejectUnauthorized: true`), never opportunistic; cleartext is possible only behind an explicit `OM_ALLOW_INSECURE_SMTP=true` operator opt-in, mirroring the policy `channel-imap` already enforces.
- Motivation: downstream apps built on `@open-mercato/*` npm packages cannot use SMTP today (self-hosted mail, MailDev/Mailpit in dev, EU-hosted SMTP relays). An app-level shim cannot fix this because core packages import `@open-mercato/shared/lib/email/send` directly — the transport must live upstream.

**Scope (v1):**
- New `packages/shared/src/lib/email/transports/{types,resend,smtp}.ts`; `send.ts` becomes a dispatcher.
- Env-driven SMTP config: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `SMTP_TIMEOUT_MS`, `OM_ALLOW_INSECURE_SMTP`.
- New deps of `@open-mercato/shared`: `nodemailer` (+ `@types/nodemailer`), `@react-email/render`, plus declaring the already-used-via-hoisting `resend`.
- `.env.example` documentation (mirrored into the create-app template) and a `packages/shared/AGENTS.md` Library Directory row.
- Unit tests for resolution order, config parsing, TLS policy, rendering/attachment mapping, and error wrapping; existing `send.test.ts` passes unchanged.

**Non-goals (v1):**
- A per-call `transport` option on `SendEmailOptions` — no call site in scope needs one, and the two places that might (the `inbox_ops` routes) are themselves out of scope. The resolver signature keeps an optional `explicit` parameter, so exposing the option later is purely additive.
- Per-tenant SMTP configuration UI or credential storage — config is operator-level env, matching `CACHE_STRATEGY`/`QUEUE_STRATEGY` precedent.
- SSRF/host-pinning hardening (`resolveSafeHostAddress` / `assertTransportAllowed` from `channel-imap`) — `SMTP_HOST` is operator-controlled env, not tenant/user input; hoisting those helpers into shared is deliberate future work if per-tenant config ever lands. TLS-downgrade protection, a separate property, **is** in scope (see the TLS policy below).
- Connection pooling / transporter reuse — per-call create + close, matching `channel-imap`'s `NodemailerClient` lifecycle. A `SMTP_POOL` knob can follow if volume warrants.
- Registering an `emailService` DI value — the dead resolve hook at `packages/core/src/modules/workflows/lib/activity-executor.ts:547` (SEND_EMAIL activity) stays future work.
- Migrating the two Resend-direct `inbox_ops` routes (`api/proposals/[id]/replies/[replyId]/send`, `api/webhook/inbound`) — the inbound webhook is inherently Resend-specific; the reply-send route keeps threading headers Resend-side.
- Per-user mailbox sending — that is the Communications Hub / `channel-imap` surface (see `.ai/specs/2026-05-21-email-integration-foundation.md`), which explicitly keeps this transactional pipeline separate.
- Recipient allowlist gating (`EMAIL_ALLOWLIST_DOMAINS`-style) — separate feature if needed.

---

## Overview

Open Mercato has exactly one system transactional email path: `sendEmail()` in `packages/shared/src/lib/email/send.ts`. It is a plain exported function (not a DI service) that hardcodes the Resend SDK, keyed off `RESEND_API_KEY`, and throws when the key is missing. **17 non-test files** import it directly, holding **26 call sites**: three in `auth` (reset, resend-invite, users command), two in `sales` (quote accept/send), two in `customer_accounts` (invitation email, signup), one each in `notifications` and `messages`, three in `onboarding` (ready-email, onboarding post, demo-feedback), one in `checkout`, and four in `enterprise/security`.

Deployments that cannot or do not want to use Resend — self-hosted installs, EU data-residency SMTP relays, local development against MailDev/Mailpit, CI mail sinks — have no supported way to deliver system email. Because the call sites live inside published `@open-mercato/*` packages, a downstream app cannot shim the transport; the capability must be added upstream in `@open-mercato/shared`.

The repo already contains a proven nodemailer wrapper (`packages/channel-imap/src/modules/channel_imap/lib/smtp-client.ts`), but it is bound to per-user integration credentials under the Communications Hub and is not reachable from the transactional pipeline — and `@open-mercato/shared` must not depend on a provider package. Its **transport-security policy**, however, is directly applicable and is adopted here (see TLS policy).

## Problem Statement

1. **Resend is hardcoded.** `send.ts` constructs `new Resend(apiKey)` inline; there is no transport abstraction, no strategy selection, no fallback. Without `RESEND_API_KEY` every system email throws.
2. **Downstream apps cannot substitute a transport.** Core packages import `@open-mercato/shared/lib/email/send` directly, so an app-level replacement would only cover the app's own call sites, leaving password resets, invitations, and notifications Resend-only.
3. **No SMTP env surface exists.** `.env.example` documents only `RESEND_API_KEY` and the from-address chain (`NOTIFICATIONS_EMAIL_FROM` → `EMAIL_FROM` → `ADMIN_EMAIL`); there is no `SMTP_*` variable anywhere in the transactional path.
4. **The transport contract is Resend-shaped.** `SendEmailOptions.react` is a React element and attachments are base64 strings with Resend field names (`reply_to`) — an SMTP path needs explicit rendering and mapping, which no shared utility provides.

## Proposed Solution

Keep `sendEmail()` as the stable façade owning all cross-cutting behavior — the `OM_DISABLE_EMAIL_DELIVERY` / `OM_TEST_MODE` short-circuit and `resolveDefaultEmailFromAddress()` from-address resolution — and delegate delivery to one of two transports selected by a small resolver.

### Transport resolution

```
EMAIL_STRATEGY env ('resend' | 'smtp'; unknown value logs one warning and falls through)
  → auto-detect: RESEND_API_KEY set → 'resend'; else SMTP_HOST set → 'smtp'
    → neither configured → throw 'RESEND_API_KEY is not set'  (existing behavior, unchanged)
```

### Execution order inside the façade (normative)

The order matters for backward compatibility and is therefore fixed:

```
1. disable-check (OM_DISABLE_EMAIL_DELIVERY / OM_TEST_MODE) + captureEmailForTests   → may return early
2. resolve transport                                → may throw 'RESEND_API_KEY is not set'
3. resolve from-address (options.from → chain)      → may throw 'EMAIL_FROM_NOT_CONFIGURED: …'
4. dispatch to the resolved transport
```

Today's `send.ts` throws `RESEND_API_KEY is not set` at `:104` **before** it reaches the `EMAIL_FROM_NOT_CONFIGURED` throw at `:109`, and step 2 preceding step 3 preserves that exactly. Resolving the from-address first would change the error a fully-unconfigured deployment sees, which is precisely the case the invariant below protects.

Backward compatibility invariant: a deployment with only `RESEND_API_KEY` set behaves byte-identically to today; a deployment with nothing set fails with the same error, from the same step, as today. `EMAIL_STRATEGY` follows the repo's unprefixed `*_STRATEGY` convention (`CACHE_STRATEGY`, `QUEUE_STRATEGY`, `RATE_LIMIT_STRATEGY`).

### Lazy provider SDK loading

Each transport lazily imports its provider SDK inside the send path (`await import('nodemailer')` in the smtp transport, `await import('resend')` in the resend transport), so a deployment only ever loads the SDK of the transport it actually uses — and neither loads under disabled-delivery configurations. This only shifts *when* the module is loaded (first send instead of process start); the constructed client, request payloads, and error behavior are unchanged.

### TLS policy (normative)

This pipeline carries password-reset links, user invitations and portal invitation tokens, so the transport must not silently fall back to cleartext. nodemailer's default STARTTLS behavior when `secure: false` is *opportunistic* — it sends in the clear when the server does not advertise STARTTLS — and that default is rejected here. The policy mirrors `packages/channel-imap/src/modules/channel_imap/lib/transport.ts` (which refuses `'none'` unless `OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT=true`) and `smtp-client.ts:172-182` (`requireTLS` on STARTTLS, `rejectUnauthorized: true`):

| `SMTP_SECURE` | `OM_ALLOW_INSECURE_SMTP` | Transporter options | Meaning |
|---|---|---|---|
| `true` (default on port 465) | any | `secure: true`, `tls: { rejectUnauthorized: true }` | Implicit TLS. |
| `false` (default otherwise) | unset / `false` | `secure: false`, `requireTLS: true`, `tls: { rejectUnauthorized: true }` | **STARTTLS required** — the send fails rather than downgrading. |
| `false` | `true` | `secure: false`, `requireTLS: false`, `tls: undefined` | Cleartext permitted. Operator-opt-in only; intended for MailDev/Mailpit and CI sinks. |

Certificate verification is never skipped on a TLS or STARTTLS connection. Selecting the insecure combination logs one warning through `createLogger('email')` naming the opt-in variable; the values of `SMTP_USER`/`SMTP_PASSWORD` are never logged.

### SMTP transport behavior

- Lazy nodemailer import as described above.
- Render the React element once per send: `render(react)` for HTML and `render(react, { plainText: true })` for the text alternative (deliverability win, free with `@react-email/render`).
- Map attachments `{ filename, content (base64), contentType }` → nodemailer `{ filename, content, encoding: 'base64', contentType }`.
- Build transporter TLS options strictly per the TLS policy table above.
- Create the transporter per call and `close()` it in `finally` — the same lifecycle as `channel-imap`'s `NodemailerClient`, with no shared mutable state and hot-reload safety.
- Wrap failures as `SMTP_SEND_FAILED: <message>` (mirrors `RESEND_SEND_FAILED`). A STARTTLS upgrade refused by the server surfaces through this same wrapper. Missing `SMTP_HOST` when the smtp transport is explicitly selected throws `SMTP_NOT_CONFIGURED: set SMTP_HOST`.
- All error strings are developer/operator-facing (thrown from a shared library, surfaced in logs), consistent with the existing `RESEND_SEND_FAILED` / `EMAIL_FROM_NOT_CONFIGURED` literals in this file.

## Architecture

```
packages/shared/src/lib/email/
├── send.ts                 # façade: disable-check → resolve transport → from-resolution → dispatch
├── config.ts               # existing from-address chain + NEW resolveEmailTransportName(), resolveSmtpConfig()
└── transports/
    ├── types.ts            # ResolvedEmailMessage, EmailTransport, EMAIL_STRATEGIES / EmailStrategyName
    ├── resend.ts           # current send.ts Resend body (per-call `new Resend`, reply_to, RESEND_SEND_FAILED), SDK imported lazily
    └── smtp.ts             # lazy nodemailer, @react-email/render html+text, TLS policy, attachment mapping, SMTP_SEND_FAILED
```

| File | Change |
|------|--------|
| `packages/shared/src/lib/email/send.ts` | `SendEmailOptions` is **unchanged** — no new public field. The body runs the four normative steps in order: disable-check, `resolveEmailTransportName()`, from-address resolution, dispatch. |
| `packages/shared/src/lib/email/config.ts` | Add `resolveEmailTransportName(explicit?)` (resolution chain above; one-time `createLogger('email')` warning on unknown `EMAIL_STRATEGY`) and zod-validated `resolveSmtpConfig()` including the TLS policy resolution. |
| `packages/shared/src/lib/email/transports/resend.ts` | Extraction of the existing Resend code path. The one deliberate delta: the static `import { Resend } from 'resend'` becomes a lazy `await import('resend')` so SMTP-only deployments never load the Resend SDK (review feedback on the fork PR); send behavior is otherwise identical. |
| `packages/shared/src/lib/email/transports/smtp.ts` | New transport as described above. |
| `packages/shared/package.json` | Add `nodemailer`, `@types/nodemailer`, `@react-email/render` — and **declare `resend`**, which `send.ts` imports today through workspace hoisting alone (backed by the `declare module 'resend'` shim at `packages/shared/src/types/resend.d.ts`). Without that declaration the lazy `import('resend')` has no install-time guarantee. nodemailer version reconciled with the monorepo (root `9.0.1` vs `channel-imap` `^9.0.3` — settle on one during implementation); `resend` pinned to the existing `^6.18.1` used by root, `apps/mercato` and `packages/core`. If `@react-email/render` types do not resolve under shared's tsconfig, extend `packages/shared/src/types/react-email.d.ts` with a minimal typed `render` declaration (no `any`). |
| `apps/mercato/.env.example` + `packages/create-app/template/.env.example` | Document `EMAIL_STRATEGY`, `SMTP_*` and `OM_ALLOW_INSECURE_SMTP` in the email provider block, identical comments in both (create-app Template Sync Checklist). |
| `packages/shared/AGENTS.md` | Add an `email/` row to the Library Directory table (`sendEmail`, transport resolution, env vars). |

The build for `@open-mercato/shared` must keep `nodemailer` and `resend` external (it already externalizes node_modules deps); the lazy dynamic imports additionally protect module-load time.

## Data Models

No database entities, migrations, or snapshot changes. All state is process-env configuration:

| Env var | Type / default | Meaning |
|---------|----------------|---------|
| `EMAIL_STRATEGY` | `resend` \| `smtp`, unset by default | Forces a transport; unset → auto-detect. Unknown value → warn once, auto-detect. |
| `SMTP_HOST` | string, required for smtp | SMTP server host. Its presence (with no `RESEND_API_KEY`) auto-selects smtp. |
| `SMTP_PORT` | int, default `587` | SMTP port. |
| `SMTP_USER` / `SMTP_PASSWORD` | optional pair | AUTH credentials; `auth` is omitted from the transporter unless both are set (open relays / MailDev need none). |
| `SMTP_SECURE` | boolean (`parseBooleanWithDefault`), default `true` iff port `465`, else `false` | `true` → implicit TLS. `false` → **STARTTLS required** (`requireTLS: true`), not opportunistic. |
| `OM_ALLOW_INSECURE_SMTP` | boolean, default `false` | Operator opt-in permitting a cleartext send when `SMTP_SECURE=false`. Required for MailDev/Mailpit and CI mail sinks. Named after the existing `OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT` precedent. |
| `SMTP_TIMEOUT_MS` | optional int | Applied to nodemailer `connectionTimeout` and `socketTimeout`. |

Numeric parsing uses `@open-mercato/shared/lib/number`; boolean parsing uses `@open-mercato/shared/lib/boolean`; the config object is validated with a zod schema in `config.ts` and typed via `z.infer`.

## API Contracts

No HTTP API changes, and — unlike the first draft of this spec — **no change to any exported type**. `SendEmailOptions` keeps its current shape:

```ts
export type SendEmailOptions = {
  to: string
  subject: string
  react: React.ReactElement
  from?: string
  replyTo?: string
  attachments?: Array<{ filename: string; content: string; contentType?: string }>
}

export async function sendEmail(options: SendEmailOptions): Promise<void>
```

Internal (non-exported-contract) additions in `transports/types.ts`:

```ts
type ResolvedEmailMessage = Omit<SendEmailOptions, 'from'> & { from: string }
interface EmailTransport { send(message: ResolvedEmailMessage): Promise<void> }
const EMAIL_STRATEGIES = ['resend', 'smtp'] as const
type EmailStrategyName = (typeof EMAIL_STRATEGIES)[number]

// `explicit` is unused in v1 (see Non-goals) and exists so a future per-call
// option is an additive change to this function, not a new parameter.
function resolveEmailTransportName(explicit?: EmailStrategyName): EmailStrategyName
```

Error contract (thrown `Error.message` prefixes, log-consumable):
- `RESEND_SEND_FAILED: <msg>` — unchanged.
- `RESEND_API_KEY is not set` — unchanged (now: thrown when resolution lands on resend, including the nothing-configured fallback, and still before any from-address check).
- `EMAIL_FROM_NOT_CONFIGURED: …` — unchanged.
- `SMTP_NOT_CONFIGURED: set SMTP_HOST` — new.
- `SMTP_SEND_FAILED: <msg>` — new (covers a refused STARTTLS upgrade).

## Implementation Plan

Ordered by dependency; each phase is independently reviewable and leaves the tree green.

| Phase | Work | Acceptance check |
|---|---|---|
| 1. Dependencies | Add `nodemailer`, `@types/nodemailer`, `@react-email/render` and the previously-undeclared `resend` to `packages/shared/package.json`; reconcile the nodemailer version; add the `react-email.d.ts` shim only if types fail to resolve. | `yarn workspace @open-mercato/shared build` and `yarn typecheck` pass with no new `any`. |
| 2. Extraction (no behavior change) | Create `transports/types.ts` and `transports/resend.ts` from the current `send.ts` body (including the lazy `await import('resend')`); reduce `send.ts` to the four normative steps with a single hardcoded resend dispatch. | `packages/shared/src/lib/email/__tests__/send.test.ts` passes **unchanged**. |
| 3. Resolver + config | Add `resolveEmailTransportName()` and zod-validated `resolveSmtpConfig()` (including TLS-policy resolution) to `config.ts`; wire step 2 of the façade to the resolver. | New resolution-order tests pass, including the nothing-configured case with the from-address vars cleared. |
| 4. SMTP transport | Implement `transports/smtp.ts`: lazy nodemailer, render html+text, attachment mapping, TLS policy table, per-call transporter with `close()` in `finally`, `SMTP_SEND_FAILED` wrapping. | New `__tests__/smtp.test.ts` passes; manual MailDev run delivers a password-reset mail. |
| 5. Documentation | `apps/mercato/.env.example` + the create-app template mirror; `packages/shared/AGENTS.md` Library Directory row. | Both `.env.example` files carry identical blocks (Template Sync Checklist). |

## Testing

- **Regression:** `packages/shared/src/lib/email/__tests__/send.test.ts` passes **unchanged**, proving the default Resend path and env short-circuits are untouched. Note its limits: it sets `RESEND_API_KEY: 'test-key'` in `beforeEach`, so it cannot detect a change in the nothing-configured ordering — case 6 below is what pins that.
- **New `packages/shared/src/lib/email/__tests__/smtp.test.ts`** (`jest.mock('nodemailer')` with `createTransport` → `{ sendMail, close }`, mocked `@react-email/render`, env save/restore per the existing test's pattern):
  1. Resolution order — auto-detect smtp when only `SMTP_HOST` set; resend wins when both configured; `EMAIL_STRATEGY=smtp` forces smtp despite a Resend key; unknown `EMAIL_STRATEGY` falls back to auto-detect and warns once.
  2. Transporter options built from env (host/port/auth/timeouts); `auth` omitted when credentials incomplete; `SMTP_SECURE` default true on 465, false on 587.
  3. **TLS policy** — `SMTP_SECURE=false` yields `requireTLS: true` + `rejectUnauthorized: true`; `SMTP_SECURE=true` yields `secure: true` + `rejectUnauthorized: true`; cleartext options appear **only** with `OM_ALLOW_INSECURE_SMTP=true`, and that path warns once; a server refusing the STARTTLS upgrade surfaces as `SMTP_SEND_FAILED`.
  4. `sendMail` receives rendered `html` + `text`, mapped `replyTo`, the from-chain result, and base64-mapped attachments.
  5. Failure wrapping to `SMTP_SEND_FAILED`; `close()` invoked on success and on failure.
  6. `OM_DISABLE_EMAIL_DELIVERY=1` → no transporter is created.
  7. **Nothing configured — with `RESEND_API_KEY`, `SMTP_HOST`, `EMAIL_STRATEGY`, `NOTIFICATIONS_EMAIL_FROM`, `EMAIL_FROM` and `ADMIN_EMAIL` all cleared** → throws `RESEND_API_KEY is not set`, *not* `EMAIL_FROM_NOT_CONFIGURED`. This is the test that enforces the normative step order.
- **Validation commands:** `yarn workspace @open-mercato/shared test`, `yarn workspace @open-mercato/shared build`, `yarn typecheck`, `yarn lint`.
- **Manual end-to-end (optional):** run MailDev (`maildev/maildev`, ports 1025/1080), set `SMTP_HOST=localhost SMTP_PORT=1025 SMTP_SECURE=false OM_ALLOW_INSECURE_SMTP=true EMAIL_FROM=test@example.com`, trigger a password-reset from the dev app, verify the message in the MailDev UI. The opt-in variable is required — without it the STARTTLS-required default correctly refuses to talk to MailDev in the clear.

## Risks & Impact Review

| # | Risk | Severity | Affected area | Mitigation | Residual risk |
|---|------|----------|---------------|------------|----------------|
| 1 | Behavior regression on the Resend path (all system email breaks) | High | Every email call site | Resend code moved verbatim into `transports/resend.ts`; existing test suite must pass unchanged; auto-detect keeps Resend first when both providers are configured. | Low — dispatch layer is a thin switch. |
| 2 | Unintended transport flip: an operator sets `SMTP_HOST` for an unrelated reason while relying on Resend | Medium | Deployments with partial env | Resend wins auto-detection whenever `RESEND_API_KEY` is present; explicit `EMAIL_STRATEGY` always available; `.env.example` documents the resolution order. | Low. |
| 3 | React → HTML rendering differences vs Resend's server-side rendering (layout/entity edge cases) | Medium | SMTP deployments only | Both use the React Email ecosystem (`@react-email/render` is what Resend runs under the hood for react payloads); plaintext alternative generated alongside; manual MailDev verification step. | Low-medium — cosmetic only, scoped to smtp users. |
| 4 | Credential leakage via logs | Medium | Operators | No SMTP config values are ever logged (AGENTS.md logger rule: never log credentials); errors carry only nodemailer's message; the insecure-transport warning names the env var, never the credentials. | Low. |
| 5 | TLS downgrade — reset links and invitation tokens sent in cleartext | High | SMTP deployments | `SMTP_SECURE=false` means STARTTLS-**required**, never opportunistic; certificate verification is never skipped; cleartext requires `OM_ALLOW_INSECURE_SMTP=true` and warns. Mirrors the `channel-imap` policy the repo already enforces. Pinned by test case 3. | Low — an operator can still opt into cleartext deliberately, which is the documented MailDev/CI workflow. |
| 6 | Refusing opportunistic STARTTLS breaks an existing relay that only offers cleartext | Low | Self-hosted operators with legacy relays | Failure is loud (`SMTP_SEND_FAILED`) rather than silent; `.env.example` documents the opt-in; this is a first release, so no deployment is relying on the old behavior. | Low. |
| 7 | New dependency surface in `@open-mercato/shared` (`nodemailer`, `@react-email/render`, declared `resend`) | Low | All consumers of shared | Lazy dynamic imports keep each provider SDK out of runtimes that use the other transport. `nodemailer` already exists in the graph (root `9.0.1`, `channel-imap` `^9.0.3`); `@react-email/render` arrives only transitively today (root declares `@react-email/components@^1.0.12` and `react-email@^6.9.1`) and becomes a declared dependency here; `resend` is likewise promoted from hoisting to a declaration. | Low. |
| 8 | Per-call transporter creation is slow under bulk sends | Low | High-volume smtp deployments | Accepted for v1 (transactional volume is low; matches channel-imap lifecycle); pooling documented as an explicit follow-up (`SMTP_POOL`). | Low. |
| 9 | SSRF via `SMTP_HOST` pointing at internal services | Low | Self-hosted operators | Out of scope by design: the value is operator-set env, equivalent in trust to `DATABASE_URL`/`REDIS_URL`. Revisit if per-tenant SMTP config is ever introduced (then reuse `channel-imap`'s `resolveSafeHostAddress`/`assertTransportAllowed`, hoisted into shared). | Accepted. |
| 10 | Lazy `import('resend')` shifts a broken/missing-package failure from process start to first send | Low | Resend deployments | Phase 1 declares `resend` in `packages/shared/package.json`, which is what actually creates the install-time guarantee (today the import relies on hoisting); the unit suite exercises the resend transport, so a broken module fails in CI, not in production. | Low. |

Impact summary: no DB schema, no HTTP API, no ACL, no events, no generated files, no UI, and **no change to any exported type**. Two new error-string prefixes; three new declared deps plus one promoted from hoisting, in one package; documentation touches with the mandatory create-app template mirror.

## Final Compliance Report

- **Backward compatibility:** `sendEmail`'s signature and `SendEmailOptions` are untouched; default behavior byte-identical for every existing env configuration (Resend-only, disabled, unconfigured), with the normative step order making the nothing-configured error identical to today's. No contract surface removed or renamed — no deprecation protocol required.
- **AGENTS.md conformance:** no `any` (zod + `z.infer` for SMTP config, typed nodemailer via `@types/nodemailer`); boolean/number parsing through shared helpers; logging via `createLogger('email')`; shared package gains no domain logic and no imports from domain packages; error literals are operator-facing library errors consistent with the file's existing style (no i18n surface).
- **Security conformance:** the transport-security stance matches the existing `channel-imap` policy (TLS required, certificate verification never skipped, cleartext behind a named operator opt-in) rather than nodemailer's weaker default.
- **Env conventions:** `EMAIL_STRATEGY` matches the unprefixed `*_STRATEGY` selector convention; the `OM_ALLOW_INSECURE_SMTP` opt-in matches the `OM_`-prefixed safety-override convention; `SMTP_*` documented in `apps/mercato/.env.example` and mirrored into `packages/create-app/template/.env.example` in the same change (Template Sync Checklist).
- **Testing policy:** behavior change ships with unit tests in the same change; no seeded-data reliance; no integration-test surface (no API/UI paths affected).
- **Out-of-scope confirmations:** no `yarn db:migrate`, no generated-file edits, no cross-module coupling added, no provider package created (SMTP is infrastructure-level transport, not a marketplace integration).

## Changelog

- **2026-08-17** — Upstream review feedback (open-mercato/open-mercato#5303): fixed the execution-order contradiction by making transport resolution precede from-address resolution (normative step list + test case 7); adopted the `channel-imap` TLS policy instead of nodemailer's opportunistic STARTTLS (`OM_ALLOW_INSECURE_SMTP` opt-in, new risks 5 and 6); dropped the per-call `transport` option from v1 as having no consumer, leaving every exported type unchanged; declared `resend` in shared's `package.json` so risk 10's mitigation is true; added an Implementation Plan; corrected the call-site count to 17 files / 26 call sites and the `@react-email/render` dependency-graph claim.
- **2026-08-14** — Review feedback (fork PR #88): both provider SDKs are lazily imported inside their transports — `resend` too, not just `nodemailer` — so each deployment loads only the SDK of the transport it uses.
- **2026-08-14** — Spec created. Status: pending implementation.
