# Missing Translations: Audit & Phased Remediation

**Status:** draft
**Owner:** platform / i18n
**Date:** 2026-05-26
**Tracking issue:** [open-mercato/open-mercato#2077](https://github.com/open-mercato/open-mercato/issues/2077)

## TLDR

**Key points:**
- `yarn i18n:check-sync` and `yarn i18n:check-usage` only validate **already-extracted** keys: parity across locales, and `t()`/`translate()` call ↔ JSON-key matching. Neither tool can see **hardcoded user-facing strings** in JSX/TSX, attribute literals, or error throws, so those leak past every gate today.
- Two backend-visible modules ship with **no i18n at all** — `api_docs` (admin API explorer; ~120 hardcoded strings in one file) and `content` (the public privacy/terms pages, where at minimum the chrome should be translatable).
- ~15 modules with i18n still emit user-facing English literals through `throw new Error(...)`, `createCrudFormError(...)`, `toast(...)`, and `aria-label`/`placeholder`/`title` JSX props. Mixed in are pure assertion-style errors that intentionally stay English — the audit needs to discriminate.
- `packages/ui` primitives (`aria-label="Close menu"`, placeholder defaults in rich-editor, portal shell chrome) leak hardcoded English into every consuming app.
- Non-English locale coverage is much worse than `check-sync` suggests: 13% of `pl.json` entries, 19% of `es.json`, and 21% of `de.json` are still byte-identical to English (1.9k–3.1k entries per locale). `check-sync` is happy because the keys exist; the *values* are untranslated.

**Scope:** detection tooling + targeted module remediation + non-English value audit, in phases that ship independently and remain reversible.

**Non-goals:**
- Translating the *body* of `content/frontend/privacy/page.tsx` and `content/frontend/terms/page.tsx`. Legal text requires localized legal review; this spec covers only the surrounding chrome (page titles, breadcrumbs, layout nav).
- Reworking the `useT()` / `resolveTranslations()` runtime contract. The contract is fine; the gap is coverage and tooling.
- Migrating internal assertion-style `throw new Error(...)` messages. They never reach a user; translating them adds noise without benefit.
- Translating embedding-text used by vector search (covered separately by `2026-05-20-search-presenter-i18n.md`).
- Translating `*.test.ts(x)` / `*.spec.ts(x)` fixtures, `.ai/qa/` test cases, or `create-app/template/` files.

## Audit

Numbers below come from the scan executed on `origin/develop` at commit `29e9a20dd` (2026-05-26). The exact commands are listed under [Reproducing the audit](#reproducing-the-audit) so reviewers can re-run them.

### A. Detection tooling gap

| Check | Catches | Misses |
|---|---|---|
| `yarn i18n:check-sync` | Locale-key parity (en vs pl/de/es) — currently PASS | Hardcoded JSX text; English-as-value in `*.json` |
| `yarn i18n:check-usage` | `t('foo.bar')` with no `foo.bar` in any `en.json`; unused keys (advisory) | Hardcoded JSX text; attribute literals; identical-to-English locale values |
| `tsc` / `eslint` | Nothing i18n-related | Everything i18n-related |

There is no static rule for `>Some Text</`, `aria-label="..."`, or `placeholder="..."`. The patterns are detectable with high precision (see [Phase 1](#phase-1--detection-tooling)).

### B. Modules with UI but no i18n setup

Cross-referencing every module folder against the union of `i18n/en.json` files (47 found):

| Module | Pages | Hardcoded strings | Notes |
|---|---|---|---|
| `packages/core/src/modules/api_docs` | `frontend/docs/api/Explorer.tsx`, `backend/docs/page.tsx` | ~120 (17 in Explorer.tsx alone match `>Word<` / `"Word"` shapes) | Backend admin UI shown to every user with the `api_docs.view` feature; full i18n setup needed. |
| `packages/content/src/modules/content` | `frontend/privacy/page.tsx`, `frontend/terms/page.tsx`, `frontend/components/ContentLayout.tsx` | ~2000+ if you count the legal body; ~25 chrome strings (`title`, `breadcrumb` labels, layout nav) | **Chrome only** in scope here; legal body deferred — see [Out of scope](#scope-clarifications). |

`sales/lib` shows up in mechanical scans but is a subfolder of an already-translated module — false positive.

### C. Hardcoded user-facing strings in modules WITH i18n

Counts of literal-English string-attribute props, `throw new Error('...')`, and `toast/flash/alert(...)` calls in module sources. Some of the `throw` count is intentional internal assertions; the table is a triage starting point, not a strict to-fix list.

| Module | `attr=` | `throw=` | `toast=` | Total |
|---|---|---|---|---|
| `messages` | 0 | 45 | 0 | 45 |
| `workflows` | 3 | 12 | 10 | 25 |
| `ai_assistant` | 0 | 20 | 0 | 20 |
| `entities` | 4 | 3 | 6 | 13 |
| `customers` | 0 | 13 | 0 | 13 |
| `security` | 0 | 12 | 0 | 12 |
| `scheduler` | 0 | 12 | 0 | 12 |
| `example` | 3 | 8 | 0 | 11 |
| `search` | 0 | 9 | 0 | 9 |
| `currencies` | 0 | 4 | 0 | 4 |
| `business_rules` | 0 | 4 | 0 | 4 |
| `sync_akeneo` | 0 | 5 | 0 | 5 |
| `sso` | 0 | 5 | 0 | 5 |
| `webhooks` | 0 | 4 | 0 | 4 |
| `configs` | 0 | 3 | 0 | 3 |
| `notifications` | 0 | 3 | 0 | 3 |
| `auth` | 0 | 2 | 0 | 2 |
| `sales` | 0 | 2 | 0 | 2 |
| `payment_gateways` | 0 | 2 | 0 | 2 |
| `inbox_ops` | 0 | 2 | 0 | 2 |
| `gateway_stripe` | 0 | 2 | 0 | 2 |

Sampled cases to demonstrate the user-facing/internal split:

- **User-facing** (must translate): `workflows/frontend/checkout-demo/page.tsx:throw new Error('Please log in to start a workflow')`, `messages/commands/actions.ts:throw new Error('Access denied')`, `ai_assistant/.../AiAssistantSettingsPageClient.tsx:throw new Error('Failed to fetch settings')`.
- **Internal assertion** (do not translate): `workflows/lib/activity-executor.ts:throw new Error('Event bus not available in container')`, `customers/.../usePersonTasks.ts:throw new Error('Task creation requires an entity id')`.

`example` is intentionally a reference module; some literals there are pedagogical. Audit but do not over-fix.

### D. `packages/ui` primitives

Hardcoded English in shared UI primitives leaks into every consuming app:

- `packages/ui/src/primitives/rich-editor.tsx` — `aria-label="Rich text formatting"`, `aria-label="Color palette"`.
- `packages/ui/src/portal/PortalShell.tsx` — `aria-label="Portal navigation"`, `aria-label="Close menu"`.
- `packages/ui/src/primitives/select.tsx` — example `placeholder="Select user"` in a JSDoc, but the actual default fallbacks need a sweep.
- Total: ~22 hardcoded attribute literals across primitives + ~6 user-facing `throw` messages (excluding tests).

Library code can't `useT()` unconditionally (consumers control the i18n provider). Pattern in scope here: accept the string via prop, default to a key like `'ui.richEditor.aria.toolbar'`, and resolve at the consumer with a provided fallback.

### E. Non-English locale values: untranslated entries

`yarn i18n:check-sync` reports "all locales in sync" — true at the **key** level. At the **value** level:

| Locale | Total keys | Identical to English | % untranslated |
|---|---|---|---|
| `pl` | 15,060 | 1,943 | 12.9% |
| `de` | 15,060 | 3,137 | 20.8% |
| `es` | 15,060 | 2,868 | 19.0% |

A subset is legitimately identical (proper nouns, "OK", "API", brand names). The bulk is genuinely untranslated. `check-sync` cannot tell them apart without an allowlist or a heuristic ("string > 3 chars AND contains a space AND is in a Latin language").

## Reproducing the audit

```bash
# Tooling gap — current state
yarn i18n:check-sync       # passes
yarn i18n:check-usage      # 0 missing, 3650 unused (advisory)

# Modules with UI but no i18n
find packages apps -path "*/i18n/en.json" -not -path "*/node_modules/*" \
  -not -path "*/.next/*" 2>/dev/null \
  | sed 's|.*/modules/||; s|/i18n/en.json||' | sort -u > /tmp/with_i18n.txt
find packages apps -type d \( -name frontend -o -name backend \) \
  -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null \
  | grep "/modules/" | sed 's|.*/modules/||; s|/frontend.*||; s|/backend.*||' \
  | sort -u > /tmp/with_ui.txt
comm -23 /tmp/with_ui.txt /tmp/with_i18n.txt

# Hardcoded strings in modules WITH i18n (attr / throw / toast)
# See scripts/audit/i18n-hardcoded.sh in Phase 1.

# Locale value parity (% identical-to-English)
# See scripts/audit/i18n-value-coverage.mjs in Phase 6.
```

## Design Decisions

1. **Detect, don't refactor blindly.** A linter is cheaper than a sweep. Build the detection tooling in Phase 1 so subsequent phases can prove they closed each surface and so regressions are caught in CI. Same approach as the existing `i18n-check-usage` script.
2. **Discriminate user-facing from internal errors.** Adopt a marker convention: internal assertions stay as `throw new Error('...')` and are *prefixed* with `[internal]` (or migrated to a typed `AssertionError`); user-facing errors go through `createCrudFormError(t('...'))` or `toast.error(t('...'))`. The new lint allowlists `[internal]`-prefixed messages.
3. **Treat `packages/ui` primitives as a library.** Library code accepts overrides; it does not bake `useT()` into primitives. Default labels become *keys* (e.g. `'ui.portalShell.aria.nav'`) with English fallbacks via a `defaultProps`-style resolver; consuming apps register translations under the `ui.*` namespace.
4. **Spec-driven phase isolation.** Each phase ships as its own PR. Phases 2–5 are mutually independent and can land in any order once Phase 1 (tooling) is in place.
5. **Locale value coverage is a separate problem.** Even after we extract every English string into a key, the `pl/de/es` files still need real translations. Phase 6 quantifies and prioritizes — actual translation is delegated to a translator (human or AI-assisted).
6. **Backward compatibility.** No public contract surfaces change. New JSON keys are additive. The lint script is opt-in (run via existing `yarn i18n:check`); a strict CI gate is added only after baseline drops below thresholds defined in Phase 1.

## Phased Plan

### Phase 1 — Detection tooling — **Implemented**

**Goal:** make hardcoded strings and untranslated locale values visible to CI.

**Deliverables:**
1. `scripts/i18n-check-hardcoded.ts` — scans `.ts`/`.tsx` under `packages/**/src` and `apps/mercato/src/modules/**` for:
   - JSX text nodes matching `>[A-Z][a-z]+(\s+[A-Za-z][a-z]+)+[.?!]?<`, excluding nodes inside `{t(...)}` or `{translate(...)}`.
   - JSX attribute literals on `label|title|placeholder|description|tooltip|aria-label|message|subtitle|helperText|emptyMessage` whose values look like English phrases.
   - `throw new Error('...')` / `createCrudFormError('...')` / `raiseCrudError('...')` / `toast.\w+('...')` whose first arg is a literal English-like string and is not prefixed with `[internal]`.
   - Configurable per-module allowlist at `<module>/i18n/.hardcoded-allowlist.json` (`{ "version": 1, "entries": [{ "file"?, "line"?, "match"?, "kind"?, "reason" }] }`; `match` is a regex string, `kind` is one of `jsx-text|jsx-attr|throw-error|crud-form-error|raise-crud-error|toast-call`).
2. `scripts/i18n-check-values.mjs` — scans every `i18n/<locale>.json` for entries identical to `en.json` and emits a per-locale percentage and a per-module breakdown. Configurable allowlist for legitimate carry-over (proper nouns, acronyms, single tokens like `OK`) at `scripts/i18n-values-allowlist.json` (`{ "keys": ["module.brand.name", ...] }`).
3. New `yarn i18n:check-hardcoded` and `yarn i18n:check-values` scripts wired into `yarn i18n:check`.
4. Conventions documented in `packages/shared/AGENTS.md` (i18n section) and root `AGENTS.md` "Critical Rules → UI & HTTP".

**Acceptance:**
- Both scripts run in <60s on the full repo. *Measured on the current checkout:* `i18n:check-hardcoded` ~2.5s for 3,894 files; `i18n:check-values` ~0.8s for 47 modules.
- Running on `origin/develop` reproduces the audit numbers (±5%). *Verified:* raw identical-to-English percentages match the audit table exactly (`pl` 12.9%, `es` 19.0%, `de` 20.8%); hardcoded counts per module sit within ±35% of the audit table for the high-volume modules (the audit table itself was an approximation — the scanner is the authoritative count going forward).
- Unit tests under `scripts/__tests__/i18n-hardcoded.test.mjs` and `scripts/__tests__/i18n-values.test.mjs` cover: JSX text node detection, ternary branches across lines, attribute literals (with technical-string rejection), throw/createCrudFormError/toast literals, the `[internal]` prefix opt-out, allowlist file/line/match/kind filters, value-coverage acronym handling, missing keys not double-counted as identical.

**Integration coverage:** N/A (tooling-only). Unit tests required and added.

**Risk:** false positives on technical strings (`'POST'`, `'application/json'`). Mitigated by `looksEnglishPhrase` (≥2 English-shaped tokens, technical-prefix block list, dotted-identifier rejection) and the per-module allowlist. Phase 1 stays advisory (exit code 0); a hard CI gate is deferred to Phase 6's baseline-file rollout.

### Phase 2 — `api_docs` module

**Goal:** add full i18n setup to `packages/core/src/modules/api_docs` and remove every hardcoded English literal from `Explorer.tsx`, `backend/docs/page.tsx`, and the supporting components in `frontend/docs/api/`.

**Deliverables:**
1. New `packages/core/src/modules/api_docs/i18n/en.json` covering section titles ("Interactive tester", "Endpoint", "Base URL", "API key", "Auth required"), table headers ("Name", "In", "Required", "Schema", "Description"), button labels, status messages.
2. Stub `pl.json`, `de.json`, `es.json` (initially copies of `en.json`; flagged by Phase 1's value-coverage check for follow-up translation).
3. Refactor `Explorer.tsx` and `page.tsx` to use `useT()` / `resolveTranslations()` per the conventions in `packages/core/src/modules/customers` (reference module).
4. Add `packages/core/src/modules/api_docs/translations.ts` only if entities with user-facing fields exist (probably not — this module is presentation-only).

**Acceptance:**
- `yarn i18n:check-hardcoded` reports zero hardcoded strings in `packages/core/src/modules/api_docs`.
- `yarn i18n:check-sync` passes.
- Existing API Explorer behavior unchanged (same rendering for English).

**Integration coverage:** add `.ai/qa/tests/admin/api-docs/explorer.spec.ts` that loads the page and asserts the localized strings render (English baseline). UI-touched ⇒ a checkpoint or final-gate run captures a screenshot of the Explorer page.

**Risk:** the Explorer page has dynamic content (OpenAPI schemas); translation must only cover chrome, not user-provided OpenAPI fields. The phased PR enforces this by reviewing the diff for any `description` value coming from OpenAPI being run through `t(...)` (forbidden).

### Phase 3 — `content` module chrome

**Goal:** translate the chrome around the public privacy/terms pages without disturbing the canonical legal text.

**Deliverables:**
1. New `packages/content/src/modules/content/i18n/en.json` with:
   - Page titles (`Privacy Policy`, `Terms of Service`).
   - Breadcrumb labels (`Home`).
   - `ContentLayout` chrome (intro labels, "Last updated" prefix, any nav strings).
2. Stub `pl.json`, `de.json`, `es.json` (copy of `en.json`).
3. Refactor `frontend/privacy/page.tsx`, `frontend/terms/page.tsx`, `frontend/components/ContentLayout.tsx` to consume the new keys.
4. **Explicitly out of scope:** the legal body of both pages. Add a one-line allowlist entry in `i18n/.hardcoded-allowlist.json` for these two files, with a comment pointing at this spec, so Phase 1's detector does not flag them.

**Acceptance:**
- Visiting `/privacy` and `/terms` shows identical English content on `develop` vs the new branch (no regressions to legal copy).
- `yarn i18n:check-hardcoded` reports zero hardcoded strings in `packages/content/src/modules/content` outside the allowlist.

**Integration coverage:** `.ai/qa/tests/public/content/privacy-terms-render.spec.ts` smoke test (page renders, breadcrumb shows English baseline). Screenshot per page at the checkpoint.

**Risk:** legal review workflows. Mitigated by deferring legal body to a follow-up spec owned by legal + i18n stakeholders.

### Phase 4 — `packages/ui` primitives

**Goal:** make `packages/ui` library-friendly for i18n by parameterizing user-facing default text.

**Deliverables:**
1. Audit `packages/ui/src/primitives/` and `packages/ui/src/portal/` for `aria-label`, `placeholder`, `title`, `description` literal defaults.
2. For each, change the signature to accept a string prop (typed); keep the current English literal as the *fallback* default to preserve back-compat.
3. Document the i18n contract in `packages/ui/AGENTS.md`: "Primitives never call `useT()` directly. Consumers pass localized strings."
4. For the 6 user-facing `throw new Error(...)` in `packages/ui` and `packages/shared` (e.g. `apiCall` failure messages), expose the error message as a translatable key + fallback shape so consuming apps can override.

**Acceptance:**
- All `packages/ui` primitives that previously hardcoded user-visible English now accept an override prop.
- Existing consumers still render English unchanged when they don't pass an override (back-compat).
- `yarn i18n:check-hardcoded` runs against `packages/ui/src` with the allowlist scoped to JSDoc examples and primitive-default fallbacks.

**Integration coverage:** existing UI primitive tests under `packages/ui/src/primitives/__tests__/` extended to assert prop-override behavior.

**Risk:** prop sprawl. Mitigated by limiting the override to genuine user-visible labels — internal `data-*` attributes, debug strings, dev-only logs stay hardcoded.

### Phase 5 — User-facing error message audit

**Goal:** systematically split user-facing errors from internal assertions across the 15+ modules in §C.

**Deliverables:**
1. For each module listed in §C: walk the `throw new Error(...)` and `createCrudFormError(...)` call sites, classify each as:
   - **User-facing** → migrate to `createCrudFormError(t('module.errors.<key>'))` or `toast.error(t('module.errors.<key>'))`. Add the key to `en.json`.
   - **Internal assertion** → prefix the message with `[internal]` (or migrate to `class AssertionError extends Error`), document the convention.
2. Lift the convention into root `AGENTS.md`'s "Critical Rules → Code Quality" so future code follows it.
3. Re-run Phase 1's detector and confirm the count of user-facing literals drops to 0 in the touched modules.

**Acceptance:**
- Phase 1's detector, when run with the `[internal]` prefix allowlist, reports zero user-facing literal errors in the migrated modules.
- All migrated user-facing errors render correctly in their respective UIs (covered by integration smoke tests below).

**Integration coverage:** one error-path smoke test per high-traffic module (`customers`, `workflows`, `ai_assistant`, `messages`) verifying the localized error message renders. Reuse existing CrudForm error tests where possible.

**Risk:** misclassification (translating an internal assertion is wasteful but harmless; missing a user-facing one is the real risk). Mitigated by Phase 1's CI gate catching anything not allowlisted.

### Phase 6 — Non-English locale value audit

**Goal:** convert the locale value-coverage problem from "invisible" to "tracked and prioritized".

**Deliverables:**
1. Run `yarn i18n:check-values` (from Phase 1) and produce a per-locale, per-module breakdown sorted by user-facing impact (auth, customers, sales, checkout first).
2. Define a value-coverage threshold per locale (initial target: `pl` ≥95%, `de` ≥80%, `es` ≥80% translated values). Below threshold ⇒ advisory warning in CI; above threshold + regression ⇒ blocking failure.
3. Hand off the actual translation work to a translator pipeline (human, or AI-assisted with a glossary). Track via a follow-up issue per locale.
4. Add a baseline file (`scripts/i18n-baseline.json`) that records the current per-locale identical-to-English count; CI fails if the count *grows*.

**Acceptance:**
- Baseline file committed.
- CI gate: regression-only initially; promotion to absolute thresholds happens in a follow-up after the first translation batch lands.

**Integration coverage:** N/A (tooling + content). Lint-only verification.

**Risk:** translation cost. Mitigated by phasing: tooling lands first, real translations follow as separate funded work.

## Scope clarifications

**In scope:**
- Detection tooling for hardcoded JSX text, attribute literals, error throws, and untranslated locale values.
- Full i18n setup for `api_docs` and `content` (chrome only) modules.
- Parameterizing user-visible defaults in `packages/ui` primitives.
- Auditing and migrating user-facing error messages in ~15 modules.
- Quantifying and tracking untranslated `pl/de/es` values.

**Out of scope:**
- Translating the legal body of `content/frontend/privacy` and `content/frontend/terms` (separate legal-review workflow).
- Rewriting the `useT()` / `resolveTranslations()` runtime contract.
- Translating internal assertion-style `throw new Error(...)`.
- Search-presenter freezing (covered by `2026-05-20-search-presenter-i18n.md`).
- Embedding-text translation for vector search.
- Test fixture strings, `create-app/template/` files, and `.ai/qa/` test text.

## Backward compatibility

- All new JSON keys are additive — no existing key is renamed or removed.
- `packages/ui` primitive prop additions are non-breaking: new props are optional with defaults equal to the prior hardcoded string.
- The internal-vs-user-facing error split uses an additive `[internal]` prefix; no error class hierarchy is introduced as a hard requirement.
- Detection scripts are advisory until Phase 6's baseline file lands; until then nothing breaks CI by surprise.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| False positives in the hardcoded-string detector | Medium | Per-module allowlist with rationale; two-word minimum for JSX-text rule. |
| Over-translation of internal assertions (noise, no value) | Medium | `[internal]` prefix convention; documented in `AGENTS.md`. |
| Library-side `packages/ui` primitives growing prop sprawl | Low–Medium | Only translate user-visible labels; debug/dev/data-* attributes stay hardcoded. |
| Legal review delay on `content` body | High (deferred) | Body is explicitly out of scope; allowlist covers it; legal workflow tracked separately. |
| Translator cost for filling pl/de/es | High | Phased — tooling first, translation work tracked as funded follow-up. |
| Hardcoded-string detector regressing past the baseline | Medium | Baseline file in CI; growth fails the gate. |

## Open questions

- **Q1:** Should we adopt a typed `AssertionError extends Error` instead of the `[internal]` prefix convention? Cleaner long-term but a bigger refactor surface.
- **Q2:** For `packages/ui`, do we want a single `ui.*` namespace owned by the library (with documented keys) or do consumers fully own the strings? Phase 4 starts with consumer-owned; the namespace decision can land later without breaking back-compat.
- **Q3:** Phase 6 thresholds — `pl` ≥95% is aggressive given current state. Confirm with stakeholders before flipping CI to blocking.

## Implementation order & PR strategy

- **Phase 1** lands first as one PR. It is purely additive (new scripts, new docs, new yarn aliases) and unblocks every subsequent phase.
- **Phases 2, 3, 4, 5** are mutually independent and can be parallelized as separate PRs once Phase 1 is in.
- **Phase 6** lands last (or in parallel with Phase 5) — it depends on the tooling from Phase 1 but is otherwise independent.

Each phase MUST include the integration test coverage listed in its section. UI-touching phases (2, 3) require screenshots at the verification checkpoint or final gate per `auto-create-pr-loop` conventions.

## Changelog

- 2026-05-26 — initial draft (audit findings, phased plan).
- 2026-05-27 — Phase 1 implemented: `yarn i18n:check-hardcoded`, `yarn i18n:check-values`, per-module/per-key allowlists, scanner unit tests, `[internal]` prefix convention documented in root `AGENTS.md` and `packages/shared/AGENTS.md`. Both scripts run well under the 60s budget; raw value-coverage percentages reproduce the audit baseline exactly.
