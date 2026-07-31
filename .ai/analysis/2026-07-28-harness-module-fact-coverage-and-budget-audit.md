# Standalone-harness audit: module-fact coverage and case budgets

Issue: [#4565](https://github.com/open-mercato/open-mercato/issues/4565). Measured on the stacked head of
[#4556](https://github.com/open-mercato/open-mercato/pull/4556), itself stacked on
[#4529](https://github.com/open-mercato/open-mercato/pull/4529).

Everything below is measured, not estimated. The measurement surface is a real scaffolded controller —
an empty directory holding the template's `src/modules.ts`, populated with `mercato agentic:init` — so the
fact-sheet set, the guide sizes, and the skill tree are exactly what a scaffolded app receives.

```
node packages/cli/dist/bin.js agentic:init --tool claude-code   # in an empty app root
node scripts/evaluate-agent-harness.mjs --root <root> --all      # deterministic gate
```

Environment: macOS 26.5.2 (arm64), Node 24.14.1, `claude` 2.1.220 on the `sonnet` selector.

### Case numbering: this report predates the renumbering

Every measurement below was taken while this work's cases were numbered `OMH-188`…`OMH-195`. Merging
#4529's head on 2026-07-30 showed the parent had independently claimed `OMH-188`…`OMH-192` for writable
cases of its own, so these cases shipped as `OMH-193`…`OMH-201` instead — byte-identical apart from the ID
and the `relatedCases` repointed with them. Case IDs in the sections below are the **shipped** ones, so
they can be looked up in `cases.json` directly; where a measurement is quoted, it was produced by the same
case under its earlier ID. The mapping is:

| Measured as | Ships as | Fact-sheet |
|---|---|---|
| OMH-188 | **OMH-193** | `dictionaries` |
| OMH-189 | **OMH-194** | `api_keys` |
| OMH-190 | **OMH-195** | `configs` |
| OMH-191 | **OMH-196** | `perspectives` |
| OMH-192 | **OMH-197** | `resources` |
| OMH-193 | **OMH-198** | `sync_excel` |
| OMH-194 | **OMH-199** | `gateway_stripe` |
| OMH-195 | **OMH-200** | `sync_akeneo` |
| — (added later) | **OMH-201** | `wms` |

## 1. Module-fact coverage

At audit time a scaffold shipped **47** fact-sheets: the intersection of the 53 the build generated with
the 47 modules the template statically enabled. Merging #4529 enabled `wms` in the template, so the
current figure is **48 of 54** — a transition this branch's own guards caught rather than a drift that
slipped through (§1.2). The six generated-but-not-shipped sheets are unchanged: `core`, `generators`,
`widgets`, and the enterprise/opt-in modules (`record_locks`, `security`, `sso`,
`system_status_overlays`, `storage_s3`) that the template only enables behind an environment flag.

### 1.1 Before this branch

Six shipped fact-sheets had **no trace anywhere in the catalog** — not in a case's `context.required` or
`context.allowedExtra`, not as an `owner.path`, not in any title, prompt, or tag:

| Module | Capability an agent would otherwise rebuild |
|---|---|
| `configs` | per-organization runtime module settings (`module_configs`, `configs.manage`) |
| `perspectives` | saved list views plus role defaults (`perspectives`, `role_perspectives`) |
| `resources` | shared-asset records with types, tags, comments, activity, search |
| `sync_excel` | operator-run spreadsheet upload and load (`sync_excel_uploads`) |
| `gateway_stripe` | the installed Stripe payment provider package |
| `sync_akeneo` | the installed Akeneo PIM connector package |

The reviewer's original list on #4529 named ten; `api_docs`, `inbox_ops`, and `planner` gained
`allowedExtra` references while #4529 progressed, and `api_keys`/`dictionaries` were covered by #4556.

### 1.2 After this branch

All 48 shipped fact-sheets are routed by at least one case. Nine cases now own a fact-sheet
(`owner.kind: "facts"`): OMH-193 `dictionaries`, OMH-194 `api_keys`, OMH-195 `configs`,
OMH-196 `perspectives`, OMH-197 `resources`, OMH-198 `sync_excel`, OMH-199 `gateway_stripe`,
OMH-200 `sync_akeneo`, OMH-201 `wms`.

`packages/create-app/src/lib/module-facts-build.test.ts` now fails when a scaffold ships a fact-sheet no
case routes. It uses the production `selectModuleFactSheets` intersection, so enabling a module in the
template without adding a case is a red test rather than a silent coverage hole.

That guard has already paid for itself once on this branch. Merging `develop` enabled `wms` in the
template, and both of this branch's guards fired on the merge result exactly as designed — the fact-index
canary on the 47 → 48 sheet count, and the coverage guard on `wms` having no case. OMH-201 closed the gap
the same way the eight cases above closed theirs, routing `.ai/guides/modules/wms.md` through `om-help` as
a reuse-installed architecture decision. OMH-201 was added after the live cohort in §3 had been run, so it
carries deterministic-gate and semantic-assertion coverage only; no live routing run is claimed for it
here.

### 1.3 The weaker tier this branch does not close

Eleven shipped fact-sheets are referenced **only** through `context.allowedExtra`: `api_docs`,
`audit_logs`, `business_rules`, `dashboards`, `directory`, `entities`, `inbox_ops`, `messages`,
`onboarding`, `planner`, `translations`. An `allowedExtra` reference permits a read; it never fails a run
that skips it. These capabilities are therefore visible to the catalog but not asserted by it. That is a
different, larger piece of work — a case per capability with a prompt that genuinely forces the read — and
it is handed to a follow-up rather than grown into this branch.

## 2. Case-budget audit

Three budgets are case-local: `maxContextFiles`, `maxInitialContextBytes`, `maxTotalContextBytes`.
`timeoutMs` is case-local but writable-only. The refused-read ceiling is global
(`MAX_REFUSED_CONTEXT_READS = 6`), not per case.

The evaluator counts a path toward the *initial* budgets unless it lives under `/references/`,
`.ai/guides/modules/`, `.ai/guides/upstream/`, or `.agents/skills/`. So the honest floor for a case is the
on-disk size of its own `context.required`, restricted to initial paths — a number the catalog never
checked before this branch.

### 2.1 Cases their own budgets could not satisfy

| Case | Defect | Measured | Budget |
|---|---|---|---|
| OMH-169 | required initial context exceeds the byte budget | 57 372 B over 10 files | 57 344 B |
| OMH-146 | `maxContextFiles` equals the required set, and an `allowedExtra` initial path is declared that can never be opened | 4 required + 1 extra initial file | 4 files |
| OMH-111 | required plus all five declared extras exceed the byte budget and saturate the file budget | 57 845 B over 10 files | 57 344 B / 10 files |

OMH-169 is a guaranteed false negative: an agent that reads exactly the ten files the case demands and
nothing else is failed by 28 bytes. This is not a hypothesis — see §3.

### 2.2 Remediation

Widened from the measured footprints, rounded to the 4 KiB grid, smallest change that leaves real slack:

| Case | `maxContextFiles` | `maxInitialContextBytes` |
|---|---|---|
| OMH-111 | 10 → 11 | 57 344 → 65 536 |
| OMH-146 | 4 → 6 | 32 768 → 40 960 |
| OMH-169 | 11 → 12 | 57 344 → 65 536 |

`maxTotalContextBytes` was already generous everywhere: the smallest measured total-byte headroom across
the catalog is 37 985 B, so no total budget was touched.

Global limits are unchanged: `catalog.maxContextFiles` 16, `catalog.maxInitialContextBytes` 90 112,
`catalog.maxTotalContextBytes` 262 144, `MAX_REFUSED_CONTEXT_READS` 6, and every write, oracle, and
review limit.

### 2.3 The gate that keeps it measured

`validateCatalog` now measures each case's `context.required` and `context.required ∪ context.allowedExtra`
on disk and fails the deterministic gate when either cannot fit the case's own file or byte budgets. A
guide or fact-sheet that grows past a case's envelope therefore surfaces as a catalog error naming the
exact numbers, instead of as a live routing failure that reads like a model mistake.

One measurement boundary is worth stating: `.ai/guides/modules/*.md` is generated after enabled-module
discovery, so a tree where those sheets do not exist yet — a staged unit-test fixture, or a scaffold before
its first `generate` — measures them as zero bytes. They never count toward the *initial* budgets by design,
so only the total-byte arm is affected, and it is exact from the moment the sheets are on disk. The
controller measurements below include them.

Restoring OMH-169's pre-fix byte budget on the controller reproduces:

```
FAIL OMH-169: required context exceeds maxInitialContextBytes: 57372/57344; declared context exceeds maxInitialContextBytes: 57372/57344
Deterministic: 194/195 selected cases passed
```

### 2.4 Budgets that are thin but not broken

Twenty-eight cases leave one spare initial file over their declared context, and two (OMH-028, OMH-180)
leave none. Seven leave under 4 KiB of initial-byte slack, the tightest being OMH-077 at 1 751 B. These
are satisfiable — an agent that reads exactly the declared set passes — so they are reported rather than
widened. Widening them without a clean successful trace for each would be exactly the "copy an envelope
from a simpler case" mistake the issue asks to avoid. §3 records the live outcome for the sampled subset.

### 2.5 Duration and refused-read budgets

Routing cases have **no** case-local duration budget. `timeoutMs` is rejected by catalog validation unless
the case is writable, so every routing case runs under the operator default of 300 000 ms and the only
lever is `--timeout`. Across the sampled live cohort the passing runs took 71 s to 231 s; the slowest
passing case (OMH-195) therefore used **77%** of the ceiling, and one case (OMH-139) exhausted it entirely.
That is real but thin headroom on a contract the catalog cannot express, so it is reported rather than
changed here: a single timeout is model variance until it reproduces, and widening the routing timeout
contract deserves its own justification.

Refused reads peaked at **4** against the global ceiling of 6 (OMH-139); every other trace stayed at 0–2.
`MAX_REFUSED_CONTEXT_READS` is a global safety limit and is left alone.

## 3. Live evidence

Claude runner 2.1.220 on the `sonnet` selector, one fresh sandboxed process per case, run sequentially so
the durations are comparable.

### 3.1 The budget false negative, before and after

| | Violations | Initial bytes |
|---|---|---|
| OMH-169 before | `missing context BACKWARD_COMPATIBILITY.md`, `required context not observed BACKWARD_COMPATIBILITY.md`, **`initial context byte budget exceeded: 57372/57344`** | 57 372 / 57 344 |
| OMH-169 after | `missing context BACKWARD_COMPATIBILITY.md`, `required context not observed BACKWARD_COMPATIBILITY.md` | 57 372 / 65 536 |

The agent read exactly the ten initial files the case requires, in both runs, and the byte violation is
gone. **The case still fails**, on a different and pre-existing problem: the model never opens
`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`, a non-initial required path that no budget was ever
constraining. That is a guidance defect on #4529's surface, not a budget one, and is recorded in
[#4603](https://github.com/open-mercato/open-mercato/issues/4603) rather than papered over here.

OMH-111 passed before and after the widening (147 s → 132 s), so its fix removes a latent contradiction
rather than an active failure.

OMH-146's file contradiction is resolved — its declared `allowedExtra` path is now reachable. Its live
outcome is mildly unstable for an unrelated reason: across four runs it read
`.ai/guides/modules/ai_assistant.md` and passed three times, and once skipped it and failed on
`required context not observed`. Nothing in that assertion touches a budget; the initial-file count was 4
in every run, under the old ceiling of 4 and the new one of 6 alike.

### 3.2 The six new cases

OMH-195, OMH-196, and OMH-197 passed on their first live run, reaching `.ai/guides/modules/configs.md`,
`perspectives.md`, and `resources.md` respectively with the `architecture` route, `om-help`, and all four
required decisions.

OMH-198, OMH-199, and OMH-200 failed their first run on exactly one assertion — `missing skill om-help` —
while emitting the correct route, observing the installed fact-sheet, and producing every required
decision. The model opened `om-integration-builder` instead, which is the right skill for a spreadsheet
feed, a named payment provider, and a named PIM connector. The assertion was over-specified, so it now
names the skill live routing actually selects; the fact-sheet stays in `context.required`, which is the
part that fails when an agent hand-rolls the capability. All three pass after the retarget.

Final live state for the new cases: **6/6 pass**, each observing its installed module's fact-sheet.

| Case | Fact-sheet reached | Initial files / budget | Initial bytes / budget | Duration |
|---|---|---|---|---|
| OMH-195 | `configs.md` | 8 / 11 | 47 455 / 57 344 | 231 s |
| OMH-196 | `perspectives.md` | 3 / 11 | 20 759 / 57 344 | 78 s |
| OMH-197 | `resources.md` | 3 / 11 | 20 759 / 57 344 | 113 s |
| OMH-198 | `sync_excel.md` | 4 / 11 | 30 672 / 57 344 | 216 s |
| OMH-199 | `gateway_stripe.md` | 5 / 11 | 32 576 / 57 344 | 107 s |
| OMH-200 | `sync_akeneo.md` | 4 / 11 | 30 672 / 57 344 | 125 s |

Their budgets are inherited from the OMH-193/194 envelope and are, on this evidence, generous rather than
tight — the widest observed use is 8 of 11 files and 83% of the byte budget on OMH-195. They are left as
they are: nothing indicates a false negative, and tightening them from six runs would be its own guess.
OMH-193 and OMH-194 carry their own live evidence in the #4556 execution plan
(`.ai/runs/2026-07-27-standalone-harness-module-facts-cases.md`, steps 3.2 and 4.8); OMH-201 has none, as
§1.2 records.

### 3.3 The thin-budget cohort

Sampled cases with one spare initial file or less all passed with their current budgets: OMH-018
(5 files of 6), OMH-057 (5 of 5 — at the ceiling, one extra read would have failed it), OMH-120 (9 of 10),
OMH-180 (7 of 8). This is why they are reported rather than widened: they are tight, but no observed
correct run is failing on them.

Two cohort failures were unrelated to budgets and are recorded for completeness: OMH-153 missed the `umes`
route, the `om-system-extension` skill, and the extensions guide; OMH-139 exceeded the operator timeout.
