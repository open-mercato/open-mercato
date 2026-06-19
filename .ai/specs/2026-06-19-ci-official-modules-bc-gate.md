# CI Backward-Compatibility Gate for `official-modules`

## TLDR
**Key Points:**
- Add a CI safety net that detects, *inside an open-mercato PR*, when a change to a `@open-mercato/*` package breaks the contract the separate `open-mercato/official-modules` consumer repo depends on — before the breakage is found downstream.
- Three complementary layers: **Layer 1** — a fast, repo-local *contract-surface snapshot* test that fails on breaking removals; **Layer 2** — a *build + unit* job that installs the official modules against the PR's canary packages via local Verdaccio and runs their `typecheck` + `test`; **Layer 2b** — a *runtime smoke* job that activates the modules in the official-modules sandbox app, boots it against a real DB, and probes that it serves (health + a few module routes).

**Scope:**
- Layer 1: a versioned `contract-surface.snapshot.json` (exported symbol names + generated registries + `package.json` `exports`/`files`/`types`) and a diff test that runs in the existing `verify` job. Removals fail; additions pass.
- Layer 2: a new `official-modules-bc` CI job — publish PR canary packages to Verdaccio (reuse `scripts/lib/verdaccio.ts` + `scripts/registry/publish.sh`), checkout `official-modules` at a pinned ref, install against the canary registry, run its `typecheck` + `test`.
- Layer 2b: a new `official-modules-runtime-smoke` CI job — install the same canary modules into the official-modules **sandbox app**, activate them, `generate` + `initialize` (migrate + seed) against a Postgres + Redis service, boot the app, and assert `/api/healthz` plus a few activated-module routes return 200. Mirrors the existing `ephemeral-integration` pattern.
- A `touches_contract` change-detection output in the existing `prepare` job, true for **any** `packages/*/src/**` change, to path-gate Layers 2 and 2b.
- A `bcTestRef` field in the committed `official-modules.json`.
- Rollout: Layer 2 advisory (`continue-on-error`) first, then required with a `bc-break-approved` label opt-out.

**Concerns:**
- Cross-repo coupling: testing against `official-modules@main` would turn *their* in-flight breakage into *our* red CI. The pinned-ref strategy is the core mitigation.
- No PR is atomic across the two repos; the gate *detects* breaks, it cannot fix both sides in one PR. Intentional breaks use the deprecation protocol + label opt-out.

## Overview
This spec adds automated backward-compatibility enforcement for the platform's public contract surface, targeted at the real downstream consumer: the `open-mercato/official-modules` repository. Today nothing in CI checks that a change to `@open-mercato/*` keeps the official modules compiling and passing tests — regressions are only discovered later, by hand, when that repo is built (per `AGENTS.md`: "`yarn install` and CI are unchanged" by the submodule, and "No PR is atomic across the two repos").

The audience is platform maintainers shipping changes to `packages/*`, and third-party / official module authors who depend on stable APIs (the contract codified in `BACKWARD_COMPATIBILITY.md`). The benefit: breaking changes surface on the open-mercato PR that causes them, with a clear signal and an explicit, auditable opt-out for intentional breaks.

> **Market Reference**: Two established patterns are combined. (1) The **downstream/consumer smoke test** pattern — publish packages to a throwaway local registry (Verdaccio) and build a real external consumer against them, exactly what `scripts/test-create-app-integration.ts` already does for scaffolded apps. (2) **API-surface snapshotting** — tools like `@microsoft/api-extractor` and `are-the-types-wrong` freeze a package's public surface and fail on breaking diffs. We adopt a lightweight, in-repo variant of (2) that reuses the project's existing snapshot idiom (migration `.snapshot-open-mercato.json`, `structural-contracts.test.ts`) instead of pulling in `api-extractor` now; full signature diffing is deferred (see Alternatives).

## Problem Statement
- `official-modules` consumes `@open-mercato/*` as published dependencies. A removed/renamed export, a repointed `package.json` export subpath, a changed event ID / DI key / ACL feature ID, or a narrowed peer range silently breaks it.
- open-mercato CI never exercises that consumer, so the only feedback loop is a human building the other repo after the fact.
- `BACKWARD_COMPATIBILITY.md` enumerates 13 contract-surface categories and a deprecation protocol, but enforcement is manual (review + `BACKWARD_COMPATIBILITY.md` reading in skills). There is no mechanical gate.

## Proposed Solution

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Three tiers (snapshot → build+unit → runtime smoke) | Each tier catches what the cheaper one cannot. Snapshot: instant, offline, blocks on removals. Build+unit (Layer 2): real install + typecheck + their unit tests — catches semantic/signature/packaging breaks. Runtime smoke (Layer 2b): boots the sandbox with modules activated — catches breaks that compile and unit-pass but blow up at registration / DI wiring / migration / request time (the gap between "compiles" and "the app actually runs with these modules"). |
| Runtime smoke is its own job, advisory, narrowly gated | Booting an app with a real DB is minutes (not seconds) and inherently more flake-prone than typecheck. Isolating it keeps the cheaper tiers fast and lets it stay advisory longer. |
| Lightweight snapshot (names + registries + `package.json`), not `api-extractor` | No new heavy dev dependency; reuses the existing snapshot idiom; runs in seconds inside `verify`. Signature-level diffing is a clearly-scoped future phase. |
| Verdaccio canary install, not `link:`/workspace resolution | Mirrors how third parties actually consume the packages — catches `exports`/`files`/`types` packaging regressions that linking by directory hides. Reuses `ensureVerdaccioPublished`. |
| Pinned `bcTestRef` in `official-modules.json`, bumped deliberately | Prevents upstream churn from turning into false reds on open-mercato PRs. One source of truth for everything about the official-modules submodule. |
| Trigger Layer 2 on **any** `packages/*/src/**` change | Maximum safety; the contract surface spans more than the core packages, and the path-gate already skips the ~majority of PRs (docs/CI/scripts/app-only). |
| Advisory → required with `bc-break-approved` opt-out | The two-repo flow is not atomic; a hard block on day one would dead-end intentional, protocol-following breaks. Advisory first calibrates flakiness; the label is the auditable escape hatch. |

### Alternatives Considered
| Alternative | Why Rejected (for now) |
|-------------|------------------------|
| `@microsoft/api-extractor` full signature snapshot | Heavier (new dev dep, per-package rollup config, slower). Deferred to a future phase; Layer 2's real `typecheck` already catches signature breaks against the actual consumer. |
| Test against `official-modules@main` (no pin) | Their in-flight work would redden unrelated open-mercato PRs. Pin + deliberate bump removes this. |
| Add `official-modules` as a git submodule checked out in CI | Heavier checkout, couples CI to submodule wiring, and `link:`/workspace resolution would not reflect real published consumption. A plain secondary `actions/checkout` of the public repo is simpler and more faithful. |
| Make Layer 2 required from day one | Chicken-and-egg with the non-atomic two-PR coordination flow; no calibration window for cross-repo flakiness. |

### Layer 1 — Contract-surface snapshot (repo-local, fast, blocking)
A generator collects the **enumerable** contract surface into a committed `contract-surface.snapshot.json`:
- **Exports** — top-level exported symbol *names* per `@open-mercato/*` package, parsed (ts-morph, already used by the generators) from each package's built declaration entry points.
- **Registries** — the generated module registries already validated by `structural-contracts.test.ts`, projected to the BC categories: event IDs, DI keys, ACL feature IDs, widget spot IDs, API routes, notification IDs, CLI commands.
- **Packaging** — each package's `package.json` `exports` map keys, `files`, and `types`.

A test (run in `verify`, after `build-artifacts` are downloaded so declarations + generated files exist) recomputes the live surface and compares it to the committed snapshot:
- The committed snapshot is treated as a **floor**: every name/id/subpath present in it MUST still exist live. **Removal or repoint = FAIL** (breaking). **Addition = pass** (ADDITIVE-ONLY is allowed by `BACKWARD_COMPATIBILITY.md`).
- Intentional breaking changes require following the deprecation protocol and regenerating the snapshot via `yarn bc:snapshot`; the regenerated diff is visible in PR review (same acceptance model as migration snapshots).
- A separate **non-blocking** drift notice warns when live additions are not yet captured in the snapshot ("run `yarn bc:snapshot`"), keeping it current without failing additive PRs.

This requires **no CI YAML change** — it rides `yarn test` / `yarn test:scripts` in the existing `verify` job.

### Layer 2 — Downstream smoke job (cross-repo, faithful, advisory→required)
A new `official-modules-bc` job, `needs: prepare`, gated by `touches_contract`:
1. Checkout open-mercato (the PR), `actions/setup-node@v6` (Node 24), `corepack enable`.
2. Download the `build-artifacts` produced by `prepare` (`packages/*/dist` + generated files) — no second package build.
3. `yarn install --immutable`.
4. Start Verdaccio and publish canary packages — reuse `ensureVerdaccioPublished(rootDir)` (`scripts/lib/verdaccio.ts`) / `scripts/registry/publish.sh`.
5. `actions/checkout@v6` of `open-mercato/official-modules` at `bcTestRef` (read from `official-modules.json`) into `_official`. Public repo → no token.
6. Point `_official` at Verdaccio (`.yarnrc.yml` `npmRegistryServer` + localhost http whitelist) and inject `@open-mercato/*` → exact canary version into its root `resolutions` (`scripts/registry/inject-canary-resolutions.mjs`). Disable immutable installs (lockfile will change).
7. `yarn install` in `_official`.
8. Run its gates: `yarn typecheck` then `yarn test` (both already filter to `turbo run … --filter='./packages/*'`).
9. On failure: post a PR comment naming the failing official module package, the first error, and links to `BACKWARD_COMPATIBILITY.md` + the two-PR coordination flow.

### Layer 2b — Runtime smoke (sandbox boot + health) (cross-repo, advisory)
A new `official-modules-runtime-smoke` job, `needs: prepare`, gated by `touches_contract`. It proves the gap Layer 2 leaves open: *the app actually boots with these modules activated and serves requests.* It mirrors the existing `ephemeral-integration` job (`.github/workflows/ci.yml` line ~448) and reuses the same canary-publish front half as Layer 2:
1. Steps 1–6 of Layer 2 (checkout, artifacts, install, Verdaccio publish, checkout `official-modules@bcTestRef`, point at Verdaccio + inject canary resolutions).
2. Provision a **Postgres + Redis** service (GitHub Actions `services:`, matching the env the ephemeral suite uses).
3. In the official-modules **sandbox app** (`apps/sandbox`): activate the modules under test (the repo's own activation path — `apps/sandbox/src/modules.ts` / `yarn mercato module add`), then `yarn generate`.
4. `yarn initialize` (DB migrate + seed) against the service DB.
5. Boot the app (`next build` + start, or `yarn dev`), wait for readiness.
6. **Probe**: assert `GET /api/healthz` → 200, then hit a small set of activated-module routes (derived from the activation set) and assert they respond (200 / module registered) rather than 404/500.
7. Tear down (services are ephemeral to the job). On failure, the PR comment (shared with Layer 2) names the failing probe + first server-log error.

Scope guardrails: this is a **smoke** probe, not the full official-modules integration suite (that heavier option was explicitly deferred). It checks "boots + serves", not end-to-end module behavior. Health-probe targets are derived from the activated module set, not hand-maintained per module.

### CI wiring
- **`prepare` job**: add a `touches_contract` output computed in the existing change-detection step (one extra grep `^packages/.*/src/` over the same `git diff`). For non-PR pushes (develop/main) it is `true` so post-merge runs still execute.
- **New jobs**: both `official-modules-bc` and `official-modules-runtime-smoke` carry `if: needs.prepare.outputs.touches_contract == 'true'`. Phase 2 / 2b `continue-on-error: true`. Phase 3 promotes **Layer 2** to required and adds `&& !contains(github.event.pull_request.labels.*.name, 'bc-break-approved')` (label opt-out applies to `pull_request`; pushes always run). **Layer 2b stays advisory longer** (its own promotion decision after its flake rate is measured) — it is not coupled to Layer 2's promotion.

## Configuration
- `official-modules.json` gains `"bcTestRef": "<tag-or-sha>"` (e.g. a release tag). Bumped by a deliberate, separate PR — the only thing that advances the pin.
- New script: `yarn bc:snapshot` regenerates `contract-surface.snapshot.json`.
- No new env vars beyond the Verdaccio URL already used by the registry scripts (`VERDACCIO_URL`, default `http://localhost:4873`).

## Migration & Compatibility
- Purely additive to CI and tooling. No DB migration, no runtime/app behavior change, no public API change.
- The first commit must include a freshly generated `contract-surface.snapshot.json` (the initial baseline floor).
- `bcTestRef` should be initialized to a current known-good `official-modules` ref so the very first Layer 2 run is green.

## Implementation Plan

### Phase 1: Layer 1 — contract-surface snapshot (blocking, repo-local)
1. `scripts/contract-surface/collect.ts` — shared collection: exported names per package (ts-morph over built declaration entry points), generated-registry projection (event/DI/ACL/widget/route/notification/CLI), and `package.json` `exports`/`files`/`types`.
2. `scripts/contract-surface/generate-snapshot.ts` + `yarn bc:snapshot` — write `contract-surface.snapshot.json`.
3. `scripts/contract-surface/__tests__/contract-surface.test.ts` — floor diff: removal/repoint fails with a readable diff and remediation hint; addition passes; emit non-blocking drift notice. Plus unit tests for the diff logic (removal fails, addition passes, repointed export fails).
4. Commit the initial `contract-surface.snapshot.json` baseline. Verify it runs inside `verify` (downloaded artifacts present).

### Phase 2: Layer 2 — downstream smoke job (advisory)
1. Add `bcTestRef` to `official-modules.json`, initialized to a known-good ref.
2. `scripts/registry/inject-canary-resolutions.mjs` — read published `@open-mercato/*` name+version, write exact-version `resolutions` into a target repo's root `package.json`. Unit-test the rewrite.
3. Add `touches_contract` output to `prepare`'s change-detection step.
4. Add the `official-modules-bc` job (`continue-on-error: true`): download artifacts → install → Verdaccio publish → checkout `official-modules@bcTestRef` → point at Verdaccio + inject resolutions → install → `typecheck` + `test`.
5. PR-comment-on-failure step (requires `pull-requests: write` scoped to this job — see Security impact).
6. Calibrate over a window of real PRs; record false-red rate.

### Phase 2b: Layer 2b — runtime smoke (advisory)
1. `scripts/official-modules/runtime-smoke.mjs` — given the activated module set, derive the health-probe route list and assert `/api/healthz` + those routes respond. Unit-test the route-derivation against a fixture activation set.
2. Add the `official-modules-runtime-smoke` job (`continue-on-error: true`): Layer 2 front half → Postgres+Redis `services:` → activate modules in `apps/sandbox` → `yarn generate` → `yarn initialize` → boot → probe. Reuse the env contract from the existing `ephemeral-integration` job (JWT secret, etc.).
3. Calibrate flake rate over a window of real PRs; record it. Layer 2b promotion (if ever) is decided independently of Layer 2.

### Phase 3: Promote to required + document
1. Remove `continue-on-error`; add the `bc-break-approved` label opt-out to the job `if:`.
2. Create the `bc-break-approved` repo label; document the gate, the label, and the bump-`bcTestRef` procedure in `BACKWARD_COMPATIBILITY.md`.
3. (Optional) A scheduled advisory job that runs Layer 2 against `official-modules@main` to detect pin drift (the pinned ref falling behind real consumption) without affecting PR status.

### File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `.ai/specs/2026-06-19-ci-official-modules-bc-gate.md` | Create | This spec |
| `scripts/contract-surface/collect.ts` | Create | Collect live contract surface |
| `scripts/contract-surface/generate-snapshot.ts` | Create | `yarn bc:snapshot` generator |
| `scripts/contract-surface/__tests__/contract-surface.test.ts` | Create | Floor diff + unit tests |
| `contract-surface.snapshot.json` | Create | Committed baseline (regenerated only via `yarn bc:snapshot`) |
| `scripts/registry/inject-canary-resolutions.mjs` | Create | Force `@open-mercato/*` → canary in the consumer checkout |
| `scripts/official-modules/runtime-smoke.mjs` | Create | Derive health-probe routes from the activation set + assert boot/serve (Layer 2b) |
| `package.json` | Modify | Add `bc:snapshot` script |
| `official-modules.json` | Modify | Add `bcTestRef` |
| `.github/workflows/ci.yml` | Modify | `touches_contract` output + `official-modules-bc` job + `official-modules-runtime-smoke` job |
| `BACKWARD_COMPATIBILITY.md` | Modify (Phase 3) | Document gate + `bc-break-approved` + bump procedure |

### Testing Strategy
- **Layer 1**: unit tests for the diff (removal→fail, addition→pass, repoint→fail); determinism of the generator (stable ordering).
- **Resolution injector**: unit test the `package.json` rewrite against a fixture.
- **Layer 2b route derivation**: unit test `runtime-smoke.mjs` route-derivation against a fixture activation set.
- **Layer 2 / 2b (jobs)**: validated empirically — the advisory phase IS the test. Acceptance checks: a deliberate throwaway PR that removes a public export must redden Layer 2; a change that compiles but breaks module registration/migration must redden Layer 2b; an additive PR must redden neither. (Manual verification step, recorded on the rollout PR.)

## Risks & Impact Review

### Migration & Deployment Risks
- Additive CI/tooling only; no downtime, no backfill, no app contract change. The baseline snapshot must ship in the same PR as the test, else the test has no floor.

### Operational Risks

#### Upstream churn false-red
- **Scenario**: `official-modules@main` is mid-refactor and broken; testing against it reddens unrelated open-mercato PRs.
- **Severity**: High
- **Affected area**: Layer 2 job; PR merge flow for any `packages/*/src` change.
- **Mitigation**: Test against the pinned `bcTestRef`, advanced only by a deliberate PR. Advisory-first phase. Optional scheduled `main` run is advisory-only.
- **Residual risk**: Pin drift — the pinned ref lags real consumption, weakening coverage. Mitigated by bumping `bcTestRef` at release time and the optional scheduled drift check. Acceptable.

#### CI cost / minutes
- **Scenario**: Verdaccio publish + secondary install + typecheck on every shared-package PR adds minutes.
- **Severity**: Medium
- **Affected area**: CI throughput.
- **Mitigation**: `touches_contract` path-gate (skips docs/CI/scripts/app-only PRs), `concurrency` cancel-in-progress (already in `ci.yml`), reuse of `build-artifacts` (no second package build), single non-sharded runner.
- **Residual risk**: Shared-package PRs pay the cost. Acceptable for the safety gained.

#### Chicken-and-egg with the non-atomic two-repo flow
- **Scenario**: An intentional, protocol-following breaking change cannot land because the gate blocks it before the coordinated `official-modules` PR exists.
- **Severity**: Medium
- **Affected area**: Maintainer workflow for deprecations.
- **Mitigation**: Advisory in Phase 2; in Phase 3 the `bc-break-approved` label is the auditable opt-out (gated on deprecation protocol + RELEASE_NOTES entry, per `BACKWARD_COMPATIBILITY.md`).
- **Residual risk**: Relies on reviewer discipline to apply the label only with a real coordinated plan. Acceptable.

#### Runtime smoke cost & flakiness (Layer 2b)
- **Scenario**: Booting the sandbox with a real DB takes minutes and is more flake-prone (migration timing, port readiness, seed data) than typecheck, slowing CI and producing spurious reds.
- **Severity**: Medium
- **Affected area**: Layer 2b job latency and reliability.
- **Mitigation**: Separate, narrowly path-gated job; reuse of the proven `ephemeral-integration` env/boot pattern and `build-artifacts`; readiness wait before probing; smoke-only (no full integration suite). Stays `continue-on-error` (advisory) longer than Layer 2 — its promotion is an independent decision after flake rate is measured.
- **Residual risk**: Occasional flake; advisory status means it never blocks merge until deliberately promoted. Acceptable.

#### Verdaccio / network flakiness
- **Scenario**: Registry start or install flakes, producing spurious failures.
- **Severity**: Low-Medium
- **Affected area**: Layer 2 job reliability.
- **Mitigation**: Reuse the hardened `verdaccio.ts` helpers; advisory phase quantifies flake rate before promotion; install retry.
- **Residual risk**: Occasional flake post-promotion; re-run. Acceptable.

### Tenant & Data Isolation Risks
- None of consequence. Layer 2b boots a runtime app, but only against an **ephemeral CI database seeded with synthetic data** — no production or customer data is involved, and the DB is discarded with the job. No cross-tenant surface; nothing persists.

### Cascading Failures & Side Effects
- The job is leaf (read-only consumer build); failure blocks only its own PR status. No events, no subscribers, no module coupling.

## Final Compliance Report — 2026-06-19

### AGENTS.md Files Reviewed
- `AGENTS.md` (root) — official-modules submodule rules, supply-chain, generated-files contract, PR labels
- `BACKWARD_COMPATIBILITY.md` — the contract this spec mechanizes
- `packages/cli/AGENTS.md` — generators / snapshot idiom
- `packages/create-app/AGENTS.md` — Verdaccio / canary tooling reused by Layer 2
- Organization instructions — secrets, approved tools, supply chain, security impact

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No code under `apps/mercato/src/` except `*.generated.ts` | Compliant | Snapshot + scripts live at repo root / `scripts/`, not in the app boilerplate. |
| root AGENTS.md | Never edit generated files by hand | Compliant | `contract-surface.snapshot.json` is regenerated via `yarn bc:snapshot`, never hand-edited. |
| root AGENTS.md | Supply chain: no `curl … \| sh`; pin versions; confirm package names | Compliant | No new prod deps; Verdaccio + toolchain already pinned; `bcTestRef` pins the consumer; no piped installers. |
| root AGENTS.md | Never bump `official-modules.generated.ts` / submodule pointer unintentionally | Compliant | Only adds a `bcTestRef` field to `official-modules.json`; does not touch the generated registry or activation set. |
| root AGENTS.md | PR labels are first-class | Compliant | Introduces `bc-break-approved` as a documented opt-out label (Phase 3). |
| BACKWARD_COMPATIBILITY.md | ADDITIVE-ONLY surfaces may grow but not break | Compliant | Snapshot floor fails on removal/repoint, passes on addition. |
| org instructions | Secrets in 1Password; never inline | Compliant | No credentials; public repo checkout needs no token. |
| org instructions | Approved tools only for org data | Compliant | GitHub Actions + Verdaccio already in-repo; no new external service. |
| org instructions | Security impact section for auth/CI permission changes | Compliant | See Security impact below (PR-comment needs scoped `pull-requests: write`). |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | N/A | No entities, no API routes — CI/tooling spec. |
| Risks cover all write operations | Pass | Only "write" is the optional PR comment; covered under Security impact. |
| Phasing yields a working app at each step | Pass | Phase 1 self-contained; Phase 2 advisory (non-blocking); Phase 3 promotes. |
| Mechanisms reuse framework primitives | Pass | Reuses `verdaccio.ts`, `registry/publish.sh`, existing snapshot idiom, existing change-detection step. |

### Security impact
- The Layer 2 job checks out a **public** repo — no token, no secret exposure.
- The PR-comment-on-failure step needs `pull-requests: write`. The workflow's top-level `permissions: contents: read` stays; the elevated scope is granted **only on the `official-modules-bc` job** via a job-level `permissions:` block (`contents: read`, `pull-requests: write`), minimizing blast radius. No other job gains write scope.
- No production access, no customer data, no credentials handled.

### Verdict
- **Fully compliant** — ready for implementation. (Open Questions resolved; Q3 verified against the live `official-modules` repo: yarn-workspace monorepo, `@open-mercato/*` consumed as published deps, `typecheck`/`test` filter to `./packages/*` — Verdaccio approach confirmed.)

## Changelog
### [2026-06-19]
- Initial specification. Open Questions resolved: Layer 1 lightweight (names + registries + `package.json`); pin in `official-modules.json` `bcTestRef`; registry-consumption model verified against `official-modules`; `touches_contract` triggers on any `packages/*/src/**` change.
- Added **Layer 2b — runtime smoke** (boot + health): activate modules in the official-modules sandbox app, `generate` + `initialize` against ephemeral Postgres+Redis, boot, and probe `/api/healthz` + a few activated-module routes. Advisory; mirrors the existing `ephemeral-integration` job; promotion decided independently of Layer 2. Closes the "compiles + unit-passes but doesn't actually boot with these modules" gap.
