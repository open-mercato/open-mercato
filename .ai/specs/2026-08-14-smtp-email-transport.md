# SMTP Transport for Transactional Email

## TLDR

**Key Points:**
- Adds an **SMTP (nodemailer) transport** to the system transactional email pipeline in `packages/shared/src/lib/email/`, alongside the existing hardcoded Resend path.
- `sendEmail()` stays the single façade with its **signature unchanged** — all ~14 existing call sites (auth reset/invite, notifications, messages, checkout, sales quotes, customer_accounts, onboarding, enterprise security) keep working with zero edits.
- Transport resolution, in priority order: (1) new optional per-call `transport?: 'resend' | 'smtp'` field on `SendEmailOptions`, (2) `EMAIL_STRATEGY` env (`resend` | `smtp`), (3) auto-detection — `RESEND_API_KEY` set → resend, else `SMTP_HOST` set → smtp, (4) neither configured → current behavior (throw `RESEND_API_KEY is not set`).
- The SMTP path renders the React Email element to HTML + plaintext via `@react-email/render` and maps the existing base64 attachment shape to nodemailer's format. Both provider SDKs are imported lazily inside their transports — Resend-only deployments never load nodemailer, and SMTP-only deployments never load the Resend SDK.
- Motivation: downstream apps built on `@open-mercato/*` npm packages cannot use SMTP today (self-hosted mail, MailDev/Mailpit in dev, EU-hosted SMTP relays). An app-level shim cannot fix this because core packages import `@open-mercato/shared/lib/email/send` directly — the transport must live upstream.

**Scope (v1):**
- New `packages/shared/src/lib/email/transports/{types,resend,smtp}.ts`; `send.ts` becomes a dispatcher.
- Env-driven SMTP config: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `SMTP_TIMEOUT_MS`.
- New deps of `@open-mercato/shared`: `nodemailer` (+ `@types/nodemailer`), `@react-email/render`.
- `.env.example` documentation (mirrored into the create-app template) and a `packages/shared/AGENTS.md` Library Directory row.
- Unit tests for resolution order, config parsing, rendering/attachment mapping, and error wrapping; existing `send.test.ts` passes unchanged.

**Non-goals (v1):**
- Per-tenant SMTP configuration UI or credential storage — config is operator-level env, matching `CACHE_STRATEGY`/`QUEUE_STRATEGY` precedent.
- SSRF/host-pinning hardening (`resolveSafeHostAddress` / `assertTransportAllowed` from `channel-imap`) — `SMTP_HOST` is operator-controlled env, not tenant/user input; hoisting those helpers into shared is deliberate future work if per-tenant config ever lands.
- Connection pooling / transporter reuse — per-call create + close, matching `channel-imap`'s `NodemailerClient` lifecycle. A `SMTP_POOL` knob can follow if volume warrants.
- Registering an `emailService` DI value — the dead resolve hook at `packages/core/src/modules/workflows/lib/activity-executor.ts` (SEND_EMAIL activity) stays future work.
- Migrating the two Resend-direct `inbox_ops` routes (`api/proposals/[id]/replies/[replyId]/send`, `api/webhook/inbound`) — the inbound webhook is inherently Resend-specific; the reply-send route keeps threading headers Resend-side.
- Per-user mailbox sending — that is the Communications Hub / `channel-imap` surface (see `.ai/specs/2026-05-21-email-integration-foundation.md`), which explicitly keeps this transactional pipeline separate.
- Recipient allowlist gating (`EMAIL_ALLOWLIST_DOMAINS`-style) — separate feature if needed.

---

## Overview

Open Mercato has exactly one system transactional email path: `sendEmail()` in `packages/shared/src/lib/email/send.ts`. It is a plain exported function (not a DI service) that hardcodes the Resend SDK, keyed off `RESEND_API_KEY`, and throws when the key is missing. Roughly 14 call sites across `core` (auth, notifications, messages, sales, customer_accounts), `checkout`, `onboarding`, and `enterprise` import it directly.

Deployments that cannot or do not want to use Resend — self-hosted installs, EU data-residency SMTP relays, local development against MailDev/Mailpit, CI mail sinks — have no supported way to deliver system email. Because the call sites live inside published `@open-mercato/*` packages, a downstream app cannot shim the transport; the capability must be added upstream in `@open-mercato/shared`.

The repo already contains a proven nodemailer wrapper (`packages/channel-imap/src/modules/channel_imap/lib/smtp-client.ts`), but it is bound to per-user integration credentials under the Communications Hub and is not reachable from the transactional pipeline — and `@open-mercato/shared` must not depend on a provider package.

## Problem Statement

1. **Resend is hardcoded.** `send.ts` constructs `new Resend(apiKey)` inline; there is no transport abstraction, no strategy selection, no fallback. Without `RESEND_API_KEY` every system email throws.
2. **Downstream apps cannot substitute a transport.** Core packages import `@open-mercato/shared/lib/email/send` directly, so an app-level replacement would only cover the app's own call sites, leaving password resets, invitations, and notifications Resend-only.
3. **No SMTP env surface exists.** `.env.example` documents only `RESEND_API_KEY` and the from-address chain (`NOTIFICATIONS_EMAIL_FROM` → `EMAIL_FROM` → `ADMIN_EMAIL`); there is no `SMTP_*` variable anywhere in the transactional path.
4. **The transport contract is Resend-shaped.** `SendEmailOptions.react` is a React element and attachments are base64 strings with Resend field names (`reply_to`) — an SMTP path needs explicit rendering and mapping, which no shared utility provides.

## Proposed Solution

Keep `sendEmail()` as the stable façade owning all cross-cutting behavior — the `OM_DISABLE_EMAIL_DELIVERY` / `OM_TEST_MODE` short-circuit and `resolveDefaultEmailFromAddress()` from-address resolution — and delegate delivery to one of two transports selected by a small resolver.

### Transport resolution

```
explicit `transport` option on the call
  → EMAIL_STRATEGY env ('resend' | 'smtp'; unknown value logs one warning and falls through)
    → auto-detect: RESEND_API_KEY set → 'resend'; else SMTP_HOST set → 'smtp'
      → neither configured → throw 'RESEND_API_KEY is not set'  (existing behavior, unchanged)
```

Backward compatibility invariant: a deployment with only `RESEND_API_KEY` set behaves byte-identically to today; a deployment with nothing set fails with the same error as today. `EMAIL_STRATEGY` follows the repo's unprefixed `*_STRATEGY` convention (`CACHE_STRATEGY`, `QUEUE_STRATEGY`, `RATE_LIMIT_STRATEGY`).

### Lazy provider SDK loading

Each transport lazily imports its provider SDK inside the send path (`await import('nodemailer')` in the smtp transport, `await import('resend')` in the resend transport), so a deployment only ever loads the SDK of the transport it actually uses — and neither loads under disabled-delivery configurations. This only shifts *when* the module is loaded (first send instead of process start); the constructed client, request payloads, and error behavior are unchanged.

### SMTP transport behavior

- Lazy nodemailer import as described above.
- Render the React element once per send: `render(react)` for HTML and `render(react, { plainText: true })` for the text alternative (deliverability win, free with `@react-email/render`).
- Map attachments `{ filename, content (base64), contentType }` → nodemailer `{ filename, content, encoding: 'base64', contentType }`.
- Create the transporter per call and `close()` it in `finally` — the same lifecycle as `channel-imap`'s `NodemailerClient`, with no shared mutable state and hot-reload safety.
- Wrap failures as `SMTP_SEND_FAILED: <message>` (mirrors `RESEND_SEND_FAILED`). Missing `SMTP_HOST` when the smtp transport is explicitly selected throws `SMTP_NOT_CONFIGURED: set SMTP_HOST`.
- All error strings are developer/operator-facing (thrown from a shared library, surfaced in logs), consistent with the existing `RESEND_SEND_FAILED` / `EMAIL_FROM_NOT_CONFIGURED` literals in this file.

## Architecture

```
packages/shared/src/lib/email/
├── send.ts                 # façade: disable-check → from-resolution → resolve transport → dispatch
├── config.ts               # existing from-address chain + NEW resolveEmailTransportName(), resolveSmtpConfig()
└── transports/
    ├── types.ts            # ResolvedEmailMessage, EmailTransport, EMAIL_STRATEGIES / EmailStrategyName
    ├── resend.ts           # current send.ts Resend body (per-call `new Resend`, reply_to, RESEND_SEND_FAILED), SDK imported lazily
    └── smtp.ts             # lazy nodemailer, @react-email/render html+text, attachment mapping, SMTP_SEND_FAILED
```

| File | Change |
|------|--------|
| `packages/shared/src/lib/email/send.ts` | `SendEmailOptions` gains optional `transport?: 'resend' \| 'smtp'` (additive). Body keeps the disable-check and from-address throw, then dispatches on `resolveEmailTransportName(options.transport)`. |
| `packages/shared/src/lib/email/config.ts` | Add `resolveEmailTransportName(explicit?)` (resolution chain above; one-time `createLogger('email')` warning on unknown `EMAIL_STRATEGY`) and zod-validated `resolveSmtpConfig()`. |
| `packages/shared/src/lib/email/transports/resend.ts` | Extraction of the existing Resend code path. The one deliberate delta: the static `import { Resend } from 'resend'` becomes a lazy `await import('resend')` so SMTP-only deployments never load the Resend SDK (review feedback on the fork PR); send behavior is otherwise identical. |
| `packages/shared/src/lib/email/transports/smtp.ts` | New transport as described above. |
| `packages/shared/package.json` | Add `nodemailer`, `@types/nodemailer`, `@react-email/render`. Version aligned with the monorepo's existing nodemailer pin (root `9.0.1` vs `channel-imap` `^9.0.3` — reconcile to one during implementation). If `@react-email/render` types do not resolve under shared's tsconfig, extend `packages/shared/src/types/react-email.d.ts` with a minimal typed `render` declaration (no `any`). |
| `apps/mercato/.env.example` + `packages/create-app/template/.env.example` | Document `EMAIL_STRATEGY` + `SMTP_*` in the email provider block, identical comments in both (create-app Template Sync Checklist). |
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
| `SMTP_SECURE` | boolean (`parseBooleanWithDefault`), default `true` iff port `465`, else `false` | Implicit TLS. STARTTLS on 587 is nodemailer's default upgrade behavior when `secure` is false. |
| `SMTP_TIMEOUT_MS` | optional int | Applied to nodemailer `connectionTimeout` and `socketTimeout`. |

Numeric parsing uses `@open-mercato/shared/lib/number`; boolean parsing uses `@open-mercato/shared/lib/boolean`; the config object is validated with a zod schema in `config.ts` and typed via `z.infer`.

## API Contracts

No HTTP API changes. The affected contract surface is the shared library function (BACKWARD_COMPATIBILITY.md category: types/signatures — **additive only**):

```ts
export type SendEmailOptions = {
  to: string
  subject: string
  react: React.ReactElement
  from?: string
  replyTo?: string
  attachments?: Array<{ filename: string; content: string; contentType?: string }>
  transport?: 'resend' | 'smtp'        // NEW, optional — omitting it preserves existing behavior
}

export async function sendEmail(options: SendEmailOptions): Promise<void>
```

Internal (non-exported-contract) additions in `transports/types.ts`:

```ts
type ResolvedEmailMessage = Omit<SendEmailOptions, 'from' | 'transport'> & { from: string }
interface EmailTransport { send(message: ResolvedEmailMessage): Promise<void> }
const EMAIL_STRATEGIES = ['resend', 'smtp'] as const
type EmailStrategyName = (typeof EMAIL_STRATEGIES)[number]
```

Error contract (thrown `Error.message` prefixes, log-consumable):
- `RESEND_SEND_FAILED: <msg>` — unchanged.
- `RESEND_API_KEY is not set` — unchanged (now: thrown when resolution lands on resend, including the nothing-configured fallback).
- `EMAIL_FROM_NOT_CONFIGURED: …` — unchanged.
- `SMTP_NOT_CONFIGURED: set SMTP_HOST` — new.
- `SMTP_SEND_FAILED: <msg>` — new.

## Testing

- **Regression:** `packages/shared/src/lib/email/__tests__/send.test.ts` passes **unchanged**, proving the default Resend path and env short-circuits are untouched.
- **New `packages/shared/src/lib/email/__tests__/smtp.test.ts`** (`jest.mock('nodemailer')` with `createTransport` → `{ sendMail, close }`, mocked `@react-email/render`, env save/restore per the existing test's pattern):
  1. Resolution order — auto-detect smtp when only `SMTP_HOST` set; resend wins when both configured; `EMAIL_STRATEGY=smtp` forces smtp despite a Resend key; per-call `transport: 'smtp'` overrides env; unknown `EMAIL_STRATEGY` falls back to auto-detect.
  2. Transporter options built from env (host/port/secure/auth/timeouts); `auth` omitted when credentials incomplete; `SMTP_SECURE` default true on 465, false on 587.
  3. `sendMail` receives rendered `html` + `text`, mapped `replyTo`, the from-chain result, and base64-mapped attachments.
  4. Failure wrapping to `SMTP_SEND_FAILED`; `close()` invoked on success and on failure.
  5. `OM_DISABLE_EMAIL_DELIVERY=1` → no transporter is created.
  6. Nothing configured → still throws `RESEND_API_KEY is not set`.
- **Validation commands:** `yarn workspace @open-mercato/shared test`, `yarn workspace @open-mercato/shared build`, `yarn typecheck`, `yarn lint`.
- **Manual end-to-end (optional):** run MailDev (`maildev/maildev`, ports 1025/1080), set `SMTP_HOST=localhost SMTP_PORT=1025 SMTP_SECURE=false EMAIL_FROM=test@example.com`, trigger a password-reset from the dev app, verify the message in the MailDev UI.

## Risks & Impact Review

| # | Risk | Severity | Affected area | Mitigation | Residual risk |
|---|------|----------|---------------|------------|----------------|
| 1 | Behavior regression on the Resend path (all system email breaks) | High | Every email call site | Resend code moved verbatim into `transports/resend.ts`; existing test suite must pass unchanged; auto-detect keeps Resend first when both providers are configured. | Low — dispatch layer is a thin switch. |
| 2 | Unintended transport flip: an operator sets `SMTP_HOST` for an unrelated reason while relying on Resend | Medium | Deployments with partial env | Resend wins auto-detection whenever `RESEND_API_KEY` is present; explicit `EMAIL_STRATEGY` always available; `.env.example` documents the resolution order. | Low. |
| 3 | React → HTML rendering differences vs Resend's server-side rendering (layout/entity edge cases) | Medium | SMTP deployments only | Both use the React Email ecosystem (`@react-email/render` is what Resend runs under the hood for react payloads); plaintext alternative generated alongside; manual MailDev verification step. | Low-medium — cosmetic only, scoped to smtp users. |
| 4 | Credential leakage via logs | Medium | Operators | No SMTP config values are ever logged (AGENTS.md logger rule: never log credentials); errors carry only nodemailer's message. | Low. |
| 5 | New dependency surface in `@open-mercato/shared` (`nodemailer`, `@react-email/render`) | Low | All consumers of shared | Lazy dynamic imports keep each provider SDK out of runtimes that use the other transport; both libraries already exist in the monorepo dependency graph (channel-imap, react-email tooling); versions reconciled with the existing root pin. | Low. |
| 6 | Per-call transporter creation is slow under bulk sends | Low | High-volume smtp deployments | Accepted for v1 (transactional volume is low; matches channel-imap lifecycle); pooling documented as an explicit follow-up (`SMTP_POOL`). | Low. |
| 7 | SSRF via `SMTP_HOST` pointing at internal services | Low | Self-hosted operators | Out of scope by design: the value is operator-set env, equivalent in trust to `DATABASE_URL`/`REDIS_URL`. Revisit if per-tenant SMTP config is ever introduced (then reuse `channel-imap`'s `resolveSafeHostAddress`/`assertTransportAllowed`, hoisted into shared). | Accepted. |
| 8 | Lazy `import('resend')` shifts a broken/missing-package failure from process start to first send | Low | Resend deployments | The package remains a regular declared dependency (install-time guarantee unchanged); the unit suite exercises the resend transport, so a broken module fails in CI, not in production. | Low. |

Impact summary: no DB schema, no HTTP API, no ACL, no events, no generated files, no UI. One additive optional field on an exported type; two new error-string prefixes; three new deps in one package; documentation touches with the mandatory create-app template mirror.

## Final Compliance Report

- **Backward compatibility:** `sendEmail` signature additive-only; default behavior byte-identical for every existing env configuration (Resend-only, disabled, unconfigured). No contract surface removed or renamed — no deprecation protocol required.
- **AGENTS.md conformance:** no `any` (zod + `z.infer` for SMTP config, typed nodemailer via `@types/nodemailer`); boolean/number parsing through shared helpers; logging via `createLogger('email')`; shared package gains no domain logic and no imports from domain packages; error literals are operator-facing library errors consistent with the file's existing style (no i18n surface).
- **Env conventions:** `EMAIL_STRATEGY` matches the unprefixed `*_STRATEGY` selector convention; `SMTP_*` documented in `apps/mercato/.env.example` and mirrored into `packages/create-app/template/.env.example` in the same change (Template Sync Checklist).
- **Testing policy:** behavior change ships with unit tests in the same change; no seeded-data reliance; no integration-test surface (no API/UI paths affected).
- **Out-of-scope confirmations:** no `yarn db:migrate`, no generated-file edits, no cross-module coupling added, no provider package created (SMTP is infrastructure-level transport, not a marketplace integration).

## Changelog

- **2026-08-14** — Review feedback (fork PR #88): both provider SDKs are lazily imported inside their transports — `resend` too, not just `nodemailer` — so each deployment loads only the SDK of the transport it uses.
- **2026-08-14** — Spec created. Status: pending implementation.
