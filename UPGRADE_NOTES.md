# Upgrade Notes

Open Mercato `0.5.0` is our biggest release so far. It bundles more than 250 fixes and
improvements that landed after the Hackathon in Sopot, alongside several important
dependency and tooling upgrades. That combination is exactly why this document now exists:
to give downstream app and module authors one place to review the upgrade work that may
require code changes on their side.

This document lists backward-incompatible changes that users of the Open Mercato platform
must apply to their own modules, apps, and extensions when upgrading between framework
versions. It only covers **actionable** incompatibilities — library behavior that affects
code a downstream module author can plausibly write against.

For the platform's own contract-surface stability guarantees, see
[`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md).

For user-facing release highlights see [`CHANGELOG.md`](CHANGELOG.md).

Companion AI skills (one per upgrade window) live in
[`.ai/skills/om-auto-upgrade-<from>-<to>/SKILL.md`](.ai/skills/) and can mechanically migrate
most of the patterns listed below in a user's codebase.

---

## 0.7.0 → 0.7.1 (unreleased)

### `SearchResultPresenter.badge` is deprecated — no search UI renders it (#5716)

`SearchResultPresenter.badge` from `@open-mercato/shared/modules/search` has never been rendered. Thirteen modules populate it, #4886 taught the presenter enricher to re-translate it per request, and the vector index writes it to the `result_badge` column and reads it back — but the Cmd+K dialog, the topbar inline results and `/backend/search` all render only `title`, `subtitle` and `icon`. `git log -S"presenter.badge" -- packages/search/src/modules/search/frontend` is empty across the project's whole history. The spec that introduced the request-time re-render described the dialog as rendering the badge, which is what made the field read like a display seam; that description was aspirational and never matched the renderers.

The direction is not to start rendering it. #4886 also added `resolveEntityTypeLabel()` and the `search.entityType.<module>.<entity>` keys, and all three surfaces already render that label next to each result. Nearly every producer's badge holds the same per-entity-**type** string that label now carries — `search.entityType.customers.customer_person_profile` is "Person" against a `customers.search.badge.person` of "Person", `messages.message` is "Message" against a badge of "Message", and the same duplication holds for `resources`, `customer_accounts`, `staff`, `planner`, `documents`, `sales`, `catalog`, `wms` and `eudr`. Rendering `badge` would print the same word twice on nearly every result.

The field is therefore deprecated rather than removed, and is **slated for removal in 0.9.0**. Nothing changes at runtime in this release: `badge` is still accepted, still populated by every existing producer, still localized per request, and still stored. Only the JSDoc changed, so no module breaks and no migration is forced yet.

**Action for module authors:** stop populating `presenter.badge` in your module's `search.ts` before 0.9.0, and move the value to whichever of the two replacements matches what it holds.

- **An entity-type label** (the common case — a constant like `'Document'` or one string per record kind): delete the `badge` and add a `search.entityType.<module>.<entity>` translation key instead. Every search surface already renders that label, so this is usually a pure deletion plus one key per entity; without the key the label falls back to a humanized `entityId` such as `Warranty Claims · Warranty Claim`.
- **Per-record detail** (a status, a counterparty, a date): append it to `subtitle`, which is rendered on all three surfaces.

The `result_badge` column, the Meilisearch document field and the vector round-trip are untouched here and retire separately once the deprecation window closes; dropping the presenter field itself needs no migration.

The one in-repo producer whose badge carried genuine per-record information was `warranty_claims`, which put the claim status there — so claim status was written, stored and never shown. It now appends the **localized** status to the subtitle (`Ada Lovelace — repair — In review`) via the existing `warranty_claims.status.*` keys, which are already translated in all four locales. Warranty-claim search results therefore gain a status segment in their subtitle; no other module's search output changes.

### `AlertDescription` renders a `<div>` instead of a `<p>` (#5487)

`AlertDescription` from `@open-mercato/ui/primitives/alert` rendered a `<p>`, which may only contain phrasing content. Every caller that nested a paragraph, a list, or any other block element inside it therefore produced invalid HTML: the browser's parser closed the paragraph early, the resulting DOM stopped matching what React rendered on the server, and hydration failed with `In HTML, <p> cannot be a descendant of <p>`. Eleven call sites across `ui`, `ai-assistant`, `core`, `enterprise`, and `scheduler` were nesting block children this way. The primitive now renders a `<div>` with the same `text-sm leading-5` classes, which removes the whole class of bug at once.

Nothing changes at runtime beyond the tag name — no prop was added, removed, or renamed, and `<p>` and `<div>` render identically under the design system's Tailwind preflight, so no visual regression accompanies the change. What changes is the **type**:

- `AlertDescriptionProps` widens from `React.HTMLAttributes<HTMLParagraphElement>` to `React.HTMLAttributes<HTMLDivElement>`.
- The forwarded ref type changes from `HTMLParagraphElement` to `HTMLDivElement`.

**Action for module authors:** if you hold a ref to `AlertDescription` as `useRef<HTMLParagraphElement>(null)`, or annotate one of its event handlers with `React.*Event<HTMLParagraphElement>`, change the element type to `HTMLDivElement`. Nothing else is affected: the component is used by composition in 97 files across this repository and not one of them passes a ref, so the practical migration surface is very small. There is no runtime bridge to stage because the element type is the entire changed surface — a mismatched annotation is a compile error in your own package, never a silent behavior change. Callers that previously worked around the restriction by rendering block `<span>`s inside the description (for example the record-locks settings page shipped in #5481) keep working unchanged and may be simplified back to real paragraphs at leisure.

### Device API responses are camelCase; the snake_case keys are deprecated aliases (#5513)

`GET /api/devices`, `GET /api/devices/admin/devices` and `GET /api/devices/admin/devices/:id` returned the raw database column names (`device_id`, `user_id`, `last_seen_at`, …) while every other module returns camelCase. A client written against the platform convention read `undefined` for every field on this one module. All three routes now return camelCase keys as the canonical shape:

| Deprecated alias | Canonical key |
|------------------|---------------|
| `tenant_id` | `tenantId` (list routes only) |
| `organization_id` | `organizationId` (list routes only) |
| `user_id` | `userId` |
| `device_id` | `deviceId` |
| `client_app_version` | `clientAppVersion` |
| `os_version` | `osVersion` |
| `push_provider` | `pushProvider` |
| `push_token_updated_at` | `pushTokenUpdatedAt` |
| `last_seen_at` | `lastSeenAt` |
| `created_at` | `createdAt` |
| `updated_at` | `updatedAt` |

`id`, `platform` and `locale` are spelled the same either way and are unchanged. Nothing was removed: **every snake_case key is still returned**, holding the same value as its camelCase counterpart, and is marked deprecated in the OpenAPI document. The aliases are removed no earlier than the next minor release.

Request-side contracts are untouched — query parameters, the `sortField` values (`lastSeenAt`, `createdAt`, `updatedAt`, already camelCase), request bodies, and the `POST`/`PUT`/`DELETE` response shapes are unchanged, as are the database columns themselves. The one behavior difference for a caller already reading the snake_case keys is that timestamp columns now always serialize as ISO-8601 strings under both spellings. `push_token` remains absent from every response under either spelling.

**Action for API consumers:** switch to the camelCase keys. A client that keeps reading the snake_case ones works unchanged until the aliases are removed.

### Interaction participants may omit `userId` — external calendar guests (#5115)

`interactionParticipantSchema` required `participants[].userId` to be a UUID, so an attendee with no person/customer/staff record — an external guest identified only by their email — could not be recorded at all. `userId` is now optional; a participant must still be identifiable, so one without a `userId` **must** carry a valid email address (`participants[].email`), and one with neither is still rejected with a `400`.

Nothing that was previously accepted is now rejected, and no field was removed from any response. What changes for consumers is that `participants[].userId` in the `GET /api/customers/interactions` response — and in the OpenAPI document generated from `interactionListItemSchema` — is now **optional rather than required**. Every participant that could exist before still carries its `userId`; the key is absent only on guest participants, a row shape that could not be stored until this release.

**Action for API consumers:** treat `participants[].userId` as optional. A generated client or hand-written type that declares it required keeps working until someone in that tenant actually invites an external guest, at which point a strict response validator will reject the payload and a `participant.userId` dereference will yield `undefined`. Identify a participant by `userId` when present and fall back to the normalized (trimmed, lower-cased) `email` otherwise — that is exactly the canonical actor key the platform's own calendar mapping, participant dedupe and conflict detection now use (`lib/calendar/participantIdentity.ts`). No database migration is required: `customer_interactions.participants` is a schemaless JSONB column with no foreign key or constraint.

### CRM deal status filters and closures now use one canonical vocabulary (#5107)

`customer_deals.status` is a lenient text column whose writers disagreed on spelling: UI closure flows persist `win` / `loose`, the AI tool `customers.update_deal_stage` persists `won` / `lost`, and the seeded dictionary also carries `closed`. Deal filtering previously matched whatever spelling the caller sent, so "won" results differed between the CRM list view, the Kanban board, and deals closed through different surfaces.

Three behavior changes ship together — additive on the wire, but visible to operators:

1. **Status filters are expanded through the canonical vocabulary** (`expandDealStatusAliases` in `@open-mercato/core/modules/customers/lib/dealStatus.ts`, shared by the deals list route, the Kanban lane queries, the map route, and the Kanban aggregate route). `win` / `won` both match won deals, `loose` / `lost` both match lost deals, values are matched case-insensitively (each result also keeps the caller's original token), and **the seeded `closed` option now matches the whole terminal set (`win`, `won`, `loose`, `lost`, `closed`) instead of the single literal `closed` status**, which no writer ever persisted. Any other value passes through trimmed, alongside its lower-case form, for exact matching.
2. **Closing a deal by status alone now records full closure state.** `customers.deals.update` derives `closureOutcome` from a terminal status spelling when the request carries no explicit outcome or stage (UI spellings `win`/`loose` and AI spellings `won`/`lost` behave identically) and relocates the deal to the pipeline's terminal Won/Lost stage when one exists. Conversely, updating an already-closed deal to a non-terminal status without an explicit `closureOutcome` now clears `closureOutcome`, `lossReasonId`, and `lossNotes`.
3. **The AI mutation-approval card projects these derived writes** (terminal stage, closure outcome, cleared loss columns), so what the operator approves matches what the command persists.

No API route, method, request field, or response field was removed; the aggregate route's accepted `status` values were widened. On `GET /api/customers/deals/aggregate` an injected `status = 'open'` for `isOverdue=true` is now suppressed when the caller supplies an explicit status filter (matching `GET /api/customers/deals`), so combined overdue+status lane header counts change accordingly. A deal moved into a terminal stage by Kanban drag-and-drop keeps its previous status — it is placed by stage but not matched by status filters until it is closed through a closure flow; recording that gap is deliberate, and automating status on drag is future work. Existing rows closed by the AI tool before this change keep their stored status and lane — they match the corrected filters via spelling expansion but are not retroactively moved to a terminal stage; re-saving such a deal through any closure flow applies the new state. No data backfill runs automatically.

**Action for module authors:** if you filtered deals with raw status spellings outside the shared helpers, prefer `lib/dealStatus.ts` (`expandDealStatusAliases`, `isClosedDealStatus`) so your reads stay consistent with the platform views.

### `makeCrudRoute` list routes keep every value of a repeated query parameter (#5548)

Every handler built by `makeCrudRoute` assembled its query object with `Object.fromEntries(url.searchParams.entries())`. `URLSearchParams.entries()` yields one pair per occurrence, so each repeated key overwrote the previous one and `?status=win&status=loose` reached the route schema as the bare string `'loose'` — every earlier selection was discarded before validation ran. Any schema declaring `z.union([z.string(), z.array(z.string())])` advertised an array branch this path could never deliver, and the CRUD response cache made it worse: it keys repeated values order-insensitively, so `?status=win&status=loose` and `?status=loose&status=win` shared one cache entry while resolving to *different* filters, and whichever ordering warmed the cache first decided the answer for that entry's lifetime.

The query object is now built by `buildQueryParams` from `@open-mercato/shared/lib/crud/query-params`, applied at the list handler and at the three non-`GET` handlers that assembled `raw.query` the same way. The grouping rule is deliberately narrow:

- A key that occurs **once** still reaches the schema as a **string**, exactly as before. Existing `z.string()` filter params are unaffected.
- A key that occurs **twice or more** reaches the schema as a **`string[]`**, which is the branch its schema already advertised.
- Values are **never split on commas** at this layer. `?ids=a,b` and `?search=Smith, John` keep their literal string value, so the comma-separated `?ids=` contract from SPEC-042 and every free-text filter are untouched. Where a field's own contract says a comma separates values, use `readQueryParamList` / `toQueryValueList` from the same module — they treat the repeated and comma forms as equivalent.

`parseIdsParam` and `isIdsParamProvided` in `@open-mercato/shared/lib/crud/ids` now accept the repeated form too. Without that, a repeated `?ids=` would have arrived as an array, read as "no ids filter supplied", and silently widened the response to the full list — the record-count side channel #4143 closed.

**One behavior change worth planning for.** A list route whose schema types a filter param as a plain `z.string()` (no array branch) now returns **400** when a client sends that param twice, where it previously accepted the request and silently used the last value. That is the correct failure mode — quietly discarding a caller's filter is the defect this fixes — but a lenient client may be relying on the old behavior. Callers using the comma form, or sending each param once, are unaffected; a caller sending repeats starts receiving the values it already asked for, which is strictly a widening.

**Action for module authors:** audit your own list-route schemas for filter params that clients may repeat. Where a param is genuinely multi-valued, widen it to `z.union([z.string(), z.array(z.string())])` (or `z.array(z.string())`) and normalize it with `toQueryValueList`. Where it is genuinely single-valued, no change is needed — a repeated occurrence should be rejected. No route URL, HTTP method, response field, `makeCrudRoute` signature, options type, or database column changes, so `BACKWARD_COMPATIBILITY.md` §2, §3 and §7 are not violated.

## 0.6.7 → 0.7.0 (2026-08-26)

### `PUT /api/auth/users/acl` merges omitted fields instead of clearing them (#5493)

The route used to treat every omitted field as a cleared one: an omitted `features`
became `[]` and an omitted `organizations` became `null`. A request carrying only
`organizations` was therefore classified as an empty override, so the route **deleted the
user's ACL row** and answered `200 {"ok":true}`. Because a per-user ACL is how a role gets
*narrowed*, deleting it dropped the user back to their full role — the failure direction
was fail-open, triggered by an ordinary administrative scope edit.

Omitted `features`, `organizations`, and `isSuperAdmin` now keep their stored values, so a
single-dimension edit no longer clears the dimensions it did not touch. Two consequences
for callers that relied on the old shape:

- **Removing an override now needs every dimension cleared explicitly.** Send
  `{ userId, features: [], organizations: null }`. A bare `{ userId, features: [] }` against
  a row that carries an organization restriction is now rejected (see below) rather than
  deleting the row.
- **An organization-scoped override with no feature grant returns `400`.** A `UserAcl` is an
  absolute override, so persisting that state would revoke every role-granted feature
  instead of narrowing the role. Restate the grant alongside the scope —
  `{ userId, organizations: [orgId], features: ['module.*'] }`. Test fixtures and scripts
  that set a scope with an organizations-only call need the same restatement; previously
  such a call reported success while storing nothing.

`PUT /api/auth/roles/acl` already behaved this way and is unchanged.

### Passkey MFA verification requires a real WebAuthn assertion (#3852)

`PasskeyProvider.verify()` used to accept a second payload shape — `{ credentialId, challenge }` — beside the genuine `{ response }` assertion, and approved it by string comparison. Both compared values are public: `prepareChallenge()` returns the credential id and the challenge to the caller, and `GET /api/security/mfa/methods` discloses `providerMetadata.credentialId`. A third shape needed even less: with no prepared challenge at all, only the disclosed credential id was compared. Anyone who could reach the verify step for a session therefore passed the passkey second factor with no authenticator private key and no signature, in both login-time MFA and passkey-as-sudo step-up.

**`POST /api/security/mfa/verify` and `POST /api/security/sudo/verify` now answer `401` for a passkey payload that is not a WebAuthn assertion.** This is a deliberate break of the request-shape contract with no deprecation window, because the shape being removed *is* the vulnerability — see the matching entry in [`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md).

**Action for client authors:** send the object returned by `@simplewebauthn/browser`'s `startAuthentication()` as `payload.response`. The first-party UI already does this, so no change is needed for apps that use the shipped `PasskeyChallengeVerify` component. A client that submitted the credential id and challenge was, by construction, not performing cryptographic verification.

**Action for operators — read this before upgrading.** The passkey *enrollment* path still accepts a client-supplied `publicKey` with no attestation (tracked as #5296; **this release does not close it**). A credential stored through that shortcut can be one of two things, and the row does not say which:

- **An unusable key** — the caller supplied a value no authenticator holds the private half of. It can never produce a verifiable assertion, so it now fails every login. A user whose only MFA method is such a credential is locked out until an admin resets it.
- **An attacker-controlled but perfectly valid keypair** — the caller generated a real P-256 keypair in software and enrolled its COSE public key. That credential signs assertions this release accepts, exactly as a genuine authenticator would. Requiring a real assertion does not help here; the key is real, it is simply not the user's.

The second case is an account-takeover path, not a lockout inconvenience, so **treat every shortcut-enrolled passkey as potentially hostile rather than merely broken.** It matters most for a user who already holds a password-only (`mfa_pending`) session: `authorizeMfaEnrollmentMutation` in `api/mfa/_shared.ts` authorizes enrollment on `auth.sub` and does not reject a pending token, so an attacker with a stolen password may be able to enroll a key they control and then satisfy the second factor with it.

**Provenance cannot be reconstructed from the stored row.** Both enrollment paths write the same `provider_metadata` keys (`credentialId`, `credentialPublicKey`, `counter`, `transports`, `label`), and the shortcut lets the caller choose all of them, so there is no field that reliably distinguishes a browser-ceremony credential from an API-provisioned one. Do not assume a query can single out the affected rows.

Effective mitigations, strongest first:

1. **Sequence #5296 ahead of this upgrade** if you can, so no new shortcut credential can be enrolled after the audit.
2. **Reset and re-enroll every passkey method** on any deployment that ever provisioned passkeys through the API, rather than trying to identify individual rows. Enumerate them with:

   ```sql
   SELECT id, user_id, tenant_id, label, created_at, last_used_at
     FROM user_mfa_methods
    WHERE type = 'passkey'
      AND deleted_at IS NULL
      AND is_active = true
    ORDER BY created_at;
   ```

   Then reset each affected user with `POST /api/security/users/{id}/mfa/reset` and have them re-enroll through the browser ceremony. Communicate the reset in advance: for users whose only method is a passkey it is a lockout until they re-enroll.
3. If a full re-enrollment is not feasible, at minimum reset the passkey methods of users who hold `security.mfa.manage` or an admin role, since those are the accounts a forged credential is worth targeting.

### Standalone apps gain deterministic design-system and i18n checks

New scaffolds ship `scripts/ds-check.mjs` as the hard-failing `yarn ds:check` gate and
`scripts/i18n-check-hardcoded.mjs` as the advisory `yarn i18n:check-hardcoded` report. Their
`typecheck` script also uses the same `NODE_OPTIONS=--max-old-space-size=8192` headroom as
`build`. Existing apps keep their user-owned package scripts and `.ai/agentic.config.json`, so
adoption is manual:

1. Copy `packages/create-app/template/scripts/ds-check.mjs`,
   `packages/create-app/template/scripts/i18n-check-hardcoded.mjs`, and the reasoned
   `.ds-check-ignore` baseline into the matching app paths, then remove baseline entries as
   their files move to semantic tokens.
2. Add `"ds:check": "node scripts/ds-check.mjs"` and
   `"i18n:check-hardcoded": "node scripts/i18n-check-hardcoded.mjs"` to `package.json`, and
   change `typecheck` to
   `cross-env NODE_OPTIONS=--max-old-space-size=8192 tsc --noEmit`.
3. Add `"yarn ds:check"` immediately after `"yarn lint"` in
   `.ai/agentic.config.json` `validation.commands`. Keep the i18n command advisory until a
   project-specific allowlist has been reviewed.

The design-system checker supports `--json` and fails on findings, malformed ignore data, or
stale ignore entries. The i18n checker also supports `--json`, reports JSX and message-call
findings, honors module `i18n/.hardcoded-allowlist.json` files and `[internal]` messages, and
returns success for findings while it remains advisory.

### Generated module fact-sheets moved to per-module directories

`agentic:init` now writes each installed module's generated Markdown facts under `.ai/guides/modules/<id>/`, with `index.md` as the entry point and one file per non-empty section. Local reference projections use the matching `.ai/guides/reference-modules/<id>/index.md` layout. The JSON sidecars remain at `.ai/guides/module-facts.json`, `.ai/guides/module-facts.v2.json`, and `.ai/guides/reference-module-facts.json` with unchanged schemas.

**Action for harness and automation authors:** replace literal `.ai/guides/modules/<id>.md` reads with `.ai/guides/modules/<id>/index.md`, then follow the section links needed for the task. The update harness removes prior-manifest-owned flat sheets, including locally modified generated copies, because retaining them would leave stale facts beside the authoritative directory. Unknown files that were never owned by the generated harness remain untouched.

### `JWT_SECRET` is required, and the legacy token grace period is now time-bounded (#5174)

Three related changes close an authentication-bypass path on deployments that kept the documented Docker defaults. **Operator action is required before upgrading a Docker deployment.**

**The full-app compose stacks no longer default `JWT_SECRET`.** `docker-compose.fullapp.yml` and its create-app template twin used to resolve `${JWT_SECRET:-JWT}`, so a deployment that never set the variable signed its tokens with the literal `JWT` — a value published in this repository. Both files now declare `${JWT_SECRET:?…}`, so `docker compose up` fails fast with an explanatory message instead of starting an impersonatable stack. The same files also stopped pinning `NODE_ENV: development` over an image whose `runner` stage already sets `NODE_ENV=production`; they now default to `${NODE_ENV:-production}`. The Next.js server child was already insulated (the CLI forces production for it), but the pin leaked into every other process in those containers — `mercato init`, migrations, the auto-spawned worker supervisor and scheduler, and the entire MCP sidecar — which is where a `NODE_ENV`-keyed safety check like the one below would otherwise have downgraded itself to a warning.

Set the variable in the `.env` file **next to the compose file** (the repository root) — not in `apps/mercato/.env`, which cannot override a variable the compose file passes into the container:

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
```

**The app refuses to run in production with an unsafe signing secret.** At startup (and on every secret read, which covers worker, scheduler, and CLI processes) Open Mercato now rejects a `JWT_SECRET` — or a per-audience `JWT_<AUDIENCE>_SECRET` override — that is missing, shorter than 32 characters, or one of the placeholder values shipped in this repository's examples, including the old 32-character guide value `your-secure-jwt-secret-change-me`. Outside production the same conditions only log a warning, so local development is unaffected. If your production deployment currently uses a short-but-real secret, rotate it to `openssl rand -hex 32` **before** upgrading; rotating logs every user out.

**Legacy fallback now requires a fixed cutover.** `JWT_LEGACY_GRACE_MINUTES` was read as an on/off switch: any value other than `0`, `false`, or `off` enabled raw-secret verification of pre-migration tokens *forever*, and those tokens are accepted without a session id — so they survive logout and password reset. The value is now honored as minutes measured against the token's own `iat`, but that relative age is not sufficient by itself because anyone holding the former secret can choose a fresh `iat`. Raw-secret fallback therefore stays disabled unless `JWT_LEGACY_CUTOVER_AT` contains a valid future ISO-8601 instant. Tokens issued more than 60 seconds in the future are also rejected.

For a rolling deployment that must preserve pre-migration sessions, set both `JWT_LEGACY_GRACE_MINUTES=480` and a near-term `JWT_LEGACY_CUTOVER_AT` before rollout. The 480-minute age cap remains the default once a cutover is configured. Deployments that have already migrated should set `JWT_LEGACY_GRACE_MINUTES=0`; fresh installs have no pre-migration tokens and should start there. Without a valid cutover, pre-migration tokens are rejected and those users must sign in again.

### Login rejects users with `isConfirmed: false` (#4541)

`POST /api/auth/login` and `resolveCanonicalStaffAuthContext` now treat `isConfirmed === false` as "deactivated" and refuse the session, returning the same generic `401` as a wrong password. Deactivating a user through `PUT /api/auth/users` with `{ isConfirmed: false }` additionally deletes that user's `sessions` rows, so existing tokens stop resolving immediately.

`User.isConfirmed` defaults to `true` and no seeding or invitation path sets it to `false`, so no existing account loses access on upgrade. The only in-tree producer of `false` is `deactivateDemoUsersIfSelfOnboardingEnabled`, which also nulls the password hash — those accounts could not authenticate before this change either.

**Action for module authors:** if your module sets `isConfirmed` directly on `User` rows, be aware it is now an authentication gate rather than an informational flag. Code that used `isConfirmed: false` to mean "invited, not yet onboarded" while still expecting the user to be able to log in must move to its own field.

### Command interceptors contribute audit context via `metadata.logContext` (#4542)

`CommandInterceptorBeforeResult.metadata` gains a reserved key: when a `beforeExecute` hook returns `{ metadata: { logContext: { … } } }`, those keys are shallow-merged into the persisted `ActionLog.context_json`. This is how a downstream app stamps caller metadata (IP, user agent, request id) onto audit entries written by core CRUD commands, without wrapping core routes.

```typescript
beforeExecute: async (input, context) => ({
  ok: true,
  metadata: {
    logContext: { ip: context.requestIp, userAgent: context.userAgent },
  },
})
```

The key is `logContext`, not `context`, specifically so that the generic `metadata` payload an interceptor already passes to its own `afterExecute` hook is never silently promoted into audit storage.

**Also changed:** `ActionLog.context_json` is now a shallow merge of `options.metadata.context`, interceptor `logContext`, and `buildLog().context` (in ascending precedence). Previously `buildLog().context` replaced `options.metadata.context` wholesale, so entries where both were set now carry the union of their keys rather than only the former's. **Action:** if you read `context_json` and relied on absent base keys, key off the specific fields you own rather than the object's shape.

### List totals are capped at 10 000 by default — treat `total` as a floor when `totalIsCapped` is true

Every CRUD list count is now bounded: the database stops counting after
`OM_LIST_COUNT_CAP` (default `10000`) matching rows. Below the cap, `total` stays
exact and responses are byte-identical to before. At the cap, the response
reports `total: <cap>` together with a new optional `totalIsCapped: true` field
(and `meta.listCountCapWarning` from the query engine). **When `totalIsCapped`
is true, both `total` and `totalPages` are floors, not values** — rows past the
cap exist and remain servable (data queries are offset-based and independent of
the count), but any pager that derives its page count from `total` will stop
offering them. The platform's `Pagination`/`DataTable` handle this: a capped
pager never clamps the current page down to the floor, suppresses the last-page
jump, and keeps Next available through short-page detection while pages come
back full. A custom pager built on `total` must do the same or its users cannot
reach rows past the cap. This is a **value-level behavior change on a STABLE
response surface**, shipped enabled, because an exact `COUNT` over arbitrary
filters is `O(matching rows)` and dominates list latency on large tables.

**Action for API clients:** wherever you consume `total` as ground truth about
the full result set (loop bounds, "N results" labels, reconciliation), treat it
as a floor whenever `totalIsCapped` is `true`. To enumerate a full result set,
page until a page comes back with fewer rows than requested — never until you
have collected `total` rows.

**Action for UI authors:** thread `totalIsCapped` from your list response into
`DataTable`'s `pagination` prop. Every in-tree list does this already, and a
CI guard (`yarn check:pagination-capped`) keeps the set closed, so this applies
to tables you maintain outside the repo. It is not only a labelling concern: an
unadopted table renders the floor as if it were exact **and stops offering rows
past it**, because its page count is derived from a capped `total`. With the
flag threaded, `DataTable` renders "10 000+", keeps Next available while pages
come back full, and never clamps a deep-linked page down to the floor.

**Escape hatch:** `OM_LIST_COUNT_CAP=0` disables capping and restores exact
count *values* globally. It is read per request from the environment, is
permanently supported, and needs no redeploy. Note it restores the values, not
the previous query shape: counts keep running through the rebuilt
scope-and-filters query (with filters as `EXISTS` semi-joins), which is
strictly lighter on unfiltered lists and plans set-oriented on filtered ones.

**Doc-storage counts count rows, not distinct record ids.** Custom-entity
(doc-storage) list counts changed from `count(distinct entity_id)` to
`count(*)`. Within one organization the two are identical. Across a scope
spanning several organizations that hold a row for the same record id, the
count now matches the item list — which returns one row per storage row — where
it previously under-reported relative to the items.

### Global search is gated on `search.global` and filters results per entity (#5163)

Two changes ship together on `GET /api/search/search/global`, the endpoint the Cmd+K palette calls.

**The feature gate moved from `search.view` to `search.global`.** The topbar has always rendered the palette on `search.global` while the endpoint enforced `search.view`, so the two gates could disagree in either direction: a role holding only `search.global` got a focusable search box that 403'd on every keystroke, and a role holding only `search.view` could query the endpoint with no UI to reach it. `admin` holds `search.*`, which is why nobody noticed. Neither feature id was renamed or removed — ACL feature ids are FROZEN under [`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md) §10 — and `search.view` keeps gating the search administration endpoints under `api/search/settings/**`, plus `GET /api/search/search`, whose gate is unchanged (see the per-entity filter note below).

**Action for API consumers:** this is a **narrowing** for any integration that calls the global endpoint with a token holding `search.view` alone. Grant those callers `search.global`. Because the new employee default (below) only reaches existing roles through a sync, run `yarn mercato auth sync-role-acls` after upgrading.

**Results are now filtered by the caller's per-entity view features.** The single feature gate authorizes *using* search, not *reading every indexed record*: a caller who passed it previously received presenter titles, subtitles and deep links for every indexed entity type, including ones the caller could not open. Each searchable entity now declares the owning module's view feature in `aclFeatures` in its module's `search.ts`, and the route drops results the caller has no grant for before they leave the server. This is the same rule the `search_get` / `search_aggregate` AI tools have applied since #2715; the `search_query` AI tool now applies it too. Superadmins are exempt.

**Action for module authors:** the filter **fails closed**. An entity type whose config declares no `aclFeatures` — or that no `search.ts` declares at all, which includes user-defined custom entities projected into `search_tokens` by `query_index` — no longer appears in global-search results for any non-superadmin caller. Every enabled entity shipped by `@open-mercato/core` and `@open-mercato/checkout` has been backfilled. `messages:message`, `sales:sales_note`, and `sales:sales_document_address` are disabled because their APIs enforce participant-, record-, or document-kind-specific access that a static entity feature cannot represent safely; they can return only after search supports the same row-aware checks. If results disappeared for your own module, add `aclFeatures: ['<module>.<entity>.view']` to that entity's config; run with `OM_SEARCH_DEBUG=true` and look for `search.api.global entity-filtered` to see which entity types were dropped and why.

### The hybrid search endpoint filters results per entity too (#5168)

`GET /api/search/search` — the endpoint behind the Vector Search playground in search administration — applied tenant and organization scoping but no per-entity ACL, so a caller past its single `search.view` gate received presenter titles, subtitles and deep links for every indexed entity type. It now applies exactly the same per-entity `aclFeatures` filter as the global endpoint above: the query is narrowed to the entity types the caller may read, and the results are filtered again on the way out as defense in depth. Superadmins are exempt.

**Its `requireFeatures` gate is deliberately unchanged** — `search.view` is the correct gate for an administration surface, and it is pinned by `TC-SEARCH-003`.

**Action for API consumers:** this is a **narrowing** for an integration whose token holds `search.view` but not the view feature of the entity types it searches. Grant those callers the per-entity view features they need, or call the endpoint as a superadmin. Like the global endpoint, the filter fails closed for an entity type that declares no `aclFeatures`; run with `OM_SEARCH_DEBUG=true` and look for `search.api.search entity-filtered` to see which types were dropped and why. The endpoint also answers `503` when `rbacService` or `searchIndexer` is not registered, since neither the narrowing nor the filter can be evaluated without them.

**The example module's `search.ts` is what keeps example todos visible.** `example:todo` is indexed through its CRUD route's `indexer: { entityType }`, so before that config existed the fail-closed filter hid it from every non-superadmin — the concrete symptom being `TC-EXAMPLE-001`, which searches todos as `admin`. The config (shipped separately, in the app and in the create-app template) declares `aclFeatures: ['example.todos.view']`, the same feature `GET /api/example/todos` enforces, and the drift guard now pins that mapping so the hybrid filter cannot regress it again. `example:example_customer_priority` stays unconfigured: it holds a customer id and a priority enum with no human-readable text.

### The `empty` and `crm` starter presets now enable the `search` module (#5164)

`create-mercato-app --preset crm` and `--preset empty` produced apps with no Cmd+K palette at all, not even for a superadmin: the app shell renders the palette on `search.global`, and `filterGrantsByEnabledModules` strips every feature whose owning module is absent from the enabled-modules registry, so the grant never survived. Only the `classic` preset — which keeps the template's own `src/modules.ts` — had it.

**Action:** none for existing apps. This changes only what *new* scaffolds generate. An app already scaffolded from `crm` or `empty` can add `{ id: 'search', from: '@open-mercato/search' }` to its `src/modules.ts`; the package is already pinned in the generated `package.json`, and the token strategy runs on the `search_tokens` table `query_index` maintains, so no Meilisearch and no embedding provider are needed.

### Data sync batches now emit their own traces instead of nesting under the trigger

Only relevant if you run telemetry (`TELEMETRY_BACKEND` set to an enabled backend). Trace context propagates from the request that starts a sync, through the queue, into the worker — and `ParentBasedSampler` only decides sampling at a trace's **root**. A run lasting hours therefore inherited one decision taken on a request from long before it: below `TELEMETRY_SAMPLING_RATIO=1.0` an entire run could emit nothing at all, and at `1.0` a single backfill produced one unrenderable million-span trace.

The `data_sync` engine now wraps each batch in a **root** span (`data_sync.import.batch` / `data_sync.export.batch`) linked back to the run's trace, so every batch samples independently and each trace stays renderable.

Sampling stays probabilistic — at ratio `p` a run of `n` batches still emits nothing with probability `(1 - p)^n` (75% for one batch at `p = 0.25`, 0.3% for twenty) — but a long run is no longer one coin flip, and at `1.0` each trace is now bounded instead of unrenderable.

**Action for operators:** none required, but expect the new shape in your tracing backend. Sync work no longer appears inside the triggering request's trace; look for `data_sync.*.batch` root traces instead, and follow the span **link** to get back to the trigger. Saved views or dashboards that assumed the old nesting need repointing. Batch spans carry `data_sync.run_id`, `data_sync.integration_id`, `data_sync.entity_type`, `data_sync.batch_index`, `om.tenant_id` and `om.organization_id` for filtering. The read that finds the stream drained is traced separately as `data_sync.import.drain` / `data_sync.export.drain`, so a panel counting or averaging `*.batch` sees batches only.

**Action for adapter authors:** none — `streamImport`/`streamExport` are unchanged, and generator `finally` blocks still run on cancellation and failure. If your adapter hand-rolls its own per-batch span, you can delete it: the engine's span now covers the same work, and an adapter-created span could never actually root itself. Any inner spans you create nest under the engine's batch span as before.

One contract detail is now enforced where it previously was not: the engine drives your iterator directly instead of using `for await`, so the returned value must be a genuine `AsyncIterable` (an `async function*`, or an object with `[Symbol.asyncIterator]`) — which is what `streamImport`/`streamExport` have always been typed as. `for await` also happened to accept a *synchronous* iterable of promises; that was never part of the declared contract, and an untyped adapter relying on it now fails immediately with a `TypeError` on the first batch rather than silently. TypeScript adapters are unaffected.

**For module authors:** the underlying mechanism is two new optional `SpanOptions` fields in `@open-mercato/telemetry` — `root?: boolean` (start a new trace, taking a fresh sampling decision) and `links?: TraceCarrier[]` (causal links as W3C carriers). Both are additive; a call that sets neither behaves exactly as before. Packages that cannot depend on `@open-mercato/telemetry` reach the same primitives through `withTelemetrySpan` / `captureTelemetryTrace` in `@open-mercato/shared/lib/telemetry/runtime`.

### TanStack Table upgraded to v9 — `ColumnDef` imports must move to the legacy entry point

The platform now depends on `@tanstack/react-table@^9.0.0`. v9 is an API rewrite: `useReactTable` and the `get*RowModel` factories moved out of the package root, and `ColumnDef` gained a leading `TFeatures` generic (`ColumnDef<TFeatures, TData, TValue>` instead of `ColumnDef<TData, TValue>`). Because module code imports these types **directly from `@tanstack/react-table`** rather than through `@open-mercato/ui`, no bridge inside the platform can shield you from it — a module that declares `ColumnDef<MyRow>[]` stops compiling after the upgrade.

v9 ships an official v8 compatibility entry point, and that is what the platform's own `DataTable` uses.

**Action for module authors:** repoint type-only imports.

```diff
-import type { ColumnDef } from '@tanstack/react-table'
+import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
```

State types that live in `table-core` are unaffected and keep their root import — `SortingState`, `RowSelectionState`, `SortFn`. Two renames to be aware of if you used them: `VisibilityState` is now `ColumnVisibilityState`, and `SortingFn<TData>` is now `SortFn<TFeatures, TData>` (pair it with `LegacyFeatures` from the legacy entry point to keep v8 semantics).

If you call the table hook yourself rather than using `DataTable`:

```diff
-import { useReactTable, getCoreRowModel, getSortedRowModel } from '@tanstack/react-table'
+import { useLegacyTable, getCoreRowModel, getSortedRowModel } from '@tanstack/react-table/legacy'
```

`useLegacyTable` registers the full stock feature set, so column visibility/ordering/sizing/pinning/resizing, row selection, sorting and pagination behave exactly as they did on v8. `flexRender` stays on the package root.

Two further consequences may reach your code:

- **`RowData` narrowed** from `unknown` to `Record<string, any> | Array<any>`. A helper generic over its row type now needs a constraint — `function myHelper<T extends RowData>(...)`. The platform's own `DataTableProps<T>`, `useAutoDiscoveredFields` and `applyCustomFieldVisibility` gained that constraint for the same reason; the latter two default their new type parameter, so bare references keep compiling.
- **v9 ships ESM-only** where v8 shipped CJS. If you run Jest, add the table packages to your `transformIgnorePatterns` allowlist, mirroring the scaffolded template:

  ```
  '/node_modules/(?!(@open-mercato|@mikro-orm|@tanstack/react-table|@tanstack/table-core|@tanstack/react-store|@tanstack/store)/)'
  ```

Migrating to the v9-native feature-slot API (`tableFeatures`, `createColumnHelper`, `table.Subscribe`) is optional and can happen per module at your own pace; the legacy entry point is supported by upstream for exactly this transition.

### ioredis upgraded to v6 — the platform pins RESP2

The platform now depends on `ioredis@^6.0.0`. v6's one breaking change is that it negotiates **RESP3 by default**, which reshapes map-style replies and moves pub/sub onto push frames. BullMQ and `rate-limiter-flexible` do not declare RESP3 support, so every Redis client the platform constructs now passes `protocol: 2` explicitly.

**Action for module authors:** none, if you obtain connection options from `parseRedisUrl`/`resolveRedisConnection` in `@open-mercato/shared/lib/redis/connection` — they now carry `protocol: 2` for you. If you construct an `ioredis` client directly, pass the shared constant so your client does not silently diverge onto RESP3:

```ts
import { REDIS_WIRE_PROTOCOL } from '@open-mercato/shared/lib/redis/connection'

const redis = new Redis(url, { protocol: REDIS_WIRE_PROTOCOL })
```

`ParsedRedisConnection` gained an optional `protocol?: RedisProtocolVersion` field — additive, so existing consumers are unaffected.

### Sales line list endpoints now default to `line_number` order

`GET /api/sales/order-lines` and `GET /api/sales/quote-lines` previously inherited the CRUD factory's `sortField = 'id'` fallback. Line ids are `gen_random_uuid()` v4 UUIDs, so a document's lines came back in an arbitrary order — and any integration that rewrites lines by delete-and-reinsert got a different order after every sync. Both endpoints now default to `line_number ASC, id ASC`.

**Action for API consumers:** none, unless you relied on the previous order. Nothing about the route, method, or response shape changed, and result ordering is not a contract surface under [`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md) — but the bytes on the wire do come back in a different sequence. A caller that needs the old behavior can pass `?sortField=id` explicitly.

**Note for deployments:** the CRUD list cache keys on the incoming request, and the admin items table sends no sort param, so a payload cached before the upgrade keeps its key afterwards and keeps serving the old ordering until a write invalidates its tag or the TTL expires. Documents that get touched resolve immediately; a static archived order may hold the old order for the remainder of its TTL. Nothing to configure — just don't read a stale cached document as the fix having failed.

**Note on legacy documents:** `line_number` is `integer NOT NULL DEFAULT 0`, so rows written before line numbers were assigned all tie at `0`. For those documents the `id` tiebreak makes the order *stable and repeatable* rather than *meaningful* — which is the intended behavior, but it means a legacy document can look unchanged after the upgrade.

**For module authors:** the mechanism is two new optional `list` options on `makeCrudRoute`, `defaultSort` and `tiebreakSortField`. Both are opt-in; a route that sets neither is unaffected. See [the CRUD factory docs](https://docs.openmercato.com/docs/framework/api/crud-factory) → "Default and tiebreak sorting".

### Workflow activities now fail on unresolved `{{...}}` templates (#4334)

`interpolateVariables()` returns the **original string** when a context path is missing, so a workflow definition referencing a key its start path never seeds passed the literal `"{{context.orderId}}"` downstream. With `continueOnActivityFailure: true` the resulting command rejection was swallowed: the workflow advanced, the user saw the decision accepted, and nothing happened. `UPDATE_ENTITY` inputs and `EMIT_EVENT` payloads are now scanned at every depth, and an activity carrying an unresolved template fails loudly instead — naming the offending key path.

**Action for authors of stored workflow definitions:** an activity that previously "succeeded" while silently shipping an unresolved template now fails. That is almost always the bug becoming visible rather than a new one, but there is a genuine regression case: a definition that deliberately passes brace-delimited text through to a field the target command accepts verbatim — a message body, a note, or a template meant to be rendered later downstream. The guard cannot tell that apart from a missing context key, so such a definition now fails the activity.

If you hit this, the fix is to stop routing literal `{{...}}` text through `UPDATE_ENTITY` input or `EMIT_EVENT` payload fields — escape it, or move the templating to the consumer that is supposed to render it. Search stored definitions for `{{` in activity `config.input` and `config.payload` before upgrading if you want to find these ahead of time.

### Credential-free integrations now resolve as configured (#4897)

An integration whose effective credentials schema declares `fields: []` now resolves through the
payment-gateway descriptor as credential-free: `requiresConfiguration: false`, `isConfigured: true`,
and `configurationStatus: 'unmanaged'`. Previously the descriptor attempted a credential lookup and
reported `requiresConfiguration: true`, `isConfigured: false`, and
`configurationStatus: 'missing_credentials'`, which could disable an otherwise usable provider.

**Action for integration authors:** none. Providers that declare one or more credential fields keep
the existing credential and state checks. If an integration inherits credentials from its bundle,
the bundle's effective schema is still used, so declaring `fields: []` on the integration does not
bypass required bundle credentials.

### `NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED` is removed

The `example` module's `widgets/injection-table.ts` used to export a value chosen by a
ternary — `(NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED || NEXT_PUBLIC_OM_CRUDFORM_EXTENDED_EVENTS_ENABLED)
? { …always, …crossModule } : always` — and `widgets/components.ts` exported a
conditionally spread array keyed on `NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED`.
Both exports are now single, unconditional literals.

The reason is not cosmetic. The module fact extractor
(`packages/cli/src/lib/generators/module-extension-facts.ts` → `readRootObject` /
`extractObjectConvention` → `staticValue`) folds only statically known values, and it folds a
ternary solely when both branches are deeply equal. Neither export qualified, so the
framework's own reader published **zero** contributions for both files: every scaffolded app
and every agent fact-sheet saw the canonical reference module as contributing no widget
injection and no component override at all. Running the real extractor over the module now
reads 26 injection-table contributions and 3 component-override contributions where it
previously read 0 and 0.

**What replaces the flag.** Nothing, by design. The cross-module entries (customers, catalog,
sales) ship unconditionally, and they are inert without their host module: each of them is
keyed on a spot id that only `customers`, `catalog`, or `sales` renders, and a module that is
not installed renders no spot. The change also adds nothing to the widget registry — the
loader reads widget entries (`loadWidgetEntries`) and injection tables (`loadInjectionTable`)
from two independent sources, so every `example` widget was already enumerated regardless of
what the table said. On top of that, `injection-loader.ts` skips any widget whose
`metadata.requiredModules` names a module that is not in the enabled set; the `example`
widgets do not declare `requiredModules` today, which is the mechanism to reach for if you
copy one of these entries into a widget that calls another module's API directly. The two
checkout demo overrides also register unconditionally, but their `wrapper`
returns the original component **by identity** while
`NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED` is off. Because
`resolveRegisteredComponent` does `resolved = override.wrapper(resolved)`, an identity return
is indistinguishable from no override, so the rendered DOM is unchanged and that flag keeps
its existing meaning and default.

**Which behavior this settles on.** The documented default was misleading. `apps/mercato/.env.example`
ships `NEXT_PUBLIC_OM_CRUDFORM_EXTENDED_EVENTS_ENABLED=true`, and that flag was OR-ed into the
same condition, so any app started from the monorepo `.env.example` already had every
cross-module example injection **enabled** — directly contradicting the
`NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED=false` line and its `(default: false)` comment
sitting a few lines below it. This change settles on the behavior those apps were actually
getting: cross-module example injections are always on. It also decouples them from
`NEXT_PUBLIC_OM_CRUDFORM_EXTENDED_EVENTS_ENABLED`, which is a `CrudForm` event-emission switch
and never should have gated an injection table.

**This is a real default change for scaffolded standalone apps.** An app created by
`create-mercato-app` sets neither flag, so before this change it registered only the
example-owned demo surfaces; now it also registers the cross-module entries targeting
`customers`, `catalog` and `sales`. They stay inert unless the host module is enabled — a
cross-module entry is keyed on a spot id only its host renders — but the registrations are
present, and the UMES DevTool will list them. If you want a scaffolded app to carry the
example's source without its cross-module injections, remove the entries from
`src/modules/example/widgets/injection-table.ts` in your app, or disable the `example`
module entirely (it ships unregistered in every built-in preset).

**Action for downstream apps:** delete `NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED` from
your `.env` files and from any CI/deployment environment that exports it; it is now dead
configuration and setting it has no effect. It has been removed from
`apps/mercato/.env.example` (`packages/create-app/template/.env.example` never documented it).
If you copied `example/widgets/injection-table.ts` into your own module and kept the
`false` branch to hide the cross-module entries, delete the entries you do not want instead of
gating them — an env-gated export is unreadable to the fact extractor and will make your
module look empty to the agent harness.

**Action for module authors generally:** export `injectionTable` and `componentOverrides` as
plain literals. Gate behavior *inside* a widget or wrapper, or declare
`metadata.requiredModules` on the widget; do not branch the exported registry value itself.


### Generated facts gain a v2 sidecar, and extension joins now derive irregular plurals (#4897)

`BACKWARD_COMPATIBILITY.md` §14 freezes the `hosts`, `contributions`, and `unresolved` arrays of
generated `.ai/guides/module-facts.json`, together with their correlation-resolution values and
exact public IDs, as STABLE once published. Four changes land against that surface and the
adjacent generator/query types. Three correct values that named something nonexistent, and the
fourth fixes a join that resolved to a table that does not exist, but correctness does not erase
the published contract: each is a visible value change for anyone who reads the generated facts
or extends an entity.

The generated-facts boundary is now explicitly versioned. `.ai/guides/module-facts.json` remains
the v1 compatibility artifact: its stable extension-surface arrays, exact contribution IDs,
classification modes, and correlation behavior are generated with the legacy reader contract.
`.ai/guides/module-facts.v2.json` is an additive sibling containing the corrected reader facts.
Newly generated harness consumers prefer v2 and fall back to v1, while downstream tools that have
not migrated keep reading the original path without observing stable-value changes. Both files
retain the frozen top-level `Record<moduleId, ModuleFactsJsonEntry>` shape; the version is carried
by the filename rather than an invented non-module key.

**Action for direct extractor callers:** omission of `factsContractVersion` selects v2. Pass
`factsContractVersion: 1` only while reproducing the legacy sidecar during the compatibility
window; migrate comparisons and pinned IDs to v2, then remove the explicit v1 selection.

**1. Contribution IDs from `ComponentReplacementHandles` gain their component segment.**
`packages/cli/src/lib/generators/module-extension-facts.ts` now folds
`ComponentReplacementHandles.section('ui.detail', 'NotesSection')` into the handle the runtime
actually registers, so the contribution publishes `section:ui.detail.NotesSection` where it
previously published `ui.detail`. The old value named no component — `ui.detail` is the section
namespace, not a component id — so nothing could have correlated against it successfully. Still,
it is an exact public ID changing: a scaffolded app or downstream tool that pinned the old string
should move to `module-facts.v2.json` and repin. The same applies to the sibling `page`,
`dataTable`, and `crudForm` formulas. The legacy sidecar keeps the old strings during the bridge.

**2. One published `mode` value changes: `section:auth.login.form` moves `replace` → `wrapper`.**
The component-override reader used to discriminate `mode` on an `entry.props` property that the
`ComponentOverride` union has no member for; together with the other reader fixes in this change it
now discriminates on the union's real members (`wrapper` / `propsTransform` / `replacement`).
Measured across a 55-module corpus, `section:auth.login.form` (enterprise `security`) is the only
leaf whose value changes in v2; every other contribution keeps the mode it published. `wrapper` is
what that entry has always done at runtime — the v1 fact sheet was wrong, not the module. The v1
sidecar continues to publish `replace` during the bridge.

**3. Recovered injection-table contributions (additive).** The extractor silently dropped every
string-form and single-object-form slot declaration, hiding twelve real contributions across six
modules — `integrations` published none at all. Those contributions appear in v2. This is additive:
no previously published ID disappears or changes. The v1 sidecar preserves its published arrays;
the generated-facts JSON budget was raised 3.50MB → 3.56MB to hold the corrected projection.

**4. `EntityExtension` joins derive irregular plurals through `pluralizeBaseName`.**
`packages/shared/src/lib/query/engine.ts` derived an extension's physical table by appending an
`s` to the entity segment, while the same file already used `pluralizeBaseName` for every other
table-name fallback. Any third-party extension whose entity segment ends in `y` therefore joined
a table that does not exist: `foo:company` derived `companys`. It now derives `companies`.

**Action for module authors:** this is a runtime behavior change in the shared query engine. If
you worked around the old derivation by adding a `y`-ending entity's real table under
`EntityExtension.table`, that declaration is now redundant but still honored — an explicit
`table` always wins, so nothing breaks either way. Keep `table` for plurals no guesser can win
(`person` → `people`) and for any entity whose `@Entity({ tableName })` simply does not match the
derived name. Behavior is unchanged for every entity segment that does not end in `y`.

**Type-surface note (#4897).** `ExtractAllModuleFactsResult`
(`packages/cli/src/lib/generators/module-facts.ts`) gains optional
`unresolvedFirstPartyTargets?: string[]` and `factCoverage?: ModuleFactCoverageFamily[]` fields.
The implementation always populates both, while optionality preserves source compatibility for
existing constructors, mocks, and wrappers. `ListConfig.csv` (`packages/shared/src/lib/crud/factory.ts`) widens
in the other direction and needs no action: `headers` accepts a function in addition to
`string[]`, and `row` gains a second `ctx` parameter, so every existing `(item) => …`
implementation stays assignable.


### Settings sections are identified by their untranslated group id (#4843)

`buildSettingsSections` used to identify each settings section by slugging the **rendered** group label, so `SettingsSection.id` was locale-dependent — `module-configs` in one deployment, `konfiguracja-modu` in another. Sections now carry the untranslated group id instead: the `pageGroupKey` a settings page declares (for example `settings.sections.moduleConfigs`), falling back to its raw `pageGroup` label when it declares no key. This matches how the main sidebar already identifies its nav groups, and it is what makes the ordering in `settingsSectionOrder` locale-independent.

The shape of `SettingsSection` and of `BackendChromePayload.settingsSections` is unchanged; only the **value** of the `id` field changes.

**Action for module authors injecting settings menu items:** an injected `menuItems[].groupId` must equal the target section's group id, not a slug of its label. The documented convention already used this form (`groupId: 'example.nav.group'`), so widgets that followed it keep working — and in fact begin resolving reliably in non-English deployments for the first time. A widget that hard-coded a label slug such as `groupId: 'module-configs'` no longer matches its section and instead creates a section of its own; change it to `groupId: 'settings.sections.moduleConfigs'`.

**Action for callers of `buildSettingsSections`:** the `sectionOrder` parameter should now be keyed by group id. Maps keyed by the old label slugs still resolve through a deprecated compatibility lookup and will keep working for at least one minor release, but they only ever matched English deployments, so rekeying is the actual fix.

### Bounded public webhook request bodies

Public webhook receivers now stop reading once the applicable byte ceiling is exceeded and return `413` before signature verification or downstream work. `OM_WEBHOOK_MAX_BODY_BYTES` configures the globally bounded generic, shipping, and communication-channel receivers and defaults to 1 MiB. InboxOps inherits that setting when present, supports `INBOX_OPS_WEBHOOK_MAX_BODY_BYTES` as a source-specific override, and otherwise keeps its historical 2 MiB limit. Payment gateway handlers preserve their existing body reads unless their `registerWebhookHandler(...)` options opt into `maxBodyBytes`; the value must be a positive safe integer no greater than 1 MiB.

**Action for existing deployments:** set the environment values to ceilings accepted by every affected provider, and align any reverse-proxy body limit with the application limit on the same webhook paths. Existing payment gateway providers require no change; add `maxBodyBytes` only after verifying the provider's documented maximum and boundary behavior.

### Standalone response security headers (#4042)

Fresh applications generated by `create-mercato-app` now include the same response security headers as the monorepo app: CSP, strict referrer handling, MIME-sniffing protection, same-origin framing, and a restrictive sandbox CSP for attachment downloads. The default CSP retains the Stripe script and frame origins required by the bundled payment integration.

**Action for existing standalone apps:** template files are not overwritten during package upgrades. Copy the `contentSecurityPolicy` constant and `headers()` configuration from the latest [`packages/create-app/template/next.config.ts`](packages/create-app/template/next.config.ts) into the app's `next.config.ts`, merging them with any app-owned rules. If a custom provider needs another script, frame, image, or connection origin, add only that exact origin to the matching CSP directive. Do not remove or weaken the `/api/attachments/file/:path*` sandbox rule. Validate each browser-based integration after adopting the baseline.

This is an opt-in security hardening step for existing apps and the default for newly scaffolded apps. It does not change Open Mercato API, event, DI, ACL, or database contracts.

### The unique constraint on `onboarding_requests.email` is dropped (#4514)

`onboarding_requests.email` has held system-scoped AES-256-GCM ciphertext since #4160, and every write uses a fresh random IV, so two rows for the same address never store the same value. The `onboarding_requests_email_unique` constraint left over from the plaintext era could therefore never fire. It is now dropped, leaving `onboarding_requests_email_hash_unique` as the single deduplication contract — the one the platform has actually enforced since #4160, through `hashForLookup`/`lookupHashCandidates`. The same migration adds a non-unique `onboarding_requests_email_idx` in its place, because the resubmission lookup still has a legacy `(email = input AND email_hash IS NULL)` arm and Postgres can only combine an `OR` through a bitmap when every arm is indexable — without a replacement index the whole disjunction, hash arm included, would fall back to a sequential scan.

**Action for module authors:** none, unless you write to `onboarding_requests` directly. Deduplicating a signup request means matching `email_hash`, never `email`; code that already does that is unaffected. The one pattern that changes behavior is an upsert declaring `ON CONFLICT (email)` — Postgres requires a unique index for that inference, so such a statement now raises an error instead of silently never conflicting. Rewrite it against `email_hash`. Nothing else changes: no column, table, type, or API is renamed or removed, and every insert or update accepted before is still accepted.

### `GET /api/attachments` serves an empty page past the end instead of clamping (#5299)

The record-scoped attachments list was the only paged endpoint that clamped a requested page down to the last existing page — both for the database offset it used and for the `page` value it echoed back. Asking for page 7 of a 3-page result returned page 3's items labelled `page: 3`. It now behaves like every other query-engine-backed list: the offset is `(page - 1) * pageSize` unclamped, so a page past the end returns an empty `items` array, and `page` echoes exactly what was requested.

**Action for API consumers:** none, unless you relied on the clamp. The route, method, and response shape are unchanged — `items`, `total`, `page`, `pageSize`, and `totalPages` are all still returned, and `page` is still an integer of at least `1`. Two patterns are worth checking. A loop that pages while the returned page is full previously never terminated on this endpoint and now does, which is the point of the change. A caller that used a deliberately large page number as a shorthand for "give me the last page" now receives an empty page instead, and must compute the last page from `totalPages` itself.

**For module authors:** a client-side workaround that treated an echoed page lower than the requested one as the end of the list — the pattern `AttachmentsSection` adopted in #5274 — remains correct; it simply never triggers now. You can drop it when convenient, but nothing forces you to.
### `loadSidebarPreference` is deprecated in favour of `findSidebarPreference`

`loadSidebarPreference(em, scope)` from `@open-mercato/core/modules/auth/services/sidebarPreferencesService` returns a normalized *default* settings object (`hiddenItems: []`, `groupOrder: []`, …) for a user with no `UserSidebarPreference` row, which makes "no saved preference" indistinguishable from "a preference that happens to be empty". Its own callers were written for the former: the backend chrome layers role defaults beneath the user layout and guards the user pass with `userPreference ? … : baseForUser`, an else-branch that could never run. Since applying a preference **overwrites** each item's `hidden` flag rather than OR-ing it, the empty user pass silently erased every role-level hide and the role group order on each render.

The fix is a new function rather than a changed return type, so nothing breaks for existing callers:

- **`findSidebarPreference(em, scope)`** — new. Returns `Promise<SidebarPreferencesSettings | null>`, with `null` meaning "no saved preference". Both internal call sites now use it.
- **`loadSidebarPreference(em, scope)`** — unchanged behaviour and unchanged `Promise<SidebarPreferencesSettings>` return type, now marked `@deprecated`. Slated for removal in **0.9.0**.

**Action for module authors:** migrate to `findSidebarPreference` and handle `null`. The empty settings object the deprecated function returns for an absent row is fabricated, never persisted — code that reads `settings.hiddenItems` straight off it is reading a value no user has chosen, and feeding that result back into `applySidebarPreference` erases any role layer underneath. If you genuinely want the old defaults, `(await findSidebarPreference(em, scope)) ?? normalizeSidebarSettings(null)` reproduces them exactly. A saved row returns normalized settings from both functions, so a user who has customised their sidebar is unaffected either way.

## 0.6.6 → 0.6.7 (2026-08-05)

### CLI bundling: local `*.client` dynamic imports are replaced by an inert stub (#4623)

The CLI loads its module registry by bundling app-module sources with esbuild. Because esbuild inlines dynamic imports into the single output file and hoists the imported file's static imports to the top, a dashboard widget doing `lazyDashboardWidget(() => import('./widget.client'))` pulled its browser-only dependencies into every CLI start — and a wrapper such as `@open-mercato/ui/backend/charts` then failed on `next/dynamic`, a bare specifier Node's ESM resolver cannot resolve outside a bundler. The symptom was that every CLI entry point, `yarn dev` included, died with `Cannot find module '.../node_modules/next/dynamic'`.

The CLI bundler now resolves **dynamic** imports of local (`./`, `../`, `@/`) `*.client` modules to an inert stub whose default export throws if it is ever called. The owning `widget.ts` stays importable in Node, so `loadAllWidgets()` can keep reading widget metadata when seeding dashboards, while the browser-only subgraph never enters the bundle.

Scope limits worth knowing:

- **Only dynamic imports are rewritten.** A static `import X from './widget.client'` is left to the bundler exactly as before. This is deliberate: a static import may request named bindings the stub cannot provide, and esbuild rejects those with `No matching export`, which would fail the whole CLI bundle — the same breakage class this change removes.
- **Only local specifiers are rewritten.** Package-provided client modules (`@open-mercato/...`) are already marked external by the CLI bundler and are untouched.
- Server-side helpers that merely follow a `*.client.ts` naming convention are unaffected as long as they are imported statically.

**Action for downstream:** none for modules that already follow the documented dashboard-widget convention. If one of your dashboard widgets reaches its browser component through a *static* import in `widget.ts`, switch it to `lazyDashboardWidget(() => import('./widget.client'))` — that is what makes the CLI bundle safe. If you dynamically `import()` a server-side module whose name ends in `.client`, rename it or import it statically; a dynamic import of such a path now resolves to the stub and throws `[internal] Client-only module … is not available in the CLI runtime` when called.

---

### Events worker dispatches through the DI event bus instead of the CLI-only module registry

The events worker used to build its own subscriber map from `getCliModules()` - a registry populated **only** by `registerCliModules()` inside the `mercato` bin. Any worker started another way (a custom entrypoint, an in-process runner, a container whose command bypasses the CLI) resolved zero subscribers, returned early, and marked the job **completed**: no error, no log. Because default-on single-delivery had already skipped those subscribers inline, the side effect vanished - taking every wildcard `event: '*'` persistent subscriber with it (outbound webhooks, workflow event triggers, business-rule CRUD triggers).

The worker now resolves `eventBus` from its per-job DI container and calls the new `EventBus.dispatchQueued(event, payload, options, resolve)`, passing its own `ctx.resolve` as the last argument so subscribers bind to the container that job runs in. The bus owns subscriber selection for both halves of single-delivery, so they cannot disagree. `packages/cli`-launched workers are unaffected: `mercato queue worker` already bootstraps the app module registry (`registerModules`) before the CLI one, from the same array.

Two related changes:

- **The worker fails loudly instead of silently.** If `eventBus` cannot be resolved (or predates `dispatchQueued`), `handle()` throws. The job retries and dead-letters with an actionable message rather than disappearing.
- **Turning single-delivery off no longer dual-dispatches.** The producer stamps the queued job `persistentDeliveredInline: true` when it delivered inline, and the worker skips such jobs, so `OM_EVENTS_SINGLE_DELIVERY=false` now means inline-only rather than inline *and* worker. Retry is preserved: the stamp is only written when every persistent subscriber succeeded inline, so a handler that threw leaves the job unstamped and the worker runs it with the queue's retry and dead-lettering. Note that a retried job re-runs the persistent subscribers that already succeeded inline, which is why persistent subscribers must be idempotent (`packages/events/AGENTS.md`).
- **The worker dispatches persistent subscribers only.** It used to select by exact event name and run *every* subscriber registered under it. That difference is invisible on the normal path - with single-delivery on, ephemeral subscribers have already run inline - but one combination changes: an enqueue-only emit (`{ persistent: true, deliverInline: false }`) with `OM_EVENTS_SINGLE_DELIVERY=false` skips inline delivery entirely, so an *ephemeral* subscriber registered on that exact event name no longer runs at all. `packages/events/AGENTS.md` already restricts enqueue-only to events whose subscribers are all `persistent: true`, so a conforming caller is unaffected; if you carry that combination, mark the subscriber `persistent: true` or drop `deliverInline: false`.

**Action for downstream:** none for delivery semantics - `OM_EVENTS_SINGLE_DELIVERY` is read exactly as before. Custom `EventBus` implementations must add `dispatchQueued`; the worker's exported `clearListenerCache()` is now a deprecated no-op and will be removed in a later release. If you carry a local patch swapping the worker's `getCliModules()` for `getModules()`, remove it - `patch-package` will fail to apply against this release.

### Query index reindex now fails when a batch loses records

`upsertIndexBatch` used to swallow every write error: the bulk `INSERT … ON CONFLICT` had a bare `catch`, and the per-row fallback ran inside a transaction whose per-row `catch` could not actually recover — in Postgres a failed statement aborts the transaction, and `COMMIT` on an aborted transaction returns a `ROLLBACK` tag without raising. A single bad record therefore discarded its entire batch (up to 500 rows) while the reindex job still credited the coverage counters and finished green, and the subsequent orphan purge then deleted the pre-existing index rows for those records.

Three behavior changes follow:

- `upsertIndexBatch` returns `UpsertIndexBatchResult` (`{ attempted, written, failedRecordIds, searchTokenFailures }`) instead of `void`, and the per-row fallback no longer runs in a transaction, so one bad row can no longer discard its siblings. It still never throws on a partial write — callers reconcile via the result (`assertIndexBatchWritesLanded`).
- A reindex that loses records now **throws** `QueryIndexBatchWriteError` after finishing its batches and refreshing the coverage snapshot. The queue job fails, `indexer_error_logs` gets a row per failed record (capped at 50 per batch), and the CLI exits non-zero.
- A failed document encryption is treated as a failed row rather than being indexed in plaintext, and the orphan purge excludes records the run failed to write so their existing index rows survive.

`isUniqueViolation` now lives at `@open-mercato/shared/lib/db/pg-errors`. The previous `@open-mercato/core/modules/communication_channels/lib/pg-errors` import remains available as a deprecated re-export for this release; downstream modules should move to the shared path.

**Action for downstream:** none required for callers that ignore the return value — `Promise<void>` → `Promise<UpsertIndexBatchResult>` is assignment-compatible. Expect previously-green reindex jobs to start failing where they were silently dropping records; the failures are pre-existing data loss becoming visible, not new breakage. Custom `encryptDoc`/`decryptDoc` callbacks passed to `upsertIndexBatch` should no longer swallow their own errors, or the new accounting cannot see them.

### MFA self-service management now requires `security.mfa.manage` (#3855)

Regenerating recovery codes and removing an MFA method now require `security.mfa.manage`. Starting or confirming an MFA provider requires the same feature during ordinary self-service use, but remains available to a tenant user who is actively compelled to enroll by an MFA enforcement policy. If enforcement verification is unavailable and backend navigation fails closed to enrollment, provider setup and confirmation stay available as the recovery path instead of turning the redirect into a lockout.

New tenants grant `security.mfa.manage` to the default `employee` role so ordinary users retain voluntary MFA management outside an enforcement flow.

**Action for existing tenants:** synchronize role ACLs after deployment, then restart application instances so their in-process ACL caches load the new grant:

```bash
yarn mercato auth sync-role-acls
```

Tenant-created roles are not modified by this command. A role deliberately denied `security.mfa.manage` cannot manage recovery codes, remove methods, or start voluntary enrollment, but an actively enforced non-compliant user can still complete provider enrollment and escape the enforcement redirect.

### Scheduler queue targets now deliver one flat payload contract in both execution modes (#4221)

The local scheduler used to wrap a scheduled queue target's configured `targetPayload` in an undocumented envelope (`{ scheduleId, scheduleName, scopeType, tenantId, organizationId, payload: { …targetPayload }, triggeredAt }`), while the asynchronous execute-schedule worker already spread `targetPayload` onto the worker payload root. Both paths now build their payload through one scheduler-owned helper (`packages/scheduler/src/modules/scheduler/lib/queueTargetPayload.ts`) and deliver the documented flat contract:

```ts
{ ...targetPayload, tenantId, organizationId, _idempotencyKey }
```

Scheduler-owned `tenantId`/`organizationId`/`_idempotencyKey` are applied after the spread, so they always win over conflicting `targetPayload` fields. Scheduler execution metadata (`scheduleId`, `scheduleName`, `scopeType`, `triggeredAt`) is no longer injected into the application payload. The async worker's idempotency key is now derived from the retry-stable execute-schedule job id instead of `Date.now()`, so BullMQ retries of one logical firing reuse the same `_idempotencyKey`.

**Action for downstream:** workers written to the documented flat contract need no change and now also work under the local scheduler. A worker that relied on the undocumented local envelope (reading `job.payload.payload.*` or `scheduleId`/`scheduleName`/`triggeredAt` from the payload) must switch to the flat fields; include any identifiers it needs in `targetPayload` when registering the schedule.

### Order payment-total inputs are deprecated with an explicit compatibility warning (#4695)

`orderCreateSchema` declared `paidTotalAmount`, `refundedTotalAmount` and `outstandingAmount`, so `sales.orders.create` (and `POST /api/sales/orders`) validated them — and then built the order with the ledger hardcoded to `"0"` and recomputed the totals from those zeros. A caller creating a 100.00 order with `paidTotalAmount: 100` got `paid_total_amount 0` and `outstanding_amount 100` back, with no error, warning or log.

These three columns are a projection of the order's payments: `recomputeOrderPaymentTotals` rebuilds them from the `SalesPayment` / `SalesPaymentAllocation` rows on every payment create, update, delete and refund. A value seeded on the document has no payment rows behind it, so honouring the input would create a second, unreconciled source of truth that silently loses to the first payment.

For the 0.6.7 compatibility window, `sales.orders.create` and `POST /api/sales/orders` still accept these released input fields and ignore their values, preserving the existing order result. When any key is supplied, the command and HTTP response add `warnings: [{ code: "sales.order.payment_ledger_input_deprecated", fields: [...] }]`; the process also emits one bounded operator warning without logging values or customer data. OpenAPI keeps the fields visible, marks the behavior in the create operation description, and documents the optional warning response. The fields remain deprecated for at least one minor release before removal. See [`.ai/specs/2026-08-01-sales-order-payment-ledger-input-deprecation.md`](.ai/specs/2026-08-01-sales-order-payment-ledger-input-deprecation.md).

**Action for downstream:** stop sending `paidTotalAmount`, `refundedTotalAmount`, and `outstandingAmount` when creating orders. Callers that never sent them are unaffected and continue receiving the historical `{ id }` create response. To create an already-settled order, create the order and then record its payment with `sales.payments.create` / `POST /api/sales/payments`, which recomputes the ledger from payment rows.

## 0.6.5 → 0.6.6 (unreleased)

### ACL feature policy and concrete capability payloads

Server authorization now uses one shared feature policy across staff and customer realms. A final `entry.overrides.acl.features['feature.id'] = null` is an exact runtime denial: stale explicit grants, matching wildcards, staff super-admin, and portal-admin no longer authorize that feature. Disabled-module requirements are evaluated by the same policy. Stored role/user ACL rows are not migrated or deleted; removing the null override makes preserved grants effective again.

The existing browser/JWT fields keep their names and `string[]` shapes, but their values now contain concrete effective feature IDs:

- `BackendChromePayload.grantedFeatures`
- customer login, invitation, magic-link, refresh, profile, request context, and portal navigation `resolvedFeatures` / `grantedFeatures`

These arrays no longer contain `*` or namespace wildcard strings. Downstream clients that inspect wildcards must switch to checking concrete feature IDs. Portal code must use the explicit `isPortalAdmin` boolean rather than infer admin status from `portal.*`. Raw `loadAcl` and `getGrantedFeatures` remain available for ACL management and inspection; server authorization should call the realm `userHasAllFeatures` method or shared `authorizeFeatures`.

No database migration is required.

### Payment-session amounts are reconciled against the order total (#4488)

Follow-up to the #4486 capture hardening, which left session creation on the caller-supplied amount. `POST /api/payment_gateways/sessions` (and `paymentGatewayService.createPaymentSession`) now reconcile the request against the authoritative order total **whenever `orderId` is supplied**: `amount` and `currencyCode` must match the amount still due on that order, resolved inside the caller's own tenant and organization. Mismatches, unknown orders, and out-of-scope orders all fail with `409` before any provider call — the unknown and out-of-scope cases share one response body so a caller cannot probe for other tenants' orders.

The lookup goes through the new optional `PaymentOrderTotalResolver` contract (`@open-mercato/shared/modules/payment_gateways/types`), resolved from the DI name `paymentOrderTotalResolver`; the `sales` module registers the default implementation. Requests without `orderId`, and installations where no module registers a resolver, are not reconciled and behave exactly as before.

*Action for downstream:* if you called this endpoint with `orderId` as a free-form external reference rather than a sales order id, drop the field (or map it into `metadata`) — an id that does not resolve to an order in the caller's scope is now rejected. If your own module owns orders instead of `sales`, register your own `paymentOrderTotalResolver` to keep session amounts reconciled. See [`.ai/specs/implemented/SPEC-044-2026-02-24-payment-gateway-integrations.md`](.ai/specs/implemented/SPEC-044-2026-02-24-payment-gateway-integrations.md) §16.5.
### Standalone apps: optimistic-lock guard restored; `src/di.ts` now requires explicit bootstrap wiring (#4201)

Two related DI defects affected standalone (npm) apps:

1. **The default OSS optimistic-lock guard was silently disabled.** The request container is built in Awilix CLASSIC injection mode, and the guard's factory destructured a renamed parameter (`({ em: scopedEm })`), which CLASSIC cannot resolve. The resolution error was swallowed, so every `makeCrudRoute` PUT/DELETE ignored the `x-om-ext-optimistic-lock-expected-updated-at` header and stale writes returned `200` instead of `409`. *Action for downstream:* none — upgrading `@open-mercato/shared` restores the guard. A failed guard resolution now logs a warning (once per process) instead of failing silently.

2. **`src/di.ts` `register()` never ran in standalone apps.** The `@/di` dynamic import inside the published package does not resolve to the app's `src/di.ts`, so the documented app-level DI override hook was dead. Apps now wire it explicitly from `src/bootstrap.ts`. *Action for downstream:* apps scaffolded before 0.6.6 that want `src/di.ts` to work must add the wiring to their `src/bootstrap.ts` (new scaffolds include it):

```ts
import { register as registerAppDi } from '@/di'

export const bootstrap = createBootstrap(
  { /* existing generated data */ },
  { appDiRegistrar: registerAppDi },
)
```

Additionally, two core-module registrations that destructured factory parameters without opting into per-registration PROXY resolution (`catalogPricingService`, `notificationService`) silently received `undefined` dependencies under CLASSIC mode; both now chain `.proxy()`. *Action for downstream:* none, but if your own module's `di.ts` registers `asFunction(({ dep }) => ...)`, chain `.proxy()` (or take plain named parameters) — a guard test (`packages/core/src/__tests__/di-classic-proxy.test.ts`) now enforces this for in-repo modules.

### `ComboboxInput` shows a "no matches" row for a non-empty query

When the user has typed and the filtered suggestion list is empty, the popover now stays open and renders `ui.inputs.comboboxInput.noMatches` instead of closing silently. The loading affordance is unchanged: while a fetch is in flight the popover still shows `ui.inputs.comboboxInput.loading`, including when a stale suggestion list is present. The new key ships in every bundled locale.

### `customers/components/detail/assignableStaff` moved to `customers/lib/assignableStaff`

The implementation moved so non-component callers (API routes, commands) can import it without reaching into a `components/` path. The old path re-exports every public symbol and is marked `@deprecated`; it keeps working through 0.6.x and will be removed in 0.7.0. Update imports:

```diff
- import { fetchAssignableStaffMembers } from '@open-mercato/core/modules/customers/components/detail/assignableStaff'
+ import { fetchAssignableStaffMembers } from '@open-mercato/core/modules/customers/lib/assignableStaff'
```

### Credit memo creation now persists validated order and invoice links

`sales.credit_memos.create` now persists its validated `orderId` and `invoiceId` as the credit memo's `order` and `invoice` relations. `SalesCreditMemo` exposes both only as relations (`@ManyToOne` on `order_id` / `invoice_id`) and has never had scalar `orderId` / `invoiceId` properties, so earlier releases validated each reference and then silently dropped it — reads returned a null `order_id` and `invoice_id`. The delete snapshot and its undo path read and restore both links through the relation as well.

`TC-SALES-031` asserts the persisted order link, and `credit-memo-document-links.test.ts` covers both relations on create and on delete-snapshot. No caller changes are required.

### Opt-in per-entity ACL for custom-entity records (#3857)

Follow-up to the #2612 records-API hardening, which deliberately left custom/EAV entities on the coarse `entities.records.view` / `entities.records.manage` path. Those two features were **entity-agnostic**: any holder could read/modify/delete records of *every* custom entity in their tenant, so sensitive custom entities (salaries, board minutes) could not be compartmentalized from ordinary ones (intra-tenant horizontal privilege; cross-tenant was already blocked).

Custom entities can now be flagged **`access_restricted`**. The change is **additive and default-off**, so existing entities and grants behave exactly as before — no migration, no lockout:

- **Unrestricted (default):** unchanged — the coarse route feature is the whole authorization.
- **Restricted:** `assertEntityAclForRequest` additionally requires a **synthesized per-entity feature** `entities.records.<entityId>.view` / `entities.records.<entityId>.manage` (e.g. `entities.records.hr:salaries.view`). The coarse feature alone no longer grants it; `entities.records.*`, `entities.*`, and super-admin still do (normal wildcard semantics).

Grant the per-entity features in the Role/User ACL editor — `GET /api/auth/features` now appends them for the calling tenant's restricted entities. New DB column `custom_entities.access_restricted` (`boolean not null default false`, migration `Migration20260716120000`). Toggle it per entity on the custom-entity create/edit page, or declare `accessRestricted: true` in a module's `ce.ts` `CustomEntitySpec`. An optional tenant policy `entities.newEntitiesRestrictedByDefault` (module config, default off; read/set via `GET/PUT /api/entities/entity-settings`) makes new entities restricted-by-default for tenants that want deny-by-default.

*Action for downstream:* none to keep current behavior. **If you flag an in-use entity as restricted, existing coarse-feature holders lose access to it** until granted the per-entity feature — this is the intended compartmentalization. If you ship a sensitive custom entity via `ce.ts`, set `accessRestricted: true` and grant the per-entity features to the roles that should see it. See [`.ai/specs/2026-07-16-custom-entity-record-acl-per-entity.md`](.ai/specs/2026-07-16-custom-entity-record-acl-per-entity.md).

### Skills install into the canonical `.agents/skills/` directory (#4155)

`yarn install-skills` (monorepo) and `mercato agentic:init` / `yarn install-skills` (standalone apps) used to write every skill into each agent's own folder — local tier skills were symlinked into both `.claude/skills/` and `.codex/skills/`, and external skills landed in `.agents/skills/` **plus** `.claude/skills/` **plus** a hand-made `.codex/skills/` mirror: three copies of the same skill.

Skills now install **once**, into the canonical cross-agent directory `.agents/skills/`. An agent only gets its own per-skill symlinks when it cannot read that directory: Claude Code does (automatic, unchanged for its users), while Codex and Cursor read `.agents/skills/` natively and no longer get a `.codex/skills/` or `.cursor/skills/` directory at all. Scaffolded apps no longer seed `.codex/skills` / `.cursor/skills` symlinks either.

All existing flags and exit behavior of `yarn install-skills` are unchanged; the new flags are additive. Only gitignored dev-tooling directories are affected — no application code, no committed files.

Contributor action:

- Re-run the installer once so stale `.codex/skills/` (and any `.cursor/skills/`) links from the old layout are swept away:

  ```bash
  yarn install-skills --clean && yarn install-skills
  ```

  A plain `yarn install-skills` also self-heals (it sweeps the legacy per-agent links); the `--clean` form just makes it explicit.
- If a setup still depends on the old layout, `yarn install-skills --legacy-links` restores it.
- To keep an agent's directory from being written at all, pass `--ignore-agents <csv>` or add a persistent `{ "agents": { "ignore": ["cursor"] } }` block to `.ai/skills/tiers.json`.

### Documents module — optional realtime-collaboration sidecar and env vars

The new `documents` module ships an optional realtime-collaboration sidecar: the `documents-collab` service in `docker-compose.fullapp.yml` / `docker-compose.fullapp.dev.yml` (and the create-app template equivalents), started with `yarn documents:collab`. Every related environment variable is **optional** and the stack degrades gracefully when they are unset:

- `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL` — browser-reachable `ws(s)://` endpoint, embedded into the client at **build time**. Unset → the document editor works in single-user mode (no realtime collaboration). A malformed or loopback production value is logged and ignored at runtime, so an optional collaboration misconfiguration cannot abort the platform image build.
- `DOCUMENTS_COLLAB_JWT_SECRET_V2` — shared secret between the app and the sidecar; required only when collaboration is enabled. Must contain at least 32 UTF-8 bytes; the sidecar fails closed (refuses to serve collaboration tokens, `/healthz` reports 503) when it is missing or too short.
- `DOCUMENTS_COLLAB_REDIS_URL` (falls back to `REDIS_URL`) — Redis endpoint used for multi-instance collaboration sync. The bundled compose files wire both to the stack's Redis out of the box.
- `DOCUMENTS_COLLAB_REDIS_PREFIX` — deployment-scoped collaboration namespace. It is required when Redis is configured in production; use one shared value for all replicas of a deployment and a different value for every deployment sharing the Redis database. Bundled compose files derive an isolated default from `DEPLOY_ENV`.
- `TENANT_DATA_ENCRYPTION_KEY` and the other `TENANT_DATA_ENCRYPTION*` vars — the sidecar decrypts the same tenant data as the app, so the compose files now pass the app service's encryption configuration to `documents-collab` too. If you run the sidecar outside the bundled compose files, forward your encryption configuration to it yourself.
- PDF export requires Chromium. Both production Dockerfiles default `INSTALL_CHROMIUM=0`; opt in with `--build-arg INSTALL_CHROMIUM=1` (or `INSTALL_CHROMIUM=1 docker compose build app`). Without it, PDF export returns 503 and everything else keeps working. The measured Alpine runtime-image cost is **236 MB → 1.26 GB** (**+1.02 GB**), so deployments that need PDF export take that cost explicitly.

*Action for downstream:* none for existing deployments — with no documents env vars set, images build and `docker compose config/ps/up` run exactly as before (the compose files use `:-` defaults, never `:?` required interpolation, and `APP_URL` keeps its `http://localhost:3000` default). The sidecar is behind the `documents-collab` Compose profile and no longer starts or binds port 4101 during a normal `up`. In the monorepo Compose files it reuses the exact image built by the `app` service rather than rebuilding the same tag with a different build-argument set; standalone templates retain Compose's project-scoped service images. To enable collaboration, set the collaboration URL and v2 secret, rebuild the app image, and start with `docker compose --profile documents-collab up`. Set `INSTALL_CHROMIUM=1` only when the deployment needs PDF export.

### Shared `om-*` pipeline skills now come from open-mercato/skills

The generalized agent-pipeline skills (`om-code-review`, `om-auto-create-pr`, `om-auto-review-pr`, `om-merge-buddy`, `om-spec-writing`, the `-loop` variants, `om-prepare-issue`, and 15 more — see the `external` block in [`.ai/skills/tiers.json`](.ai/skills/tiers.json)) were removed from `.ai/skills/` and are now installed from the shared [open-mercato/skills](https://github.com/open-mercato/skills) collection. `yarn install-skills` runs `npx -y skills add open-mercato/skills --skill '*'` after the local tier symlinks, placing the skills under `.agents/skills/` (gitignored), then `npx -y skills update --project` so re-running the installer refreshes the external skills to their latest published versions (the lockfile is gitignored, so `add` seeds and `update` keeps them current).

Contributor action:

- Re-run `yarn install-skills` (network required for the npx step; pass `--no-external` or set `OM_SKIP_EXTERNAL_SKILLS=1` when offline — local tier skills still install).
- Repo-specific behavior for the external skills is configured in [`.ai/agentic.config.json`](.ai/agentic.config.json) (validation gate, labels, base branch), the tracker descriptor [`.ai/trackers/github.md`](.ai/trackers/github.md), the review checklist [`.ai/review-checklist.md`](.ai/review-checklist.md), and repo-local override skills under `.ai/skills/<external-name>/SKILL.md`.
- The local `om-auto-fix-github` skill has been removed and replaced by the external `om-auto-fix-issue` (installed under `.agents/skills/` from the shared open-mercato/skills collection). Update any `/om-auto-fix-github` callers to `/om-auto-fix-issue`.

### Rate-limit proxy trust now defaults to safe direct mode (#4041)

`RATE_LIMIT_TRUST_PROXY_DEPTH` now defaults to `0` instead of `1`. Direct deployments therefore ignore client-supplied forwarding headers and use endpoint-scoped `global` fallback buckets, so missing trusted IP data no longer disables auth, metadata-driven, or checkout throttles. Invalid, negative, and fractional depth values emit a warning and also fall back to `0`; forwarded chains shorter than an explicitly configured positive depth use the same bounded fallback.

**Action for proxied deployments:** set `RATE_LIMIT_TRUST_PROXY_DEPTH` to the exact number of trusted reverse proxies between the client and the app (for example, `1` for a single nginx/ALB hop). Without that explicit setting, all traffic shares each endpoint's configured fallback bucket, which is secure against header spoofing but can reduce availability under load. Direct deployments should leave the value unset or set it to `0`.


### Tenant-scoped search settings + verified provider availability (#3092)

Vector/fulltext search settings (Cmd+K strategies, embedding provider/model, auto-index flag) were stored in a single global `module_configs` row, so any tenant admin's save overwrote every tenant's configuration. Settings are now scoped per tenant: a tenant reads/writes only its own row and inherits the instance default (legacy global row) → env-derived default when unset. Four downstream-visible changes:

1. **Search settings are now tenant-scoped.** Settings `GET` responses gain a `source: 'tenant' | 'instance' | 'env'` field indicating where the effective value came from. *Action for downstream:* none for typical callers; clients must not assume one tenant's settings apply to another.

2. **`ModuleConfigService` gained an optional `scope` argument** on `getRecord`/`getValue`/`setValue`/`invalidate`. This is **additive** — every caller that omits `scope` keeps the exact prior behavior (the global row). `ModuleConfigRecord` gained additive `tenantId`/`organizationId`/`source` fields. *Action for downstream:* none; opt into per-tenant config by passing `scope` where you want it.

3. **`module_configs` schema change (additive).** Added nullable `tenant_id`/`organization_id` columns; replaced the single `(module_id, name)` unique constraint with two partial unique indexes (global `WHERE tenant_id IS NULL`, scoped `WHERE tenant_id IS NOT NULL`). Existing rows keep `tenant_id = NULL` and become the instance default; no backfill required. *Action for downstream:* apply the `configs` module migration (`Migration20260617150000`) before relying on tenant-scoped settings.

4. **Provider availability is now verified (behavior fix).** `isProviderConfigured('ollama')` previously returned `true` unconditionally. A new cached, fail-closed `embeddingProviderProbe` (additive DI key) actively checks Ollama via `GET {OLLAMA_BASE_URL}/api/tags` (key-presence for the other providers). The embeddings settings `GET` returns per-provider `available`/`reason`, and the embeddings `POST` rejects selecting an unreachable provider with `409 { error, reason }`. *Action for downstream:* environments that relied on Ollama always reporting "available" must ensure Ollama is actually reachable at `OLLAMA_BASE_URL` (which was already required for embedding to function).

All changes are additive at the contract surface. No event IDs, widget spot IDs, ACL feature IDs, import paths, or CLI commands changed. The vector index (shared pgvector table) remains instance-level; per-tenant scoping covers settings selection, not stored vectors. See [`.ai/specs/2026-06-15-tenant-scoped-search-settings.md`](.ai/specs/2026-06-15-tenant-scoped-search-settings.md) (tracking issue #3092).

### Notification channels unified on the delivery-strategy seam (Phase 7)

All notification channels now flow through one seam and one gate. This is additive and backward-compatible, with one **intentional corrective behavior change** and one **deprecation** relevant to module authors.

**Behavior change (corrective).** Per-channel opt-out and the `nonOptOut`/`silent` type flags are now enforced on **every** channel, not just push. Previously, disabling `in_app` or `email` for a notification type in a user's preferences was silently ignored — those channels always delivered. After upgrading, an `in_app` opt-out hides the notification from the bell/inbox/unread-count (the row is still written as a durable record), and an `email` opt-out suppresses the email. A user who has **never changed their preferences sees no difference** (preferences default to on). No action required unless you relied on opt-outs being ignored.

**`Notification.channels` is now authoritative.** The new nullable `channels` JSONB column stores the resolved delivery-channel set. A create call with no `channels` still fans out to every registered channel (unchanged); pass `channels: ['push']` (etc.) to a `notificationService.create(...)` call to target specific channels. Legacy rows (`channels = NULL`) are treated as "all channels / visible".

**Deprecation — `NotificationDeliveryContext` email fields.** For authors of custom `NotificationDeliveryStrategy` implementations: the context is now split into a channel-agnostic core (`NotificationDeliveryContextCore`) and `EmailDeliveryExtras` (`panelUrl`, `panelLink`, `actionLinks` — and `recipient.email` is email-specific). The flat shape is unchanged (all fields still present) so existing strategies compile and run as-is, but the email-shaped fields are now `@deprecated`: a non-email strategy MUST NOT depend on them and should derive whatever it needs from `notification`. They will move behind an email-scoped accessor in a future major.

**New capability hooks.** `NotificationDeliveryStrategy` gained optional `isConfigured(ctx)` and `supports(notification)`; the dispatcher skips a channel when either returns `false`. Use `isConfigured` for tenant-config/technical deliverability (not per-user opt-out, which the create-time gate already handles).

**Behavior change — built-in notification types no longer deliver push.** Every built-in notification type (auth, sales, messages, catalog, workflows, customers, customer accounts, staff, inbox ops, business rules, communication channels — 28 types) now declares the channel eligibility `channels: ['in_app', 'email']`: push is completely off for these types — it never delivers and users cannot enable it from their preferences (the push cell renders locked). Connecting FCM/APNs/Expo therefore no longer floods devices with **these built-in core types**; `nonOptOut` types (security alerts) are governed by the same eligibility, while the admin custom-send types stay unrestricted. **Caveat — this does not yet hold platform-wide.** Any notification type that *omits* `channels` still resolves to **every** registered channel, push included, the moment a push channel is connected. Types that ship without `channels` today — `enterprise/security`, `enterprise/record_locks`, `checkout`, both `example` modules, `webhooks`, `ai_assistant`, and every module scaffolded from the CLI generator template — are push-eligible by default. Whether the platform-wide default for a `channels`-less type should stay **opt-out-per-type** or become **push-opt-in** (a type must list `push` explicitly) is an open maintainer policy decision — see the spec's § Deferred Follow-ups. Module authors: declare `channels` on your own `NotificationTypeDefinition`s to choose the shipped channel set; **omitting it keeps the every-channel, push-eligible default** — set `channels: ['in_app', 'email']` to keep push off.

**New capability — operators edit a type's channels without a code change, per tenant.** The new `notification_type_overrides` table (apply the notifications module migration; unique per `(tenant_id, notification_type_id)`) stores a tenant-scoped override of the code-declared eligibility: a stored array replaces the code set, an absent row inherits it, and one tenant's edit never changes delivery for another tenant. Edit it from the type-catalogue table on the **Notification Delivery** settings page or via `PATCH /api/notifications/types` with `{ "id": "<type>", "channels": ["in_app","email","push"] }` (pass `channels: null` to clear the override) — e.g. flip push back on for `messages.new` in a tenant that wants it. A channel outside the effective set is rejected by the delivery gate before both user preferences and the `nonOptOut` bypass, `setPreferences` drops writes for it server-side, and both preference UIs render the cell locked off. `GET /api/notifications/types` now returns `channels` (effective set for the caller's tenant, `null` = every channel), `storedChannels`/`storedNonOptOut` (the raw override), and `updatedAt` (the override row's optimistic-lock version — the PATCH honors the standard `x-om-ext-optimistic-lock-expected-updated-at` header and 409s a stale write, since the full `channels` array replaces). The same PATCH also accepts `nonOptOut: true | false | null` on the same row: `true` forces a type on for the tenant's users, `false` makes a code-required type user-editable, `null` inherits the code flag (`notification_types.non_opt_out` remains a pure code mirror). The catalogue re-sync never touches the overrides table, so operator edits survive upgrades; clearing both fields deletes the row.

### Device `push_token` is encrypted at rest — existing tenants get a backfilled encryption map

The devices module registers a new encrypted entity: `push_token` on `devices:user_device` is encrypted at rest via the standard tenant-data-encryption seam. Encryption is driven by an `encryption_maps` row that declares which fields to encrypt, and those rows are normally seeded **once at tenant creation** (`entities seed-encryption`). A pre-existing tenant therefore has **no map for the new device entity**, and `encryptEntityPayload` no-ops when no map resolves — so a device registered after the upgrade would have its `push_token` written as **plaintext**, silently.

**This heals automatically on `yarn db:migrate`.** A forward-only, idempotent data migration (`entities` module, `Migration20260722120000`) inserts the `devices:user_device` map for every `(tenant, organization)` scope that already has active encryption maps — mirroring what `seed-encryption` does, and correctly skipping tenants that run with encryption disabled (they have no maps at all). New tenants continue to get the map from `seed-encryption` at creation. **No operator action is required** for the standard migrate-then-deploy flow, and there is no plaintext window because the map exists before the new code serves traffic.

Two additional heal paths are available if you need them:

- **Upgrade Action** (`devices.seed-push-token-encryption-map`, version `0.6.6`) — the managed, UI/API-triggered heal for the same backfill, gated on `UPGRADE_ACTIONS_ENABLED=true` and the `configs.manage` feature, run per tenant (idempotent). Use it if you skip migrations or want to re-assert the map from the admin banner.
- **Manual CLI** — re-run `yarn mercato entities seed-encryption --tenant <tenantId> --org <organizationId>` per tenant. It idempotently upserts **all** modules' default encryption maps, including the device one.

Note: only push tokens **written after** the map exists are encrypted. If a tenant already ran a build that wrote plaintext tokens before the map was present, those rows stay plaintext until the device re-registers (or you run `entities rotate-encryption` / `decrypt-database` tooling). The map is a declaration only — the tenant DEK drives the actual crypto, so seeding it is safe even when encryption is currently disabled; it simply activates once encryption is enabled.

### Run `yarn mercato auth sync-role-acls` after upgrading — new devices/push ACL features

This release adds new ACL feature IDs across the devices/push stack: `devices.*` (`view`/`manage`/`admin`), `push_notifications.view_deliveries` / `push_notifications.send_custom`, the tenant push-channel grants `communication_channels.connect_tenant_channel` / `communication_channels.channel.push.manage`, `notifications.manage_preferences` / `notifications.manage_user_preferences`, and the per-provider `channel_{fcm,apns,expo}.{view,configure}` features.

New tenants receive these through each module's `setup.ts` `defaultRoleFeatures` at creation. **Existing tenants do not** — their role ACLs were written before these features existed, so until you sync them an admin gets `403`/blank UI on the new **Devices** page, the **Push Delivery Log**, the notification-preferences grid, and the push-channel connect flow. Run the idempotent sync once per upgrade:

```bash
yarn mercato auth sync-role-acls
```

It only *adds* the newly declared default grants to existing roles and never removes an operator's customizations. Target one tenant with `--tenant <tenantId>` if you prefer a staged rollout.

### Advanced-filter conditions whose field names a Where combinator are now ignored

`deserializeAdvancedFilter` (flat, v1) and `deserializeTree` (v2) — the shared parsers behind the `filter[...]` query params on every CRUD list route — now drop a condition whose `field` starts with `$`, i.e. names a Where combinator such as `$and`, `$or` or `$not`. A filter built only from such conditions deserializes to `null` and the route lists as if no filter were supplied.

Condition field names are never validated against a route's field allowlist, so a combinator-named field previously compiled into a Where key sharing the namespace with real column names — reaching the query engine either as a filter on a non-existent column (matching every indexed row) or colliding with a key the route itself emitted. Dropping it matches how an unrecognized operator is already handled.

**Action for module authors:** none expected — there is no legitimate `$`-prefixed column, so no real caller can be relying on this. It is documented because these two functions are shared surface used by every list route: if you are debugging a saved view or a hand-built filter that used to reach the engine and now appears to be ignored, check whether one of its conditions names a combinator. Route-level defence is independent of the parser — a route that consumes the filter itself via `consumeAdvancedFilterState` + `mergeAdvancedFilterTree` (customers/people, companies, deals, devices) already AND-combines it under its own filters, so no client key can overwrite a server-enforced scope. See [`.ai/specs/2026-04-28-push-notifications-and-devices.md`](.ai/specs/2026-04-28-push-notifications-and-devices.md) § Changelog.

### New root `resolutions` entry: `node-forge@1.4.0`

The new `@open-mercato/channel-apns` package depends on `@parse/node-apn@6.5.0`, which declares `node-forge` as an **exact** version (`node-forge: "npm:1.3.1"`) rather than a range — so no install can ever pick up a patched `node-forge`, including a security patch. The root `package.json` now pins `node-forge` to `1.4.0` in `resolutions`, alongside the other security-hygiene pins there.

This applies monorepo-wide, so it also lifts `node-forge` for any other workspace that resolves it transitively. It is safe to leave in place; do not remove it while `channel-apns` is present, or the graph silently reverts to the exact 1.3.1 the SDK hard-codes. See `packages/channel-apns/AGENTS.md`.

### New root `resolutions` entry: `websocket-driver@0.7.5`

GHSA-xv26-6w52-cph6 (critical, published 2026-07-15) affects `websocket-driver < 0.7.5`, which the graph resolves transitively via two chains: `@docusaurus/core → webpack-dev-server → sockjs → faye-websocket` (already present on `develop`) and `@firebase/database → faye-websocket` (new with `channel-fcm`). Both declare ranges that satisfy `0.7.5`, so a plain re-resolve would eventually pick it up — the pin makes the floor explicit and keeps `yarn npm audit` (the CI `audit` job) green deterministically. Safe to remove once every chain's own minimum moves past 0.7.5.


### Versioned browser-storage envelopes for shared UI preference slots (#3457)

Several shared UI surfaces that persist client state to `localStorage` — DataTable perspective snapshots, the AppShell sidebar collapsed-groups set, the AI model picker selection, and the AI chat sessions cache — now write through a shared **versioned-envelope** helper (`packages/shared/src/lib/browser/versionedPreference.ts`) instead of bare JSON. On disk each of these slots now carries a `{ v, data }` shape with an explicit version discriminator, rather than the raw value it stored before.

**No manual action is required for end users.** The `localStorage` **keys are unchanged**, and `readVersionedPreference(...)` migrates a pre-envelope (legacy bare) value forward automatically on the next write when a `legacyIsValid` guard is supplied (as it is for every slot migrated in #3457). Stored data that is version-mismatched or malformed is safely discarded back to the documented fallback instead of crashing or silently corrupting UI state, so a downgrade/upgrade across this boundary simply re-derives defaults at worst.

**Action for module authors who read/write these persisted slots directly.** If your module reads or writes one of these shared `localStorage` keys (or adds its own structured preference slot), go through the helper rather than `safeLocalStorage`/raw `localStorage`:

```ts
import {
  readVersionedPreference,
  writeVersionedPreference,
  // readVersionedIdSet / writeVersionedIdSet for the common "set of ids" shape
} from '@open-mercato/shared/lib/browser/versionedPreference'

// read: validate the envelope, discard stale/mismatched data, migrate a legacy bare value forward
const value = readVersionedPreference(key, version, isValid, fallback, { legacyIsValid })
// write: wraps as { v: version, data: value }
writeVersionedPreference(key, version, value)
```

Follow the **versioning threshold** documented in [`packages/shared/AGENTS.md`](packages/shared/AGENTS.md) when deciding whether a slot needs an envelope: trivial scalar flags (a single boolean/number/string with no schema to evolve, e.g. `om:sidebarCollapsed`) MAY stay raw via `safeLocalStorage`; **structured values** (objects, records, arrays of objects whose shape can change incompatibly) MUST use a versioned envelope so a future shape change can migrate or discard old data. A slot that already carries its own inline `{ v, ... }` discriminator is already migratable and MUST NOT be re-wrapped — re-wrapping changes the on-disk format and discards existing user data.

This is a refactor with no API, event-ID, DI, or DB-schema contract change. Related: #3457 (this change), and the sibling persisted-storage audit tracked in #3174 / #3393.

### Selectable dev-mode watch scope (opt-in, default unchanged)

In the monorepo, `yarn dev` can now watch a **subset** of workspace packages instead of always watching every one. The default remains `all` (watch everything), so **no action is required** — existing `yarn dev` / `yarn dev:greenfield` runs behave exactly as before.

To opt in, pick a scope with the new `OM_WATCH_SCOPE` env var or the `--watch=<mode>` flag (CLI flag wins over the env var):

- `all` (default) — watch every package.
- `auto-optimized` — watch only packages your git working tree / current-branch diff touched, re-checking every 2 minutes and expanding to newly-touched packages.
- `popular` — watch only the most frequently changed packages from recent `git log` history (`OM_WATCH_POPULAR_LIMIT`, default 6; falls back to `core`, `ui`, `shared`).
- `env` — watch exactly the packages in `OM_WATCH_PACKAGES`, or the selection saved by the interactive picker (`yarn dev:watch-select`, persisted to the gitignored `.mercato/watch-packages.local.json`).

```bash
yarn dev --watch=auto-optimized
OM_WATCH_SCOPE=env OM_WATCH_PACKAGES=core,ui yarn dev
yarn dev:greenfield --watch=popular
```

Additional knobs: `OM_WATCH_GIT_STATUS`, `OM_WATCH_GIT_BRANCH`, `OM_WATCH_BASE_REF`, `OM_WATCH_POPULAR_LIMIT`. This is purely a local dev-DX feature: no API, event-ID, DI, ACL, or DB-schema contract changed, and the app source is still fully watched by Next.js/Turbopack regardless of scope. Standalone create-app projects do not run the workspace-package watcher in normal use. See [the troubleshooting guide](apps/docs/docs/appendix/troubleshooting.mdx) for the full reference.

### Attachment organization fix ships with an opt-in reconciliation you must enable to heal existing data (#3765)

`POST/GET/DELETE /api/attachments` and the file/image serve routes now scope by the **currently selected** organization instead of the uploader's pinned home organization. This is a forward-only bug fix — new uploads land under the right org. **Attachments that were already written under the wrong organization while the bug was live are not healed automatically**, and because reads are now scoped to the selected org they become *invisible* to org-scoped surfaces (product/variant media aggregation, list, file/image serve) until reconciled.

The heal is delivered as a version-gated **Upgrade Action** (`attachments.reconcile-organization`, version `0.6.6`) that resets each attachment's `organization_id` to its parent record's org. **Upgrade Actions are disabled by default**, so no data changes on deploy — you must opt in:

1. **Enable Upgrade Actions.** Set the server flag so the action can run, and the public flag so the admin banner renders:

   ```bash
   UPGRADE_ACTIONS_ENABLED=true            # server: required to list + execute actions
   NEXT_PUBLIC_UPGRADE_ACTIONS_ENABLED=true # client: required for the admin CTA banner to appear (build-time inlined)
   ```

   The action is also gated on the running app version being ≥ `0.6.6`.

2. **Run it, one of two ways** (both require the `configs.manage` feature and act **per tenant**; the pass is idempotent, tenant-scoped, and only ever changes `organization_id` — never `tenant_id`, so nothing moves across tenants):
   - **UI:** a `configs.manage` admin clicks the **"Reconcile attachment organizations"** CTA in the upgrade banner.
   - **Manually via the API** (only `UPGRADE_ACTIONS_ENABLED=true` is needed for this path — the public flag is only for the banner):

     ```bash
     curl -X POST https://<host>/api/configs/upgrade-actions \
       -H 'content-type: application/json' \
       --cookie '<authenticated configs.manage session>' \
       -d '{"actionId":"attachments.reconcile-organization"}'
     ```

   Attachments whose parent record's org cannot be resolved (custom/legacy `entityId`s, hard-deleted parents, the virtual `attachments:library` entity) are counted and **left untouched** — nothing is deleted or blanked. Re-running after already-correct data is a no-op (`already_completed`).

*Action for downstream:* if you ran a multi-org setup on an affected build, enable Upgrade Actions and run `attachments.reconcile-organization` once per tenant to heal misfiled attachments; a self-hoster with single-org or clean data can leave Upgrade Actions off. No contract surface changed (the reconciliation helper and upgrade-action entry are additive). See [`.ai/specs`](.ai/specs/) and issue #3765.

### Role ACL organization semantics widened — review `role_acls` rows before upgrading

`RbacService` changed how a role's organization grant is interpreted. Both changes widen access, so review your `role_acls` data before deploying.

**1. An empty `organizations_json` array widens access for API-key principals only — human principals are unchanged.**

For a **human user**, an empty array remains a deny-all organization scope: it projects to an empty accessible set, so `resolveOrganizationScope` still falls back to the user's **account organization and its descendants** and scoped reads and deletes fail closed. This is deliberate — collapsing it to `null` (unrestricted) would reopen the scoped-deletion hole closed by #4033, where a deny-all actor could delete an organization-bound API key. The role's *features* still apply; only its organization reach stays empty.

For an **API-key principal**, an empty role allowlist now means "inherit the key's own organization binding" rather than contributing nothing. A key with a concrete `organization_id` therefore stays bound to that organization; only a key without one widens to the tenant.

Find rows whose meaning depends on this distinction:

```sql
SELECT role_id, tenant_id FROM role_acls WHERE organizations_json = '[]'::jsonb AND deleted_at IS NULL;
```

No action is required for human-facing roles. Review these rows only where the role is assigned to API keys, and set an explicit allowlist (`'["<org-uuid>", …]'::jsonb`) if a key should stay narrower than its own binding. Use the explicit `["__all__"]` sentinel when tenant-wide access is what you actually want — it has always meant that and is unambiguous.

**2. A role's organization grants now match the selected organization's ancestor chain.**

`roleAclAllowsOrganization` used to require the selected organization to appear literally in `organizations_json`. It now also matches when any **ancestor** of the selected organization is listed, so a role scoped to a parent organization applies in that parent's descendants. This mirrors what `resolveOrganizationScope` already did when expanding parent grants to descendants, so most deployments see no change — but a role deliberately pinned to a parent org *without* wanting it to reach children now reaches them. Ancestor expansion requires the Directory hierarchy service; when Directory is disabled, matching stays exact and fails closed.

**3. An organization-restricted role-level super-admin grant is no longer global.**

A `RoleAcl` with `is_super_admin = true` *and* a non-empty, non-`__all__` `organizations_json` no longer short-circuits to global super-admin. It is now evaluated through the scoped ACL projection and stays bounded by its organization list. This is a **narrowing** — an operator relying on such a row for tenant-wide administration will lose that reach. Clear the row's `organizations_json` (or set `["__all__"]`) to restore global super-admin.

Find affected rows:

```sql
SELECT role_id, tenant_id, organizations_json FROM role_acls
WHERE is_super_admin = true AND jsonb_array_length(COALESCE(organizations_json, '[]'::jsonb)) > 0
  AND NOT organizations_json ? '__all__' AND deleted_at IS NULL;
```

*Action for downstream:* run both queries against each tenant, decide per row, and adjust before deploying. No API, DI, or type surface changed — `RbacService` gained an optional third constructor argument (the Directory hierarchy seam) and keeps working without it.

### Removed — `MODULE_FACTS_ALLOWLIST` export (module fact-sheet auto-discovery) (#3752, #3798, #3754)

The module fact-sheet generator no longer gates on a hard-coded 9-module allowlist. It now **auto-discovers** every source-available package module: the `create-app` build (and `mercato agentic:init`) bundle a fact-sheet for every package-provided module (`discoverPackageModuleSources`), shipped to scaffolded apps as `.ai/guides/module-facts.json` + per-module sheets. The monorepo no longer emits a committed `apps/mercato/src/module-facts.generated.json` — that artifact had no runtime or test consumer and has been removed along with its generator (`generateModuleFacts`) and the unused registry-driven `discoverEnabledModuleSources` path.

- **Removed (#3754):** `MODULE_FACTS_ALLOWLIST` and `ModuleFactsModuleId` (previously exported from `@open-mercato/cli/lib/generators/module-facts`) are **gone**. Their only remaining runtime consumer was the legacy `core.<module>.md` redirect-stub loop, retired in the same change. Because the whole fact-sheet auto-discovery layer is still `Unreleased` (it never shipped in a tagged release), the exports are removed outright with no deprecation window.
- **Additive, non-breaking API:** `extractModuleFacts` gained an optional `moduleRoot`, and `extractAllModuleFacts` gained an optional `sources`. The legacy `{ coreSrcRoot, moduleIds? }` call shape still works, but with `MODULE_FACTS_ALLOWLIST` gone it no longer falls back to the historical 9-module list — pass an explicit `moduleIds` (or the preferred `sources`) instead.

*Action for downstream:* callers that imported `MODULE_FACTS_ALLOWLIST` to enumerate documented modules must instead read the keys of the bundled `.ai/guides/module-facts.json` (or call `discoverPackageModuleSources` from `@open-mercato/cli/lib/generators/module-facts-discovery`). No tagged release ever exported these names, so no in-the-wild code depends on them. See [`.ai/specs/2026-07-06-module-facts-auto-discovery.md`](.ai/specs/2026-07-06-module-facts-auto-discovery.md).

### Removed — per-module standalone AI guides → generated fact-sheets (#3715, #3754)

The hand-written per-module standalone guides that shipped into scaffolded apps as `.ai/guides/core.<module>.md` (for the user-facing core modules `auth`, `catalog`, `currencies`, `customer_accounts`, `customers`, `data_sync`, `integrations`, `sales`, `workflows`) are replaced by two layers:

- **Generated per-module fact-sheets** — `.ai/guides/modules/<module>.md` plus a combined `.ai/guides/module-facts.json` sidecar, extracted from module source (entities, events, ACL features, API routes with per-method auth, DI service tokens, searchable entities, host extension tokens, notifications, CLI) at build time.
- **One hand-written conceptual guide** — `.ai/guides/module-system.md`, covering the timeless module-system concepts (anatomy, auto-discovery, naming, mandatory mechanisms, data integrity, migrations).

*Action for downstream:* reference `.ai/guides/modules/<module>.md` for a module's concrete facts and `.ai/guides/module-system.md` for conceptual guidance. The legacy `.ai/guides/core.<module>.md` redirect stubs that briefly bridged the old names were **retired outright in #3754**: because they never shipped in a tagged release (the whole layer is still `Unreleased`), they were removed with no deprecation window rather than kept for a minor. Freshly scaffolded apps already link only the new paths. See [`.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md`](.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md).

---

## 0.6.3 → 0.6.4 (2026-06-08)

### Tenant-ownership & per-module ACL authorization hardening (#2612)

Closes a class of Broken Access Control (OWASP A01 / BOLA+BFLA) defects where the platform checked *capability* (route `requireFeatures`) but not *object/target-module ownership* before reading or mutating. Three downstream-visible changes:

1. **Generic entity-records API now enforces the target module's ACL.** `GET/POST/PUT/DELETE /api/entities/records` (and CSV/export) previously authorized with only `entities.records.view` / `entities.records.manage`. They now also require the **owning module's** feature for the requested `entityId` (e.g. `directory.tenants.view` for `directory:tenant`, `customers.people.view` for `customers:customer_person_profile`), resolved from an explicit registry in `packages/core/src/modules/entities/lib/entityAcl.ts`. **Custom/EAV entities are unaffected** — they keep the existing `entities.records.*` + tenant-scope path. **Unmapped ORM-backed entities are fail-closed (super-admin only).** *Action for downstream:* if you exposed a custom **ORM-backed** entity through this generic API, add an entry to the `entityAcl` map (module + view/manage features) or callers without the owning feature will receive `403`.

2. **Public org-slug lookup no longer returns `tenantId`.** `GET /api/directory/organizations/lookup?slug=…` now returns `{ ok, organization: { id, name, slug } }` — the internal `tenantId` field was removed (it was an unauthenticated information leak). The platform-domain customer-portal login/signup flow now resolves the tenant **server-side from `organizationId`** via `resolveTenantContext`. *Action for downstream:* portal clients that read `tenantId` from this response must instead send the org's `id` as `organizationId` to `POST /api/customer_accounts/{login,signup}`. The legacy body `tenantId` is still accepted (with a fail-closed cross-check) for one release, so existing clients keep working during migration. `GET /api/directory/tenants/lookup` is unchanged.

3. **Auth user & role mutations enforce target-tenant ownership.** `PUT`/`DELETE /api/auth/users`, the user ACL/consents/resend-invite routes, and role create/update/delete now verify the **target** user/role belongs to the actor's tenant (and org scope where applicable). A non-super-admin acting on a foreign-tenant or platform (`tenantId = null`) id now receives `404` (cross-tenant/unknown) or `403` (in-tenant, out-of-allowed-org) instead of silently mutating it. Super-admin (incl. selected-tenant) behavior is unchanged. *Action for downstream:* none unless you relied on the cross-tenant bypass; integrators that assumed a tenant admin could edit arbitrary `userId`s will now be denied (this was unintended).

No DB schema change. No ACL feature IDs were renamed or removed (only enforced). See [`.ai/specs/implemented/2026-06-05-tenant-ownership-and-module-acl-authorization.md`](.ai/specs/implemented/2026-06-05-tenant-ownership-and-module-acl-authorization.md). Enterprise `security` (MFA admin/enforcement) variants are tracked separately in [`.ai/specs/enterprise/implemented/2026-06-05-security-mfa-cross-tenant-authorization.md`](.ai/specs/enterprise/implemented/2026-06-05-security-mfa-cross-tenant-authorization.md).

### Enterprise `security` — MFA admin & enforcement views are now tenant-scoped (#2612)

Same root cause as above, in the enterprise `security` module. Because `security/setup.ts` grants default admins `security.*`, every tenant admin held `security.admin.manage` — which previously let them read/act across **all** tenants. Now enforced (super-admin/platform required for cross-tenant or platform-wide views):

1. **Per-user MFA admin (IDOR closed).** `GET /api/security/users/[id]/mfa/status` and `POST /api/security/users/[id]/mfa/reset` now verify the target user belongs to the actor's tenant — a foreign-tenant target returns `404` even with a valid sudo token (sudo validates the actor, not the target).
2. **MFA compliance.** `GET /api/security/users/mfa/compliance?tenantId=…` no longer prefers a caller-supplied `tenantId`; a non-super-admin requesting a foreign tenant gets `403`.
3. **Enforcement compliance & policies.** `GET /api/security/enforcement/compliance` now requires platform-admin for `scope=platform` (previously it counted users across all tenants) and validates `scope=tenant|organisation` ownership; enforcement policy list/create/update/delete reject foreign-tenant/org scopes for non-super-admins (`403`). The unfiltered `em.find(User, { deletedAt: null })` is unreachable for non-super-admins.

*Action for downstream:* none unless internal tooling relied on a tenant admin viewing other tenants' MFA posture or using `scope=platform` — those calls now require a platform/super-admin. No DB schema change; no ACL feature IDs renamed. Service methods (`MfaAdminService`, `MfaEnforcementService`) gained an **optional** actor-context backstop param — additive, existing callers unaffected. Reuses the core `enforceTenantSelection`/`resolveIsSuperAdmin` helpers, so the enterprise build must be paired with a core that has them (true since ≤ 0.6.4). See [`.ai/specs/enterprise/implemented/2026-06-05-security-mfa-cross-tenant-authorization.md`](.ai/specs/enterprise/implemented/2026-06-05-security-mfa-cross-tenant-authorization.md).

### Scheduler queue targets restricted to authorized safe workers (security)

The scheduler job API previously let any user holding `scheduler.jobs.manage` point a
schedule at **any** registered queue worker with an arbitrary JSON payload, and both
dispatch paths delivered that payload to the worker nearly verbatim — turning the
scheduler into a confused deputy for privileged internal operations (e.g. a scheduled
payload could synthesize Stripe webhook events with attacker-chosen scope).

Queue targeting is now an explicit opt-in:

- A worker declares itself schedulable by adding `schedulerSafe: true` to its
  `WorkerMeta` (`packages/queue`); the module registry propagates the flag and the
  scheduler honors it everywhere:
  - `GET /api/scheduler/targets` advertises only safe queues (response shape unchanged).
  - Create/update via `/api/scheduler/jobs` rejects any other queue with a validation
    error on `targetQueue`.
  - Dispatch re-authorizes before enqueue: module-authored schedules
    (`sourceType: 'module'`) keep working against their own internal queues;
    API-authored schedules may only target safe queues.
- The dispatcher rebuilds tenant/organization authority context server-side. Keys named
  `scope`, `tenantId`, or `organizationId` — plus every `_`-prefixed envelope key — are
  stripped from author-supplied payloads at the root and inside the local-strategy
  `payload` wrapper, then replaced with trusted values derived from the schedule row.
  Module-authored payloads that already stored their own scope equal to the schedule's
  scope (communication channels, integrations, data-sync) behave identically.
- Provenance is now server-owned. `sourceType`/`sourceModule` are no longer accepted
  from API request bodies (unknown keys are dropped silently): schedules created
  through `/api/scheduler/jobs` are always user-authored and stamped with the acting
  user. Module-authored schedules keep targeting internal queues **only while their
  recorded `sourceModule` still owns the queue in the live module registry AND the row
  carries no acting-user stamp** (`created_by_user_id IS NULL`) — `schedulerService.register()`
  never sets one, while every session-authenticated API write does. **Known residual:**
  a row created before the upgrade by a **non-user-bound API key** also lacks that
  stamp and is indistinguishable from a genuine registration at rest; such rows still
  pass the dispatch guard. Audit them after upgrading with
  `yarn mercato scheduler audit-queue-targets`, which lists every module-authored
  queue-target row with its current dispatch verdict so unrecognized ALLOWED entries
  can be disabled. Module-authored schedules also reject API changes to their
  target/payload; unchanged targets are treated as no-ops so operational edits (name,
  schedule, enabled) keep working from the backend UI, and legacy user rows pointing at
  now-unapproved queues can still be disabled from the UI (retargeting or leaving such
  a row active requires an approved queue).
- Error-status changes on `PUT /api/scheduler/jobs`: retargeting onto an unapproved
  queue now returns `422` from the update command instead of a zod `400`, rewriting a
  module-authored schedule's target returns `403`, and saving a user-authored row in a
  way that leaves it active on an unapproved queue returns `422`. Clients asserting on
  `400` for these cases should match the new codes.
- Opted-in targets can declare per-target creator features via
  `schedulerRequiredFeatures` in worker metadata and a payload schema through
  `registerSchedulerQueuePayloadSchema(queue, schema)`; both are enforced when
  creating/updating schedules and re-checked immediately before dispatch. The shipped
  `scheduler-test` QA queue demonstrates the full descriptor (`{ message?: string }`
  plus arbitrary keys).
- Payment webhook processors now fail closed on untrusted dispatch origins: only jobs
  enqueued by the inbound webhook route (signature verified) carry the trusted origin
  marker; scheduler-originated or unmarked jobs are dropped with an error log. Jobs that
  were already sitting in Redis during an upgrade window will be dropped once. The
  route now enqueues the marked payload flat (`queue.enqueue(jobPayload)`), matching
  `Queue.enqueue(data)` semantics across strategies.

**Action required:** if your module relied on users scheduling work onto one of your
queues, add `schedulerSafe: true` to that worker's metadata and validate the schedule
payload shape in the worker; if you enqueued payment webhook jobs from custom code,
migrate that code to the standard webhook route or mark the payload with
`markQueueJobOrigin(payload, 'inbound-webhook')` from
`@open-mercato/shared/lib/queue/dispatchOrigin`.

No database, ACL-feature, API-route-URL, or response-shape changes ship with this fix.

### New `om-prepare-issue` skill (deferred-work capture)

A new bundled skill, [`om-prepare-issue`](.ai/skills/om-prepare-issue/SKILL.md), codifies the "park this idea for later" workflow. Given a free-form feature brief it (1) researches and writes a spec under `.ai/specs/` to `om-spec-writing` standards, (2) opens a **docs-only spec PR** against `develop` (labels `documentation` + `skip-qa`, reusing `om-auto-create-pr` worktree/branch/label mechanics), and (3) opens a **tracking GitHub issue** that links the spec path and the spec PR and names the implementer skill (`om-implement-spec` / `om-auto-fix-issue`) for later pickup. It never implements the feature — the only file it adds is the spec.

The skill is registered in the `automation` tier of [`.ai/skills/tiers.json`](.ai/skills/tiers.json) (alongside `om-auto-create-pr` and `om-auto-fix-issue`) and is also shipped into standalone apps scaffolded by `create-mercato-app` (`packages/create-app/agentic/shared/ai/skills/om-prepare-issue/`).

This is purely additive — no existing skill, slash command, API, DB, or module-contract surface changed.

### `om-auto-review-pr` now posts manual-QA instructions on the `needs-qa → qa` transition

[`om-auto-review-pr`](.ai/skills/om-auto-review-pr/SKILL.md) (and `om-review-prs`, which delegates to it) now posts an **additional PR comment with concrete step-by-step manual QA instructions** whenever it routes an approved PR to the `qa` pipeline state (i.e. `needs-qa` present, `skip-qa` absent). The comment uses the house QA route format from `om-auto-qa-scenarios` — P0/P1/P2 priority tags with **Where to click** / **What to verify** / **What can go wrong** blocks derived from the actual diff.

This is additive: the existing claim, pipeline-label, author-handoff, and completion comments are unchanged; the QA-instructions comment is posted only on the `needs-qa → qa` transition (never on `merge-queue`, `changes-requested`, or other states). No action is required from downstream users beyond re-installing skills (below) to pick up the updated `SKILL.md`.

### How to apply these skill changes downstream

Skill content lives in `.ai/skills/<name>/SKILL.md` and is consumed via per-skill symlinks under `.claude/skills/` and `.codex/skills/`. To pick up the new skill and the updated review behavior:

```bash
# List the tier catalog and what is currently installed
yarn install-skills --list

# Re-run the installer to refresh symlinks for your selected tiers.
# om-prepare-issue and om-auto-review-pr both live in the opt-in `automation` tier:
yarn install-skills --with automation      # default tiers + automation
# or install every tier:
yarn install-skills --all
```

The installer is idempotent and tier-driven (`.ai/skills/tiers.json`) — it adds the new symlink and sweeps stale ones; it never edits skill content. Standalone apps generated by `create-mercato-app` receive `om-prepare-issue` automatically the next time agentic setup runs (`yarn mercato agentic:init`).

This is tooling/docs only; no application runtime, API, DB, or module-contract surface changes.

### OSS optimistic locking default-ON (2026-05-27)

The `updated_at`-based optimistic-locking guard introduced in
[`#1981`](https://github.com/open-mercato/open-mercato/pull/2055) is now
**default ON** for every CRUD entity exposed via `makeCrudRoute`. The
runtime behavior is strictly additive — clients that do not send the
`x-om-ext-optimistic-lock-expected-updated-at` header continue to pass
through unchanged — but downstream operators and module authors should
review the following before deploying:

#### What changed

- `parseOptimisticLockEnv(undefined | '' | '   ')` now returns
  `{ mode: 'all' }` (previously `{ mode: 'off' }`). The platform DI
  bootstrap registers a default `crudMutationGuardService` that consults
  the global reader store, which the CRUD factory's
  `registerOptimisticLockReaderIfAbsent` populates at module-load time.
- `OM_OPTIMISTIC_LOCK=off` (case-insensitive; also `false` / `0` /
  `no` / `disabled` / `none`) now disables the guard explicitly.
  Allow-list values (`OM_OPTIMISTIC_LOCK=customers.company,sales.order`)
  continue to work; they narrow coverage to the listed `resourceKind`s.
- `packages/core/src/modules/customers/di.ts` and
  `packages/core/src/modules/sales/di.ts` no longer register their own
  `crudMutationGuardService` — the platform default suffices. They keep
  the hand-wired `registerOptimisticLockReaders(...)` call (companies/
  people use a `kind` discriminator on the polymorphic
  `customer_entities` table, so the generic reader cannot match).

#### When you might see a change in behavior

Only when *all four* of these are true:

1. Your deployment has not set `OM_OPTIMISTIC_LOCK` explicitly.
2. A page issues `PUT` / `PATCH` / `DELETE` with the optimistic-lock
   header set (via `CrudForm` with `optimisticLockUpdatedAt`, or by
   calling `buildOptimisticLockHeader(...)` directly).
3. The header's timestamp does not match the row's current `updated_at`.
4. The route is registered through `makeCrudRoute` (i.e. it picks up
   the auto-registered generic reader).

In that case the mutation now responds with `409` and the structured
body `{ error: 'record_modified', code: 'optimistic_lock_conflict',
currentUpdatedAt, expectedUpdatedAt }` instead of silently winning the
race. Pages built on `CrudForm` already render the localized
`ui.forms.flash.recordModified` flash; custom callers should pin against
`code: 'optimistic_lock_conflict'` (via `extractOptimisticLockConflict`).

#### How to opt out

Set the env var explicitly:

```bash
OM_OPTIMISTIC_LOCK=off
```

Restart the app/dev server — the env is read once at module-load time.

#### Custom modules that registered their own `crudMutationGuardService`

If you wrote a custom module that registers `crudMutationGuardService`
in its `di.ts`, your registration still wins (Awilix replaces same-key
registrations, and module DI runs after the platform default in
`createRequestContainer`). No changes required.

#### Custom modules that built on the old `parseOptimisticLockEnv` default

If your code branches on `parseOptimisticLockEnv(undefined).mode === 'off'`
to short-circuit, that branch now returns `'all'`. Audit any
`if (config.mode === 'off')` paths that fed off the parser default; the
guard's own runtime check (`config.mode === 'off' → PASS`) is unchanged
and still does the right thing.

### Deprecations

#### `GET /api/customers/assignable-staff` → `GET /api/staff/team-members/assignable`

The customer-flow assignable-staff endpoint now lives in the staff module under its canonical URL `/api/staff/team-members/assignable`. The legacy URL `/api/customers/assignable-staff` still works but returns `308 Permanent Redirect` to the new URL with the original query string preserved. RBAC is unchanged (`customers.roles.view` page guard + `customers.roles.manage`/`customers.activities.manage` handler check) so existing role assignments keep working.

```ts
// before
const data = await readApiResultOrThrow('/api/customers/assignable-staff?pageSize=20')

// after
const data = await readApiResultOrThrow('/api/staff/team-members/assignable?pageSize=20')
```

The legacy URL will stay around for at least one minor version and be removed no earlier than the next major release. Update in-tree consumers now; external HTTP clients that follow `308` redirects do not need changes.

See [`.ai/specs/implemented/2026-05-08-staff-decouple-from-core.md`](.ai/specs/implemented/2026-05-08-staff-decouple-from-core.md) for the full migration plan.

### AI coding skills renamed with the `om-` prefix

Every bundled AI coding skill is now namespaced with an `om-` prefix, both under the repo's `.ai/skills/` directory and in the standalone-app scaffolding generated by `create-mercato-app` (`packages/create-app/agentic/shared/ai/skills/`). This avoids collisions with skills a downstream team adds to their own project and matches the `@open-mercato/*` package naming convention.

The rename is purely mechanical — **prepend `om-` to the skill folder name and its `name:` frontmatter**. Skill content and triggers are unchanged. Affected skills:

```
auto-continue-pr            → om-auto-continue-pr
auto-continue-pr-loop       → om-auto-continue-pr-loop
auto-create-pr              → om-auto-create-pr
auto-create-pr-loop         → om-auto-create-pr-loop
auto-fix-github             → om-auto-fix-github
auto-qa-scenarios           → om-auto-qa-scenarios
auto-review-pr              → om-auto-review-pr
auto-sec-report             → om-auto-sec-report
auto-sec-report-pr          → om-auto-sec-report-pr
auto-update-changelog       → om-auto-update-changelog
auto-upgrade-0.4.10-to-0.5.0 → om-auto-upgrade-0.4.10-to-0.5.0
backend-ui-design           → om-backend-ui-design
check-and-commit            → om-check-and-commit
code-review                 → om-code-review
create-agents-md            → om-create-agents-md
create-ai-agent             → om-create-ai-agent
dev-container-maintenance   → om-dev-container-maintenance
ds-guardian                 → om-ds-guardian
fix                         → om-fix
fix-specs                   → om-fix-specs
implement-spec              → om-implement-spec
integration-builder         → om-integration-builder
integration-tests           → om-integration-tests
merge-buddy                 → om-merge-buddy
migrate-mikro-orm           → om-migrate-mikro-orm
open-pr                     → om-open-pr
pre-implement-spec          → om-pre-implement-spec
review-prs                  → om-review-prs
root-cause                  → om-root-cause
skill-creator               → om-skill-creator
smart-test                  → om-smart-test
spec-writing                → om-spec-writing
sync-merged-pr-issues       → om-sync-merged-pr-issues
verify-in-repo              → om-verify-in-repo
```

The create-app scaffolding also ships these standalone-only skills under the same prefix: `om-data-model-design`, `om-eject-and-customize`, `om-module-scaffold`, `om-system-extension`, `om-trim-unused-modules`, `om-troubleshooter`.

What you need to do:

- **Slash-command invocations** change accordingly, e.g. `/auto-create-pr` → `/om-auto-create-pr`, `claude "/module-scaffold"` → `claude "/om-module-scaffold"`.
- **Scripts, docs, or AGENTS.md files** that reference a skill by name or by `.ai/skills/<name>/SKILL.md` path must adopt the `om-` prefix. A one-shot rewrite over your own tree:

  ```bash
  # Update .ai/skills/<name> path references to the om- prefix (review the diff before committing)
  grep -rlE '\.ai/skills/(auto-|backend-ui-design|check-and-commit|code-review|create-|dev-container|ds-guardian|fix|implement-spec|integration-|merge-buddy|migrate-mikro-orm|open-pr|pre-implement-spec|review-prs|root-cause|skill-creator|smart-test|spec-writing|sync-merged-pr-issues|verify-in-repo)' . \
    | xargs sed -i -E 's#(\.ai/skills/)(auto-|backend-ui-design|check-and-commit|code-review|create-|dev-container|ds-guardian|fix|implement-spec|integration-|merge-buddy|migrate-mikro-orm|open-pr|pre-implement-spec|review-prs|root-cause|skill-creator|smart-test|spec-writing|sync-merged-pr-issues|verify-in-repo)#\1om-\2#g'
  ```

- **Custom skills you authored** are unaffected — only the bundled Open Mercato skills moved.

This is tooling/docs only; no application runtime, API, DB, or module-contract surface changes.

---

## 0.6.1 → 0.6.2 (2026-05-19)

No actionable dependency upgrades for downstream user code. See
[`CHANGELOG.md`](CHANGELOG.md) for release highlights.

---

## 0.6.0 → 0.6.1 (2026-05-13)

No actionable dependency upgrades for downstream user code. See
[`CHANGELOG.md`](CHANGELOG.md) for release highlights.

---

## 0.5.0 → 0.6.0 (2026-05-06)

This window carries the MikroORM v6 → v7 migration
([#1513](https://github.com/open-mercato/open-mercato/pull/1513)), the last of the three
majors that were deferred out of the 0.5.0 consolidation. No other dependency majors
shipped in this window.

### Breaking dependency changes that may affect user code

#### `@mikro-orm/*` `^6.6.10` → `^7.0.10`

v7 is ESM-only, dropped Knex for [Kysely](https://github.com/kysely-org/kysely), moved
decorators out of `@mikro-orm/core`, and removed the default `ReflectMetadataProvider`.
Every downstream module with entities, raw SQL, or a standalone ORM bootstrap needs
changes. The full mechanical recipe (incl. tests/Jest setup) lives in the companion skill
[`.ai/skills/om-migrate-mikro-orm/SKILL.md`](.ai/skills/om-migrate-mikro-orm/SKILL.md); the
highlights are:

Decorators moved — import decorators from `@mikro-orm/decorators/legacy`; keep
`OptionalProps`, `Collection`, `EntityManager`, `FilterQuery`, `RequiredEntityData`, etc.
on `@mikro-orm/core`:

```ts
// before
import { Entity, PrimaryKey, Property, ManyToOne, OptionalProps } from '@mikro-orm/core'

// after
import { OptionalProps } from '@mikro-orm/core'
import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
```

`persistAndFlush` / `removeAndFlush` removed — chain instead:

```ts
// before
await em.persistAndFlush(entity)
await em.removeAndFlush(entity)

// after
await em.persist(entity).flush()
await em.remove(entity).flush()
```

Jest mocks must be updated accordingly (`persist: jest.fn().mockReturnThis(), flush: jest.fn()`).

Knex → Kysely — `em.getConnection().getKnex()` is gone; use `em.getKysely<any>()` and the
Kysely query builder. Operators are mandatory (`.where('col', '=', val)`), JSONB needs
`` sql`${JSON.stringify(doc)}::jsonb` ``, `knex.fn.now()` becomes `` sql`now()` ``, and
aggregate results come back as strings (wrap `count()` rows in `Number(...)`). Upserts use
`.onConflict(oc => oc.columns([...]).doUpdateSet({...}))`.

Migrator API renamed — `orm.getMigrator()` → `orm.migrator`,
`migrator.createMigration()` → `migrator.create()`,
`migrator.getPendingMigrations()` → `migrator.getPending()`.

ORM bootstrap (if you call `MikroORM.init` yourself) — register the metadata provider
explicitly, pass `EntityManager` as a generic, and reshape the pool config:

```ts
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { PostgreSqlDriver, EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'

await MikroORM.init<PostgreSqlDriver, PostgreSqlEntityManager<PostgreSqlDriver>>({
  driver: PostgreSqlDriver,
  metadataProvider: ReflectMetadataProvider, // v7 no longer installs this by default
  pool: { min, max, idleTimeoutMillis },     // acquireTimeoutMillis / destroyTimeoutMillis removed
  driverOptions: { connectionTimeoutMillis, ssl },
  entities,
})
```

Without `ReflectMetadataProvider` the legacy decorators silently emit wrong column
metadata at runtime.

Stricter typing — v7 tightens `FilterQuery<T>` / `RequiredEntityData<T>`. Expect to add
occasional casts, wrap ambiguous generic filters with `NoInfer<T>`, and watch out for
`em.create(Entity, { ...spread, override })`: v7's inference exposes cases where a
trailing spread silently overwrites computed fields — put the spread first.

Jest / ESM — v7 uses `import.meta.resolve`, which `ts-jest` on CJS can't run. The repo
ships [`scripts/jest-mikroorm-transformer.cjs`](scripts/jest-mikroorm-transformer.cjs);
wire it in every standalone `jest.config.cjs` and bump `tsconfig` `target` to `ES2022`:

```js
transform: { '^.+\\.(t|j)sx?$': '<rootDir>/../../scripts/jest-mikroorm-transformer.cjs' },
transformIgnorePatterns: ['node_modules/(?!(@mikro-orm)/)'],
```

---

## 0.4.10 → 0.5.0 (2026-04-21)

Release context:
- Biggest Open Mercato release so far
- More than 250 fixes and improvements delivered after the Hackathon in Sopot
- Includes several major dependency upgrades, which is why `UPGRADE_NOTES.md` was added
  for this release window

This window bundles the consolidated Dependabot dependency bumps from
[#1620](https://github.com/open-mercato/open-mercato/pull/1620) (minor/patch) and
[#1621](https://github.com/open-mercato/open-mercato/pull/1621) (major), migrated to
`develop` in [#1625](https://github.com/open-mercato/open-mercato/pull/1625).

Three major bumps with deep platform surface impact were **deliberately reverted** and are
**NOT** part of 0.5.0 — they remain on their 0.4.10 versions and are tracked as separate
dedicated upgrades. See [Deferred majors](#deferred-majors) below.

Companion skill: [`om-auto-upgrade-0.4.10-to-0.5.0`](.ai/skills/om-auto-upgrade-0.4.10-to-0.5.0/SKILL.md).

### Breaking dependency changes that may affect user code

#### `meilisearch` `^0.55` → `^1.0`

The exported client class was renamed from `MeiliSearch` to `Meilisearch` (lowercase `s`),
and the package switched to pure ESM (`"type": "module"`).

Code changes:

```ts
// before
import { MeiliSearch } from 'meilisearch'
const client = new MeiliSearch({ host, apiKey })

// after
import { Meilisearch } from 'meilisearch'
const client = new Meilisearch({ host, apiKey })
```

Jest configuration (ESM): Jest's default `transformIgnorePatterns` skips `node_modules`.
Since `meilisearch@1` ships pure ESM, add an allow-list so `ts-jest`/`babel-jest` can
transform it:

```js
// apps/<your-app>/jest.config.cjs
module.exports = {
  // ...
  transformIgnorePatterns: [
    '/node_modules/(?!meilisearch)/',
    '\\.pnp\\.[^\\/]+$',
  ],
}
```

#### `stripe` `^17` → `^22`

The `Stripe.LatestApiVersion` namespace constant was removed and the zero-argument
`stripe.accounts.retrieve()` was replaced by `stripe.accounts.retrieveCurrent()`.

Code changes:

```ts
// before
import Stripe from 'stripe'
const stripe = new Stripe(apiKey, {
  apiVersion: apiVersion as Stripe.LatestApiVersion,
})
const account = await stripe.accounts.retrieve()

// after
import Stripe from 'stripe'
type StripeConfig = NonNullable<ConstructorParameters<typeof Stripe>[1]>
const stripe = new Stripe(apiKey, {
  apiVersion: apiVersion as StripeConfig['apiVersion'],
})
const account = await stripe.accounts.retrieveCurrent()
```

Also bumped in lock-step: `@stripe/react-stripe-js` `^3` → `^6`, `@stripe/stripe-js`
`^7` → `^9`. Consult Stripe's own migration guides for component-level API changes.

#### `lucide-react` `^0.556` → `^1.8`

Brand icons `Linkedin` and `Twitter` were removed for trademark reasons. Replace with
a semantic substitute (the platform uses `Briefcase` for LinkedIn-style links and
`AtSign` for Twitter-style handles):

```tsx
// before
import { Linkedin, Twitter } from 'lucide-react'

// after
import { Briefcase, AtSign } from 'lucide-react'
```

Other lucide icon name stabilizations landed in the v1 cut — check your imports
against https://lucide.dev/icons if you see "module has no exported member" errors.

Server-side navigation metadata:

If you store page, sidebar, or settings-navigation icons in backend metadata that is
serialized on the server, do **not** pass Lucide component references or JSX elements such
as `icon: Users` or `icon: <Users />`. After the v1 upgrade these can cross the
server/client boundary and break routes such as `/api/auth/admin/nav`.

Use one of these patterns instead:

```ts
// preferred for backend/page metadata
icon: 'users'
```

```ts
// also safe when you need a custom shape
const usersIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }),
  React.createElement('circle', { cx: 9, cy: 7, r: 4 }),
)

icon: usersIcon
```

If your admin navigation starts failing with an error about calling
`node_modules/lucide-react/dist/esm/Icon.js` from the server, audit every metadata-driven
icon in that nav path and replace component references with icon names or inline SVG.

#### `react-markdown` `^9` → `^10`

The `className` prop was removed from `<ReactMarkdown>`. Wrap the invocation in a
`<div>` that carries the class instead:

```tsx
// before
<ReactMarkdown className="prose" remarkPlugins={plugins}>{body}</ReactMarkdown>

// after
<div className="prose">
  <ReactMarkdown remarkPlugins={plugins}>{body}</ReactMarkdown>
</div>
```

#### `cron-parser` `^4` → `^5`

The default-export factory was removed. `parseExpression` is no longer a function exposed
on the default import — use the named `CronExpressionParser.parse` static method:

```ts
// before
import parser from 'cron-parser'
const expr = parser.parseExpression('*/5 * * * *')

// after
import { CronExpressionParser } from 'cron-parser'
const expr = CronExpressionParser.parse('*/5 * * * *')
```

The returned iterator shape (`next()`, `prev()`, `hasNext()`, `hasPrev()`) is unchanged.

#### `@simplewebauthn/server` `^11` → `^13` (and `@simplewebauthn/types` `^11` → `^12`)

Function signatures were narrowed from `Uint8Array` to `Uint8Array<ArrayBuffer>`. A
`TextEncoder().encode(...)` result or a `new Uint8Array(Buffer.from(...))` result is
typed `Uint8Array<ArrayBufferLike>` and is no longer assignable. Coerce with `.slice()`:

```ts
// before
function toWebAuthnUserId(userId: string): Uint8Array {
  return new TextEncoder().encode(userId)
}
function base64UrlToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'))
}

// after
function toWebAuthnUserId(userId: string) {
  return new TextEncoder().encode(userId).slice()
}
function base64UrlToBytes(value: string) {
  return new Uint8Array(Buffer.from(value, 'base64url')).slice()
}
```

Several exported types also moved from `@simplewebauthn/types@11` to `@simplewebauthn/types@12`.
If you imported passkey types directly, re-run `tsc` — the message is usually the rename is
transparent once the new version is installed.

#### `recharts` `^2` → `^3`

recharts 3 dropped several default props (e.g. `isAnimationActive`) and tightened the
`ResponsiveContainer` width/height typing. If you render charts in a custom module, expect
to audit any non-default props, particularly custom `Tooltip`/`Legend` content renderers,
which now receive slightly different payload shapes. No helper is provided here — review
https://recharts.org upgrade notes.

#### `rate-limiter-flexible` `^9` → `^11`

Two back-to-back major releases. The constructor options object is mostly compatible; the
main breakage is around the deprecated `pointsConsumed` return field and the strictened
Redis client option type (`useRedisPackage`/`storeClient` unioning). Audit any direct
consumers — the platform itself uses this transitively; user modules that wire their own
`RateLimiterRedis` instance are the ones to watch.

#### `framer-motion` `^11` → `^12`

Most `motion.<el>` call sites continue to work. The layout animation engine was rewritten
and some auto-animated layout transitions now behave slightly differently at the pixel
level. Bug-for-bug parity is not guaranteed; verify any long-running, scroll-triggered, or
gesture-driven animations after upgrading.

#### `glob` `^11` → `^13`

Node 20+ now required. The `Glob` class `matchBase` option was renamed to `matchBases`; the
function signature already accepted `signal` and `withFileTypes`. If you used the
`globSync()` one-shot helper, no code change is needed.

#### `esbuild` `^0.25` → `^0.28`

Only affects build tooling in workspace packages that ship a standalone bundle
(`packages/create-app`, `packages/cli`, `packages/checkout`, `packages/scheduler`,
`packages/webhooks`, `packages/sync-akeneo`). The 0.25→0.28 window made `--outdir` with a
non-existent directory error (previously it silently created it); ensure your build scripts
`mkdir -p` explicitly. No runtime behavior change.

#### `eslint` `^9` → `^10`

Flat config is now the only config format (`.eslintrc.*` is removed). If you still ship a
legacy `.eslintrc.js` in a user module, migrate it to `eslint.config.mjs`. ESLint 10 also
drops Node 18 support — make sure your CI runs Node 20+ at minimum.

#### `rimraf` `^5` → `^6`

Pure tooling change. The default-exported function is now async-only and no longer accepts
the legacy callback signature. If you invoke `rimraf` from a build script, `await` it.

#### `@docusaurus/*` `^3.9` → `^3.10`

Minor bump. No user code changes. The consolidation pins `webpack` to `5.104.1` via
root-level `resolutions` because `webpackbar@6.0.1` (a transitive of `@docusaurus/core@3.10`)
is incompatible with webpack `5.106.x`'s stricter `ProgressPlugin` schema. The pin can be
dropped once `webpackbar` ships a fix or Docusaurus bumps it.

#### AI SDK family

`@ai-sdk/amazon-bedrock` `^4.0.8` → `^4.0.96`, `@ai-sdk/anthropic` `^3.0.12` → `^3.0.71`,
`@ai-sdk/cohere` `^3.0.4` → `^3.0.30`, `@ai-sdk/google` `^2` → `^3`, `@ai-sdk/mistral`
`^3.0.5` → `^3.0.30`, `@ai-sdk/openai` `^3.0.5` → `^3.0.53`, `ai` `^6.0.0` → `^6.0.168`,
`ai-sdk-ollama` `3.0.0` → `3.8.3`.

`@ai-sdk/google` is the only major bump here. v3 renamed the default model factory export
and tightened the tool-call result shape; if you import `google` directly and call `.tool()`
or pass a custom fetch, verify against v3 release notes.

#### Miscellaneous smaller bumps (no known user-code impact)

- `next` `16.2.3` → `16.2.4`, `react`/`react-dom` `19.2.1` → `19.2.5`.
- `@tanstack/react-query` `^5.90.12` → `^5.99.2`.
- `@types/node` `^20`/`^24` → `^25`, `@types/react` `^19.2.7` → `^19.2.14`.
- `newrelic` `^13.16` → `^13.19`, `dotenv` `^17.2.3` → `^17.4.2`, `resend` `^6.5.2` → `^6.12.0`.
- `@tailwindcss/postcss` and `tailwindcss` `^4.1.17` → `^4.2.2`, `tailwind-merge` `^3.4.0` → `^3.5.0`.
- `better-sqlite3` `^12.5` → `^12.9`, `bullmq` `^5.34` → `^5.75`, `ioredis` `^5.8` → `^5.10`.
- `zod` `^4.1.13` → `^4.3.6`, `semver` `^7.7.3` → `^7.7.4`, `testcontainers` `^11.12` → `^11.14`.
- `jest` `^30.2` → `^30.3`, `jest-environment-jsdom` `^30.2` → `^30.3`, `ts-jest` `^29.4.6` → `^29.4.9`.
- `eslint-config-next` `16.1.7` → `16.2.4`.
- `@react-email/components` `^1.0.1` → `^1.0.12`, `react-email` `^5.2.10` → `^6.0.0`.
  react-email v6 changed the CLI entry from `email` to `react-email`; if you scripted the
  CLI, update the command name.
- `@uiw/react-markdown-preview` `^5.1.5` → `^5.2.0`, `@uiw/react-md-editor` `^4.0.11` → `^4.1.0`.
- `openid-client` `^6.3.3` → `^6.8.3`, `otpauth` `9.4.1` → `9.5.0`.
- `@modelcontextprotocol/sdk` `^1.26` → `^1.29`.

### Deferred majors

These majors were bumped by Dependabot but **reverted** before merging because their
migration cost crosses the platform's contract surface. They are not part of 0.5.0 and
are tracked as follow-up work:

| Package | Current pin | Dependabot proposed | Why deferred |
|---------|-------------|---------------------|--------------|
| `@mikro-orm/*` | `^6.6.10` | `^7.0.11` | v7 drops decorator re-exports and `persistAndFlush`/`removeAndFlush`, requires invasive migration across every `data/entities.ts` and all write paths — **addressed in the [0.5.0 → 0.5.1](#050--051-unreleased) window** |
| `typescript` | `^5.9.3` | `^6.0.3` | v6 deprecates `moduleResolution=node10` (`error TS5107`) across every package `tsconfig.json`; fix requires either `"ignoreDeprecations": "6.0"` everywhere or a real migration to `bundler`/`node16` |
| `awilix` | `^12.0.5` | `^13.0.3` | v13 changed the `Cradle` generic default from `any` to `{}`, which makes every `container.resolve('em')` return `unknown` at 100+ DI call sites with no code change |

When a dedicated spec and migration PR land for one of these, it will be listed in its own
`0.x.y → 0.x.(y+1)` window in this document and the corresponding `auto-upgrade-...` skill
will cover it.

---

## Template for future entries

```md
## X.Y.Z → X.Y.(Z+1) (unreleased)

Companion skill: [`om-auto-upgrade-X.Y.Z-to-X.Y.(Z+1)`](.ai/skills/om-auto-upgrade-X.Y.Z-to-X.Y.(Z+1)/SKILL.md).

### Breaking dependency changes that may affect user code

#### `<package>` `^<from>` → `^<to>`

<one paragraph describing the breakage>

```ts
// before
<...>

// after
<...>
```
```

When opening a PR that bumps a dependency across a major boundary, add an entry here in
the same PR. The `auto-upgrade-...` skill for the window picks up entries from this file;
keep the headings stable (exactly `#### \`<package>\` \`^<from>\` → \`^<to>\``) so the
skill can parse them.
