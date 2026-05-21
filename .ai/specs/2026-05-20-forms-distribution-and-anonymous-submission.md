# Forms Module — Phase 2d: Distribution & Anonymous Submission

> **Parent:** [`2026-04-22-forms-module.md`](./2026-04-22-forms-module.md)
> **Depends on:** [Phase 1c Submission Core](./2026-04-22-forms-phase-1c-submission-core.md), [Phase 1d Public Renderer](./2026-04-22-forms-phase-1d-public-renderer.md).
> **Unblocks:** richer 3 vertical flows (consent campaigns, bulk patient intake).
> **Scope:** Open Source (`.ai/specs/`).
> **Session sizing:** ~1.5–2 weeks.

## TLDR

- Today a form can only be filled by an **authenticated portal customer** (`frontend/[orgSlug]/portal/forms/[key]`). There is **no way to send a form to a named recipient**, and the one anonymous public route (`POST /api/forms/:id/run/submissions`) is a **validation-only stub that never persists** (see its own header comment, lines 7–10).
- This phase adds two things: (1) a **distribution layer** — shareable open links and per-recipient personal invitations (optionally emailed) — and (2) an **anonymous-persistence layer** that lets a token-bearing (un-logged-in) recipient run the *full* start → autosave → submit lifecycle, reusing `SubmissionService` **unchanged**.
- The trick that avoids touching the encryption / append-only / role-policy core: **every anonymous participant is anchored by a `forms_invitation` row whose uuid is used as `started_by` / `saved_by` / `actor.user_id` / `subject_id`.** A short-lived signed **submission access token** authorizes save/submit without a session.
- All existing invariants hold: append-only revisions, per-tenant envelope encryption, role-sliced reads, tenant isolation, "runtime reads write no access-audit row" (R1 posture).

## Decisions (made for you — redirect any of these)

The session is running in "don't stop to ask" mode, so the following architectural calls are baked in. Each is reversible at spec-review time.

- **D1 — Anonymous principal = invitation uuid.** `forms_form_submission.started_by`, `.submitted_by`, `.subject_id`, and `forms_form_submission_actor.user_id` are all `uuid` columns, so a synthetic string principal (`anon:…`) is impossible. Instead, **every anonymous fill is anchored by a `forms_invitation` row**; its `id` is the participant principal. `subject_type = 'forms_invitation'`, `subject_id = invitation.id`. This reuses `SubmissionService` with **zero changes**.
- **D2 — Two distribution modes.** `open` = one reusable public link; a fresh anonymous `forms_invitation` (null email) is minted per *start*. `personal` = one pre-created invitation per recipient, optionally emailed, resolvable by a per-recipient token.
- **D3 — Token model.** Open links use a low-sensitivity random `public_slug` in the URL (`/f/:slug`). Personal invitations use a high-entropy raw token shown once; only its **SHA-256 hash** is stored (`token_hash`). The **submission access token** that authorizes save/submit is a stateless HMAC string mirroring the existing 1d resume-token format (`submissionId.invitationId.role.exp.hmac`), signed with `FORMS_DISTRIBUTION_TOKEN_SECRET`.
- **D4 — Reuse, don't fork, the runtime core.** A new `DistributionService` orchestrates resolve → mint/link invitation → `SubmissionService.start(...)` → issue access token. Save/submit go through a new **public runtime guard** that resolves a principal from *either* the access token *or* customer auth, then calls the same `SubmissionService.save/submit`.
- **D5 — Recipient PII uses the platform encryption map, not the forms envelope.** `recipient_email` / `recipient_name` are column-level PII → declare them in `<forms>/encryption.ts` `defaultEncryptionMaps` and read via `findWithDecryption`. The forms envelope `EncryptionService` stays reserved for revision payloads only.
- **D6 — Email via the `messages` module.** Invitation emails enqueue an external-email job on the `messages-email` queue (`sendMessageEmailToExternal`). Email is optional — a distribution can be link-only. No new mail transport is invented.
- **D7 — Version pin policy.** A distribution stores `form_id` and resolves the form's `current_published_version_id` **at start time** (so re-publishing updates future fills, not in-flight ones — each submission still FK-pins its own version per the global invariant). An optional `pinned_version_id` locks a distribution to one version.
- **D8 — Abuse controls are first-class.** Distribution-level `max_responses` + `opens_at`/`closes_at`, per-IP+token rate limiting, an optional CAPTCHA verification hook, and ≥128-bit token entropy. Open-link dedupe via a signed browser cookie.

## Overview

The forms module's submission core (1c) and renderer (1d) already implement the hard parts — versioned schemas, encrypted append-only revisions, optimistic-concurrency autosave, role-sliced reads, and submit. What is missing is the **front door**: a way to put a published form in front of someone who is not a logged-in portal customer, and to persist what they fill in.

This phase is deliberately **additive and thin on the core**. It introduces a distribution/invitation data model, a `DistributionService`, a public token-authenticated runtime API, an admin surface to create links and manage recipients, and a small transport abstraction in the renderer so the *same* `FormRunner` serves both authenticated and anonymous flows.

## Problem Statement

Concretely, the gaps (verified in code) are:

1. **No distribution mechanism.** No email invite, no shareable/tokenized link, no recipient tracking. Forms reach users only via portal navigation.
2. **Anonymous persistence is a stub.** `api/[id]/run/submissions/route.ts` re-runs the tamper evaluator and returns `{ accepted, reachedEndingKey }` but explicitly defers persistence ("Persistence is deferred to phase 1d's authenticated submission flow").
3. **The authenticated runtime API hard-requires a customer session.** `api/form-submissions/*` derives `startedBy` / `savedBy` from `getCustomerAuthFromRequest`; there is no principal for an un-logged-in recipient.

## Proposed Solution

1. Add two entities — `forms_distribution` and `forms_invitation` — plus their migration and an `encryption.ts` map for recipient PII.
2. Add `DistributionService` to mint/resolve distributions and invitations and to bootstrap an anonymous submission by delegating to `SubmissionService`.
3. Add a **public runtime guard** (`resolveRuntimePrincipal`) that accepts a submission access token *or* customer auth, and a public API surface under `/api/forms/public/*`.
4. Add admin commands + API + UI to create distributions, copy links, add recipients, send/resend/revoke invitations, and watch delivery/fill status.
5. Add a renderer transport abstraction so `ui/public/FormRunner` runs the anonymous flow against the public endpoints with a bearer access token.
6. Wire invitation email through the `messages` module; supersede the validation-only `run/submissions` stub.

## Architecture

### New files

```
packages/forms/src/modules/forms/
├─ data/
│  ├─ entities.ts                      # +FormDistribution, +FormInvitation
│  └─ validators.ts                    # +distribution/invitation Zod schemas
├─ encryption.ts                       # NEW — defaultEncryptionMaps for recipient PII (D5)
├─ services/
│  ├─ distribution-service.ts          # NEW — resolve/mint/begin-anonymous orchestration
│  └─ distribution-token.ts            # NEW — sign/verify submission access token (HMAC, mirrors 1d resume-token)
├─ commands/
│  ├─ distribution.ts                  # forms.distribution.{create,update,close}
│  └─ invitation.ts                    # forms.invitation.{create,send,resend,revoke}
├─ lib/
│  └─ runtime-principal.ts             # NEW — resolveRuntimePrincipal(req): access-token OR customer auth
├─ api/
│  ├─ public/
│  │  ├─ distributions/[slug]/route.ts             # GET resolve open link → form context
│  │  ├─ invitations/[token]/route.ts              # GET resolve personal invite (marks opened)
│  │  ├─ start/route.ts                            # POST begin anonymous submission → access_token
│  │  └─ submissions/[id]/
│  │     ├─ route.ts                               # GET (resume) / PATCH (autosave) — bearer token
│  │     └─ submit/route.ts                        # POST submit — bearer token
│  ├─ [id]/distributions/route.ts                  # admin GET list / POST create
│  └─ distributions/[distributionId]/
│     ├─ route.ts                                  # admin GET / PATCH (update/close)
│     └─ invitations/
│        ├─ route.ts                               # admin GET list / POST bulk-create
│        └─ [invitationId]/
│           ├─ route.ts                            # admin DELETE (revoke)
│           └─ send/route.ts                       # admin POST send/resend
├─ subscribers/
│  └─ invitation-email.ts              # on forms.invitation.send → enqueue messages-email
├─ ui/
│  ├─ admin/forms/[id]/distributions/  # DistributionsPanel, CreateDistributionDialog, RecipientsTable
│  └─ public/state/runtime-client.ts   # NEW — transport interface (auth client | anonymous token client)
├─ frontend/
│  ├─ f/[slug]/page.tsx                # public open-link runner page
│  └─ i/[token]/page.tsx               # public personal-invitation runner page
├─ acl.ts                              # +forms.distribute feature
├─ events.ts                           # +distribution/invitation event IDs (additive)
└─ events-payloads.ts                  # +Zod payloads for the new events
```

### Anonymous lifecycle (sequence)

```
Recipient opens /f/:slug  (or /i/:token)
        │
        ▼
GET /api/forms/public/distributions/:slug
   → resolve distribution (status=active, within opens_at/closes_at, response_count<max)
   → return { form context (schema/uiSchema via compiler), requiresCustomerAuth, distributionId }
        │
        ▼  (renderer calls)
POST /api/forms/public/start { slug | token, locale }
   DistributionService.beginAnonymous():
     - open mode:    create anonymous forms_invitation (null email)
       personal mode: load invitation by token_hash, assert not submitted/expired/revoked
     - SubmissionService.start({ subjectType:'forms_invitation', subjectId:invitation.id,
                                 startedBy: invitation.id, initialRole })
     - invitation.submissionId = submission.id; invitation.status = 'started'
     - access_token = signAccessToken(submissionId, invitation.id, role, ttl)
   → { submission, revision, decoded_data, access_token }
        │
        ▼  Authorization: Bearer <access_token>
PATCH /api/forms/public/submissions/:id   → SubmissionService.save(...)   (autosave loop, 1d)
        │
        ▼
POST  /api/forms/public/submissions/:id/submit → SubmissionService.submit(...)
   - increment distribution.response_count (atomic, row-locked) and enforce max_responses
   - invitation.status = 'submitted'; invitation.submittedAt = now
   - emit forms.invitation.submitted
   → { submission, redirect_url }
```

`SubmissionService` is invoked with `surface = 'runtime'` on every read so anonymous reads never write a `forms_access_audit` row (R1 posture, preserved from 1c).

## Data Models

### `forms_distribution`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `organization_id` | uuid | tenant scope |
| `tenant_id` | uuid | tenant scope |
| `form_id` | uuid | FK id (no ORM relation) |
| `pinned_version_id` | uuid null | D7 — null ⇒ resolve active published version at start |
| `mode` | text | `open` \| `personal` |
| `public_slug` | text | URL-safe random; UNIQUE per org (open mode) |
| `status` | text | `active` \| `paused` \| `closed`; default `active` |
| `title` | text null | internal label |
| `default_locale` | text | |
| `require_customer_auth` | boolean | default `false`; `true` ⇒ fall back to portal auth, no anonymous token |
| `allow_multiple_submissions` | boolean | default `false` (open mode dedupe toggle) |
| `max_responses` | int null | cap; enforced atomically on submit |
| `response_count` | int | default `0` |
| `opens_at` / `closes_at` | timestamptz null | availability window |
| `redirect_url` | text null | post-submit redirect |
| `settings` | json null | captcha flag, custom completion copy, etc. |
| `created_by` | uuid | |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | |

Indexes: `UNIQUE (organization_id, public_slug)`, `(organization_id, form_id)`, `(organization_id, status)`.

### `forms_invitation`

The `id` doubles as the **anonymous participant principal** (D1).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK — used as submission `started_by`/`subject_id`/actor `user_id` |
| `distribution_id` | uuid | FK id |
| `organization_id` | uuid | tenant scope |
| `tenant_id` | uuid | tenant scope |
| `recipient_email` | text null | **ENCRYPTED** (D5) — null for open-link participants |
| `recipient_name` | text null | **ENCRYPTED** (D5) |
| `recipient_ref` | text null | opaque external id (e.g. CRM id); never an ORM FK |
| `role` | text null | actor role to assign; null ⇒ version default |
| `token_hash` | text null | SHA-256 of the raw personal token; null for open participants |
| `status` | text | `pending`\|`sent`\|`opened`\|`started`\|`submitted`\|`expired`\|`revoked` |
| `submission_id` | uuid null | linked at start |
| `locale` | text null | |
| `expires_at` | timestamptz null | |
| `sent_at`/`opened_at`/`started_at`/`submitted_at` | timestamptz null | lifecycle stamps |
| `send_count` | int | default `0` |
| `last_error` | text null | last email delivery error |
| `created_by` | uuid null | null for anonymous open participants |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | |

Indexes: `(distribution_id, status)`, `UNIQUE (token_hash) WHERE token_hash IS NOT NULL`, `(organization_id, submission_id)`.

`encryption.ts` declares `recipient_email` and `recipient_name` in `defaultEncryptionMaps` for `forms_invitation`; all reads of those columns route through `findWithDecryption` / `findOneWithDecryption`.

### Submission access token (no table)

Stateless, signed. Format mirrors the existing 1d resume token:

```
base64url(submissionId) . base64url(invitationId) . role . exp . hmacSHA256(payload, FORMS_DISTRIBUTION_TOKEN_SECRET)
```

Verified by `distribution-token.ts`; the org/tenant are **always re-derived from the persisted submission**, never trusted from the token body (R-2d-4). TTL `FORMS_ACCESS_TOKEN_TTL_S` (default 24h), refreshed on each successful save.

## API Contracts

All inputs validated with Zod; every route exports `openApi`. Public routes set `metadata.<METHOD> = { requireAuth: false }` and authorize via slug/token instead.

### Public runtime (anonymous)

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/forms/public/distributions/:slug` | none | Resolve open link → form context + availability; 410 when closed/expired/capped |
| `GET` | `/api/forms/public/invitations/:token` | none | Resolve personal invite by raw token; marks `opened`; 410 if submitted/expired/revoked |
| `POST` | `/api/forms/public/start` | none | Body `{ slug? , token? , locale? , captchaToken? }` → `{ submission, revision, decoded_data, access_token }` |
| `GET` | `/api/forms/public/submissions/:id` | bearer access token | Resume (role-sliced current state) |
| `PATCH` | `/api/forms/public/submissions/:id` | bearer access token | Autosave — body `{ base_revision_id, patch, change_summary? }` → `SubmissionService.save` |
| `POST` | `/api/forms/public/submissions/:id/submit` | bearer access token | Body `{ base_revision_id, submit_metadata? }` → `SubmissionService.submit`; returns `{ submission, redirect_url }` |

### Admin (feature-gated)

| Method | Path | Feature | Command |
|---|---|---|---|
| `GET`/`POST` | `/api/forms/:id/distributions` | `forms.distribute` | `forms.distribution.create` |
| `GET`/`PATCH` | `/api/forms/distributions/:distributionId` | `forms.distribute` | `forms.distribution.update` / `.close` |
| `GET`/`POST` | `/api/forms/distributions/:distributionId/invitations` | `forms.distribute` | `forms.invitation.create` (bulk) |
| `POST` | `…/invitations/:invitationId/send` | `forms.distribute` | `forms.invitation.send` (also resend) |
| `DELETE` | `…/invitations/:invitationId` | `forms.distribute` | `forms.invitation.revoke` |

The validation-only `POST /api/forms/:id/run/submissions` is **superseded**; it gains a `@deprecated` note and a one-version bridge (still returns its tamper result) per the root BC deprecation protocol, then is removed in a later release.

## Events (additive — frozen catalog rule §3)

New IDs (dot-separated, singular entity, past tense):

- `forms.distribution.created`, `forms.distribution.closed`
- `forms.invitation.created`, `forms.invitation.sent`, `forms.invitation.opened`, `forms.invitation.submitted`, `forms.invitation.revoked`

The fill lifecycle continues to emit the existing `forms.submission.started` / `.revision_appended` / `.submitted`. Adding IDs is additive and BC-safe; none are renamed or removed.

## Access Control

- New feature `forms.distribute` in `acl.ts`, granted by default to `admin` (and the `forms.design` design role) via `setup.ts` `defaultRoleFeatures`; run `yarn mercato auth sync-role-acls` after adding.
- Public runtime endpoints are intentionally unauthenticated but are gated by: distribution `status = active`, availability window, response cap, and a valid token/slug. Anonymous writes are confined to the single submission named in the access token, in the single role it carries.
- Reuse 1c's server-side role slicing — an anonymous participant only ever holds the distribution/version default actor role.

## Configuration (env vars)

| Env var | Default | Purpose |
|---|---|---|
| `FORMS_DISTRIBUTION_TOKEN_SECRET` | *(required)* | HMAC secret for access + invitation tokens |
| `FORMS_ACCESS_TOKEN_TTL_S` | `86400` | Submission access-token lifetime (refreshed on save) |
| `FORMS_INVITATION_TOKEN_TTL_S` | `1209600` | Personal invitation link lifetime (14 days) |
| `FORMS_PUBLIC_RATE_LIMIT_PER_MIN` | `30` | Per-IP+token public-endpoint rate limit |
| `FORMS_OPEN_LINK_DEDUPE_COOKIE` | `om_forms_pcid` | Signed cookie used to dedupe open-link starts |

## Risks & Impact Review

### R-2d-1 — Unauthenticated submission spam/abuse
- **Severity**: High. **Mitigation**: distribution `max_responses` + availability window; per-IP+token rate limit (`FORMS_PUBLIC_RATE_LIMIT_PER_MIN`); optional CAPTCHA verification hook on `/start` (gated by `settings.captcha`); ≥128-bit slug/token entropy. Residual: determined abuse against open links — operator closes the distribution.

### R-2d-2 — Access-token leakage grants write to a draft
- **Severity**: High. **Mitigation**: token bound to one `(submissionId, invitationId, role)`; short TTL; never logged; HTTPS-only; submit transitions the submission out of `draft` so a leaked token can no longer mutate it. Lost token on an open link = lost draft (acceptable); personal invites can be re-issued.

### R-2d-3 — Recipient PII exposure
- **Severity**: High. **Mitigation**: `recipient_email`/`recipient_name` encrypted via `encryption.ts` map (D5); never logged; outbound email rendered through the `messages` module's existing redaction posture.

### R-2d-4 — Cross-tenant access via forged/replayed token
- **Severity**: Critical. **Mitigation**: HMAC signature with server secret; org/tenant **always re-derived from the persisted submission row**, never from token claims; `DistributionService` asserts the resolved distribution/invitation/submission share one `organization_id` + `tenant_id`. Integration test exercises a token from tenant A against tenant B → 404.

### R-2d-5 — Open-link invitation-row / submission flood
- **Severity**: Medium–High. **Mitigation**: signed dedupe cookie collapses repeat starts from one browser; `max_responses` enforced atomically under a row lock at submit; `closes_at`; anonymous invitation rows count toward the cap.

### R-2d-6 — Anonymous reads writing audit rows (R1 regression)
- **Severity**: Medium. **Mitigation**: all public-runtime reads call `SubmissionService` with `surface = 'runtime'`; integration test asserts no `forms_access_audit` row is written for a public read.

### R-2d-7 — Email delivery failure
- **Severity**: Medium. **Mitigation**: send is an idempotent-ish action tracked by `send_count` + `last_error`; `messages-email` queue retries; admin resend. Submission validity never depends on email delivery.

### R-2d-8 — Version drift between link creation and fill
- **Severity**: Low. **Mitigation**: D7 pin policy; each submission FK-pins its resolved version; `pinned_version_id` available to lock a campaign to one version.

## Implementation Steps

1. **Entities + migration + encryption map.** Add `FormDistribution`, `FormInvitation`; additive migration creating `forms_distribution` + `forms_invitation` with the indexes above; declare recipient PII in `encryption.ts`. Update the module's `.snapshot-open-mercato.json`.
2. **Tokens.** `distribution-token.ts` (sign/verify access token) + raw-token hashing helper. Unit-test signature tamper, expiry, and scope binding.
3. **`DistributionService`.** `createDistribution`, `resolveBySlug`, `resolveByToken`, `beginAnonymous` (mint/link invitation → `SubmissionService.start` → issue token), `markSubmitted` (atomic `response_count` increment + cap enforcement).
4. **Runtime principal guard.** `resolveRuntimePrincipal(req)` returns `{ principal, role, organizationId, tenantId, submissionId }` from access token *or* `getCustomerAuthFromRequest`.
5. **Public API routes.** distributions/:slug, invitations/:token, start, submissions/:id (GET/PATCH), submit. All `requireAuth:false`, Zod-validated, `openApi`-documented, rate-limited.
6. **Admin commands + API.** distribution + invitation commands (undoable for state changes; `send` is a tracked side effect); admin routes feature-gated by `forms.distribute`.
7. **Invitation email subscriber.** On `forms.invitation.send`, enqueue an external-email job on `messages-email` via `sendMessageEmailToExternal`; record `sent_at`/`send_count`/`last_error`.
8. **Renderer transport.** Extract a `runtime-client.ts` interface; `useFormRunner` accepts an injected client (default = customer-auth `/api/form-submissions`; anonymous = token client against `/api/forms/public/*`). No change to the visual `FormRunner` tree.
9. **Public runner pages.** `frontend/f/[slug]/page.tsx` and `frontend/i/[token]/page.tsx` bootstrap context, then mount `FormRunner` with the anonymous client.
10. **Admin UI.** `DistributionsPanel` on the form detail page (DataTable + StatusBadge), `CreateDistributionDialog` (CrudForm, `Cmd/Ctrl+Enter` / `Escape`), `RecipientsTable` (bulk add via textarea/CSV, send/resend/revoke, status badges). `apiCall`/`useGuardedMutation` only; semantic tokens only.
11. **Deprecate** the validation-only `run/submissions` route (`@deprecated` + bridge).
12. **ACL/setup**: add `forms.distribute`, grant defaults, `sync-role-acls`. i18n keys under `forms.distribution.*` / `forms.invitation.*`. Run `yarn generate`.
13. **Cross-reference updates** (separate small edits at acceptance): add Phase 2d row to the parent spec's phase table + dependency graph, and to `packages/forms/AGENTS.md` phase map.

## Testing Strategy

- **Integration — open link**: create distribution → GET context → start → autosave → submit persists; `response_count` increments; second submit past `max_responses` → 410/422.
- **Integration — personal invite**: create invitation → send (assert `messages-email` job enqueued) → resolve by token (marks `opened`) → start → submit; revoke blocks start; expired token → 410.
- **Integration — anonymous persistence parity**: a token-driven fill produces the same encrypted append-only revision chain as an authenticated portal fill (same `SubmissionService` path).
- **Integration — security**: forged/cross-tenant token → 404; access token only mutates its own submission/role; rate limit returns 429; anonymous read writes **no** `forms_access_audit` row.
- **Integration — PII**: `recipient_email` is ciphertext at rest; round-trips via `findWithDecryption`; never appears in logs.
- **Unit**: token sign/verify (tamper, expiry, scope); slug/token entropy; atomic cap enforcement; `RecipientsTable` status-badge derivation.
- **Accessibility**: public runner pages and dialogs keyboard-operable; dialog `Cmd/Ctrl+Enter` submit, `Escape` cancel.

## Final Compliance Report — 2026-05-20

| Rule | Status | Notes |
|------|--------|-------|
| Singular entity/command/event naming | Compliant | `forms.distribution.*`, `forms.invitation.*` |
| No cross-module ORM relationships | Compliant | `form_id`/`recipient_ref` are FK ids / opaque strings |
| `organization_id` + `tenant_id` on every entity | Compliant | Both columns on both new entities; all queries scoped |
| Encryption map for PII (heuristic §7) | Compliant | `recipient_email`/`recipient_name` in `encryption.ts`; `findWithDecryption` |
| Zod validation + `openApi` on all routes | Compliant | Listed per route |
| Canonical HTTP/UI primitives | Compliant | `apiCall`/`useGuardedMutation`, `CrudForm`, `DataTable`, `StatusBadge` |
| Events additive only (BC §3) | Compliant | New IDs only; none renamed/removed |
| Deprecation protocol for `run/submissions` | Compliant | `@deprecated` + one-version bridge |
| Design System tokens | Compliant | Semantic status tokens; no arbitrary sizes; lucide icons |
| Append-only / encryption / role-slice / R1 invariants | Compliant | `SubmissionService` reused unchanged; `surface='runtime'` on reads |

**Verdict: ready for implementation post-1c/1d.**

## Implementation Status

### Phase 2d — Distribution & Anonymous Submission

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 2d — Distribution & Anonymous Submission | Done | 2026-05-20 | Distribution + invitation entities, public anonymous runtime, admin distribution UI, `forms.distribute` feature. Build green (168 entry points), 444 forms unit tests pass. |

#### Shipped artifacts

- `packages/forms/src/modules/forms/data/entities.ts` — `FormDistribution`, `FormInvitation`
- `packages/forms/src/modules/forms/migrations/Migration20260520120000_forms.ts` — `forms_distribution` + `forms_invitation` tables
- `packages/forms/src/modules/forms/encryption.ts` — `defaultEncryptionMaps` for `recipient_email` / `recipient_name` (D5)
- `packages/forms/src/modules/forms/services/distribution-token.ts` — HMAC submission access tokens + invitation-token hashing
- `packages/forms/src/modules/forms/services/distribution-service.ts` — `DistributionService` (resolve/mint/begin-anonymous orchestration)
- `packages/forms/src/modules/forms/lib/runtime-principal.ts` — `resolveRuntimePrincipal` (access token OR customer auth)
- `packages/forms/src/modules/forms/api/public/*` — unauthenticated runtime: `distributions/:slug`, `invitations/:token`, `start`, `submissions/:id` (GET + PATCH), `submissions/:id/submit`
- `packages/forms/src/modules/forms/commands/{distribution,invitation}.ts` — `forms.distribution.{create,update,close}`, `forms.invitation.{create,send,revoke}`
- `packages/forms/src/modules/forms/api/[id]/distributions` + `api/distributions/[distributionId]/*` — admin API gated by `forms.distribute`
- `packages/forms/src/modules/forms/subscribers/invitation-email.ts` — on `forms.invitation.sent` (resend reminder path)
- `packages/forms/src/modules/forms/ui/public/state/runtime-client.ts` — renderer transport abstraction (auth client | anonymous token client)
- `packages/forms/src/modules/forms/frontend/f/[slug]/page.tsx` + `frontend/i/[token]/page.tsx` — public runner pages
- `packages/forms/src/modules/forms/ui/admin/forms/[id]/distributions/` — `DistributionsPanel`, `CreateDistributionDialog`, `RecipientsTable` on a new `backend/forms/[id]/distributions` page
- `packages/forms/src/modules/forms/acl.ts` — `forms.distribute` feature (granted to `admin` via `setup.ts`)
- `packages/forms/src/modules/forms/events.ts` — 7 new event IDs (`forms.distribution.created/.closed`, `forms.invitation.created/.sent/.opened/.submitted/.revoked`)
- `packages/forms/src/modules/forms/__tests__/distribution-token.test.ts` — 16 tests (sign/verify tamper/expiry/scope, hashing, entropy)

Build: green (168 entry points). Tests: 444 forms unit tests pass.

#### Deviations from the spec

1. **Email transport (D6 revised).** Invitation email is sent via the platform's shared `sendEmail` transport (`@open-mercato/shared/lib/email/send`, the Resend-backed sender onboarding uses) rather than the `messages` module's `sendMessageEmailToExternal` / `messages-email` queue named in Decision D6 — because that helper requires a persisted `Message` row. The primary personal-link email (carrying the one-time raw token) is enqueued inline by the `forms.invitation.create` command; `subscribers/invitation-email.ts` (on `forms.invitation.sent`) handles the resend path with a generic reminder (no token link, since only the token hash is stored). All email paths are fail-soft — errors are recorded to `invitation.last_error`.
2. **Pinned-version support (additive).** Implemented by extending `SubmissionService.start` with an optional `pinnedVersionId` argument (additive, backward-compatible) rather than forking the service.
3. **CAPTCHA is a TODO stub.** `verifyCaptcha()` returns `true` when a token is present; no real provider is wired. Clearly marked as a TODO.
4. **Public-link slug resolution is global.** `public_slug` is looked up globally (no org filter) in the unauthenticated `/f/:slug` route, since that URL carries no org context; collision resistance relies on the ≥128-bit random slug (the per-org partial-unique index remains in place).
5. **Integration (Playwright) tests are NOT shipped** — no integration harness is wired for the forms package (same situation noted in Phase 1d). Unit coverage: `distribution-token.test.ts` (16 tests: sign/verify tamper/expiry/scope, hashing, entropy). Recommend adding the spec's integration suites when a harness lands.
6. **`sync-role-acls` required per environment.** The new `forms.distribute` feature requires running `yarn mercato auth sync-role-acls` in each environment so existing tenants receive the grant.

## Changelog

### 2026-05-20 — Implemented
- Phase 2d shipped — distribution + invitation entities, migration `Migration20260520120000_forms.ts`, recipient-PII encryption map, HMAC access tokens (`distribution-token.ts`), `DistributionService` + `runtime-principal.ts`, public anonymous API under `/api/forms/public/*`, admin commands + feature-gated API (`forms.distribute`), invitation-email subscriber, renderer transport abstraction + public runner pages (`/f/:slug`, `/i/:token`), admin distribution UI, 7 new event IDs. Build green (168 entry points); 444 forms unit tests pass. See Implementation Status above for deviations.

### 2026-05-20
- Initial spec — distribution layer (open links + personal invitations) and anonymous-persistence layer reusing `SubmissionService` via an invitation-anchored participant principal.
