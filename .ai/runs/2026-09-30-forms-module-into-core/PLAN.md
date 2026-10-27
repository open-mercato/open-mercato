# Plan — migrate the official `forms` module into `@open-mercato/core`

Source spec: `.ai/specs/2026-09-30-forms-module-into-core.md`
Source repo: `open-mercato/official-modules@d694a75`, `packages/forms/src/modules/forms` (branch `develop`)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Vendor the module verbatim into `packages/core/src/modules/forms/` + add the 3 missing prod deps (`ajv`, `ajv-formats`, `pdf-lib`) | inline | done | d280fb625 |
| 1 | 1.2 | Shared brief for the investigation tasks | inline | done | 4bccb2299 |
| 1 | 1.3 | Register `forms` in `apps/mercato/src/modules.ts`; fix the `@tanstack/react-table` v8→v9 `ColumnDef` drift (4 files, 28 typecheck errors) | inline | done | 5df50543b |
| 1 | 1.4 | Supply the 12 locale keys the module referenced but never shipped; generate `ko.json`; fix the ending-screen badge labelled with the submit-action key | inline | done | 2b0006431 |
| 1 | 1.5 | Detailed orders for the review tasks | inline | done | f3bfb9ed0 |
| 1 | 1.6 | Declare the module's injection hosts (`extension-points.ts`) so `assertNoUnresolvedExtensionTargets` resolves them; drop the dangling `forms:embed` mapping | inline | done | 21ee6c533 |
| 1 | 1.7 | Regenerate `packages/ui`'s committed lucide registry for the 12 Form Studio palette icons | inline | done | ad2ba4b48 |
| 1 | 1.8 | Spec + this run folder | inline | done | 80bdc5945 |
| 2 | 2.1 | Apply the MUST/SHOULD items from the host-wiring audit + the test-plan findings (command registration, cross-tenant read, subject-route URL, nav-group key, ZodError 400, embed docs) | inline | done | 3cd1d19be |
| 2 | 2.2 | Apply the Critical/High items from the security review (C1 cross-tenant anonymize, C2 unsliced submission reads, H1 javascript: redirect XSS, H2 submit actor gate) | inline | done | af6ce65af |
| 2 | 2.3 | Apply the DS-review findings that are real defects (21 no-op status tokens, 55 raw-key flash toasts); structural reuse deferred to follow-up | inline | done | 0cd51a9fb |
| 3 | 3.1 | Author the P0 forms integration suite and make it green — 44 specs, 40 pass live, 4 browser-only blocked by missing system libs | dispatch | done | 8df28d09b |
| 3 | 3.2 | Open the PR against `develop` with pipeline labels — #6770, draft | inline | done | 75bb4a798 |
| 3 | 3.3 | Exploratory QA — browser BLOCKED (no Chromium system libs, no root); did HTTP-level QA on a live stack instead and verified 4 fixes end to end | inline | done | 8df28d09b |
| 3 | 3.4 | `om-code-review` pass over the whole branch; fix findings | dispatch | done | 8df28d09b |
| 3 | 3.5 | Final full validation gate (`--continue`, raised heap) + QA evidence | inline | todo | |

## Goal

Move the `forms` module out of the separate `official-modules` repository and into this monorepo as
a first-class module of `@open-mercato/core`, with integration coverage, a browser-QA pass and a
code review — so the platform owns the questionnaire/form primitive directly instead of shipping it
as an optional external submodule.

## Scope

- `packages/core/src/modules/forms/` — the vendored module (~301 files, ~59k lines): `acl.ts`,
  `api/` (~50 routes including the anonymous `api/public/**` tree), `backend/` pages including the
  drag-and-drop Form Studio, `frontend/` public + `[orgSlug]/portal/**` pages, `commands/`,
  `data/`, `di.ts`, `encryption.ts`, `events.ts`, `i18n/`, `lib/`, `migrations/`, `runner/`,
  `schema/`, `services/`, `setup.ts`, `subscribers/`, `translations.ts`, `ui/`, `widgets/`,
  `workers/`, `__tests__/`.
- `packages/core/package.json` — `ajv`, `ajv-formats`, `pdf-lib`.
- `apps/mercato/src/modules.ts` — the `forms` module entry.
- `packages/ui/src/backend/icons/lucideRegistry.generated.tsx` — regenerated for the Studio palette.
- `.ai/specs/2026-09-30-forms-module-into-core.md`, `.ai/analysis/forms-*`, this run folder.

## Non-goals

- **Removing `packages/forms` from `official-modules`.** That is a different repository and
  therefore a different PR. Until it happens the module exists in both places; the official-modules
  copy is inert here because this repo's `external/official-modules` submodule is not checked out
  and `official-modules.json` does not activate it.
- **Rewriting the module.** The migration preserves behaviour. Changes are confined to what this
  repo's contracts, gates and conventions actually require, plus defects those gates expose.
- **Re-specifying the feature.** The module's own design specs live in the source repo
  (`2026-05-21-forms-render-surfaces.md` and siblings); this spec covers the *migration*.

## Execution notes

- `export TMPDIR=/tmp` before any tsx-backed yarn script, and run the suite as
  `yarn test --env-mode=loose`. turbo 2 declares only `globalEnv: ["NODE_ENV"]`, so `TMPDIR` is
  stripped and several `packages/cli` suites then resolve a temp dir *inside* the monorepo and
  assert the wrong environment mode.
- `yarn build:packages` does not refresh `packages/ui`'s lucide registry (turbo caches the ui build
  because ui's own inputs are unchanged). Use `node packages/ui/build.mjs`.
- Pre-existing local-only failures, unrelated to this branch: `packages/cli`
  `module-package-sources.test.ts` (asserts `mtimeMs` equality, gets `…813.999` vs `…814`) and
  `open-mercato-docs#test` under memory pressure (it runs a full Docusaurus build).
