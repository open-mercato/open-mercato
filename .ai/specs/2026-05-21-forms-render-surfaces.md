# Forms Module — Render Surfaces (Embeddable Form Widget & Surface Unification)

> **Parent:** [`2026-04-22-forms-module.md`](./2026-04-22-forms-module.md)
> **Depends on:** [Phase 1d Public Renderer](./2026-04-22-forms-phase-1d-public-renderer.md), [Phase 2d Distribution & Anonymous Submission](./2026-05-20-forms-distribution-and-anonymous-submission.md).
> **Unblocks:** marketing-site lead capture, in-app contextual forms (form on a customer/deal/product record), "leave feedback" CTAs, partner/third-party embeds.
> **Scope:** Open Source (`.ai/specs/`).
> **Session sizing:** ~1.5–2 weeks.

## TLDR

- A published form can already be rendered **two** ways today: an **authenticated customer-portal page** (`frontend/[orgSlug]/portal/forms/[key]`) and a **standalone hosted link** (`/f/:slug` open distribution, `/i/:token` personal invitation). Both mount the *same* `<FormRunner>` with a different `RuntimeClient` (auth vs anonymous).
- This spec adds the third (and explicitly requested) way — an **injectable widget** — and, because the rendering core is already transport-agnostic, formalizes the full surface taxonomy so every channel reuses **one** rendering primitive. No new submission/persistence path is introduced.
- New surfaces: **(S3) internal injection widget** (drop a form into any module's admin/portal page via the existing widget-injection system), **(S4) external website embed** (iframe loader script for third-party sites), and **(S5) trigger/dialog** (open any form in a dialog/sheet from a button anywhere). **(S6) headless API render** is documented as a first-class supported mode (it already works via `GET /api/forms/:id/run/context`).
- The keystone is a single exported `<EmbeddedForm>` component — a thin bootstrap over `<FormRunner>` that picks the right `RuntimeClient` from a small `source` discriminator. Every surface is a wrapper around it; `FormRunner` itself is **not forked**.

## Decisions (made for you — redirect any of these)

The session is running in "don't stop to ask" mode, so the following architectural calls are baked in. Each is reversible at spec-review time.

- **D1 — One rendering primitive.** Add `<EmbeddedForm>` (in `ui/public/`) as the single bootstrap over `<FormRunner>`. `PublicFormRunnerPage` (S2) and the portal page (S1) are refactored to delegate to it so there is exactly one place that resolves context → mints/loads a submission → builds a `RuntimeClient` → mounts the runner. No visual change to `FormRunner`'s tree.
- **D2 — `source` discriminator, not new clients.** `<EmbeddedForm>` accepts a `source` union: `{ kind: 'portal'; formKey; subjectType; subjectId }` (→ `createAuthRuntimeClient`), `{ kind: 'distribution'; slug }` / `{ kind: 'invitation'; token }` (→ `createAnonymousRuntimeClient`). The two existing clients are reused unchanged; no third transport is invented.
- **D3 — Internal injection widget reuses the existing widget system.** A generic, parameterized widget `forms.injection.embedded-form` mounts `<EmbeddedForm>`. Host modules place it via `widgets/injection-table.ts` against a spot and pass `{ source }` through `InjectionSpot` props. This is the same mechanism the phase-2b compliance widgets already use — third-party modules copy the pattern unchanged.
- **D4 — External embed is iframe-based, not inline DOM injection.** The embed is a tiny loader script (`embed.js`) that injects an `<iframe>` pointing at an OM-hosted host page (`/embed/:slug`) and handles auto-resize via `postMessage`. Rationale: full style isolation, **no CORS** (all API calls are same-origin *inside* the iframe), no access-token exposure to the host page's JS, and a clean CSP story. Inline (CORS + Shadow DOM) embedding is explicitly **out of scope** (documented as a future option, R-RS-7).
- **D5 — Embeddable forms must be backed by an *open* distribution.** Only `mode='open'`, `status='active'`, `require_customer_auth=false` distributions can be embedded externally (S4) — there is no session inside a third-party iframe. Auth-required forms can still use S1/S3/S5. The embed host page reuses the existing `/api/forms/public/*` anonymous lifecycle verbatim.
- **D6 — Framing security is per-distribution and opt-in.** Embedding is disabled by default. A distribution opts in via `settings.embed = { enabled: true, allowedDomains: string[], theme?, autoResize? }`. The `/embed/*` route segment emits a `Content-Security-Policy: frame-ancestors` header derived from `allowedDomains` (and drops `X-Frame-Options`); **every other route keeps the app's existing frame protection**. This lives in `settings` JSON — **no migration required**.
- **D7 — Trigger/dialog is a thin client surface.** `<FormTrigger>` + `useFormDialog()` mount `<EmbeddedForm>` inside the DS `Dialog`/`Sheet` primitive. `Cmd/Ctrl+Enter` submit + `Escape` cancel come from the primitive. No new API.
- **D8 — Headless is documentation, not code.** `GET /api/forms/:id/run/context` (compiled schema + field descriptors) already lets a consumer render fully custom UI and POST through the public/auth runtime. This spec promotes it to a documented surface (S6) and adds no new endpoint.

## Overview

The forms submission core (1c), public renderer (1d), and distribution layer (2d) already implement everything hard about *running* a form: versioned compiled schemas, encrypted append-only revisions, optimistic-concurrency autosave, role-sliced reads, submit, anonymous token persistence, abuse controls. Critically, `ui/public/FormRunner.tsx` takes an injected `client: RuntimeClient`, so **the runner has no opinion about where it is mounted or who the participant is** — that is decided entirely by the bootstrap wrapper and the chosen client.

That decoupling is what makes "render a form in N places" a thin, additive feature rather than a rewrite. Today only two bootstrap wrappers exist (the portal page and `PublicFormRunnerPage`). This spec extracts the shared bootstrap into one `<EmbeddedForm>` primitive and adds new mounting surfaces around it.

## Problem Statement

Verified against the current branch:

1. **No injectable widget.** The module's `widgets/injection-table.ts` only maps four *compliance* widgets onto `submission-drawer:*` spots. There is no widget that renders a fillable form, and no way to drop a form into another module's page (e.g. a satisfaction form on a customer record, an intake form on a deal).
2. **No external/third-party embed.** Forms can only be filled on OM-hosted pages. There is no loader script, no iframe host route, and no `frame-ancestors` policy — the app is frame-protected globally, so a `/f/:slug` page cannot be embedded on a marketing site.
3. **No trigger/dialog surface.** A form can only be reached by navigating to its page; there is no "open this form in a dialog from a button" affordance.
4. **Bootstrap logic is duplicated and surface-specific.** The portal page and `PublicFormRunnerPage` each re-implement the resolve-context → start → build-client → mount-runner sequence. Adding surfaces by copy-paste would multiply that duplication and drift.

## Proposed Solution

1. Extract a single `<EmbeddedForm>` primitive (`ui/public/EmbeddedForm.tsx`) that takes a `source` discriminator, runs the shared bootstrap, and mounts `<FormRunner>`. Refactor S1 (portal page) and S2 (`PublicFormRunnerPage`) to delegate to it (behavior-preserving).
2. Add `forms.injection.embedded-form` — a parameterized injection widget that renders `<EmbeddedForm source={...} />` from props supplied by the host `InjectionSpot`. Declare a self-spot (`forms:embed`) so the module also dogfoods it.
3. Add the external embed: an `/embed/:slug` host page (reuses the S2 anonymous flow under a permissive `frame-ancestors`) and a static loader script served at a stable path that injects the iframe and wires `postMessage` auto-resize.
4. Add framing-policy plumbing: read `distribution.settings.embed`, emit `frame-ancestors` only for `/embed/*`, and gate embed eligibility on `mode='open' && active && !require_customer_auth`.
5. Add `<FormTrigger>` + `useFormDialog()` (S5) for dialog/sheet mounting.
6. Document S6 (headless) and the full surface matrix in `packages/forms/AGENTS.md` and the docs site.

## Architecture

### Rendering primitive (the keystone)

```
                         ┌────────────────────────────┐
   source discriminator  │       <EmbeddedForm>        │   one bootstrap:
   ─────────────────────▶│  resolve context            │   resolve → start →
                         │  → start/load submission    │   build client → mount
                         │  → build RuntimeClient       │
                         │  → <FormRunner client=…/>   │
                         └────────────────────────────┘
                                      ▲
        ┌──────────────┬──────────────┼──────────────┬───────────────┐
   S1 portal page   S2 hosted link  S3 injection   S4 /embed host   S5 dialog
   (auth client)    (anon client)   widget         (anon, framed)   (any client)
```

`source` union (D2):

| `source.kind` | Fields | Client | Used by |
|---|---|---|---|
| `portal` | `formKey`, `subjectType`, `subjectId` | `createAuthRuntimeClient` | S1, S3 (in-portal/admin), S5 |
| `distribution` | `slug` | `createAnonymousRuntimeClient` | S2, S4, S5 |
| `invitation` | `token` | `createAnonymousRuntimeClient` | S2, S5 |

`<EmbeddedForm>` reuses the exact bootstrap currently inside `PublicFormRunnerPage` (GET context → POST `/start` → build anonymous client) for the `distribution`/`invitation` kinds, and the portal page's auth bootstrap for the `portal` kind. The four bootstrap phases (`loading` / `auth_required` / `unavailable` / `error` / `ready`) are preserved.

### New / changed files

```
packages/forms/src/modules/forms/
├─ ui/public/
│  ├─ EmbeddedForm.tsx                 # NEW — single bootstrap primitive over <FormRunner> (D1/D2)
│  ├─ PublicFormRunnerPage.tsx         # REFACTOR — delegates to <EmbeddedForm source={distribution|invitation}>
│  ├─ FormTrigger.tsx                  # NEW — <FormTrigger> + useFormDialog() (S5, D7)
│  └─ index.ts                         # +export EmbeddedForm, FormTrigger, useFormDialog, EmbeddedFormSource
├─ widgets/
│  ├─ injection-table.ts               # +forms:embed spot → forms.injection.embedded-form
│  └─ injection/
│     └─ embedded-form/
│        └─ widget.tsx                 # NEW — reads { source } from injection props, renders <EmbeddedForm>
├─ frontend/
│  └─ embed/[slug]/page.tsx            # NEW — external iframe host page (S4); reuses anonymous flow (D4/D5)
├─ lib/
│  └─ embed-frame-policy.ts            # NEW — build frame-ancestors CSP from distribution.settings.embed (D6)
├─ api/public/distributions/[slug]/route.ts  # +echo settings.embed (theme/autoResize) into context (additive)
└─ services/distribution-service.ts    # +isEmbeddable(distribution) guard (mode=open & active & !auth) (D5)

apps/mercato/public/forms/
└─ embed.js                            # NEW — static loader: inject iframe + postMessage auto-resize (D4)
                                       #   (served from the app; the iframe content is the OM host page)
```

Frontend portal page (`frontend/[orgSlug]/portal/forms/[key]/page.tsx`) is refactored to mount `<EmbeddedForm source={{ kind: 'portal', … }} />`.

### External embed flow (S4)

```
Third-party site HTML:
  <div data-om-form="SLUG"></div>
  <script src="https://app.example.com/forms/embed.js" async></script>
        │
        ▼  embed.js runs on the host page
  for each [data-om-form]: create <iframe src="https://app.example.com/embed/SLUG">
        │                  listen for postMessage { type: 'om-forms:resize', height } from app origin
        ▼
  /embed/:slug (OM host page, inside iframe)
        │  identical to /f/:slug bootstrap, but:
        │   - layout chrome stripped (form only)
        │   - response sets CSP frame-ancestors from settings.embed.allowedDomains (D6)
        │   - posts { type:'om-forms:resize', height } to window.parent on size change + on submit
        ▼
  GET /api/forms/public/distributions/:slug  →  POST /api/forms/public/start  →  autosave/submit
        (all same-origin within the iframe — no CORS, no token exposure to host page JS)
```

The host page validates the parent origin against `allowedDomains` before posting messages, and `embed.js` validates that incoming messages originate from the OM app origin before resizing (R-RS-4).

## Data Models

**No new tables. No migration.** Embed configuration rides on the existing `forms_distribution.settings` JSON column (added in 2d):

```ts
// forms_distribution.settings.embed (all optional; absent ⇒ embedding disabled)
{
  enabled: boolean              // master switch (default false)
  allowedDomains: string[]      // e.g. ["https://www.acme.com", "https://acme.com"]; drives frame-ancestors
  theme?: 'light' | 'dark' | 'auto'
  autoResize?: boolean          // default true
}
```

`allowedDomains` entries are validated (origin shape, https-only except `localhost`) by the distribution Zod schema. An empty/absent `allowedDomains` with `enabled: true` is rejected at save time — embedding without an allowlist is not permitted (R-RS-1).

## API Contracts

No new endpoints. Two additive, backward-compatible changes:

| Method | Path | Change |
|---|---|---|
| `GET` | `/api/forms/public/distributions/:slug` | Additively include `embed: { theme, autoResize }` (NOT `allowedDomains`) in the resolved context so the host page can self-style. `410` semantics unchanged. |
| — | `/embed/:slug` (page route, not an API) | New SSR page; sets `Content-Security-Policy: frame-ancestors <allowedDomains>` and omits `X-Frame-Options`. Returns the same `410`/unavailable states as `/f/:slug` when the distribution is closed/capped or not embeddable. |

Headless surface (S6) is the **existing** `GET /api/forms/:id/run/context` + the public/auth save/submit routes — unchanged, now documented.

## Access Control

- **S1/S3-portal** rely on the existing customer/portal auth (`createAuthRuntimeClient`), role-sliced server-side exactly as today.
- **S3-admin** (rendering a form inside an admin page) is gated by the host page's own feature guard plus `forms.view`; the widget itself adds no new feature.
- **S2/S4/S5-anonymous** reuse the 2d public-runtime guard: distribution `status=active`, availability window, response cap, valid slug/token, optional CAPTCHA. No new ACL feature is introduced.
- **Embed eligibility** (D5) is enforced server-side in both `/embed/:slug` and `embed.js`'s target: a distribution that is not `mode='open' && active && !require_customer_auth && settings.embed.enabled` renders the unavailable state.
- No new `acl.ts` feature. (Optional future: a `forms.embed` design-time feature to gate *configuring* embed settings in the studio — noted, not in scope.)

## Risks & Impact Review

### R-RS-1 — Clickjacking / unrestricted framing
- **Severity**: High. **Mitigation**: framing is disabled by default; `frame-ancestors` is emitted **only** for `/embed/*` and **only** from an explicit per-distribution `allowedDomains` allowlist (https-only). `enabled: true` with an empty allowlist is rejected at save. Every other route keeps the app's global frame protection. Residual: a tenant mis-allowlists their own domain — contained to that distribution.

### R-RS-2 — Embedding an auth-required form externally (broken/insecure surface)
- **Severity**: Medium. **Mitigation**: D5 server-side guard — only `open && !require_customer_auth` distributions are embeddable; otherwise the host page renders the unavailable state. Integration test asserts a personal/auth distribution cannot be framed.

### R-RS-3 — Anonymous embed inherits 2d abuse vectors (spam, token leak, flood)
- **Severity**: High. **Mitigation**: S4 reuses the 2d anonymous lifecycle wholesale — `max_responses`, availability window, per-IP+token rate limit, optional CAPTCHA, ≥128-bit slug, signed dedupe cookie. No new persistence path means no new abuse surface. Residual identical to 2d (operator closes the distribution).

### R-RS-4 — `postMessage` spoofing / cross-origin message injection
- **Severity**: Medium. **Mitigation**: `embed.js` accepts only messages whose `event.origin` equals the OM app origin it loaded from; the host page posts resize messages only after validating `document.referrer`/ancestor against `allowedDomains`. Messages carry a namespaced `type` (`om-forms:*`); unknown types ignored.

### R-RS-5 — iframe auto-resize loop / layout thrash
- **Severity**: Low. **Mitigation**: resize messages are debounced and only sent on actual `ResizeObserver` height deltas above a threshold; `embed.js` clamps to a max height and ignores non-monotonic jitter.

### R-RS-6 — Bootstrap refactor regresses S1/S2 behavior
- **Severity**: Medium. **Mitigation**: `<EmbeddedForm>` is a pure extraction of the existing bootstrap; S1/S2 become thin wrappers. The 1d/2d runner behavior (autosave, resume, review, completion, redirect) is unchanged because `<FormRunner>` is untouched. Snapshot/behavioral tests for the portal and `/f/:slug` flows run before and after the refactor.

### R-RS-7 — Demand for inline (non-iframe) embedding
- **Severity**: Low (scope). **Mitigation**: explicitly out of scope. Inline embedding would require CORS on `/api/forms/public/*`, Shadow-DOM style isolation, and host-page CSP coordination. Documented as a future option; the iframe approach covers the common case without those risks.

### R-RS-8 — Theme/CSS leakage between host page and form
- **Severity**: Low. **Mitigation**: the iframe fully isolates styles (D4). `settings.embed.theme` selects light/dark/auto inside the iframe; nothing of the host page's CSS reaches the form and vice-versa.

## Implementation Steps

1. **Extract `<EmbeddedForm>`** (`ui/public/EmbeddedForm.tsx`): move the bootstrap state machine out of `PublicFormRunnerPage`; add the `source` discriminator (D2) and the `portal` branch (auth client). Export from `ui/public/index.ts`.
2. **Refactor S1 + S2** to delegate: `PublicFormRunnerPage` → `<EmbeddedForm source={distribution|invitation}>`; portal page → `<EmbeddedForm source={portal}>`. Behavior-preserving; run existing runner tests.
3. **Internal injection widget** (S3): add `widgets/injection/embedded-form/widget.tsx` reading `{ source }` from injection props; register `forms.injection.embedded-form`; add a `forms:embed` spot row to `injection-table.ts`. Document the prop contract for third-party host modules.
4. **Embed eligibility guard** (D5): `DistributionService.isEmbeddable(distribution)`; distribution Zod schema validates `settings.embed` (allowlist origin shape, https-only, non-empty when enabled).
5. **Frame policy** (`lib/embed-frame-policy.ts`): build `frame-ancestors` from `allowedDomains`; helper to attach the CSP header on the `/embed/*` response and ensure `X-Frame-Options` is not set there.
6. **Embed host page** (S4): `frontend/embed/[slug]/page.tsx` — chrome-stripped `<EmbeddedForm source={distribution}>`; emit the frame CSP; post `om-forms:resize` on `ResizeObserver` deltas and on submit; validate ancestor origin against the allowlist.
7. **Loader script**: `apps/mercato/public/forms/embed.js` — scan `[data-om-form]`, inject iframe to `/embed/:slug`, listen for `om-forms:resize` from the app origin (debounced, clamped). Plain ES5-safe IIFE, no framework, < a few KB.
8. **Context echo** (additive): include `embed: { theme, autoResize }` in `GET /api/forms/public/distributions/:slug` (never `allowedDomains`).
9. **Trigger/dialog** (S5): `ui/public/FormTrigger.tsx` — `<FormTrigger source={…}>` + `useFormDialog()` mounting `<EmbeddedForm>` in the DS `Dialog`/`Sheet`; `Cmd/Ctrl+Enter` submit, `Escape` cancel.
10. **Studio/admin wiring**: add an "Embed" tab/section to the distributions UI to toggle `settings.embed.enabled`, manage `allowedDomains`, pick `theme`, and copy the `<script>` + `<div data-om-form>` snippet. `apiCall`/`useGuardedMutation` only; semantic tokens only.
11. **Docs**: surface matrix (S1–S6) in `packages/forms/AGENTS.md` Phase Map + a docs page; document the headless render path (S6) and the embed snippet.

## Testing Strategy

- **Refactor parity (S1/S2)**: portal fill and `/f/:slug` open-link fill produce the same start→autosave→submit revision chain after the `<EmbeddedForm>` extraction as before (behavioral test).
- **Injection widget (S3)**: the `forms.injection.embedded-form` widget mounts and runs a form from injection props; an auth `source` uses the auth client, a `distribution` source uses the anonymous client.
- **External embed (S4)**: `/embed/:slug` for an embeddable open distribution renders form-only chrome and sets `frame-ancestors` to the allowlist; a non-embeddable distribution (personal / auth-required / disabled) renders unavailable; the response sets no `X-Frame-Options` on `/embed/*` and the global frame protection still applies elsewhere.
- **Embed security**: `embed.js` ignores `postMessage` from a non-app origin; host page ignores resize requests when the ancestor origin is not allowlisted; `settings.embed.enabled` with empty `allowedDomains` is rejected at save.
- **Trigger/dialog (S5)**: `<FormTrigger>` opens the dialog, runs the form, `Escape` cancels, `Cmd/Ctrl+Enter` submits.
- **Abuse parity (S4)**: rate limit, `max_responses` cap, CAPTCHA, and availability window behave identically to `/f/:slug` (reused 2d path).
- **Accessibility**: embed host page and dialog are keyboard-operable; iframe has an accessible title; focus is trapped in the dialog.
- **Unit**: `embed-frame-policy` builds correct `frame-ancestors`; `isEmbeddable` truth table; `settings.embed` Zod validation (origin shape, https-only, non-empty allowlist).

> Integration (Playwright) tests follow the same caveat noted in 2d — no integration harness is wired for the forms package yet. Ship unit coverage and add the integration suites above when a harness lands.

## Final Compliance Report — 2026-05-21

| Rule | Status | Notes |
|------|--------|-------|
| Singular entity/command/event naming | Compliant | No new entities/events; reuses 2d distribution/invitation |
| No cross-module ORM relationships | Compliant | Injection widget passes ids/keys via props; no ORM relations |
| `organization_id` + `tenant_id` scoping | Compliant | All reads go through existing 2d/1c services |
| Reuse rendering core; no fork | Compliant | `<FormRunner>` untouched; `<EmbeddedForm>` is a bootstrap wrapper (D1) |
| Single submission/persistence path | Compliant | Only the two existing `RuntimeClient`s are used (D2); no new write path |
| Zod validation + `openApi` on routes | Compliant | Only additive `settings.embed` validation + additive context field; no new API |
| Canonical HTTP/UI primitives | Compliant | `apiCall`/`useGuardedMutation`, DS `Dialog`/`Sheet`, semantic tokens |
| Framing/clickjacking posture | Compliant | `frame-ancestors` scoped to `/embed/*`, per-distribution allowlist, off by default (D6/R-RS-1) |
| Anonymous abuse controls | Compliant | S4 reuses 2d rate limit / cap / CAPTCHA / dedupe (R-RS-3) |
| Backward compatibility | Compliant | All changes additive; S1/S2 refactor is behavior-preserving |
| Design System tokens | Compliant | Semantic tokens; no arbitrary sizes; lucide icons |
| Append-only / encryption / role-slice / R1 invariants | Compliant | Inherited from 1c/1d/2d; not touched |

**Verdict: ready for implementation post-2d.**

## Surface Matrix (reference)

| # | Surface | Route / Mount | Client | Auth | Status |
|---|---------|---------------|--------|------|--------|
| S1 | Customer portal page | `frontend/[orgSlug]/portal/forms/[key]` | auth | portal customer | **Exists** (1d/1c) — refactor to `<EmbeddedForm>` |
| S2 | Standalone hosted link | `/f/:slug`, `/i/:token` | anonymous | none / token | **Exists** (2d) — refactor to `<EmbeddedForm>` |
| S3 | Injectable widget | `forms.injection.embedded-form` on any spot | auth or anonymous | host-dependent | **New** |
| S4 | External website embed | `embed.js` → `/embed/:slug` (iframe) | anonymous | none | **New** |
| S5 | Trigger / dialog | `<FormTrigger>` / `useFormDialog()` | any | source-dependent | **New** |
| S6 | Headless API render | `GET /api/forms/:id/run/context` + public/auth save/submit | caller-built | caller-defined | **Exists** — documented |

## Implementation Status

### Render Surfaces (S1–S6)

| Surface | Status | Date | Notes |
|---------|--------|------|-------|
| S1 — Portal page | Done | 2026-05-22 | `frontend/[orgSlug]/portal/forms/[key]/page.tsx` refactored to mount `<EmbeddedForm source={{ kind:'portal', … }} />`; behavior-preserving. |
| S2 — Standalone hosted link | Done | 2026-05-22 | `PublicFormRunnerPage` (`/f/:slug`, `/i/:token`) delegates to `<EmbeddedForm>`. |
| S3 — Injectable widget | Done | 2026-05-22 | `forms.injection.embedded-form` registered on the new `forms:embed` spot; reads `context.source` + optional `onReturnHome`/`className` from injection props. |
| S4 — External website embed | Done | 2026-05-22 | iframe host `frontend/embed/[slug]/page.tsx`, ES5 loader served by `GET /api/forms/public/embed-loader`, `embed-frame-policy.ts`, `isEmbeddable()`, `embedSettingsSchema`, additive `embed:{theme,autoResize}` context echo, admin `EmbedSettingsDialog`. **Live third-party framing now wired** via `apps/mercato/src/proxy.ts` + `GET …/embed-policy` (follow-up 2026-05-22). Iframe theme applied. |
| S5 — Trigger / dialog | Done | 2026-05-22 | `<FormTrigger>` + `useFormDialog()` mount `<EmbeddedForm>` in a DS `Dialog` (Escape closes; inner runner drives submit). |
| S6 — Headless API render | Done | 2026-05-22 | No new code — `GET /api/forms/:id/run/context` + the public/auth save/submit routes; promoted to a documented surface. |

#### Shipped artifacts

- `packages/forms/src/modules/forms/ui/public/EmbeddedForm.tsx` — single bootstrap primitive over `<FormRunner>` (D1/D2)
- `packages/forms/src/modules/forms/ui/public/index.ts` — exports `EmbeddedForm`, `FormTrigger`, `useFormDialog`, `EmbeddedFormSource`
- `packages/forms/src/modules/forms/frontend/[orgSlug]/portal/forms/[key]/page.tsx` — S1 refactor onto `<EmbeddedForm>`
- `packages/forms/src/modules/forms/ui/public/PublicFormRunnerPage.tsx` — S2 refactor onto `<EmbeddedForm>`
- `packages/forms/src/modules/forms/widgets/injection/embedded-form/widget.tsx` — S3 widget (`forms.injection.embedded-form`)
- `packages/forms/src/modules/forms/widgets/injection-table.ts` — `forms:embed` spot → `forms.injection.embedded-form`
- `packages/forms/src/modules/forms/frontend/embed/[slug]/page.tsx` — S4 chrome-stripped iframe host page
- `packages/forms/src/modules/forms/api/public/embed-loader/route.ts` — S4 ES5 loader script (`GET /api/forms/public/embed-loader`)
- `packages/forms/src/modules/forms/lib/embed-frame-policy.ts` — pure `buildFrameAncestorsCsp` / `readEmbedSettings` (D6)
- `packages/forms/src/modules/forms/services/distribution-service.ts` — `isEmbeddable()` guard (D5)
- `packages/forms/src/modules/forms/data/validators.ts` — `embedSettingsSchema` (config on `forms_distribution.settings.embed`)
- `packages/forms/src/modules/forms/api/public/distributions/[slug]/route.ts` — additive `embed:{theme,autoResize}` echo
- `packages/forms/src/modules/forms/ui/public/FormTrigger.tsx` — S5 `<FormTrigger>` + `useFormDialog()`
- admin `EmbedSettingsDialog` — toggle/copy snippet for `settings.embed`
- `packages/forms/src/modules/forms/__tests__/` — new 25-test `embed-frame-policy` suite

Embed snippet a user copies:

```html
<script src="https://YOUR-APP/api/forms/public/embed-loader" async></script>
<div data-om-form="YOUR-SLUG"></div>
```

Validation: full forms typecheck shows only 7 PRE-EXISTING unrelated baseline errors (none from this work); all 684 forms unit tests pass (including the new 25-test `embed-frame-policy` suite); `yarn generate` succeeded and registered the new widget, the `/embed/[slug]` route, and the embed-loader API.

#### Deviations from the spec

1. **~~External framing documented-but-not-shipped~~ — RESOLVED 2026-05-22.** Live third-party framing is now wired end-to-end. The app's global CSP rule in `apps/mercato/next.config.ts` was scoped to exclude `/embed/` (`source: '/((?!embed/).*)'`), and the app's existing proxy/middleware (`apps/mercato/src/proxy.ts` — Next 16 renamed `middleware` → `proxy`; the embed branch was added there rather than creating a conflicting second middleware file) now owns `/embed/:slug` headers: it resolves the per-distribution allowlist via `GET /api/forms/public/distributions/:slug/embed-policy` (→ `DistributionService.getEmbedPolicyBySlug` → `buildFrameAncestorsCsp(readEmbedSettings(...))`), sets the dynamic `frame-ancestors` CSP, and omits `X-Frame-Options`; it fails closed (`frame-ancestors 'none'`) for non-embeddable / unknown slugs. The shared CSP body lives in `apps/mercato/src/lib/security-headers.ts`. This touches `apps/mercato` deliberately, at the user's direction, since per-request framing is inherently an app-level concern.
2. **~~Per-distribution iframe theme not applied~~ — RESOLVED 2026-05-22.** `frontend/embed/[slug]/page.tsx` now fetches the distribution's `embed.theme`/`autoResize`, applies `light`/`dark`/`auto` by toggling `.dark` on the iframe document root (`auto` follows `prefers-color-scheme`), and disables the resize `postMessage` when `autoResize: false`. No change to `<EmbeddedForm>`/`FormRunner` was needed.
3. **Loader path differs from the spec sketch.** The loader is served from the module API (`GET /api/forms/public/embed-loader`) rather than a static `apps/mercato/public/forms/embed.js` file — keeping the embed entirely inside the forms package (no `apps/mercato` asset).
4. **Integration (Playwright) tests not shipped** — no integration harness is wired for the forms package yet (same caveat as 1d/2d). Unit coverage includes the new 25-test `embed-frame-policy` suite; add the spec's S1–S5 integration suites when a harness lands.

## Changelog

### 2026-05-22 — Follow-ups (both deviations resolved)
- **Live external framing wired.** Excluded `/embed/` from the global CSP rule in `apps/mercato/next.config.ts`; extended the app proxy (`apps/mercato/src/proxy.ts`, Next 16's `proxy` middleware convention) to set a dynamic per-distribution `frame-ancestors` (and drop `X-Frame-Options`) for `/embed/:slug`, resolved via the new `GET /api/forms/public/distributions/:slug/embed-policy` endpoint + `DistributionService.getEmbedPolicyBySlug`; shared CSP body extracted to `apps/mercato/src/lib/security-headers.ts`. Fails closed for non-embeddable slugs.
- **Iframe theme applied.** `frontend/embed/[slug]/page.tsx` applies the distribution's `embed.theme` (`.dark` toggle, `auto` follows system) and honors `embed.autoResize`.
- Validation: forms typecheck unchanged (7 pre-existing baseline errors, 0 new); app typecheck adds 0 errors in the new app files; 684 forms unit tests pass; `yarn generate` registered the `embed-policy` route. The `/embed/` exclusion regex was verified against Next's bundled `path-to-regexp` (`/embed/abc` excluded; `/`, `/f/:slug`, `/api/*` still matched).

### 2026-05-22 — Implemented
- S1–S6 shipped — single `<EmbeddedForm>` primitive over `FormRunner`; S1 (portal page) and S2 (`PublicFormRunnerPage`) refactored to delegate; S3 injectable widget `forms.injection.embedded-form` on the new `forms:embed` spot; S4 external iframe embed (embed-loader API + `/embed/:slug` host + `embed-frame-policy.ts` + `isEmbeddable()` + `embedSettingsSchema` + admin `EmbedSettingsDialog`); S5 `<FormTrigger>`/`useFormDialog()`; S6 headless `/run/context` documented. Typecheck baseline clean (7 pre-existing unrelated errors); 684 forms unit tests pass (incl. new 25-test `embed-frame-policy` suite); `yarn generate` registered the new widget, `/embed/[slug]` route, and embed-loader API. Two deviations: live external framing requires app-level middleware (documented, not shipped, per the apps/mercato boundary) and per-distribution iframe theme application is deferred. See Implementation Status above.

### 2026-05-21
- Initial spec — formalize the forms render-surface taxonomy (S1–S6) around a single `<EmbeddedForm>` primitive; add the requested injectable widget (S3), an iframe-based external website embed (S4, opt-in per-distribution `frame-ancestors` allowlist on `settings.embed`), and a trigger/dialog surface (S5); document the headless render path (S6). No new entities, migrations, or write paths — every surface reuses the existing `FormRunner` + the two `RuntimeClient`s (auth / anonymous).
