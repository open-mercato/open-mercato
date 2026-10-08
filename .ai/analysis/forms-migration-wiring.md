# forms → core — host wiring audit

**Scope.** What repo-level wiring the vendored `packages/core/src/modules/forms/` tree (301 files)
still needs to behave like a first-class core module. Read
[`.ai/analysis/forms-migration-brief.md`](./forms-migration-brief.md) first.

**Method.** Every claim below is backed by command output or a file excerpt captured in this
worktree. Where a question could only be answered with `forms` enabled, a **temporary probe** was
used — one line added to `apps/mercato/src/modules.ts`, the gate run, the line reverted.

**Timeline note — items 1–4 were fixed upstream while this audit ran.** The audit started from
`4bccb2299`, where `forms` was not enabled. Two commits then landed on the parent branch
`cez/c82a4a14`:

- `5df50543b feat(forms): enable the forms module in the app registry and fix react-table drift`
- `2b0006431 fix(forms): supply the twelve locale keys the module referenced but never shipped`

This document was **rebased onto `f3bfb9ed0` and every gate re-run** against that tree. Items 1–4
are reported as *verified resolved*, with the evidence that found them and the evidence that they
are now green — they are kept rather than deleted because they are the proof that those four fixes
were the right ones and are now complete. **Items 5 onward are outstanding as of `f3bfb9ed0`**, each
re-confirmed against the rebased tree.

**What this document is not.** It is a *host wiring* audit. Defects inside the module source are
reported only where they break a repo gate or a route contract, with a note that the fix is
source-level and belongs to a sibling task.

---

## Verdict at a glance

Status as of `f3bfb9ed0`.

| # | Item | Class | Status |
|---|------|-------|--------|
| 1 | `forms` entry in `apps/mercato/src/modules.ts` | MUST | ✅ landed `5df50543b` — re-verified |
| 2 | `packages/core/src/modules/forms/i18n/ko.json` | MUST | ✅ landed `2b0006431` — `i18n:check-sync` exits 0 |
| 3 | 11 missing `forms.*` keys in all 5 locales | MUST | ✅ landed `2b0006431` — `i18n:check-usage` exits 0 |
| 4 | 28 TS errors in 4 forms files | MUST | ✅ landed `5df50543b` — `typecheck` exits 0 |
| 5 | Host-side `/embed/:slug` framing (`proxy.ts` + `next.config.ts`) | **MUST** | ❌ outstanding — embed route unusable |
| 6 | `commands/submission.ts` never registered | **MUST** | ❌ outstanding — `yarn generate` still warns |
| 7 | `/api/forms/:id/run/*` unauthenticated **and** unscoped by org/tenant | **MUST** | ❌ outstanding — cross-tenant read |
| 8 | `/forms/[id]/run` has no `page.meta.ts` | SHOULD | ❌ outstanding |
| 9 | `backend.nav.operations` i18n key undefined | SHOULD | ❌ outstanding |
| 10 | No `rateLimit` on 4 unauthenticated write routes | SHOULD | ❌ outstanding |
| 11 | Explicit `./modules/forms` entry in `packages/core/package.json` | SHOULD | ❌ outstanding |
| 12 | 31 DS-lint warnings in forms `.tsx` | SHOULD | ❌ outstanding (advisory) |
| 13 | 14 hardcoded strings | optional | ❌ outstanding (advisory) |
| 14 | `packages/core/src/modules/forms/AGENTS.md` | **do NOT add** | see §7 — it would be 100% truncated |

**Confirmed NOT needed** — each proven below, so nobody re-litigates them: `packages/core/build.mjs`
changes, `tsconfig*.json` changes, `exports` wildcards for i18n or deep paths, any
`jest.config.cjs` change, any migration rename/renumber, any `*.generated.ts` registry edit under
`apps/mercato/src/`, any `official-modules.json` entry.

---

# MUST — resolved upstream (kept as the proof they are complete)

## 1. `apps/mercato/src/modules.ts` — the `forms` entry ✅

**Confidence: certain.**

`yarn generate` is *not* purely directory-convention driven. Module discovery starts from an
explicit allowlist — `packages/cli/src/lib/generators/module-registry.ts:2050`:

```ts
const enabled = resolver.loadEnabledModules()
for (const entry of enabled) { ... }
```

`loadEnabledModules()` reads `enabledModules` from `apps/mercato/src/modules.ts`. With `forms`
absent, the entire module is invisible to every generator.

Evidence at `4bccb2299` (`yarn generate`, exit 0):

```
[OpenAPI] Found 584 API route files
[OpenAPI] Generated 584 API paths

$ grep -rn "modules/forms" apps/mercato/.mercato/generated/
(no matches)
$ grep -o "'forms'" apps/mercato/.mercato/generated/enabled-module-ids.generated.ts
(no matches)
```

**Landed in `5df50543b`**, placed after `customer_accounts`/`portal` — correct, since the portal
pages and public runner resolve customer auth through them:

```ts
  { id: 'portal', from: '@open-mercato/core' },
+ { id: 'forms', from: '@open-mercato/core' },
```

Re-verified on the rebased tree:

```
[OpenAPI] Found 629 API route files        # 584 → 629, i.e. +45 forms routes
apps/mercato/.mercato/generated/api-route-shard.026.forms.generated.ts
$ grep -c "modules/forms/api" apps/mercato/.mercato/generated/api-routes.generated.ts
45
$ grep -n "forms" apps/mercato/.mercato/generated/entities.ids.generated.ts
28:  "forms": "forms",
254:  "forms": { "form": "forms:form", "form_version": "forms:form_version", ... }   # all 11
```

**Nothing else needs to name `forms`.** Checked and ruled out:

- `apps/mercato/src/official-modules.generated.ts` — an empty versioned registry driven by
  `official-modules.json` (`activated: []`). That is the activation path for the
  `external/official-modules` **submodule**; a module vendored into `packages/core` must not appear
  there. Leave both untouched.
- No other `*.generated.ts` exists under `apps/mercato/src/` — `find apps/mercato/src -name
  '*.generated.ts'` returns exactly that one file.
- `packages/core/generated/` (entity ids, per-entity dirs) is gitignored — `.gitignore:75`
  `packages/*/generated/`. It regenerates and must not be committed.
- No ordering/allowlist file exists beyond `modules.ts`. `sortModules()` in
  `packages/cli/src/lib/db/commands.ts` orders by declared dependencies, not a static list.

## 2. `i18n/ko.json` ✅

**Confidence: certain.**

Module `i18n/<locale>.json` files are registered **purely by directory convention** — no registry
entry, no `exports` entry. `discoverTranslations()` (`module-registry.ts:2019-2043`) reads
`<moduleRoot>/i18n/*.json` and shards them into `modules.i18n.<locale>.generated.ts`. Critically,
**the i18n check scripts scan the source tree directly and do not consult `modules.ts`** — so this
failed even while `forms` was still disabled.

At `4bccb2299`:

```
$ yarn i18n:check-sync
[check] Checking translation sync across 5 locales (en, pl, es, de, ko)...
Found 62 modules with translations

[forms] MISSING FILES: ko.json

1 issues found across 1 modules
$ echo $?
1
```

Corroborated independently by `yarn i18n:check-values`, where the Korean gap was *exactly* forms'
key count:

```
$ python3 -c "import json; print(len(json.load(open('.../forms/i18n/en.json'))))"
756
$ yarn i18n:check-values | grep '^\[ko\]'
[ko] 32796 keys • 1766 significant identical (5.4%) • 2049 raw (6.2%) • 756 missing
```

(en/pl/es/de all reported `0 missing`; forms ships all four with 756 keys each.)

**Landed in `2b0006431`** (770-line `ko.json`). Re-verified:

```
$ yarn i18n:check-sync
Found 62 modules with translations
All translation files are in sync.
$ echo $?
0
```

`yarn i18n:check-sync` is position 4 in the `.ai/agentic.config.json` gate and is **not**
continue-on-error, so this was a hard block.

## 3. The 11 missing `forms.*` keys ✅

**Confidence: certain.**

At `4bccb2299`:

```
$ yarn i18n:check-usage
Found 32649 translation keys across all en.json files
Found 70932 static references to 24698 unique keys

MISSING KEYS (referenced in code but not in any en.json): 11 keys
  .../forms/ui/public/FormTrigger.tsx:63        → forms.trigger.title
  .../forms/subscribers/invitation-email.ts:123 → forms.invitation.email.subject
  .../forms/subscribers/invitation-email.ts:124 → forms.invitation.email.heading
  .../forms/subscribers/invitation-email.ts:125 → forms.invitation.email.greeting
  .../forms/subscribers/invitation-email.ts:128 → forms.invitation.email.body
  .../forms/subscribers/invitation-email.ts:132 → forms.invitation.email.body_reminder
  .../forms/subscribers/invitation-email.ts:135 → forms.invitation.email.cta
  .../forms/subscribers/invitation-email.ts:137 → forms.invitation.email.footer
  .../forms/runner/FormRunner.tsx:144           → forms.runner.actions.submit
  .../forms/runner/FormRunner.tsx:217           → forms.runner.actions.back
  .../forms/runner/FormRunner.tsx:220           → forms.runner.actions.next

Summary: 11 missing keys, 7962 unused keys (advisory)
$ echo $?
1
```

All 11 in forms; no other module contributed one. Verified against the file rather than trusting
the scanner — forms' `en.json` uses **flat dotted keys**, matching `customers/i18n/en.json`, so a
nested-vs-flat false positive is ruled out:

```
$ python3 -c "import json; d=json.load(open('.../forms/i18n/en.json'));
  print([k for k in ['forms.trigger.title','forms.runner.actions.submit'] if k in d])"
[]
```

**Landed in `2b0006431`** — 12 keys × 5 locales (the 11 plus `forms.runner.actions.submitted`).
Re-verified:

```
$ yarn i18n:check-usage
Summary: 7962 unused keys (advisory)        # no MISSING KEYS section
$ echo $?
0
```

## 4. The 28 typecheck errors ✅

**Confidence: certain.**

This failed at `4bccb2299` with `forms` still disabled — `packages/core/tsconfig.json` has
`"include": ["src/**/*", "generated/**/*"]`, which is not gated on `modules.ts`:

```
$ yarn typecheck
src/modules/forms/ui/admin/forms/[id]/distributions/RecipientsTable.tsx(290,33):
  error TS2707: Generic type 'ColumnDef' requires between 2 and 3 type arguments.
src/modules/forms/ui/admin/forms/[id]/distributions/RecipientsTable.tsx(295,18):
  error TS7031: Binding element 'row' implicitly has an 'any' type.
...
Failed: @open-mercato/core#typecheck
$ echo $?
1
```

| Count | File | | Count | Code |
|---|---|---|---|---|
| 8 | `ui/admin/forms/[id]/distributions/RecipientsTable.tsx` | | 21 | `TS7031` implicit-any binding element |
| 8 | `backend/forms/page.tsx` | | 4 | `TS2707` `ColumnDef` generic arity |
| 7 | `ui/admin/forms/[id]/distributions/DistributionsPanel.tsx` | | 3 | `TS7053` implicit-any index |
| 5 | `backend/forms/[id]/submissions/page.tsx` | | | |

`grep "error TS" | grep -v modules/forms` returned **0** — the rest of the repo typechecked clean,
so all 28 came from the vendored tree. With the `forms` probe enabled the count stayed exactly 28,
proving enabling introduced no *additional* app-level type errors.

Root cause was the predicted API drift: the vendored source targeted `@tanstack/react-table` v8
where `ColumnDef` took 1–2 type arguments; this repo is on v9 where it takes 2–3.

**Landed in `5df50543b`**, which used the better fix than the obvious one — switching the four
tables to `LegacyColumnDef` from `@tanstack/react-table/legacy`, the same import every other core
DataTable page here uses, clearing all 28 without touching a single column definition. Re-verified:

```
$ yarn typecheck
$ echo $?
0
$ grep -c "error TS" /tmp/tc3.txt
0
```

---

# MUST — outstanding

## 5. `/embed/[slug]` needs host-side framing support that does not exist in this repo

**Confidence: certain. This is the one genuinely missing piece of host plumbing.**

The module's own page metadata states the contract —
`packages/core/src/modules/forms/frontend/embed/[slug]/page.meta.ts`:

> SECURITY (R-RS-1): this route is served with a per-distribution
> `Content-Security-Policy: frame-ancestors <allowedDomains>` header and no `X-Frame-Options`. The
> app's global frame protection in `apps/mercato/next.config.ts` **EXCLUDES** `/embed/`; the dynamic
> header is applied by `apps/mercato/src/proxy.ts`, which resolves the allowlist via
> `GET /api/forms/public/distributions/:slug/embed-policy`.

and the API route repeats it (`api/public/distributions/[slug]/embed-policy/route.ts`):

> Consumed server-side by the app `/embed` middleware to set a dynamic, per-distribution framing
> header.

**Neither half exists here.** `apps/mercato/next.config.ts` applies global frame protection to
*every* path with no `/embed/` carve-out:

```ts
const contentSecurityPolicy = [ ... "frame-ancestors 'self'", ... ].join('; ')   // line 14

async headers() {
  return [
    { source: '/:path*', headers: [
      { key: 'Content-Security-Policy', value: contentSecurityPolicy },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },                            // line 82
    ]},
    ...
```

and `apps/mercato/src/proxy.ts` (custom-domain routing only) contains no reference to it:

```
$ grep -in "embed\|frame\|Content-Security" apps/mercato/src/proxy.ts
(no matches)                                      # re-confirmed on f3bfb9ed0
```

**Consequence if shipped as-is:** `/embed/:slug` is served with `frame-ancestors 'self'` plus
`X-Frame-Options: SAMEORIGIN`. Every browser refuses to render it in a third-party iframe. The
embed feature — `GET /api/forms/public/embed-loader`, the `EmbedSettings` bag,
`normalizeEmbedOrigin`, `buildFrameAncestorsCsp` and their unit tests — is dead on arrival. It will
not throw; it will silently never frame.

**Edit — two parts.**

(a) `apps/mercato/next.config.ts` — add an `/embed/:path*` entry to `headers()` that drops
`X-Frame-Options` and omits `frame-ancestors` from the CSP, so the per-request header can win.
**There is a precedent to copy in the same function**: the `'/api/attachments/file/:path*'` block
(line ~86) already overrides the global CSP for one route family for exactly this reason
("Attachment file downloads set their own restrictive CSP (sandbox) in the route handler — override
the global app CSP so it is not replaced at the Next.js config layer").

(b) `apps/mercato/src/proxy.ts` — add an `/embed/` branch before the custom-domain logic that calls
`GET /api/forms/public/distributions/:slug/embed-policy`, reads `frame_ancestors`, and sets
`Content-Security-Policy: frame-ancestors <value>`. The API route already fails closed
(`frame-ancestors 'none'` for unknown/non-embeddable slugs) and sets
`cache-control: public, max-age=60`, so the proxy can be a thin pass-through.

**Design decision to raise before implementing.** Part (b) makes a core-module API call from
`apps/mercato/src/proxy.ts` — host code that knows about a specific module. The root `AGENTS.md`
says "MUST NOT add code directly in `apps/mercato/src/`" outside generated registries. A cleaner
alternative is a **frontend page middleware**: the convention already exists
(`apps/mercato/src/modules/example/frontend/middleware.ts`, driven by `frontendMiddlewareEntries` /
`resolvePageMiddlewareRedirect` in the frontend catch-all), but that executor currently supports
only *redirects*, not response-header mutation, so it needs a small extension to
`packages/shared/src/lib/middleware/page-executor.ts`. **This is an "Ask First" decision** — it
touches the host app and a shared contract. Surface it rather than picking one unilaterally.

## 6. `commands/submission.ts` is never registered — `yarn generate` warns

**Confidence: certain. Fix is source-level, one line.**

The only warning `yarn generate` emits for forms, re-confirmed on `f3bfb9ed0`:

```
[generate] ⚠ registerCommand(...) is never called at import time — these command ids will appear
in the manifest but the handlers will not register at runtime:
  packages/core/src/modules/forms/commands/submission.ts
```

Cause — `commands/submission.ts:205` wraps registration in an exported function nobody calls:

```ts
export function registerSubmissionCommands(): void {
  registerCommand(startHandler); registerCommand(saveHandler); registerCommand(submitHandler)
  registerCommand(reopenHandler); registerCommand(assignActorHandler); registerCommand(revokeActorHandler)
}
```

and `commands/index.ts` — whose own docstring says "Importing this file is enough to register every
command via the side-effect `registerCommand(...)` calls inside each module" — does not import it:

```ts
import './form'
import './form-version'
import './distribution'
import './invitation'
// './submission' is absent
```

**Consequence:** six submission-lifecycle command ids appear in the generated manifest but resolve
to nothing at runtime. Every admin/UI surface routing a submission mutation through the command bus
fails — and it fails at *call* time, not boot time, so nothing catches it until a user clicks.

**Edit.** Add `import './submission'` to `commands/index.ts` and make `submission.ts` call
`registerSubmissionCommands()` at module scope, matching its four siblings. (Calling the exported
function from `setup.ts` also works but diverges from the file's own documented convention.)

## 7. `GET /api/forms/:id/run/context` and `POST /api/forms/:id/run/submissions` are unauthenticated **and** unscoped by organization/tenant

**Confidence: certain on the code. The "public" intent is documented; the missing tenant scope is not.**

Forms declares 19 `requireAuth: false` routes — 10 under `api/public/`, 9 outside it:

```
[public/]         /public/distributions/[slug]
[public/]         /public/distributions/[slug]/embed-policy
[public/]         /public/embed-loader
[public/]         /public/invitations/[token]
[public/]         /public/start
[public/]         /public/submissions/[id]
[public/]         /public/submissions/[id]/attachments
[public/]         /public/submissions/[id]/attachments/[attachmentId]
[public/]         /public/submissions/[id]/pdf
[public/]         /public/submissions/[id]/submit
[OUTSIDE public/] /by-key/[key]/active                                 → getCustomerAuthFromRequest
[OUTSIDE public/] /form-submissions                                    → getCustomerAuthFromRequest
[OUTSIDE public/] /form-submissions/[id]                               → getCustomerAuthFromRequest
[OUTSIDE public/] /form-submissions/[id]/attachments                   → getCustomerAuthFromRequest
[OUTSIDE public/] /form-submissions/[id]/resume-token                  → getCustomerAuthFromRequest
[OUTSIDE public/] /form-submissions/[id]/submit                        → getCustomerAuthFromRequest
[OUTSIDE public/] /form-submissions/by-subject/[subject_type]/[subject_id] → getCustomerAuthFromRequest
[OUTSIDE public/] /[id]/run/context                                    → NO GUARD
[OUTSIDE public/] /[id]/run/submissions                                → NO GUARD
```

**Seven of the nine are fine.** `requireAuth: false` there is the correct in-repo idiom for a
*portal-customer* route: the staff-auth gate in the API catch-all would reject a portal customer, so
the route opts out and enforces customer auth itself. All seven call `getCustomerAuthFromRequest`
and 401 on failure — the same pattern `warranty_claims/api/portal/*` uses.

**Two are genuinely open.** `/[id]/run/context` and `/[id]/run/submissions` call no auth helper at
all, and both look the form up **by primary key only** — re-confirmed on `f3bfb9ed0`:

```ts
// api/[id]/run/context/route.ts
export const metadata = { GET: { requireAuth: false } }
...
const form = await em.findOne(Form, { id: formId, deletedAt: null })   // :37 — no organizationId/tenantId
```

The unauthenticated part is documented and deliberate ("customer-facing forms support
unauthenticated runs"). The **missing tenant scope is not** — anyone holding a form UUID can read
any tenant's published form schema, and `POST .../run/submissions` writes a submission against it.
That violates two hard rules in the root `AGENTS.md`: *"Always filter by `organization_id` for
tenant-scoped entities"* and *"Never expose cross-tenant data from API handlers"*.

The follow-on `FormVersion` lookup **is** scoped (`organizationId: form.organizationId`,
`tenantId: form.tenantId`), which is why this reads as an oversight rather than a design choice —
the scope is derived from the unscoped row instead of from the request.

**Edit (source-level, sibling task).** Resolve tenant/organization from the request (host-based, as
`customer_accounts/lib/resolveTenantContext` does, or via the distribution slug) and add it to the
`findOne(Form, ...)` filter in both handlers. If these two routes are superseded by the `/f/:slug` +
`/api/forms/public/start` surface, deleting them is the better fix. Decide together with item 8 —
they are the same feature.

### How this repo treats each forms route surface — reference

Checked against `apps/mercato/src/app/api/[...slug]/route.ts` and
`apps/mercato/src/app/(frontend)/[...slug]/page.tsx`:

| Surface | Gate | Forms status |
|---|---|---|
| `api/**` | catch-all; `requiresAuthentication = methodMetadata?.requireAuth !== false` — **default deny**, explicit `requireAuth: false` opts out | correct; 45 routes under `/api/forms/...` |
| `frontend/**` public | catch-all; **default allow** — gated only if `requireAuth`/`requireCustomerAuth` is set | `/f/[slug]`, `/i/[token]`, `/embed/[slug]` all declare `requireAuth: false` — explicit and correct. Precedent: `sales` `/quote/[token]` |
| `frontend/[orgSlug]/portal/**` | catch-all; `requireCustomerAuth` → customer cookie + org-slug↔`customerAuth.orgId` match + optional `requireCustomerFeatures` | `/[orgSlug]/portal/forms/[key]` and `/[orgSlug]/portal/submissions/[id]/continue` both declare `requireCustomerAuth: true` — correct. Precedent: `warranty_claims` `/[orgSlug]/portal/claims/[id]` |
| `backend/**` | catch-all; `requireAuth` + `requireFeatures` | all 7 pages declare `requireAuth: true` plus a `forms.*` feature from `acl.ts` — correct |

**Module-id namespacing is automatic and correct.** Module API routes serve at
`/api/<moduleId>/<path>`, so `api/public/distributions/[slug]/embed-policy` becomes
`/api/forms/public/distributions/{slug}/embed-policy` — exactly what the module's docstrings
reference. Verified in the generated OpenAPI: 45 `/api/forms/...` paths, 10 under
`/api/forms/public/...`.

**No route collisions.** New frontend patterns are `/f/[slug]`, `/i/[token]`, `/embed/[slug]`,
`/forms/[id]/run`, `/[orgSlug]/portal/forms/[key]`, `/[orgSlug]/portal/submissions/[id]/continue`.
None duplicates any of the 31 pre-existing frontend routes, and `registerFrontendRouteManifests`
runs `sortRoutesBySpecificity`, so literal-first patterns win over `/[orgSlug]/...` for two-segment
paths. `detectBackendRouteCollisions` errors only on *identical* paths between two package modules;
`/backend/forms*` is unused elsewhere.

**Precedent for a `public/` API subtree**: `packages/core/src/modules/sales/api/quotes/public`.
Forms is the second module to do this and the first with a top-level `api/public/`.

---

# SHOULD — convention parity

## 8. `/forms/[id]/run` registers with `undefined` metadata

**Confidence: certain.**

`frontend/forms/[id]/run/page.tsx` has no sibling `page.meta.ts` — the only forms frontend page
without one (`ls` on that directory returns `page.tsx` alone, re-confirmed on `f3bfb9ed0`). The
generated manifest shows the consequence:

```ts
resolvePageRouteMetadata("/forms/[id]/run", (undefined as any))
```

versus every other forms route, which carries an explicit object. In the frontend catch-all,
`if (match.route.requireAuth)` is then falsy, so the page renders for anyone, with no title and no
`titleKey`.

The *practical* impact is bounded: the page immediately calls `/api/forms/{id}/run/context`, which
is itself public — so this is not a second hole, it is the front end of item 7. But it is an
untitled, unlabelled, undeclared public route.

**Edit.** Add `frontend/forms/[id]/run/page.meta.ts` mirroring `frontend/f/[slug]/page.meta.ts`
(`requireAuth: false`, `title`, `titleKey`) — or delete the page if `/f/[slug]` supersedes it.

## 9. `backend.nav.operations` is defined in no locale file

**Confidence: certain.**

`backend/forms/page.meta.ts` sets `pageGroupKey: 'backend.nav.operations'`. Across the entire repo,
that is the **only** `pageGroupKey` with no definition — checking all 16 distinct values against
every `en.json`:

```
UNDEFINED: backend.nav.operations
```

(the other 15 — `backend.nav.developers`, `backend.nav.security`, `customers.nav.group`, … — all
resolve). `forms` is also the sole referencer:

```
$ grep -rln "backend.nav.operations" packages apps
packages/core/src/modules/forms/backend/forms/page.meta.ts
```

Not a build break — the sidebar falls back to the literal `pageGroup: 'Operations'` — but the group
label is then hardcoded English in all five locales.

**Edit.** Add `"backend.nav.operations": "Operations"` (plus translations) to
`packages/core/src/modules/forms/i18n/*.json`. A module i18n dict overrides the app dict for its own
keys, so defining a `backend.*` key inside a module file does take effect. If the team prefers
host-owned nav group labels, put it in `apps/mercato/src/i18n/*.json` instead — but then it must be
mirrored into the create-app template, and note that `yarn template:sync` does **not** cover
`src/i18n`, so that parity needs a manual check.

## 10. No `rateLimit` on the four unauthenticated write routes

**Confidence: high.**

```
$ grep -rln "rateLimit" packages/core/src/modules/forms/api/ | wc -l
0
```

Forms exposes four unauthenticated write endpoints:

- `POST /api/forms/public/start`
- `PATCH /api/forms/public/submissions/[id]`
- `POST /api/forms/public/submissions/[id]/submit`
- `POST /api/forms/public/submissions/[id]/attachments` ← unauthenticated **file upload**

Every comparable in-repo surface rate-limits. 15 route files use `rateLimit`, including all four
`checkout/api/pay/[slug]/*` routes and `sales/api/quotes/accept`.
`packages/checkout/.../api/pay/[slug]/submit/route.ts` is the closest analogue and is explicit:

```ts
// Fail-closed: this endpoint creates payment sessions that can charge cards.
const rateLimitResponse = await enforceCheckoutRateLimit({
  req, container, config: checkoutSubmitRateLimitConfig,
  namespace: 'checkout-submit', posture: 'fail-closed',
})
if (rateLimitResponse) return rateLimitResponse
```

**Edit.** Add a `rateLimit` config to the four routes' `metadata`, or an `enforceFormsRateLimit`
helper mirroring checkout's. **Know the limitation:** the route-level `rateLimit` metadata in the
API catch-all keys on IP-or-`'global'`, never on user — behind a proxy without a correct
forwarded-IP chain that degenerates to a single bucket for the whole deployment. The checkout-style
in-handler helper with an explicit namespace is the stronger option.

Forms does ship a CAPTCHA seam (`services/captcha-verifier.ts`, `resolveCaptchaVerifier`) which
covers part of this — confirm whether it is wired and on by default before deciding how much rate
limiting to add.

## 11. Add an explicit `./modules/forms` entry to `packages/core/package.json`

**Confidence: high. A documented-but-broken import path, not a build break today.**

The deep-path wildcards already cover everything forms actually imports — up to 10 segments, with
dedicated `.json` arms at each depth:

```json
"./*/*/*/*.json": "./src/*/*/*/*.json",
"./*/*/*/*": { "types": ["./src/*/*/*/*.ts", "./src/*/*/*/*.tsx"], "default": "./dist/*/*/*/*.js" },
```

So `@open-mercato/core/modules/forms/i18n/en.json` and
`@open-mercato/core/modules/forms/services/submission-service` both resolve. **No wildcard change is
needed.**

But the *bare* specifier `@open-mercato/core/modules/forms` falls through to `"./*/*"`, whose types
arm is `./src/modules/forms.ts` — a file that does not exist. `index.ts` is never reached. That
matters because the module advertises the bare path in its own docs (`events-payloads.ts:13`):

```ts
 * import { formsEventPayloadSchemas } from '@open-mercato/core/modules/forms'
```

Today those are the only two occurrences repo-wide and both are inside comments, so nothing breaks
at build time. But the advertised import is wrong twice over: the path does not resolve, *and*
`forms/index.ts` exports only `metadata` and `features` — not `formsEventPayloadSchemas`.

```
$ grep -c "modules/forms" packages/core/package.json
0
```

**Edit.** Alongside the existing `./modules/customers`, `./modules/sales`, `./modules/catalog`:

```json
"./modules/forms": {
  "types": "./src/modules/forms/index.ts",
  "default": "./dist/modules/forms/index.js"
},
"./modules/forms/commands": {
  "types": "./src/modules/forms/commands/index.ts",
  "default": "./dist/modules/forms/commands/index.js"
},
```

and re-export the documented symbols from `forms/index.ts`, or fix the two doc comments. The
`commands` entry matches what `customers`, `sales`, `catalog`, `dictionaries` and `feature_toggles`
all do, and forms has a real `commands/index.ts` barrel.

## 12. 31 DS-lint warnings in forms `.tsx`

**Confidence: certain. Advisory — does not block.**

```
$ node --require ./scripts/typescript-js-require-hook.cjs node_modules/eslint/bin/eslint.js \
    --config eslint.ds.config.mjs --format json packages/core/src/modules/forms
files scanned: 99
15  om-ds/no-legacy-alert-variant   (severity 1)
13  om-ds/no-raw-table              (severity 1)
2   om-ds/require-page-wrapper      (severity 1)
1   om-ds/require-loading-state     (severity 1)
```

All 31 are **severity 1 (warning)**; zero errors. Unchanged by the `LegacyColumnDef` fix in
`5df50543b` (re-run on `f3bfb9ed0`: identical counts). CI's `ds-lint` job is advisory except for
`scripts/ci/ds-lint-report.mjs --check`, which "exits 1 when any error-level finding" exists — so
this passes. It will, however, show up as a **+31 delta vs the base branch** in the automated DS
report comment on the PR. Expect that and pre-empt it in the PR description.

**`yarn lint` will never catch these** — see §7-structural below.

---

# Optional

## 13. 14 hardcoded user-facing strings

```
$ yarn i18n:check-hardcoded
[core/forms] 14 hardcoded strings
Summary: 920 hardcoded • 361 allowlisted • across 64 modules
Phase 1 of the i18n remediation plan is advisory — exit code stays 0.
$ echo $?
0
```

Advisory (Phase 1 of `.ai/specs/2026-05-26-missing-translations-audit-and-remediation.md`). forms
ranks well outside the worst offenders (`packages/cli` 112, `ai_assistant` 78, `packages/ui` 66,
`core/messages` 52, `core/workflows` 37). Route them through `t('forms.errors.<key>')`, prefix
internal-only ones with `[internal]`, or add
`packages/core/src/modules/forms/i18n/.hardcoded-allowlist.json`. Not a landing blocker.

## 14. No `search.ts`, `ce.ts`, `notifications.ts`, `ai-tools.ts`, `cli.ts`

forms ships `acl.ts`, `di.ts`, `encryption.ts`, `events.ts`, `events-payloads.ts`, `index.ts`,
`setup.ts`, `translations.ts` — all discovered by convention, all correctly shaped. `setup.ts`
exports a `ModuleSetupConfig` whose `defaultRoleFeatures.admin` lists all six `acl.ts` feature ids.
The absent files are genuinely optional extension points. Forms has no query-index integration and
declares no `queryIndexReindexEntityTypes` in any migration, which is consistent — it reads its own
tables directly.

---

# Answers to the specific questions, including what needs **no** change

## Q2 — `packages/core` build config: nothing to change

**Confidence: certain.**

- **`build.mjs`** — no edit. It globs `src/**` with no module allowlist. Verified against output:
  `packages/core/dist/modules/forms/` exists with `acl.js`, `api/`, `backend/`, `commands/`,
  `data/`, `di.js`, `frontend/`, `index.js`, `lib/`, `migrations/`, `runner/`, `schema/`,
  `services/`, `setup.js`, `subscribers/`, `ui/`, `widgets/`, `workers/`. Build log:
  `[build:core] found 5265 entry points`, `built successfully`.

- **`i18n/*.json` are *deliberately* not copied to dist** — `build.mjs` passes
  `copyJsonIgnore: ['**/i18n/**']`, and only `modules/design_system/i18n/*.json` is copied back by
  `copyDesignSystemAssets()`. **Not a forms problem**: `packages/core/dist/modules/customers/i18n`
  does not exist either. Module locale JSON resolves from **source** through the
  `"./*/*/*/*.json": "./src/*/*/*/*.json"` exports arm, and the generated i18n shards import it by
  package path. Do **not** add forms to `copyDesignSystemAssets()`.

- **`tsconfig.json` / `tsconfig.build.json`** — no edit.
  `"include": ["src/**/*", "generated/**/*"]`, `"exclude": ["node_modules", "dist", "**/__tests__/**"]`.
  forms is inside `src/`, so it is typechecked — that is *how* the 28 errors in item 4 surfaced.
  `tsconfig.build.json` is a bare `{ "extends": "./tsconfig.json" }`.
  Consequence worth knowing: `__tests__` is excluded, so **`yarn typecheck` never reads forms' 63
  test files**. A type error there surfaces only under jest.

- **`exports`** — deep wildcards already cover every real forms import path. Only the bare
  `./modules/forms` barrel entry is worth adding (item 11, SHOULD).

## Q3 — Migrations: the copied snapshot is valid; no collisions

**Confidence: certain on collisions and snapshot shape. The `db:generate` no-op claim is UNPROVEN — see the caveat.**

**Is a per-module snapshot copied across repos valid here? Yes.** Migration state is **per-module,
not per-repo**. `packages/cli/src/lib/db/commands.ts:252-283` isolates each module:

```ts
MetadataStorage.clear()                                        // :252 — per-module isolation
const tableName = `mikro_orm_migrations_${sanitizedModId}`     // → mikro_orm_migrations_forms
const snapshotName = getMigrationSnapshotName(resolver)        // → .snapshot-open-mercato
const orm = await MikroORM.init({ entities, migrations: { path: migrationsPath, tableName, snapshotName } })
```

`entities` holds *only* forms' entities, so the snapshot describes only forms' 11 tables and carries
no cross-repo state. Structurally identical to this repo's own snapshots:

```
forms           top keys: ['name','namespaces','tables','views','nativeEnums']   ('name': 'public')
warranty_claims top keys: ['name','namespaces','tables','views','nativeEnums']   ('name': 'public')
table keys only in forms: []        column keys only in forms: []
```

The forms snapshot omits the `triggers` (table) and `collation` (column) keys that
`warranty_claims` carries. **Normal here, not version drift** — 32 of this repo's 52 module
snapshots also omit them:

```
snapshots WITH triggers:    20
snapshots WITHOUT triggers: 32  (api_keys, entities, planner, query_index, business_rules, sales,
                                 perspectives, inbox_ops, forms, translations, customer_accounts, ...)
```

**How will `yarn db:generate` treat it?** It iterates `resolver.loadEnabledModules()`, so it skipped
forms entirely before `5df50543b`. Now that forms is enabled, it diffs live entity metadata against
the copied snapshot and emits a migration only for a real delta. Forms' entities use
`@mikro-orm/decorators/legacy`, the dominant in-repo convention (also `api_keys`, `sales`,
`customers`, `entities`, `query_index`, `business_rules`, `planner`, `phone_calls`,
`push_notifications`, `shipping_carriers`), and `@mikro-orm/decorators@7.1.14` exports the
`./legacy` subpath. No decorator-level drift expected.

> **Caveat — UNPROVEN.** `db:generate` opens a real Postgres connection (`MikroORM.init` with a live
> pool) and no database was available in this worktree, so **this was not executed**. Before merge,
> run `yarn db:generate` once and confirm it emits **no** migration for forms. If it does, follow
> the coding-agent exception in `AGENTS.md`: delete unrelated output, keep only the intended SQL,
> and update `migrations/.snapshot-open-mercato.json`. **Never run `yarn db:migrate`.**

**Do class names / timestamps collide? No.**

```
$ find packages apps -name 'Migration*.ts' -path '*migrations*' -not -path '*/dist/*' | wc -l
339
```

Neither the duplicate-class-name list nor the duplicate-timestamp list across those 339 contains any
of forms' six. (22 timestamps *are* shared between other module pairs — e.g.
`Migration20260602120000` — which independently proves cross-module collisions are harmless here,
because the tracking table is per-module.)

| forms migration | collides with |
|---|---|
| `Migration20260508135459_forms` | nothing |
| `Migration20260508140932_forms` | nothing |
| `Migration20260508155737_forms` | nothing |
| `Migration20260520120000_forms` | nothing |
| `Migration20260521090000_forms` | nothing |
| `Migration20260521120000_forms` | nothing |

**Every forms table, and proof none exists elsewhere.** Eleven, all `forms_`-prefixed:
`forms_form`, `forms_form_version`, `forms_form_submission`, `forms_form_submission_actor`,
`forms_form_submission_revision`, `forms_encryption_key`, `forms_form_access_audit`,
`forms_form_attachment`, `forms_distribution`, `forms_consent_record`, `forms_invitation`.

```
$ for t in forms_form forms_form_version ... forms_invitation; do
    grep -rln "'$t'\|\"$t\"" packages apps --include=*.ts --include=*.tsx --include=*.json \
      | grep -v "modules/forms/"
  done
(no output for any of the eleven)
```

Cross-checked against the snapshot's own table list, which matches `data/entities.ts`
`@Entity({ tableName: ... })` one-for-one. Note in particular that `forms_form_attachment` is
forms' own table and does **not** collide with the `attachments` module's `attachment` /
`attachment_partition` tables.

## Q4 — i18n registration mechanism

Module locale files are picked up **by directory convention only** — `discoverTranslations()`
(`module-registry.ts:2019`) reads `<moduleRoot>/i18n/*.json`, and the registry writes one shard per
locale (`modules.i18n.<locale>.generated.ts`) plus a `loadI18nModules(locale)` switch. No registry
entry, no `exports` entry, no manual step. With forms enabled, `modules.i18n.en.generated.ts` picks
it up automatically; before `2b0006431` the `ko` shard did not (no `ko.json`) — the mechanism
working exactly as designed.

**CI enforcement status of the four checks** (exit codes re-measured on `f3bfb9ed0`):

| Command | Exit at `4bccb2299` | Exit at `f3bfb9ed0` | Blocks? |
|---|---|---|---|
| `yarn i18n:check-sync` | **1** (`[forms] MISSING FILES: ko.json`) | **0** | **yes** — position 4 in `.ai/agentic.config.json` `validation.commands` |
| `yarn i18n:check-usage` | **1** (11 missing keys, all forms) | **0** | **yes** — position 5. CI runs it under a `continue-on-error` step, so read the *step conclusion*, not the check name; the local gate treats non-zero as failure |
| `yarn i18n:check-hardcoded` | 0 (`[core/forms] 14`) | 0 | no — advisory, Phase 1 |
| `yarn i18n:check-values` | 0 (`[ko] … 756 missing`) | 0 | no — advisory, Phase 1 |

> **Environment note for whoever reruns these.** All four run under `tsx`/node and create a unix
> socket in `TMPDIR`. Under cezar the default `TMPDIR` is a path where `listen()` fails with
> `EINVAL`, and the wrapper swallows it into **exit 0** — a silent false pass:
> ```
> Error: listen EINVAL: invalid argument /…/.ai/cezar/tmp/…/tsx-1000/3529048.pipe
> EXIT:0
> ```
> Export a normal `TMPDIR` first (`export TMPDIR=$HOME/.cache/tmp`) or you will read "green" off a
> crashed process.

## Q5 — Jest: no accommodation needed at all

**Confidence: certain — this was executed, not reasoned.**

```
$ cd packages/core && npx jest --config jest.config.cjs --silent src/modules/forms
Test Suites: 63 passed, 63 total
Tests:       803 passed, 803 total
Snapshots:   0 total
Time:        97.184 s
$ echo $?
0
```

**All 63 forms suites and 803 tests pass against the *unmodified* `packages/core/jest.config.cjs`.**
No test needs an accommodation, and neither of the two deltas from the standalone config matters:

- **`^@open-mercato/forms/(.*)$` moduleNameMapper — not needed.** No forms test references it:
  `grep -rn "@open-mercato/forms" packages/core/src/modules/forms/__tests__/` returns nothing.
  Repo-wide there are exactly two occurrences, both inside doc comments (`events-payloads.ts:13`,
  `services/encryption-service.ts`). Core's existing
  `'^@open-mercato/core/(.*)$': '<rootDir>/src/$1'` mapper covers the rewritten specifiers.
  **Do not add the mapper** — it would resurrect a package identity that no longer exists.

- **The transform tsconfig — not needed.** Core's transform is
  `scripts/jest-mikroorm-transformer.cjs` with `{ jsx: 'react-jsx', rootDir: '.', ignoreDeprecations: '6.0' }`,
  inheriting `module`/`target`/`esModuleInterop`/`experimentalDecorators`/`emitDecoratorMetadata`
  from the repo's base tsconfig. Nine forms suites import `data/entities` — i.e. exercise MikroORM
  decorators: `submission-service`, `analytics-service`, `anonymize-service`, `export-service`,
  `consent-record-service`, `access-audit-logger`, `pdf-snapshot-document`, `pdf-style-neutrality`,
  `embed-frame-policy` — and all nine pass. That is direct proof decorator metadata is emitted
  correctly under the existing config.

- **`testMatch` covers them.** `testMatch: ['<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)']`; all
  63 forms tests are `*.test.ts` under `__tests__/`, none outside, none with another extension.

- **`testEnvironment: 'node'` is fine.** No forms test imports `@testing-library/react` or
  `react-dom`, and none declares a `@jest-environment jsdom` docblock. There are **no React
  component tests** in the vendored suite — itself a coverage gap worth flagging to the
  integration-test task, given the module ships a large drag-and-drop Form Studio.

**Caveat:** `packages/core/tsconfig.json` excludes `**/__tests__/**`, so `yarn typecheck` never
reads these 63 files. They are type-checked only by the jest transform, which is more permissive. A
green typecheck says nothing about test-file types.

## Q7 — other structural risks

### `yarn generate` — passes

Exit 0, one warning (item 6). No convention warning about module shape, no discovery error.
584 → 629 API paths.

### `yarn build:packages` — passes

Exit 0. 38/38 tasks.

> **Watch the turbo cache.** This worktree shares a turbo cache with sibling cezar worktrees.
> `yarn build:packages` reported `38 cached, 38 total >>> FULL TURBO` in 778 ms — a *replay*, not a
> build, and the replayed log carried a sibling worktree's absolute paths. It happened to be correct
> (`packages/core/dist/modules/forms/` really was populated), but **verify `dist/` contents rather
> than trusting a FULL TURBO line.** The same trap bit `yarn lint` — see below.

### `yarn build:app` — passes, and every forms surface compiles

**Confidence: certain — executed twice, before and after the item-4 fix.**

Full ordered gate on `f3bfb9ed0` (`build:packages` → `generate` → `build:packages` → `build:app`,
the second `build:packages` being load-bearing):

```
BP1:0
GEN:0
BP2:0
BUILDAPP:0
 Tasks:    1 successful, 1 total
Cached:    0 cached, 1 total       # a real build, not a turbo replay
  Time:    1m55.627s
```

```
✓ Compiled successfully in 57s
✓ Generating static pages using 15 workers (6/6) in 2.4s
$ grep -c "error TS" /tmp/r4.txt
0
```

Turbopack compiles **every** forms surface — the 45 API routes (including `api/public/**`), the
7 backend pages with the drag-and-drop Form Studio, the 3 public frontend pages, the 2 portal
pages, the injection widgets, subscribers and workers. Nothing in the vendored tree defeats the
bundler.

The run with the `forms` probe enabled **before** `5df50543b` is the useful control: it also
reported `✓ Compiled successfully in 55s`, then `Failed to type check.` on exactly the 28 item-4
errors and nothing else (`grep "error TS" | grep -v modules/forms` → 0). So `build:app` was failing
**only** on item 4 — there was never a second, build-level wiring problem hiding behind it.

The 8 Turbopack warnings the build emits (`Dynamic filesystem access causes tracing of the whole
project`) are pre-existing and unrelated to forms — they trace to
`apps/mercato/src/modules/example/api/qa-events/route.ts` and `packages/queue/dist/strategies/local.js`.

### `yarn lint` — **does not lint forms at all**

**Confidence: certain.** `yarn lint` is `turbo run lint`, and **no workspace under `packages/*`
defines a `lint` script**:

```
$ for p in packages/*/package.json; do grep -q '"lint"' $p && echo "$p"; done
(no output)
$ grep -n '"lint"' package.json apps/mercato/package.json
package.json:35:              "lint": "turbo run lint"
apps/mercato/package.json:14: "lint": "eslint ."
```

CI states it outright (`.github/workflows/ci.yml:398`):

> `@open-mercato/app` is the only workspace with a `lint` script, so it must stay…

So `yarn lint` exits 0 while reading **zero bytes** of `packages/core/src/modules/forms/**`. On this
run it was worse — the result was a cross-worktree cache replay:

```
$ yarn lint
@open-mercato/app:lint: /home/pkarw/…/worktrees/2ae217d0-…/apps/mercato/src/components/…
 Tasks:    1 successful, 1 total
Cached:    1 cached, 1 total
  Time:    129ms >>> FULL TURBO
LINT_EXIT: 0
```

Note the `2ae217d0` path — a *different* worktree. A green `yarn lint` is not evidence about this
branch, let alone about forms.

**Implication.** Do not cite `yarn lint` as lint coverage for this migration. The gates that
actually read forms source are `yarn typecheck` (item 4), `yarn test` (Q5) and the advisory
`yarn lint:ds` (item 12). `yarn lint:check-graph` exists to catch the task graph going empty; it
does not widen coverage.

### `yarn agents:check-budget` — passes today, and a Task Router row would break it

**Confidence: certain — measured, including the negative case.**

```
$ yarn agents:check-budget
AGENTS.md: 31206 bytes / 31232 limit (26 bytes free; agent budget 32768).
  chain packages/ai-assistant:            OVER by 102055 bytes   -1 vs baseline
  chain packages/core:                    OVER by  39842 bytes -155 vs baseline
  chain packages/core/src/modules/sales:  OVER by  44316 bytes  -12 vs baseline
  chain packages/ui:                      OVER by  33790 bytes   -6 vs baseline
$ echo $?
0
```

**The root `AGENTS.md` has 26 bytes of headroom.** Probe — appending one 89-byte Task Router row and
re-running (then reverted):

```
AGENTS.md: 31295 bytes / 31232 limit (63 bytes over; agent budget 32768).
$ echo $?
1
```

**So adding a forms row to the root Task Router fails the gate.** To add one, an equal-or-larger
number of bytes must come out of the root file in the same PR — the canonical move is relocating
long-form prose into `.ai/docs/*` and leaving a link. Budget for that, or skip the row.

### Should `packages/core/src/modules/forms/AGENTS.md` exist? **No.**

**Confidence: high.**

There *is* precedent — `packages/core/src/modules/sales/AGENTS.md` (4 474 bytes) — but the
arithmetic says a forms equivalent would deliver nothing:

| | bytes |
|---|---|
| root `AGENTS.md` | 31 206 |
| `packages/core/AGENTS.md` | 41 404 |
| chain total before any module file | **72 610** |
| Codex `project_doc_max_bytes` | 32 768 |
| already over by | **39 842** |

The checker's own message: *"an agent started here loses the last 39 842 bytes of the chain (tail of
`packages/core/AGENTS.md`)"*. The chain is consumed root → package → module, so an agent starting in
`packages/core/src/modules/forms/` gets the root file, ~1.5 KB of `packages/core/AGENTS.md`, then
hits the ceiling. **A forms `AGENTS.md` would be 100% truncated — every byte unreachable.**

It would also not be *caught*: `analyze()` only walks chains explicitly listed in
`scripts/agents-md-budget.baseline.json` (`ai-assistant`, `core`, `core/src/modules/sales`, `ui`),
so a new `core/src/modules/forms` chain is not analysed and the gate stays green. That is the worst
outcome — a file that costs maintenance, reads as authoritative, and reaches no agent.

**Recommendation.** Do not add it. Put forms guidance in `.ai/docs/` or a spec under `.ai/specs/`,
and add the Task Router row only in a PR that also frees ≥ the row's bytes from the root file. If a
module file is added anyway it must be registered via `yarn agents:check-budget --update-baseline`
and justified in the PR, per the script's own instructions.

### Other structural items checked and cleared

- **`icon: React.createElement(...)` in `backend/forms/page.meta.ts` is fine.** It makes the
  metadata non-statically-serializable, so the generator falls back to an eager
  `import * as BMManifest… from ".../page.meta"` instead of inlining JSON. That fallback is used by
  **80 backend routes across 20+ modules** (customers ×7, ai_assistant ×7, auth ×6, entities ×5,
  sales ×4 …); `CollapsibleNavSection` types `icon?: React.ReactNode`; and ten core modules already
  build their icon with `React.createElement` in `page.meta.ts`. No change needed.
- **create-app Template Sync.** Items 1–4 and 6–14 touch no `apps/mercato/src/app/**`,
  `apps/mercato/src/i18n/**` or `.env.example`, so the **Template Sync Checklist** is not triggered
  by them. It **is** triggered by item 5 (which edits `next.config.ts` and `src/proxy.ts`) and by
  item 9 if solved in the app locale files — run `yarn template:sync:fix` in that case.
- **`BACKWARD_COMPATIBILITY.md`**: purely additive across all 13 contract-surface categories — new
  module id, entity ids, event ids, ACL features, API routes, tables, DI keys. Item 11 adds
  `exports` entries (additive). Nothing existing changes; no deprecation protocol applies. Verified:
  none of the 11 table names, and no `forms.*` ACL feature or entity id, exists anywhere else.

---

# Reproduce

Run from the repo root on `f3bfb9ed0` or later.

```bash
yarn install
export TMPDIR="$HOME/.cache/tmp"     # see the Q4 environment note — non-optional under cezar
yarn build:packages                  # CLI must be built before generate
yarn generate                        # → 0, one warning: commands/submission.ts (item 6)
yarn build:packages                  # the second one is load-bearing
yarn i18n:check-sync                 # → 0
yarn i18n:check-usage                # → 0
yarn i18n:check-hardcoded            # → 0  [core/forms] 14 hardcoded strings (advisory)
yarn i18n:check-values               # → 0  (advisory)
yarn typecheck                       # → 0
yarn agents:check-budget             # → 0  root AGENTS.md: 26 bytes free
yarn build:app
( cd packages/core && npx jest --config jest.config.cjs src/modules/forms )   # → 0  63/63, 803 tests
yarn lint                            # → 0  but reads ZERO bytes of packages/** — see above
node --require ./scripts/typescript-js-require-hook.cjs node_modules/eslint/bin/eslint.js \
  --config eslint.ds.config.mjs packages/core/src/modules/forms   # → 31 warnings, 0 errors
```

# Suggested landing order for what remains

1. **Item 6** — one-line command registration; clears the only `yarn generate` warning.
2. **Items 7 + 8 together** — the `/run` surface. Scope it to org/tenant and give the page a
   `page.meta.ts`, or delete both if `/f/:slug` supersedes them. Security-relevant; do it early.
3. **Item 5** — the embed framing decision. **Ask First**: it touches `apps/mercato/src/` and may
   need a `page-executor` extension. Until it lands, `/embed/:slug` cannot work at all.
4. **Item 9** — one i18n key, five files.
5. **Items 10, 11, 12, 13** — hardening and parity; same PR or a follow-up.
6. **Before merge, independently of the above:** run `yarn db:generate` against a real database and
   confirm it emits no migration for forms (the Q3 caveat). **Never run `yarn db:migrate`.**
