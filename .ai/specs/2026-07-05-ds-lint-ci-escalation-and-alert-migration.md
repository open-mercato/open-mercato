# DS Lint Enforcement Loop — CI wiring, warn→error escalation policy, legacy Alert migration

- **Status:** Draft (DS DX roadmap, item 5 in execution order)
- **Scope:** OSS (CI workflow + lint tooling + call-site migrations; no runtime contract changes)
- **Depends on:** [`2026-07-05-ds-system-guardian-refresh.md`](./2026-07-05-ds-system-guardian-refresh.md) (workstream 4 — `@open-mercato/eslint-plugin-ds`, `eslint.ds.config.mjs`, `yarn lint:ds`, per-module health ranking in `.ai/scripts/ds-health-check.sh`)
- **Risk:** `risk-low` (additive CI + dev tooling; migrations are render-identical by construction) · **Priority:** `priority-medium`
- **Category:** `refactor`

## TLDR

The guardian refresh shipped the structural DS lint (`@open-mercato/eslint-plugin-ds`, six rules, `yarn lint:ds`, all rules at `warn`, baseline 231 findings) — but the enforcement loop is open at both ends: nothing runs the lint in CI, so a PR can add findings invisibly, and nothing defines when a `warn` becomes an `error`, so the baseline never ratchets down. This spec closes the loop with three workstreams: (1) an advisory `ds-lint` CI job that reports per-rule counts and a delta vs the base branch on every PR; (2) a per-rule × per-module escalation policy keyed to the `ds-health-check` counters, enforced through per-module overrides in `eslint.ds.config.mjs` — including the inline-opt-out mechanism that must land before any rule flips to `error`; (3) a batched migration campaign for the 119 legacy `Alert variant=` call sites, held in place afterwards by a new `om-ds/no-legacy-alert-variant` rule.

## Overview

Three workstreams, one branch, each independently reviewable:

1. **CI wiring** — new advisory (non-blocking) `ds-lint` job in `.github/workflows/ci.yml` running the DS lint on the PR head and on a base-branch worktree with the *same* plugin + config, then publishing a per-rule base/head/delta table to the job summary and a sticky PR comment. A newcomer sees "+3 new DS findings" without knowing the tooling exists.
2. **Escalation policy** — the exact criterion and mechanism for flipping a rule from `warn` to `error`, one module at a time, driven by the per-module offender ranking in `.ai/scripts/ds-health-check.sh`. Prerequisite: resolve the `noInlineConfig` caveat documented in `eslint.ds.config.mjs` so per-line opt-outs become possible before the first flip.
3. **Legacy Alert migration** — batch-per-module migration of `<Alert variant=…>` to the `status`/`style` API using the mapping in `.ai/skills/om-ds-guardian/references/token-mapping.md` § "Legacy Alert `variant` → `status`", sequenced shared-packages-first, with a mandatory visual review per batch, plus the new lint rule that prevents regression.

## Problem Statement

Evidence gathered 2026-07-05 (lint JSON run + health-check data + git grep audit):

- **The lint runs nowhere.** `yarn lint:ds` exists and works, but no CI job invokes it. The 231-finding baseline can only grow silently — exactly the failure mode the guardian-refresh spec documented for empty states (flat since April) and inline SVG (regressing). Per-rule split of the baseline:

  | Rule | Findings |
  |---|---|
  | `om-ds/no-raw-table` | 114 |
  | `om-ds/no-hardcoded-status-colors` | 53 |
  | `om-ds/require-loading-state` | 31 |
  | `om-ds/require-page-wrapper` | 16 |
  | `om-ds/require-empty-state` | 10 |
  | `om-ds/require-status-badge` | 7 |

- **No delta visibility.** Even a contributor who runs `yarn lint:ds` locally sees 231 warnings and cannot tell which ones their PR introduced. Warnings without attribution are noise; noise gets tuned out.
- **Escalation designed but undefined.** `packages/eslint-plugin-ds/index.js` says "escalate per-rule to `error` once the corresponding metric in `.ai/reports/ds-health-*.txt` allows it" — with no definition of *allows*, no owner, and no enforcement mechanism. `docs/design-system/lint-rules.md` §L.0 says "after migrating a module, switch to `error` globally", which is unreachable while any module has findings.
- **Per-line opt-outs are impossible.** `eslint.ds.config.mjs` sets `linterOptions.noInlineConfig: true` because app code carries disable directives for rules not loaded in this ruleset (`react-hooks/*`, `no-console`, …) — with inline config on, each would become an "unknown rule" error. Consequence one: a legitimate exception cannot be expressed, so flipping any rule to `error` would hard-block files with intentional deviations. Consequence two: every run emits 28 "directive has no effect" notices (measured 2026-07-05), polluting the output.
- **Legacy Alert `variant` has no guard.** 119 call sites across 21 workspaces still use the deprecated `variant` prop (tracked by the health-check "Legacy Alert variant usages" counter). The BC shim in `packages/ui/src/primitives/alert.tsx` maps `variant` → `status` internally, so nothing is visually broken — but every copy teaches the deprecated API, the count is not covered by any of the six lint rules, and the eventual removal of the prop (deprecation protocol) is blocked until the count reaches zero.

## Goals / Non-Goals

**Goals**

- Every PR against develop/main shows its DS-finding delta without the author running anything.
- A written, mechanical criterion for each warn→error flip — no judgment calls, no surprise red builds.
- Per-line opt-outs (`eslint-disable-next-line om-ds/… -- reason`) available and *counted* before the first flip.
- Legacy `Alert variant` count driven from 119 to 0 in reviewable batches, then locked at 0 by lint.

**Non-Goals**

- Making `ds-lint` a required status check on day one (explicitly gated — see flip criterion).
- Flipping any of the six existing rules to `error` within this spec's PRs (the policy ships; the flips are follow-up one-liners once counters allow).
- Removing the `variant` prop from `alert.tsx` (STABLE contract surface; deprecation protocol, future release).
- Extending the six structural rules beyond their current backend globs (only the new Alert rule gets a wider scope).

## Proposed Solution

### Workstream 1 — Advisory `ds-lint` CI job

**Job placement.** New top-level job `ds-lint` in `.github/workflows/ci.yml`, structured like the existing `lint` job (checkout → Node 24 → corepack → yarn/node_modules caches → conditional `yarn install --immutable`). It does **not** `need` `prepare`: the plugin is plain JS and `@typescript-eslint/parser` needs no compiled packages, so the job runs in parallel with the heavy jobs. It is **not** added to the `needs` chain of `test`, `merge-coverage`, or `docker-build`, and is **not** a required status check — advisory by construction.

```yaml
ds-lint:
  runs-on: ubuntu-latest
  permissions:
    contents: read
    pull-requests: write   # sticky comment; no-op on fork PRs (read-only token)
  steps:
    # checkout / node / corepack / caches / install — identical to the lint job
    - name: DS lint (head)
      run: node node_modules/eslint/bin/eslint.js --config eslint.ds.config.mjs
           packages apps --format json --output-file /tmp/ds-head.json || true
    - name: DS lint (base)
      if: github.event_name == 'pull_request'
      run: |
        git fetch origin ${{ github.base_ref }} --depth=1
        git worktree add /tmp/ds-base origin/${{ github.base_ref }}
        (cd /tmp/ds-base && node $GITHUB_WORKSPACE/node_modules/eslint/bin/eslint.js
          --config $GITHUB_WORKSPACE/eslint.ds.config.mjs packages apps
          --format json --output-file /tmp/ds-base.json) || true
    - name: Report
      run: node scripts/ci/ds-lint-report.mjs /tmp/ds-head.json /tmp/ds-base.json
    - name: Enforce error-level findings
      run: node scripts/ci/ds-lint-report.mjs --check /tmp/ds-head.json
```

**Delta computation.** The job runs the lint twice with the *head's* plugin and config both times, so rule changes in the PR itself cannot skew the comparison. Flat-config `files` globs resolve against `cwd` (the base worktree), while the config's imports resolve against the config file's own location in the head checkout — same rules, both trees, apples to apples. The direct `node node_modules/eslint/bin/eslint.js` invocation (never the bare `yarn lint:ds`) keeps the reporting step alive when `error`-level findings exist; enforcement is the separate `--check` step so the report is always published first. Two fallbacks:

- On push events (develop/main) there is no base — the report shows absolute counts, delta omitted.
- When the base predates `eslint.ds.config.mjs` or the base run fails, the report says "delta n/a (no base data)" — it never fabricates a zero baseline.

**Report.** New script `scripts/ci/ds-lint-report.mjs` consumes both JSON files and emits one markdown block:

```
### DS lint — 234 findings (+3 vs develop)

| Rule | develop | this PR | Δ |
|---|---|---|---|
| om-ds/no-raw-table | 114 | 116 | +2 |
| om-ds/require-empty-state | 10 | 11 | +1 |
| om-ds/no-hardcoded-status-colors | 53 | 53 | 0 |
| … | | | |
| DS lint opt-outs | 0 | 0 | 0 |

**New findings**
- packages/core/src/modules/catalog/backend/products/page.tsx:212 — om-ds/no-raw-table
- …
```

The block is always written to `$GITHUB_STEP_SUMMARY`. For same-repo PRs it is additionally posted as a **single sticky PR comment** (marker `<!-- ds-lint-report -->`, updated in place via `actions/github-script`; the workflow's default permissions stay `contents: read` — the write grant is job-scoped). Fork PRs get a read-only `GITHUB_TOKEN`, so they rely on the job summary alone. To keep comment noise down, the comment is only created when the delta is non-zero or `error`-level findings exist; an existing comment is updated (never duplicated, never spammed per push) when the delta later returns to zero.

**Exit behavior.** The `--check` step exits 0 while all findings are `warn`-level. `error`-level findings (post-escalation, Workstream 2) fail it — that is intentional and is the enforcement teeth once flips begin.

**Criterion for making the job blocking** (adding it to branch-protection required checks): the moment the **first** per-module `error` flip merges. Before that, a required advisory job could only fail on infrastructure flakes; after that, an unrequired job would let `error` findings through. One prerequisite gate: at least two weeks of advisory operation on real PRs with no false-positive delta reports attributable to the base-worktree comparison (tracked via replies on the sticky comment).

### Workstream 2 — Escalation policy (warn → error, per rule × module)

**Prerequisite: restore per-line opt-outs.** Before any rule flips to `error`, `eslint.ds.config.mjs` changes as follows:

- Register the plugins whose rules appear in existing inline directives inside the scanned globs — enumerated by `grep -rhoE 'eslint-disable[^*]*' <scan roots> | sort -u`; today that is `react-hooks/*` and `@next/next/*` (core rules like `no-console` need no registration). The plugins are registered with **zero rules enabled** — they exist only so directive rule IDs resolve instead of erroring as unknown.
- Flip `linterOptions.noInlineConfig` to `false`; keep `reportUnusedDisableDirectives: 'off'` (foreign directives are "unused" from this config's perspective by design).
- Side benefit: the 28 "directive has no effect" notices disappear from every run and from the CI report.

Opt-out convention: `// eslint-disable-next-line om-ds/<rule> -- <reason>` with the reason mandatory (review-enforced; the guardian REVIEW flow flags bare disables). The health check gains a global **"DS lint opt-outs"** counter (`grep -rE 'eslint-disable.*om-ds/'`) and the CI report carries it with its own delta — an escalation must not silently convert findings into disables.

**Escalation unit and criterion.** The unit is *rule × module* (module = one directory under `packages/{core,enterprise}/src/modules/`, plus `packages/ui/src/backend` treated as one pseudo-module). A rule flips to `error` for a module when **both** hold:

1. the module's counter for that rule is **zero in two consecutive weekly health reports** (`.ai/reports/ds-health-*.txt`), and
2. the inline-opt-out change above has merged.

Two consecutive zeros (not one) prevent flip/revert churn when a module briefly touches zero while related PRs are in flight.

**Counter source.** `.ai/scripts/ds-health-check.sh` remains the escalation ledger. Its per-module breakdown table currently proxies two of the six rules via grep (hardcoded colors, pages-without-empty-state); it is extended with an optional `--lint` mode that, when `node_modules` is present, runs the eslint JSON invocation above and merges authoritative per-rule × per-module counts into the report (columns: `colors | text | svg-files | pages-no-empty | alert-variant | lint:<rule>…`). Without `--lint` the grep proxies still print, so the script stays dependency-free for quick checks. The global metric lines are preserved verbatim — existing saved reports stay delta-comparable, per the convention set by the guardian refresh.

**Enforcement mechanism.** Per-module override blocks appended to the `eslint.ds.config.mjs` array after a marker comment:

```js
// --- escalation overrides — see .ai/specs/2026-07-05-ds-lint-ci-escalation-and-alert-migration.md ---
// A module enters this list when its counter for the rule reads zero in two
// consecutive health reports. Entries are removed only when the rule flips
// to `error` in configs.recommended (all modules at zero).
{
  files: ['packages/core/src/modules/audit_logs/backend/**/*.{ts,tsx}'],
  rules: { 'om-ds/require-empty-state': 'error', 'om-ds/require-status-badge': 'error' },
},
```

Later blocks win in flat config, so overrides layer cleanly on the `warn` baseline. The block is hand-maintained — a flip is a two-line reviewed config change, and the health report's per-module zeros tell the maintainer which flips are eligible; no generator needed at this scale. When **every** module is at zero for a rule, the per-module entries for that rule are deleted and the rule's severity flips to `error` in `configs.recommended` in `packages/eslint-plugin-ds/index.js` — the terminal state per rule.

**Rule lifecycle summary:**

| State | Severity | Where declared | Entry condition |
|---|---|---|---|
| Rollout | `warn` everywhere | `configs.recommended` | shipped (guardian refresh) |
| Ratcheting | `error` in listed modules, `warn` elsewhere | escalation override block | module at zero for 2 consecutive reports + opt-outs available |
| Locked | `error` everywhere | `configs.recommended` | all modules at zero |

**New modules start strict.** A module created after this spec lands gets a full six-rule `error` override block in the same PR that scaffolds it (the guardian SCAFFOLD flow, the module-scaffold CLI spec — roadmap item 4 — and `.ai/docs/module-development.md` gain a note). New code has no baseline debt; there is no reason to grant it `warn`.

**Ordering guidance** (from the 2026-07-05 per-module lint run — top offenders: `catalog` 48, `ui/backend` 45, `workflows` 30, `staff` 23, `ent:sso` 17, `payment_gateways` 14, `customer_accounts` 11): flips arrive bottom-up — the ~10 modules with 1–6 findings (`api_docs`, `api_keys`, `configs`, `data_sync`, `directory`, `integrations`, `ent:record_locks`, `entities`, `sales`, `business_rules`) are a week of opportunistic cleanup and become the first `error` territory, building the muscle before the big migrations. Rules also differ in blast radius: `require-status-badge` (7 findings) and `require-empty-state` (10) can plausibly reach all-modules-zero within a sprint; `no-raw-table` (114) is a long campaign and stays `warn` globally for the foreseeable future.

### Workstream 3 — Legacy Alert `variant` migration campaign

**Facts on the ground.** 119 usages (git grep audit 2026-07-05, matching the health-check counter). The BC shim maps `variant` → `status` inside the component (`destructive`→`error`, `info`/`default`→`information`, `success`/`warning` identity), so legacy call sites *already render* through the new engine at the default `style="light"` — the mechanical prop swap is render-identical by construction. The visual decision that remains is per-surface: the Figma `light` style (saturated tint) is heavier than the pre-Figma look, and the deprecation note in `alert.tsx` explicitly directs call sites wanting the softer appearance to opt into `style="lighter"`. That decision cannot be automated — hence the visual-review requirement below. Mapping table: `token-mapping.md` § "Legacy Alert `variant` → `status`"; style guidance: `.ai/ui-components.md` § Alert (Style table: `light` = saturated tinted bg, `lighter` = very light tinted bg).

**New rule `om-ds/no-legacy-alert-variant`.** Added to `packages/eslint-plugin-ds/rules/`, wired into `index.js` `rules` + `configs.recommended` at `warn`:

- Flags a `variant` JSX attribute on an `<Alert>` element when `Alert` is imported from a path ending in `primitives/alert` (import tracking via the existing `utils/ast-helpers.js` patterns; a bare name-match fallback is deliberately avoided — other libraries legitimately expose `Alert variant=`).
- Provides ESLint **suggestions** (not autofix — the style decision is human): one per mapping row, e.g. `variant="destructive"` → replace with `status="error"`; `variant="default"` → remove the prop (information is the default).
- Message links `token-mapping.md` § Legacy Alert.
- Because legacy usages live outside the backend globs (frontend pages, `components/`, `widgets/`, and workspaces like `checkout`, `webhooks`, `sync-akeneo`), `eslint.ds.config.mjs` gains a **second config block** scoping *only this rule* to `packages/*/src/**/*.tsx` and `apps/*/src/**/*.tsx` (same test/generated ignores, plus `**/dist/**`), and the root `lint:ds` script's positional paths widen from the three backend roots to `packages apps`. The six structural rules keep their current backend-only scope — no baseline explosion.
- Tests follow the existing `packages/eslint-plugin-ds/tests/rules.test.js` pattern (`node:test` + `RuleTester` + `@typescript-eslint/parser`, valid/invalid cases including suggestion output, the `variant="default"` prop-removal case, and a negative case for a non-DS `Alert` import), run by `yarn workspace @open-mercato/eslint-plugin-ds test`.

**Batch plan.** One PR per batch, sequenced shared-surfaces-first (counts from the 2026-07-05 audit; totals per module, Σ = 119):

| Batch | Scope | Count | Rationale |
|---|---|---|---|
| B0 | `packages/ui` — ai parts (7), backend panels (8), `Notice`/`ErrorNotice` wrapper internals (3) | 18 | Shared package: every downstream screen inherits the fix; wrapper internals go first since those components are themselves deprecation-allowlisted and die with their removal |
| B1 | `packages/create-app` template example (2), `apps/mercato` example module (2) | 4 | Teaching surfaces — every new app copies them; smallest batch, biggest multiplier |
| B2 | `ai_assistant` (agent settings, allowlist, playground) | 19 | Top single-module offender |
| B3 | `workflows` (editor dialogs, definitions pages, graph) | 15 | Second offender |
| B4 | `checkout` (13) + `webhooks` (13) | 26 | Provider workspaces, self-contained review scope |
| B5 | `data_sync` (8) + `sync_akeneo` (4) + `scheduler` (2) + `sync_excel` (1) | 15 | Integration cluster, shared reviewer context |
| B6 | `customers` (4), `portal` (4), enterprise (`record_locks` 3, `security` 1), long tail (`auth`, `customer_accounts`, `communication_channels` ×2 each; `attachments`, `audit_logs`, `entities`, `feature_toggles`, `customers` dialogs ×1) | 22 | Sweep to zero |

**Per-batch protocol.**

1. Mechanical `variant` → `status` swap per the mapping table.
2. Per-surface style decision recorded in the PR description — default: keep `light` (what the shim renders today); opt into `lighter` only where the saturated tint overwhelms a dense surface, and treat each such opt-in as an intentional visual change with before/after screenshots.
3. PR carries `needs-qa` (the visual-review requirement — `light` vs `lighter` genuinely differ, see `.ai/ui-components.md` § Alert) unless the batch contains zero style opt-ins, in which case `skip-qa` with the render-identity argument stated explicitly.
4. PR description quotes the health-check "Legacy Alert variant usages" counter before/after.

**Holding the line and end state.** The rule at `warn` feeds the CI delta report from day one, so a PR that adds a legacy usage surfaces as "+1" immediately. The rule flips to `error` repo-wide in a single step — its per-module machinery is unnecessary given the campaign drives the count to zero within weeks — once the counter reads 0 in two consecutive health reports. Removing the `variant` prop from `alert.tsx` itself is **out of scope**: it is a STABLE contract surface under `BACKWARD_COMPATIBILITY.md` and follows the deprecation protocol (≥1 minor version with `@deprecated` JSDoc + the `error`-level rule guarding in-repo code) in a future release. The health check's per-module breakdown table additionally gains an `alert-variant` column (grep proxy `<Alert[^>]*variant=`) so batch progress shows up in the offender ranking.

## Architecture

No runtime architecture changes. Additions are one CI job, one report script under `scripts/ci/`, config blocks in `eslint.ds.config.mjs`, one lint rule + tests in the existing dev-only `packages/eslint-plugin-ds` workspace, and shell-script extensions to `.ai/scripts/ds-health-check.sh` (mirrored to `.ai/skills/om-ds-guardian/scripts/`, kept byte-identical with the `.claude/skills` copy per the guardian convention). Nothing enters any build artifact or app bundle.

## Data Models

None. No entities, migrations, or schema changes.

## API Contracts

None. No types, signatures, import paths, event IDs, spot IDs, routes, DB schema, DI keys, ACL features, or generated files change. The Alert `variant` prop and its BC shim are untouched; only call sites migrate.

## Migration & Backward Compatibility

- **CI is additive.** The `ds-lint` job joins no `needs` chain and is not a required check at introduction; existing PR outcomes are unaffected. Making it required is an explicit later step gated by the first `error` flip (Workstream 1 criterion).
- **The new rule is additive at `warn`.** `yarn lint:ds` exit codes do not change; `yarn lint` (turbo) is untouched.
- **The `noInlineConfig` flip affects only `eslint.ds.config.mjs`.** The main `eslint.config.mjs` ruleset is untouched; registered-but-disabled foreign plugins contribute no findings.
- **Alert batches are render-identical by construction** (the shim already routes `variant` through `status` at default `light`); every intentional `lighter` opt-in is an announced, QA-gated visual change.
- **Health-report format stays delta-compatible**: global metric lines preserved verbatim; the new per-module columns, the `--lint` mode, and the opt-out counter are appended additively, mirroring the guardian-refresh convention.
- **Escalation flips are the only breaking-ish surface** — for in-repo branches, not for third-party developers (the plugin is `private: true` and the config is repo-local). See Risks for the in-flight-PR scenario.

## Risks & Impact Review

| Risk | Scenario | Severity | Mitigation | Residual |
|---|---|---|---|---|
| Advisory fatigue | Devs learn the job is "always yellow" and stop reading it before any rule ever flips | Medium | Report leads with the **delta**, not the total — a clean PR reads "+0"; sticky comment only appears on non-zero delta; the blocking criterion is tied to the first flip so advisory-forever is structurally impossible | Low |
| PR-comment noise | Bot comment on every push buries human review threads | Medium | Single sticky comment matched by marker and updated in place; created only when delta ≠ 0 or errors exist; full detail lives in the job summary, the comment stays short | Low |
| Escalation breaks in-flight PRs | A module flips to `error` while an open PR adds a finding in it; the PR turns red at rebase through no fault of the author | Medium | Two-consecutive-zero criterion keeps flip candidates in modules with no active DS churn; flip PRs are announced (label + RELEASE_NOTES dev-notes line); the per-line opt-out with reason is the documented escape hatch; the fix is by definition the author's own new line — the module was at zero | Low |
| Base-worktree delta flakiness | The base lint run fails (missing config on old bases, parser mismatch) and the job reports garbage deltas | Low | Base run isolated in its own step with fallback to "delta n/a (no base data)" — never fabricates a zero baseline; two-week observation window before the job can become required | Low |
| Opt-out abuse | Escalation pressure converts findings into `eslint-disable` lines instead of fixes | Medium | Opt-out counter in the health check and in the CI report with its own delta; reason string mandatory; guardian REVIEW flow flags bare or stale disables | Medium — process-owned |
| False positives in `no-legacy-alert-variant` | Non-DS `Alert` components (third-party or local) flagged across the widened glob | Low | Import-path tracking (only `primitives/alert` imports fire the rule); negative test case required; suggestions-not-autofix means a false positive can never rewrite code | Low |
| Visual regressions in Alert batches | A `lighter` opt-in (or a missed shim nuance) changes a surface users know | Medium | The swap is render-identical by shim construction; every style change is screenshot-documented; batches carry `needs-qa` per the QA-approval merge gate, `skip-qa` allowed only for zero-opt-in batches with the argument stated | Low |

## Validation Plan

```bash
yarn workspace @open-mercato/eslint-plugin-ds test        # incl. new no-legacy-alert-variant cases
yarn lint:ds                                              # widened paths; exit 0 while everything is warn
node scripts/ci/ds-lint-report.mjs /tmp/head.json /tmp/base.json   # renders table; handles absent base file
node scripts/ci/ds-lint-report.mjs --check /tmp/head.json # exit 0 with warn-only findings
bash .ai/scripts/ds-health-check.sh                       # global lines byte-compatible; alert-variant column present
bash .ai/scripts/ds-health-check.sh --lint                # merges per-rule × per-module eslint counts
diff -rq .ai/skills/om-ds-guardian .claude/skills/om-ds-guardian   # empty
```

CI verification on the first PR carrying this change: `ds-lint` job green; job summary shows the per-rule table; on a deliberately finding-adding fixture commit the sticky comment appears with "+1", and after reverting it the same comment (not a second one) reads "+0". Per-batch Alert PRs validate via `yarn lint:ds` (counter −N), the health-check delta section, and the `needs-qa` visual pass. Integration coverage: not applicable — no API or UI runtime paths change; the `RuleTester` cases are the executable coverage for the only code added, matching the precedent set by the guardian-refresh spec.

## Final Compliance Report

- No cross-tenant or data-security surface touched; CI job permissions are minimal (workflow default `contents: read`, job-scoped `pull-requests: write` for the sticky comment only).
- No hardcoded user-facing strings introduced (lint messages and CI reports are developer-facing).
- No contract surface modified; the Alert `variant` deprecation protocol is respected, not accelerated.
- Generated files untouched; no `yarn generate` needed.
- No new production dependencies; everything rides on the existing `eslint` + `@typescript-eslint/parser` devDependencies and stock GitHub Actions.

## Changelog

- 2026-07-05 — Spec created (DS DX roadmap item 5). Direct continuation of `2026-07-05-ds-system-guardian-refresh.md` workstream 4: closes the DS enforcement loop with advisory CI delta reporting, a defined warn→error escalation policy per rule × module (including the `noInlineConfig` opt-out prerequisite), and the legacy Alert `variant` migration campaign guarded by the new `om-ds/no-legacy-alert-variant` rule. Baselines recorded: 231 lint findings (raw-table 114, colors 53, loading 31, page-wrapper 16, empty-state 10, status-badge 7), 119 legacy Alert usages across 21 workspaces, 28 `noInlineConfig` directive notices.
