# forms → core migration — detailed task orders

Shared context lives in [`forms-migration-brief.md`](./forms-migration-brief.md). Read that first.
Your task order names the section below that is *yours*. Read only your section.

---

## ORDER: security review of the unauthenticated surface

**Output file (the only file you may create or modify):** `.ai/analysis/forms-security-review.md`
**Mode:** read-only review. Fix nothing. Change no source file. Read-only commands and tests are fine.

`packages/core/src/modules/forms/` was written in another repo against an older core and has never
been reviewed under this repo's rules. It deliberately serves anonymous users, so on merge its
public surface becomes the platform's public surface. Review in this priority order. For every
finding give `file:line`, the concrete exploit path (inputs → effect), why the surrounding code does
or does not mitigate it, and the minimal fix.

1. **`api/public/**` — every route there is reachable without authentication.** `public/start`,
   `public/submissions/[id]` plus its `/submit`, `/attachments`, `/attachments/[attachmentId]` and
   `/pdf` children, `public/distributions/[slug]` plus `/embed-policy`,
   `public/invitations/[token]`, `public/embed-loader`, and `api/by-key/[key]/active`. For EACH
   route: what authorises the caller? Is the id / token / slug a bearer capability, is it
   unguessable, is it compared in constant time? Can one anonymous caller read or mutate *another*
   submission by id? Is tenant/organization scoping enforced on every query, or inferred from
   attacker-controlled input? Enumerate the IDOR candidates explicitly rather than concluding
   "looks fine".
2. **Tokens and capabilities.** `services/distribution-token.ts`,
   `api/form-submissions/[id]/resume-token/route.ts`, `lib/runtime-principal.ts`,
   `runner/tamper-check.ts` — entropy, hashed vs plaintext storage, expiry, revocation, single-use
   semantics, timing-safe comparison, and leakage through URL or `Referer`.
3. **Throttling and captcha.** `api/public/rate-limit.ts`, `services/captcha-verifier.ts` — is the
   limiter keyed per identity or per deployment? (Known trap in this repo: a route-level
   `rateLimit` key that resolves to IP-or-`'global'`, i.e. a single bucket for every caller.) Is
   captcha fail-open or fail-closed? Can it be skipped by omitting a field?
4. **Uploads.** `services/attachment-service.ts`, `services/upload-validation.ts`,
   `services/upload-scanner.ts`, `api/public/submissions/[id]/attachments/**` — MIME/extension
   confusion, size limits actually enforced server-side, path traversal in stored names, SVG/HTML
   stored XSS on download, `Content-Type`/`Content-Disposition` on the download route, whether the
   scanner is advisory or blocking, and whether an anonymous caller can download an attachment
   belonging to a submission that is not theirs.
5. **Embedding.** `lib/embed-frame-policy.ts`, the `embed-policy` route, `public/embed-loader`,
   `ui/public/EmbeddedForm.tsx` — `frame-ancestors`/CSP correctness, allowlist bypass (wildcard,
   subdomain, `null` origin, scheme), clickjacking, `postMessage` origin checks.
6. **Expression evaluation.** `services/jsonlogic-evaluator.ts`, `schema/jsonlogic-grammar.ts`,
   `services/form-logic-evaluator.ts`, and the Ajv setup in `services/form-version-compiler.ts` and
   `schema/jsonschema-extensions.ts` — sandbox escape, prototype pollution, ReDoS through `x-om`
   pattern constraints, unbounded recursion or DoS from a hostile compiled version, and Ajv's
   `strict` / `code` policy.
7. **Data protection.** `encryption.ts`, `services/encryption-service.ts`, `lib/log-redaction.ts`,
   `services/anonymize-service.ts`, `services/access-audit-logger.ts`, `lib/retention.ts` — are
   answers genuinely encrypted at rest as the module claims? Does anything log PII or a token? Does
   anonymize remove *every* copy (revisions, PDF snapshots, attachments, audit rows, search index)?
8. **Tenant isolation module-wide, not just the public routes.** Sweep every `em.find*` and
   query-engine call in `api/` and `services/` and flag any that does not scope by both `tenantId`
   and `organizationId` on a scoped entity. Also flag any raw `em.find`/`em.findOne` against an
   encrypted entity where `findWithDecryption`/`findOneWithDecryption` is required.

Ground the review in this repo's rules: root `AGENTS.md` (§ Data & Security, § UI & HTTP),
`packages/core/AGENTS.md` (§ Access Control, § Encryption, § API Routes — note the mutation-guard
requirement for custom write routes), and `.ai/review-checklist.md`. Compare against how `content`,
`auth`, `customer_accounts`, `payment_gateways` and `webhooks` handle unauthenticated entry *in this
repo* — house pattern beats generic advice.

Rank findings Critical / High / Medium / Low / Nit. Include a **"verified NOT a problem"** section
listing what you checked and cleared, so the parent does not recheck it. Be specific: a vague
finding is worse than none. Commit the one file.

---

## ORDER: design-system compliance review of the forms UI

**Output file (the only file you may create or modify):** `.ai/analysis/forms-ds-review.md`
**Mode:** read-only review. Fix nothing. Change no source file.

The forms module ships ~100 `.tsx` files that were written outside this repo's design-system gate:
a drag-and-drop Form Studio (`backend/forms/[id]/studio/**`), the backend list/analytics/history/
distribution pages, the admin distribution panels (`ui/admin/**`), the public runner
(`ui/public/**`, `runner/**`), and the injection widgets (`widgets/injection/**`). None of it has
been checked against `.ai/ds-rules.md`.

Read `.ai/ds-rules.md`, `.ai/ui-components.md`, `packages/ui/AGENTS.md` and
`.ai/ui-backend-components.md` first, then audit the forms UI for:

1. **Hardcoded Tailwind status colours** (`text-red-*`, `bg-green-*`, `text-amber-*`, `border-gray-*`
   …) that must become `{property}-status-{status}-{role}` or semantic tokens (`border-border`,
   `border-input`). Give the exact token each site should use.
2. **Arbitrary values** — `text-[13px]`, `p-[13px]`, `rounded-[24px]`, `z-[9999]`, arbitrary
   hex/rgb in `className` — that must move to the DS scale. Note that a *colour-picker* or
   *style-preset* surface may legitimately need dynamic inline colour values; distinguish those
   (the Form Studio's `style/ColorControl.tsx`, `BackgroundControl.tsx`, `presets.ts` and the
   runner's `style/applyStyle.ts` compile user-chosen theme colours by design) from real
   violations. Being wrong in this direction wastes the parent's time, so be careful here.
3. **`dark:` overrides on semantic or status tokens**, which already handle dark mode.
4. **Reinvented components.** The single highest-value part of this review: list every place forms
   hand-rolls something `packages/ui` already provides — a bespoke table instead of `DataTable`, a
   bespoke form instead of `CrudForm`, hand-rolled loading/error states instead of
   `LoadingMessage`/`ErrorMessage` from `@open-mercato/ui/backend/detail`, a custom dialog instead
   of the `Dialog` primitive, custom toast/banner instead of `FlashMessages`, custom KPI/chart
   instead of `@open-mercato/ui/backend/charts`, custom filter UI instead of `FilterBar`, custom
   page chrome instead of `Page`. For each: the forms file, the `packages/ui` equivalent, and
   whether swapping is mechanical or would change behaviour.
5. **House HTTP and mutation rules in UI code** — raw `fetch` instead of `apiCall`/`apiCallOrThrow`
   from `@open-mercato/ui/backend/utils/apiCall`; a non-`CrudForm` page whose `POST`/`PUT`/`PATCH`/
   `DELETE` is not wrapped in `useGuardedMutation(...).runMutation(...)`; `.json().catch(...)`
   instead of `readJsonSafe`.
6. **Dialog keyboard contract** — every dialog must submit on `Cmd/Ctrl+Enter` and cancel on
   `Escape`. List the dialogs that do not.
7. **Hardcoded user-facing strings** — any literal that should be `t('forms.…')`, and any purely
   internal `throw new Error(...)` / `toast.*(...)` that should carry the `[internal]` prefix so the
   i18n hardcoded-string checker treats it as opted out. Run `yarn i18n:check-hardcoded`
   (`export TMPDIR=/tmp` FIRST — otherwise tsx dies with a bogus `listen EINVAL … .pipe` error) and
   report its forms output verbatim.
8. **Accessibility basics** on the drag-and-drop canvas and the public runner: keyboard operability,
   labels tied to controls, `aria-*` on the custom matrix/ranking/scale/signature fields, and focus
   management in dialogs and the section stepper.

Also run `yarn lint` and report its forms-relevant output verbatim. Note honestly whether root
`yarn lint` actually covers `packages/core/src/**` at all — if it does not, say so and find the
command that does (check each package's own `lint` script and
`packages/eslint-plugin-ds`), then run that.

Rank findings **MUST fix before merge** / **SHOULD fix** / **nit**, and order each group by how
many sites it touches. Group by file. Give the exact replacement for each site — the parent will
apply them, so a finding without a concrete fix is not useful. Commit the one file.

---

## ORDER: author the P0 forms integration suite

**Output scope (the only paths you may create or modify):**
`packages/core/src/modules/forms/__integration__/**` and
`packages/core/src/helpers/integration/formsFixtures.ts`.
**Mode:** implement. Do not touch any other file — in particular no file under
`packages/core/src/modules/forms/` outside `__integration__/`, and no existing helper.

### Why this is urgent

`.ai/analysis/forms-integration-test-plan.md` established that
`OM_INTEGRATION_MODULES=forms` currently matches **zero** specs, so the Playwright config falls back
to a `__no_tests__` sentinel that asserts `expect(true).toBe(true)`. The PR therefore reports
`ephemeral-integration` **green while testing nothing**, with ~50 new API routes landing behind a
placeholder pass. Your job is to restore that signal.

### What to do

1. **Read `.ai/analysis/forms-integration-test-plan.md` end to end first.** Part 1 is an exhaustive,
   verified map of the harness: the 69 `__integration__` directories, the discovery module, every
   command, how the ephemeral lane provisions (testcontainers Postgres → `mercato init` → builds →
   app on :5001 → Playwright), the CI shard matrix, and an export-by-export inventory of all 38
   helper files under `packages/core/src/helpers/integration/`. Part 2 is a 93-case design
   (42 P0 / 41 P1 / 10 P2) with routes, fixtures, steps and assertions per case. **Author the 42 P0
   cases.** Do not redesign them; if a case turns out to be wrong against the real API, fix the test
   and say so in your report.
2. **Build the shared `formsFixtures.ts`** the plan proposes, in the house style of the existing
   `crmFixtures` / `catalogFixtures` / `salesFixtures`: API-first fixture creation, everything it
   creates cleaned up in teardown, no reliance on seeded or demo data.
3. **Make them pass.** A red suite is not the deliverable. If a test fails because the module is
   genuinely broken, do NOT weaken the test and do NOT fix the module — that is outside your scope.
   Report the defect precisely (route, inputs, expected vs actual) and mark that case skipped with a
   comment naming the defect, so the parent can fix the module and unskip it.

### Environment — the plan's section 1.7 has the verified recipe; these bite hardest

- `export TMPDIR=/tmp` before anything. Under cezar the default TMPDIR cannot host a unix socket,
  `tsx` dies with `listen EINVAL`, and the yarn wrapper can swallow it into a false exit 0.
- Run `yarn build:packages` before `yarn test:integration:ephemeral`, which otherwise fails
  `MODULE_NOT_FOUND` **while exiting 0**. Never trust its exit code alone — read the output.
- `apps/mercato/.env` ships `JWT_SECRET=change-me-dev-secret` and the ephemeral app runs under
  `NODE_ENV=production`, where `jwt.ts` fails closed on that placeholder. Export a real secret.
- Turbo's cache is shared across sibling worktrees and will replay another worktree's result. Verify
  `dist/` contents rather than trusting a green line.
- An unauthenticated `page.request` is the classic trap here — use the house pattern the plan
  documents.

### Deliverable

Commit the suite. In your report: how many of the 42 P0 cases are passing, how many skipped and why
(one line per skip, naming the module defect), the verbatim command and output of the full forms
integration run, and the `OM_INTEGRATION_MODULES=forms playwright --list` count proving the sentinel
is gone. Be honest about anything you could not get green — a `done` that hides a red case costs the
parent a full round trip.
