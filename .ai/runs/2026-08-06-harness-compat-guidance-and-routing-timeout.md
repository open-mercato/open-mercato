# Execution plan — harness backward-compatibility guidance and the routing duration budget

Issues: [#5058](https://github.com/open-mercato/open-mercato/issues/5058), [#5057](https://github.com/open-mercato/open-mercato/issues/5057)
Source analysis: `.ai/analysis/2026-07-28-harness-module-fact-coverage-and-budget-audit.md` (§2.5, §3.1)
Engine: om-auto-create-pr (steps: 12, --loop: no)

## Goal

Close the guidance defect #5058 describes at the level where it can still bite — the routed chain of the
cases that are *registered* as backward-compatibility cases — and settle #5057's duration-budget contract
with a decision backed by what the evaluator actually does today, not by the audit's pre-`dd2c172e` numbers.

## Scope

Both issues were written against the state of `develop` on 2026-07-28. Upstream commit `dd2c172e`
("fix(harness): tighten residual routing contracts", 2026-07-29) moved both premises, so step 1 of each
phase is to re-establish what is actually true before changing anything.

- `packages/create-app/agentic/shared/ai/skills/**` — route-level pointers to the compatibility guide
- `packages/create-app/agentic/shared/ai/harness/RELEASE.md` — the documented duration margin
- `packages/create-app/src/lib/context-guidance-contracts.test.ts` — the guidance guard
- `packages/create-app/src/lib/agent-harness-evaluator.test.ts` — the duration-contract pin

**Non-goals**

- No change to `cases.json` budgets, no new cases, no case renumbering (that is #5038's surface — it is
  open on the same file and must not be conflicted with).
- No change to `MAX_REFUSED_CONTEXT_READS`, catalog-wide budgets, or the writable `timeoutMs` contract.
- No move or rename of `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` (a case-context contract surface).

## Implementation Plan

### Phase 1 — Re-establish the facts

Scaffold a controller, run the deterministic gate, and run the live cases the issues name so the PR
reports measured state rather than the audit's.

### Phase 2 — #5058: route-level compatibility guidance

The audit's OMH-169 finding was resolved upstream by dropping the required path from the case. What
survives is the asymmetry that let it exist: a case can sit in `compatibilityRequiredCaseIds` while
nothing in its routed chain, beyond one generic root line, points at the guide. Add the missing
route-level pointers and make the property enforceable.

### Phase 3 — #5057: decide the duration-budget contract

Record the decision and its evidence, document the margin, and pin the chosen behaviour with a test.

### Phase 4 — Live re-verification and the full gate

Re-run the affected live cases, then the ordered `validation.commands` gate.

## Risks

- Adding prose to a routed `SKILL.md` or guide grows every case's measured initial context; the
  deterministic gate's `required context exceeds maxInitialContextBytes` check is the guard, and Phase 4
  re-runs it. Keep additions to one sentence.
- Live runs are model-variance-bound; a single failing run is not evidence on its own. Report run counts.
- `cases.json` is also touched by open PR #5038; this run must not edit it.

## Findings

Measured on a controller built exactly as the audit built one: an empty root holding the template's
`src/modules.ts`, populated with `node packages/cli/dist/bin.js agentic:init --tool claude-code`.
Live runs: `claude` 2.1.223, `sonnet` selector, one fresh sandboxed process per case.

**#5058 does not reproduce on current `develop`.** Two independent measurements say so.

1. OMH-169 no longer requires the guide. Upstream commit `dd2c172e` (2026-07-29, "fix(harness): tighten
   residual routing contracts") removed `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` from its
   `context.required` and dropped it from `compatibilityRequiredCaseIds`. The case's prompt builds a new
   feature; it never changes a public contract, so the requirement was the thing that was wrong.
2. The blind spot the issue's step 5 asks about is real as a *documentation* asymmetry but not as a
   *behavioral* one. Of the 20 cases still registered as compatibility-required, five (OMH-007, OMH-048,
   OMH-057, OMH-064, OMH-150) route no guide or skill that names the guide — they have only the generic
   contract-surface line the scaffolded root has carried since `64ea7a760` (2026-07-26). Three of those
   five were run live, and **all three observed the guide anyway**:

   | Case | Result | Attempts | Duration | `BACKWARD_COMPATIBILITY.md` observed |
   |---|---|---|---|---|
   | OMH-007 | pass | 1 | 100 397 ms | yes |
   | OMH-048 | pass | 1 | 86 483 ms | yes |
   | OMH-064 | fail — `context byte budget exceeded: 104452/98304` | 2 | 521 990 ms | yes |

   OMH-064's only violation is a live byte budget it overran by reading four references beyond its
   declared set; the guide was not the problem. Route-level pointers were written for these five cases and
   then reverted (`f4490baed`): they add 251–289 B to skills that cases like OMH-064 already read past
   their budget, and no measurement supports the cost. OMH-057 (writable regression) and OMH-150 (fails
   the deterministic gate, below) were not sampled.

**A separate regression blocks the issue's own repro instructions.** On that controller the deterministic
gate reports **105/203**. Ninety-six of the 98 failures are `maxTotalContextBytes` overruns, and every one
of them is explained by generated fact-sheet weight alone — `customers.md` is now 216 249 B and the 49
sheets total 1 880 763 B, against a catalog ceiling of 262 144 B. The growth arrives with #4883
(2026-08-03), which added per-row source links and topology sections to the sheets. It goes unseen because
`stageApp()` in `agent-harness-evaluator.test.ts` never creates `.ai/guides/modules/`, and
`pathReferenceExists` treats a generated module reference as present-and-weightless when that directory is
absent — so the unit gate measures every case against 0 B of fact-sheet context. OMH-169 is one of the 96,
which is why the issue's "re-run OMH-169 live" step cannot be executed at all. Filed separately.

**#5057 lands on option 2, and the fresh measurements support it.** `resolveLiveCaseTimeout` has been
runner-aware since the same `dd2c172e`: an explicit `--timeout` wins, otherwise Claude floors at
600 000 ms, a Codex `gpt-5.4-mini` high-effort run at 900 000 ms, and everything else keeps 300 000 ms. The
audit's "77% of the ceiling" was measured on `claude` against the 300 000 ms number that runner no longer
uses. The three runs above span 86 s to 522 s; the 522 s is two attempts of a correcting run, roughly 261 s
each, which is 43% of the Claude floor and 87% of the generic default. Duration therefore tracks the runner
and the attempt count, not the case, and belongs on the operator budget rather than in a portable catalog.

**Gate outcome.** `yarn build:packages` → `generate` → `build:packages` → `i18n:check-sync` →
`i18n:check-usage` → `typecheck` → `test` all pass (`yarn test`: 25/25 turbo tasks). `yarn build:app` fails
on `apps/mercato/next.config.ts:29` with `'agentRules' does not exist in type 'NextConfig'`. That file
comes from `develop`'s tip commit `6aefc2f19` (the Next.js 16.3.0 upgrade, #5020) and is untouched by this
branch, whose entire diff is three files containing no application TypeScript. It is a pre-existing
`develop` failure, not a regression here. `yarn generate` produced no working-tree drift.

Two transient failures were seen and did not reproduce: `@open-mercato/app#test` once under turbo (the
workspace passes standalone, 40 suites / 186 tests) and `create-mercato-app#test` once in
`published CLI bin executes the dist entrypoint`, whose `node build.mjs` exits 0 when run directly —
both are `dist/` contention from concurrent turbo runs on this machine.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Re-establish the facts

- [x] 1.1 Scaffold a controller root with `agentic:init --tool claude-code` and run the deterministic gate
- [x] 1.2 Map the compatibility-required cohort against its routed guidance and record the gaps
- [x] 1.3 Run OMH-169 live and record whether the issue's repro still reproduces

### Phase 2: #5058 route-level compatibility guidance

- [x] 2.1 Add the missing route-level pointers for the cases whose chain carries none — ec3a68d64, reverted in f4490baed (see Findings)
- [x] 2.2 Add the deterministic guard that every compatibility-required case routes a pointer — ec3a68d64, reverted in f4490baed (see Findings)

### Phase 3: #5057 duration-budget decision

- [x] 3.1 Record the decision and its evidence in the harness release notes — d0ee937a6
- [x] 3.2 Pin the routing-vs-writable `timeoutMs` contract with a deterministic test — d0ee937a6

### Phase 4: Live re-verification and the gate

- [x] 4.1 Re-run the affected live cases and record the result
- [x] 4.2 Run the full validation gate — green through `yarn test`; `yarn build:app` fails on `develop` itself (see below)

### Phase 5: Review response (#5068 code review by @adeptofvoltron)

- [x] 5.1 Merge the latest `develop` into the branch so review and CI judge the real merge result
- [x] 5.2 Major — restate the `RELEASE.md` paragraph in release-gate terms: the flag is `--case-timeout`
  (default 120000 ms, `run-agent-harness-release.mjs:53,79`), the routing step passes it to the evaluator
  explicitly (`:1619`), which sets `timeoutExplicit` (`evaluate-agent-harness.mjs:178`) and makes the
  runner-aware floors unreachable under `yarn harness:release`. All three claims verified in source before
  rewriting; the reviewer was right on each.
- [x] 5.3 Minor — replace "an explicit `--timeout` is always authoritative" with the actual `Math.max`
  rule, so the sentence no longer contradicts `resolveLiveCaseTimeout` (`:2713`) or the paragraph above it
- [x] 5.4 Minor — carry the counter-evidence: OMH-139 exhausted the 300000 ms evaluator default outright
  (audit §2.5), which the passing 71–231 s band alone read more comfortably than the measurements support
- [x] 5.5 Nit — assert `PASS <writable id>` on stdout so the accepting branch of the catalog guard is
  verified positively rather than by absence
- [x] 5.6 Pin the two facts the corrected paragraph asserts: `--case-timeout` exists with a documented
  120000 ms default and `--timeout` is rejected as an unknown argument
  (`agent-harness-release.test.ts`) — the drift this review caught, now caught by a test
- [x] 5.7 Targeted validation: `agent-harness-release.test.ts` 47 passed / 5 skipped,
  `agent-harness-evaluator.test.ts` 89 passed, plus the surface/context/budget contract files 46 passed

### Phase 6: Unblock CI after the GitHub Actions outage

- [x] 6.1 Merge the current `develop` (`368d4de38`) into the branch so a fresh CI run replaces the one
  GitHub Actions lost to its own outage (run 31114866191: `Failed to resolve action download info` /
  `Service Unavailable` on `Analyze javascript-typescript` and `Analyze python`; the run refuses a retry,
  so only a new head starts CI). Clean merge — `develop` touches none of the four files this PR owns. — 768feac95
- [x] 6.2 Ask @adeptofvoltron for a re-review, naming `e6eb4c3f7` as the commit that addresses every
  finding of the 2026-08-06 changes-requested review
