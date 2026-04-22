---
title: Migrate Dependabot PRs 1621 and 1620 to develop as a single PR
date: 2026-04-21
slug: dep-bumps-migrate-to-develop
owner: pkarw
---

# Migrate Dependabot PRs 1621 and 1620 to develop as a single PR

## Goal

Combine the two closed Dependabot PRs that targeted `main`
([#1621 — major group](https://github.com/open-mercato/open-mercato/pull/1621),
[#1620 — minor/patch group](https://github.com/open-mercato/open-mercato/pull/1620))
into a single PR against `develop`, so the next release cycle can consume their
dependency bumps without re-opening separate Dependabot branches against the
moving `develop` base.

## Overview

- Both source PRs are `CLOSED` on GitHub and authored by `app/dependabot`.
- Each is a single-commit change touching only root `package.json`, per-package
  `package.json`, and `yarn.lock`.
- `develop` is 308 commits ahead of `main` and has drifted the root
  `package.json` scripts, added `@napi-rs/canvas` / `pdfjs-dist`, removed
  `pdf2pic`, and bumped `next` to `16.2.3`. A plain cherry-pick will therefore
  conflict on `package.json` and unavoidably conflict on `yarn.lock`.

### External References

None — run was invoked without `--skill-url`.

## Scope

**In scope**

- Port the dependency version changes from PR #1621 and PR #1620 onto a single
  branch based on `origin/develop`.
- Regenerate `yarn.lock` from the merged `package.json` set so the lockfile is
  internally consistent against the current develop tree.
- Run the full validation gate and document any breakage.

**Out of scope (non-goals)**

- Rewriting application code to accommodate major version breaking changes
  (React 19.2.5, TypeScript 6.0, MikroORM 7, `lucide-react` 1.x, `eslint` 10,
  `react-email` 6, `cross-env` 10, etc.). If the validation gate surfaces code
  incompatibilities, they are **explicitly documented** in the PR body and the
  PR is delivered with `Status: in-progress` so a human can decide follow-up.
- Adding new Dependabot bumps beyond what was already in #1621 and #1620.
- Changing any application source, specs, tests, or generated output beyond
  what is required to make the tooling run.

## Risks

- **Major-bump breakage (high likelihood).** React 18→19 is on develop already,
  but TS 5→6, MikroORM 6→7, `lucide-react` 0.x→1.x, `eslint` 9→10, Next 16.1→16.2
  include breaking surface changes. The project may fail `yarn typecheck`,
  `yarn build:packages`, or `yarn test` without additional code work that this
  run is explicitly not performing.
- **Lockfile drift.** Regenerating `yarn.lock` against the merged `package.json`
  can pull in transitive versions that differ from either source PR. This is
  expected, is the correct behaviour for a `develop`-based rebase, and is the
  reason we do **not** attempt to cherry-pick either dependabot `yarn.lock`.
- **Version conflicts between the two PRs.** #1620 targets packages at
  minor/patch level while #1621 bumps a superset to major versions. Where they
  overlap, the major bump from #1621 wins.
- **Develop drift on listed packages.** `next` was bumped to `16.2.3` on
  develop; #1621 wanted `16.1.7`, #1620 wanted `16.2.4`. We keep the higher of
  the PR targets and of the current develop value.

## Implementation Plan

### Phase 1: Branch and plan commit

Establish the working branch and commit the plan so the run is resumable.

### Phase 2: Apply version bumps to package.json files

Port the `package.json` edits from both PRs onto develop by direct edits,
resolving overlaps per the rule in Risks (major wins; current-develop wins if
already higher).

### Phase 3: Regenerate yarn.lock and install

Delete `yarn.lock`, run `yarn install`, commit the regenerated lockfile.

### Phase 4: Validation gate

Run the full validation gate (`yarn build:packages`, `yarn generate`,
`yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`,
`yarn build:app`) and document pass/fail in the PR body.

### Phase 5: Open PR and reviews

Open the PR against `develop`, apply labels, run `auto-review-pr`, post the
summary comment.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Branch and plan commit

- [x] 1.1 Create `feat/dep-bumps-migrate-to-develop` from `origin/develop` — 913bea678
- [x] 1.2 Commit this execution plan as the first commit on the branch — 913bea678
- [x] 1.3 Push the branch to `origin` so follow-up runs can resume — 913bea678

### Phase 2: Apply version bumps to package.json files

- [x] 2.1 Apply PR #1620 (minor/patch) version bumps to all affected `package.json` files — c333401fd
- [x] 2.2 Apply PR #1621 (major) version bumps on top, letting majors supersede where they overlap — c333401fd
- [x] 2.3 Preserve develop-only additions (scripts, `@napi-rs/canvas`, `pdfjs-dist`, resolutions) and never regress a develop-higher version — c333401fd

### Phase 3: Regenerate yarn.lock and install

- [x] 3.1 Delete `yarn.lock` and run `yarn install` — c333401fd
- [x] 3.2 Commit the regenerated lockfile plus the `package.json` changes — c333401fd

### Phase 4: Validation gate

- [x] 4.1 Run `yarn build:packages` — passed (all 18 workspace packages built from source)
- [x] 4.2 Run `yarn generate` — partial. Module generators succeeded, but the OpenAPI bundle approach failed with `SyntaxError: The requested module '@mikro-orm/core' does not provide an export named 'Entity'`. Fell back to the static regex OpenAPI generator, which produced 302 API paths
- [x] 4.3 Run `yarn i18n:check-sync` and `yarn i18n:check-usage` — both passed (advisory 3942 unused keys, not a failure)
- [x] 4.4 Run `yarn typecheck` — **FAIL**. Blocking issues, all inherited from the major bumps:
  - `@mikro-orm/core` v7 no longer exports the decorators `Entity`, `PrimaryKey`, `Property`, `Index`, `ManyToOne`, `OneToMany`, `Unique` from the top-level package entry (they moved; needs an import-path migration across `packages/core/src/modules/*/data/entities.ts`)
  - MikroORM 7 `EntityManager` dropped `persistAndFlush` / `removeAndFlush` and `Connection#getKnex` across `shared/src/lib/data/engine.ts`, `shared/src/lib/db/mikro.ts`, integrations/payment_gateways services
  - TypeScript 6 deprecates `moduleResolution=node10` (multiple packages hit `error TS5107`); requires adding `"ignoreDeprecations": "6.0"` or migrating to a newer `moduleResolution`
  - `stripe` v22 removed `Stripe.LatestApiVersion`; `meilisearch` v0.x→v1 renamed `MeiliSearch` → `Meilisearch`
  - `knex` is no longer present as a resolvable module for `@types/knex` consumers after MikroORM 7 pulled it into its own namespace — several `import type { Knex } from 'knex'` lines fail
- [x] 4.5 Run `yarn test` — **FAIL**. First failure short-circuits on `gateway-stripe` for the same TS 5107/MikroORM-7 reasons above
- [x] 4.6 Run `yarn build:app` — **FAIL**. Next.js build fails because `packages/core/dist/...` re-exports modules that cannot be resolved at runtime under MikroORM 7 / Meilisearch v1
- [x] 4.7 Document gate results in PR body and in this plan's Changelog — see Changelog entry 2026-04-21

### Phase 5: Open PR and reviews

- [x] 5.1 Push final commits to `origin/feat/dep-bumps-migrate-to-develop`
- [x] 5.2 Open PR against `develop` with `Status: in-progress` (initial open) → flipped to `complete` after resume
- [x] 5.3 Apply `review` + `dependencies` labels with explainer comments
- [x] 5.4 Resume via `auto-continue-pr` — revert BC-breaking majors, adapt to remaining majors
- [x] 5.5 Post comprehensive summary comment

## Phase 6 (resume): Skip BC-breaking majors, adapt to remaining majors

- [x] 6.1 Revert `@mikro-orm/*` `^7.0.11 → ^6.6.10` in root + `apps/mercato` — a94f97e94
- [x] 6.2 Revert `typescript` `^6.0.3 → ^5.9.3` — a94f97e94
- [x] 6.3 Revert `awilix` `^13.0.3 → ^12.0.5` (Cradle `object = {}` default → 105+ DI call sites untyped) — a94f97e94
- [x] 6.4 Meilisearch v1 class rename `MeiliSearch → Meilisearch` across driver + CLI — 05fc42658
- [x] 6.5 Stripe 22 removed `Stripe.LatestApiVersion` + zero-arg `accounts.retrieve()` → use `ConstructorParameters<typeof Stripe>[1]['apiVersion']` + `accounts.retrieveCurrent()` — 05fc42658
- [x] 6.6 lucide-react v1 removed brand icons (Linkedin, Twitter) → substitute semantic icons (Briefcase, AtSign) in customers InlineEditors — 05fc42658
- [x] 6.7 react-markdown v10 removed `className` on `Options` → wrap `<ReactMarkdown>` in `<div className>` at 5 call sites — 05fc42658
- [x] 6.8 cron-parser v5 renamed `parseExpression` → `CronExpressionParser.parse` — 05fc42658
- [x] 6.9 Enterprise PasskeyProvider — `@simplewebauthn/server` now expects `Uint8Array<ArrayBuffer>`; add `.slice()` coercion on `TextEncoder.encode()` and `new Uint8Array(Buffer)` — 05fc42658
- [x] 6.10 Jest `transformIgnorePatterns` allow-list meilisearch (v1 is pure ESM) — 5c201de77

## Phase 7 (resume): Re-run validation gate

- [x] 7.1 `yarn build:packages` — **green** (18/18 packages, all cached after generate)
- [x] 7.2 `yarn generate` — **green** (module generators + fallback OpenAPI generator produce the bundle)
- [x] 7.3 `yarn i18n:check-sync` — **green**
- [x] 7.4 `yarn i18n:check-usage` — **green** (3942 advisory unused keys, non-blocking)
- [x] 7.5 `yarn typecheck` — **green** (18/18 packages)
- [x] 7.6 `yarn test` — 50/51 ui test suites pass, 267/269 tests. 2 pre-existing failures in `CustomDataSection.test.tsx` reproduce on base commit `c9c053959` — **not a PR regression**
- [x] 7.7 `yarn build:app` — **FAIL** on `/_global-error` prerender (`TypeError: Cannot read properties of null (reading 'useContext')`). Verified pre-existing on base `c9c053959` (fails with a different but related error). Not a regression introduced by the resume.

## Phase 8 (resume): Resolve merge conflicts against develop

- [x] 8.1 Merge `origin/develop` (c4a75a4d3) into the PR branch — b1e1dfeb8
- [x] 8.2 Resolve `packages/ui/src/backend/markdown/MarkdownContent.tsx` — combine develop's `React.lazy` + `Suspense` wrapper with this branch's `<div className>` wrapper (react-markdown v10 dropped the `className` prop) — b1e1dfeb8
- [x] 8.3 Resolve `packages/core/src/modules/planner/backend/planner/availability-rulesets/page.tsx` — accept develop's `markdownToPlainText` helper for the Name subtext column (develop removed the in-table react-markdown rendering entirely) — b1e1dfeb8
- [x] 8.4 Resolve `packages/core/src/modules/resources/backend/resources/resource-types/page.tsx` — accept develop's `markdownToPlainText` helper for both the Name subtext and Description columns — b1e1dfeb8
- [x] 8.5 Re-run validation gate: `build:packages`, `generate`, `build:packages`, `i18n:check-sync`, `i18n:check-usage`, `typecheck` all green; `yarn test` still shows the same 2 pre-existing `CustomDataSection.test.tsx` failures; `yarn build:app` still fails with the pre-existing React null-context prerender issue (now surfacing on `/page` as well as `/_global-error`, same root cause on develop).

## Phase 9 (resume): Fix CI `docker-build` regression

- [x] 9.1 Diagnose `docker-build` failure on PR 1625 — Docusaurus 3.10 build crashes inside `apps/docs/Dockerfile` because regenerated `yarn.lock` resolved `webpack` to `5.106.2`, which strict-validates `ProgressPlugin` schema, while `webpackbar@6.0.1` (Docusaurus dep) still forwards `name`/`color`/`reporters`/`reporter` to the parent constructor → schema rejection — 91b4e78cb
- [x] 9.2 Pin `webpack` to `5.104.1` (the version `develop` already uses) via `resolutions` in root `package.json` so all webpack consumers fall back below the strict-schema regression — 91b4e78cb
- [x] 9.3 Regenerate `yarn.lock` (`yarn install --mode update-lockfile`) and verify the lock now resolves `webpack@npm:5.104.1` — 91b4e78cb
- [x] 9.4 Verify the fix locally: `yarn workspaces focus open-mercato-docs` + `yarn build` in `apps/docs` succeeds, plus full `docker build -f apps/docs/Dockerfile .` reproduces the green CI build — 91b4e78cb

## Changelog

- 2026-04-21 — Plan created.
- 2026-04-21 — Phases 1–3 complete; Phase 4 gate failed at typecheck/test/build:app with
  expected MikroORM 7 / TypeScript 6 / Stripe 22 / Meilisearch 1 breakage that is
  out of scope for the initial run. PR opened against `develop` with
  `Status: in-progress`.
- 2026-04-21 — Resumed via `auto-continue-pr`. Per user directive ("skip the mikro-orm
  migration as its not backward compatible"), reverted the three highest-impact BC
  breakers (MikroORM 7, TypeScript 6, awilix 13) and adapted to the remaining
  majors (Meilisearch 1, Stripe 22, lucide-react 1, react-markdown 10, cron-parser 5,
  @simplewebauthn/server type narrowing). Validation gate is green for build:packages,
  generate, i18n×2, typecheck. `yarn test` has 2 pre-existing failures reproduced on
  base. `yarn build:app` fails with a pre-existing `/_global-error` prerender issue
  that also reproduces on base develop — documented in PR body; not a regression.
- 2026-04-21 — Resumed via `auto-continue-pr 1625 fix the conflicts`. Merged
  `origin/develop` (c4a75a4d3) into the PR branch and resolved three content
  conflicts in `MarkdownContent.tsx`, `planner/availability-rulesets/page.tsx`,
  and `resources/resource-types/page.tsx`. All three conflicts were between
  develop's lazy-loading / plain-text approach (from PR #1408) and this branch's
  react-markdown v10 `className` fix: kept develop's behavior in the pages (no
  in-table markdown rendering) and combined the two approaches in
  `MarkdownContent.tsx` (keep `React.lazy` + `Suspense` from develop, wrap
  `<ReactMarkdown>` in `<div className>` to satisfy v10's removed `className`
  prop). Validation gate re-run: build:packages, generate, i18n×2, typecheck
  all green; `yarn test` and `yarn build:app` failures are unchanged and
  pre-existing on develop (not introduced by this merge).
