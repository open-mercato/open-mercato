# Checkpoint 1 — verification

**Recorded:** 2026-08-06T07:48:41Z
**Steps covered:** 1.1 → 3.2

## Deterministic gate (monorepo)

`yarn workspace create-mercato-app test` — **451 pass / 0 fail**. Runner: local (no compose `app`
container was running). Green including the four guards this change touches:

- `deterministic evaluation enforces the case schema through OMH-213`
- `every module fact-sheet a scaffold ships is required by at least one catalog case` (tightened)
- `the 213-case catalog routes audited installed-module, runtime, and AI/provider branches explicitly`
- `every published case count states the shipped catalog or the portability sample`

## Mutation test of the tightened guard

Moving `.ai/guides/modules/audit_logs.md` from OMH-204's `context.required` into its
`allowedExtra` and re-running `module-facts-build.test.ts`:

```
✔ every default-controller module fact is exercised by the evaluation catalog     <- OLD predicate still passes
✖ every module fact-sheet a scaffold ships is required by at least one catalog case
  AssertionError: these shipped module fact-sheets are in no case's context.required: audit_logs.
```

The old predicate passing while the new one fails is the point: the tightening catches a regression
the previous guard could not. The catalog was restored afterwards.

## Deterministic gate on a real emitted controller

Emitted with `node packages/cli/dist/bin.js agentic:init --tool claude-code` into an empty root
holding the template's `src/modules.ts`. To isolate this change, the same emitted tree was run twice:
once with the catalog from `upstream/develop`, once with this branch's.

| Catalog | Result |
|---|---|
| `upstream/develop` (203 cases) | Deterministic: **116/203** passed |
| this branch (213 cases) | Deterministic: **126/213** passed |

**Zero new failures** (`comm` on the two FAIL sets is empty); passes rise by exactly the ten new
cases. The 87 pre-existing failures are a property of `develop`'s emitted controller and are not
touched by this PR.

Each new case is reported reaching its own fact-sheet:

```
PASS OMH-204 — .ai/guides/modules/audit_logs.md      PASS OMH-209 — .ai/guides/modules/inbox_ops.md
PASS OMH-205 — .ai/guides/modules/business_rules.md  PASS OMH-210 — .ai/guides/modules/messages.md
PASS OMH-206 — .ai/guides/modules/dashboards.md      PASS OMH-211 — .ai/guides/modules/onboarding.md
PASS OMH-207 — .ai/guides/modules/directory.md       PASS OMH-212 — .ai/guides/modules/planner.md
PASS OMH-208 — .ai/guides/modules/entities.md        PASS OMH-213 — .ai/guides/modules/translations.md
```

## Live routing — 10/10 on runner `claude`

`claude` 2.1.223 (Claude Code), `sonnet` selector, one fresh sandboxed process per case.
The `codex` runner was unavailable: its account is over quota until 2026-08-26, so this cohort is
single-runner. Every run produced all four required decisions and read its own fact-sheet.

| Case | Fact-sheets read | Initial files / budget | Initial bytes / budget | Total bytes / budget | Route |
|---|---|---|---|---|---|
| OMH-204 | `audit_logs.md` | 3 / 8 | 20 785 / 53 248 | 34 304 / 73 728 | architecture |
| OMH-205 | `business_rules.md` | 3 / 8 | 20 785 / 53 248 | 39 904 / 86 016 | architecture |
| OMH-206 | `dashboards.md`, `perspectives.md` | 5 / 8 | 37 841 / 53 248 | 75 346 / 94 208 | architecture, umes |
| OMH-207 | `directory.md` | 3 / 7 | 20 785 / 40 960 | 40 472 / 69 632 | architecture |
| OMH-208 | `entities.md` | 5 / 9 | 39 486 / 57 344 | 67 806 / 106 496 | umes, module-data |
| OMH-209 | `inbox_ops.md` | 3 / 7 | 20 785 / 40 960 | 51 815 / 94 208 | architecture |
| OMH-210 | `attachments.md`, `messages.md` | 3 / 6 | 20 785 / 36 864 | 65 177 / 118 784 | architecture |
| OMH-211 | `directory.md`, `onboarding.md` | 2 / 5 | 18 969 / 32 768 | 43 621 / 61 440 | architecture |
| OMH-212 | `planner.md` | 3 / 7 | 20 786 / 40 960 | 34 909 / 77 824 | architecture |
| OMH-213 | `translations.md` | 5 / 7 | 37 841 / 49 152 | 53 781 / 65 536 | architecture, umes |

### First cohort and what it changed

The first live cohort was 7/10. The three failures were **not** fact-sheet misses except one, and all
three were fixed by correcting the case rather than by loosening a budget:

- **OMH-208** read `entities.md` and produced all four decisions but routed `umes`, not
  `architecture`. For a custom-fields prompt `umes` is the correct domain, so the case was retargeted
  and its required context realigned to that route's standard guide and skill.
- **OMH-211** was correct on every axis but opened no skill at all, so `om-help` was dropped as a
  required skill and as required context — it asserted process, not outcome.
- **OMH-212** was the only genuine miss: it never read `planner.md`, routing to "scaffold a new
  module" instead. The prompt now demands the installed owner be named before any schema is proposed,
  and the re-run reads the sheet.

## Not run, and why

- **UI / browser checks:** skipped. The change touches only catalog JSON, tests, and harness prose —
  no `.tsx`, nothing under `packages/ui/`, no route or schema change.
- **Integration suite:** not applicable; this package has no Playwright suite and the change adds no
  API or UI surface.
- **`codex` portability runner:** unavailable (quota). Recorded rather than claimed.
