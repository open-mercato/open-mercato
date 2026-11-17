# Eval Case Tool Mocks

> **Status:** Implemented · **Created:** 2026-11-17 · **Module:** `agent_orchestrator` (enterprise), with one additive seam in `ai-assistant`
> **Extends (does not replace):** [`2026-10-21-eval-reports-and-reproducible-regression.md`](./2026-10-21-eval-reports-and-reproducible-regression.md). Its §(c) owns the file-based eval sets, the frozen manifest and the content hash. Its §(d) owns tool record/replay and the A-3 model replay.
> **Roadmap item:** A-4 in the agent-platform gap audit (open-mercato/open-mercato#9648), feature 28: "Tool and API mocks per case, strict or name-only matching, mock usage report". See [Scope Decision: API mocks](#scope-decision-api-mocks) for why "API mocks" is delivered as tool mocks.
> **Stacks on:** `feat/a3-offline-model-replay` (A-3). This spec reuses A-3's per-case `withCaseModelFixtures` binding in `runCase`, the `offline_tool_fixtures_required` check, `trialScoped` fixture refs and the `--offline` flag.

## TLDR

**Key points**
- An eval case can declare **hand-authored tool mocks** in the eval-set file (`cases[].mocks.tools[]`). When the agent calls a mocked tool, it gets the mock's `output` or `error` instead of running the real tool. No live golden run is needed.
- Each mock picks a **match mode**:
  - `strict`: the tool name and the canonical args must match.
  - `ordered`: the next unused `ordered` mock for that tool answers; args are ignored.
  - `any`: the mock answers every call to that tool; args are ignored.
  
  The default is set per case and can be overridden per mock.
- Mocks take precedence. A recorded `fixtures.tools` file (or the `--replay` directory) answers the calls the mocks do not cover. Then `--on-fixture-miss` decides between `error` (the default; offline-safe) and `live`.
- A **mock usage report** is produced per trial:
  - `used`: mocks that answered, with call counts;
  - `unused`: mocks never called;
  - `unmatched`: calls no mock answered, with how they were resolved instead.
  
  A mock marked `required: true` that goes unused **fails** the trial (`status: 'failed'`, which lowers `passScore`).
- File and CLI only: no database column, no migration, no workbench UI. The mock semantics live in `agent_orchestrator`. `ai-assistant` gains one optional, additive lookup hook on the existing tool-replay seam.

**Scope**
- The eval-set file and frozen-manifest schema: optional `mocks` on a case. It is part of the content hash.
- The replay binding: inline mocks are compiled into a per-trial resolver, bound for both replay and record modes.
- The report: an optional `trials[].mocks` and an optional `environment.mocks`. An optional `mocks` block in the suite-run summary.
- CLI: cases with mocks turn on implicit replay, the same way cases with `fixtures.tools` already do.

**Out of scope**
- `api.request` / HTTP mocks. See [Scope Decision: API mocks](#scope-decision-api-mocks).
- Partial-args matchers (JSONPath, regex, subset).
- Mocks on DB-authored eval cases and in the workbench.
- Match modes for recorded fixture files (they stay `strict`; follow-up: `--fixture-match`).

**MVP:** Phases 1–3 together. Phases 1 and 2 are safe to merge on their own but deliver nothing a user can see. Phase 3 is the first one with user value.

## Scope Decision: API mocks

The original brief had two phases: tool mocks, then mocks for Code Mode `api.request({ method, path })`. Research showed that Phase 2 has no consumer on the eval plane. On 2026-11-17 it was dropped (round-2 decision Q8):

- Every agent the eval plane runs is read-only.
  - Code agents get a definition with `readOnly: true` and `mutationPolicy: 'read-only'` (`AO/lib/sdk/defineAgent.ts` `defineAgent`, about line 416). The runtime strips every `isMutation` tool before the model sees it.
  - Native file agents get the same read-only definition. A file agent that declares a mutating or unknown tool is not registered (`defineAgent.ts` `registerFileAgent`, the `offending` check).
- `api.request` is reachable only from Code Mode `execute` (`AI/lib/codemode-tools.ts`), and `execute` is `isMutation: true`. No evaluated agent can call it.
- For the agents we evaluate, the API boundary *is* their tool surface. A tool mock with an `error` result covers the failure cases ("not found", "upstream timeout") that an API mock would.

The same reasoning makes the earlier answer to Q5 ("a mock may answer a mutation tool") inert on this plane: no mutation tool is ever offered. The seam's `tool_replay_mutation_refused` rule stays unchanged and still runs **before** any mock lookup. If a future surface does offer mutation tools under eval, that becomes its own decision.

#9648 should record A-4's "API mocks" as delivered through tool mocks, with this rationale.

## Overview

The audience is agent authors and QA engineers who keep eval sets in git and gate releases in CI. Today the only deterministic tool source is a recording of a live run. With mocks they can:
- write edge cases that live data cannot produce on demand (empty results, a tool error, a malformed payload, a record that does not exist);
- assert that the agent **consulted** something, through `required` mocks;
- keep the case readable, because a reviewer sees what the agent was shown next to what it was expected to answer.

> **Market reference.**
> - **nock** (Node HTTP mocking): a mock answers once by default or every time with `.persist()`; `pendingMocks()` / `isDone()` list the mocks nobody hit. **Adopted:** `ordered` = answers once, in order; `any` = persists; `unused` + `required` = `pendingMocks()` + `isDone()`.
> - **MSW**: `onUnhandledRequest: 'error' | 'warn' | 'bypass'`. **Adopted** through the existing `--on-fixture-miss error|live`; no third flag.
> - **VCR.py / Polly.js**: recordings with a configurable `match_on` and record modes. **Adopted:** a recording answers what mocks do not cover, and recording while mocks are active stores only the calls that ran live.
> - **WireMock**: request journal with near-miss reporting, and rich matchers (JSONPath, regex). **Adopted:** the `unmatched` journal. **Rejected:** partial matchers. They add a matcher language to maintain, and canonical-args `strict` plus args-blind `ordered`/`any` covers the cases in the brief. A later spec can add them as a new `match` value without breaking files.

## Problem Statement

1. **No hand-written mocks.** `prepareToolBinding` (`AO/lib/eval/evalReplayService.ts`) can only load a recorded file through `EvalToolFixtureStore`. To write an edge case, someone has to fake a recording file by hand, including `argsKey` SHA-256 values.
2. **Matching is fixed at `strict`.** The seam supports `strict | ordered` (`AI/lib/llm-adapters/tool-replay-context.ts` `findFixture`), but `prepareToolBinding` hard-codes `match: 'strict'`. A model that varies its args slightly turns a call into a miss. This spec gives **mocks** a choice of match mode. **Recordings stay `strict`**: a recording is an exact capture, and loosening it is a separate, small follow-up (a `--fixture-match strict|ordered` CLI flag). It is listed under Out of scope.
3. **No usage report.** `EvalCaseToolOutcome` records only `{ mode, misses, summaryFidelity }`, so a fixture or mock nobody called is invisible. That usually means the agent skipped a step.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Mocks live inline in the case (`cases[].mocks`), not in a side file | A reviewer reads input, mocks and expectation together. Mocks enter the manifest content hash, so any change to them re-versions the dataset. Recorded files stay as the side-file path (`fixtures.tools`). |
| Match modes `strict`, `ordered` and `any`, set per mock with a case default (`mocks.match`, default `strict`) | Q4. Mixing modes in one case is the common need: `strict` for the lookup under test, `any` for incidental reads. |
| Resolution order per call: `strict` → `ordered` → `any` → recorded fixture → `onMiss` | The most specific answer wins. Q3: inline before recorded. |
| `strict` compares `computeToolArgsKey(args)`, the canonical-JSON SHA-256 that recordings already use | One equality rule for mocks and recordings. Several identical `strict` mocks answer successive occurrences in file order. |
| `required: true` unused → trial `status: 'failed'`, not `'error'` | Q7. `aggregateSuiteRun` drops `error` trials from `passScore` (`measurable` = passed + failed). An unconsulted dependency is an agent-behaviour failure and must lower the score and fail `--min-pass-score`. |
| The mock resolver lives in `agent_orchestrator`; `ai-assistant` gains only an optional `lookup` + `observeHit(call, source)` on `ToolReplayContext` | Keeps `ai-assistant` generic (it knows nothing about eval files) and keeps the seam's mutation refusal and occurrence counters as the single source of truth. Additive optional fields, so existing callers are unchanged. |
| Mocks also apply in record mode | Q3 applied consistently. With `--record`, mocked calls are answered by mocks and only the remaining live calls are written to the recording. Otherwise a recording made from a mocked case would hold results the agent never saw in replay. |
| Mock usage is stored in the suite-run summary (`__evalRun.mocks`), not in a new column | Q6: no migration. `agent_eval_suite_run.summary` is already in `encryption.ts`. It follows the existing `__evalRun.tools` pattern written by `replaySuiteRun`. |
| Mocks apply wherever a manifest case runs: the CLI (`--cases`, `--snapshot`) and `POST /eval-runs` with the `snapshot` of a file-sourced manifest | Mocks are part of the frozen dataset (the hash covers them). A dataset that ran deterministic in CI must not run live when the same snapshot is replayed from the workbench. Authoring stays file-only (Q6). |
| `formatVersion` stays `1`; `mocks` is an optional key | Same approach as `fixtures.model` (A-3). An older CLI rejects a file that uses `mocks`, because the file schema is `.strict()`. That is the correct failure: it must not silently ignore mocks. |

### Alternatives Considered

| Alternative | Why rejected |
|-------------|--------------|
| Write mocks as a synthetic recorded file and reuse `findFixture` | `ordered` in the seam indexes by `ordinal` across **all** calls to the tool, so it cannot mix with `strict` mocks for the same tool. There is also no `any` and no hit tracking. Encoding mock semantics in the seam would spread eval concepts into `ai-assistant`. |
| A new `mocked` value in report `environment.toolMode` | Adds an enum value to a versioned report contract that consumers may parse strictly. Mocked cases count as `replay`; the new optional `environment.mocks` carries the detail. |
| `required` unused → `error` | Removes the trial from `passScore`, so the gate can never fail on it. |
| Reject `--record` when any case has mocks | Blocks recording a whole file for one mocked case, with no way to narrow it (`--case` exists only with `--fixtures-from-run`). |

## User Stories / Use Cases

- **A QA engineer** writes a case where `customers.search_companies` returns `[]`, and expects the agent to answer "no matching company" without inventing one. No recording is needed.
- **An agent author** marks the stock-lookup mock `required: true`. The case fails when a prompt change makes the agent answer without checking stock.
- **A CI pipeline** runs `eval --cases set.yaml --offline true` over cases that combine mocks, recordings and model fixtures. Any call that is not covered fails the trial. Nothing reaches a live tool or model.
- **A reviewer** reads the Markdown report and sees per trial which mocks were used and which calls fell through to the recording.

## Architecture

```mermaid
flowchart LR
  F[eval-set file\ncases[].mocks] -->|manifestFromFile| M[frozen manifest\nhash includes mocks]
  M --> RC[runCase]
  RC -->|compileCaseMocks| R[per-trial MockResolver\nconsumption state + journal]
  RC -->|prepareToolBinding| B[ToolReplayContext\nmode replay or record\nlookup = R.lookup\nobserveHit, observeMiss]
  B --> S[resolveToolReplayDecision\n ai-assistant seam]
  S -->|isMutation| X[refuse - unchanged]
  S -->|lookup hit| H[mock output/error]
  S -->|no hit| FX[recorded fixture / record / onMiss]
  R -->|after run| U[EvalCaseMockUsage]
  U -->|required unused| FAIL[trial failed]
  U --> SUM[suite summary __evalRun.mocks] --> REP[report trials[].mocks]
```

### Seam change (`ai-assistant`, additive)

`ToolReplayContext` gains two optional fields on **both** variants:

```ts
lookup?: (call: ToolReplayCall) => ToolReplayFixture | null
observeHit?: (call: ToolReplayCall, source: 'lookup' | 'fixture') => void
```

`observeHit` is needed because `findFixture` is private to the seam. Without it, `agent_orchestrator` cannot tell that a recording answered a call, and the `unmatched[].resolution = 'fixture'` entry could not be produced. The resolver counts its own `lookup` hits; `source: 'lookup'` is only there so one observer sees every replayed call.

`resolveToolReplayDecision` keeps its current order. It claims the call (occurrence and ordinal counters) and refuses `isMutation` in replay mode. Then:
- **Replay mode:** `lookup(call)` runs before `findFixture`. A `lookup` hit returns `{ kind: 'replay', fixture }` and calls `observeHit(call, 'lookup')`. A `findFixture` hit calls `observeHit(call, 'fixture')`. A throwing `lookup` is treated as no hit, and a throwing `observeHit` is ignored, the same way `reportMiss` already swallows observer errors.
- **Record mode:** a `lookup` hit returns `{ kind: 'replay', fixture }`, so the mocked call is answered and **not** sent to `sink`. With no hit the call is recorded as today. Record mode does not refuse mutations today, and that is unchanged.
- In both modes `lookup` is **never consulted for an `isMutation` call**. A mock can therefore never stand in for a write, even on a future surface that offers mutation tools under eval (see [Scope Decision](#scope-decision-api-mocks)). Lifting this rule needs its own spec.

`agent-tools.ts` needs no change: it already handles `kind: 'replay'`, including `fixture.error`, which becomes `Tool "<name>" failed: <message>`.

### Mock resolver (`agent_orchestrator`, new `lib/eval/toolMocks.ts`)

- `compileCaseMocks(mocks, caseDefaultMatch)` → `CompiledToolMock[]`, each `{ id, tool, match, argsKey | null, fixture, required }`. `argsKey = computeToolArgsKey(args)` for `strict` mocks. A missing `id` defaults to `<tool>#<n>`, where `n` is the mock's 0-based index among the case's mocks for that tool.
- `createMockResolver(compiled)` is created **per trial**, so trials never share consumption state:
  - `lookup(call)`:
    1. the first unconsumed `strict` mock with the same `tool` + `argsKey`; it is consumed;
    2. otherwise the first unconsumed `ordered` mock for the tool; it is consumed;
    3. otherwise the first `any` mock for the tool; it is never consumed.
    
    Every hit increments the mock's `calls`.
  - `observeUnmatched(call, resolution)` appends to the `unmatched` journal. `resolution` is `fixture` (a recording answered), `live` (`onMiss: live`, or record mode) or `error`.
  - `usage()` → `EvalCaseMockUsage`.
- The `fixture` built for a hit is `{ toolName, argsKey: call.argsKey, args: call.args, output, error, occurrence: call.occurrence }`. `output` is the mock's `output` (`null` when `error` is set); `error` is `{ message }` or `null`.

### `runCase` integration (`evalReplayService.ts`, on top of A-3)

- `toolFixtureRefFor` / `prepareToolBinding` receive the case's manifest `mocks`, which exist only for `source.kind === 'manifest'`.
- When the case has mocks, the binding is never `live`:
  - With `options.toolFixtures` **absent** (`POST /eval-runs` with a snapshot), **or** when `store.load` returns `not_configured` (CLI implicit replay with no file for this case): the binding is `replay` with `fixtures: []` and `onMiss: options.toolFixtures?.onMiss ?? 'error'`. Today `prepareToolBinding` maps both of these to `live`; that mapping stays for cases **without** mocks. Mocks alone make a case deterministic.
  - With a recorded file loaded: `fixtures` comes from the file, as today. The resolver is bound as `lookup`.
  - In record mode: `lookup` is bound on the record context.
  - Journal wiring:
    - `observeMiss` → `resolver.observeUnmatched(call, miss.resolution)`;
    - `observeHit(call, 'fixture')` → `observeUnmatched(call, 'fixture')`;
    - record-mode `sink` → `observeUnmatched(call, 'live')`. The sink is owned by `prepareToolBinding` already.
- `withTools` attaches a tool outcome when `options.toolFixtures` is set **or** the case has mocks, so a mock-only case on the API path is still counted (`replay`).
- **A-3 offline check:** a binding counts as offline-safe when it is `replay` and `onMiss` is `error`. That covers mock-only, mock + recording, and recording-only cases. Mocks never relax the check, because `onMiss: live` is still rejected.
- **Between `scoreCaseRun` and `runLlmJudgeForRun`**, when `usage.unused` contains a `required` mock:
  - the trial's `status` becomes `'failed'` and `passed` becomes `false`;
  - `errorMessage` becomes `[internal] mock_required_unused: <ids>` (encrypted column), and `score` is kept.
  
  The judge writes assertion results only (`llmJudge.ts`) and never sets the trial status, so it cannot flip the failure back.
- `ReplayCaseOutcome` gains optional `mocks?: EvalCaseMockUsage`. `replaySuiteRun` collects the usage alongside `toolOutcomes` and writes `__evalRun.mocks` in the same summary flush.

### CLI (`cli.ts`, additive)

- `implicitReplay` in `parseEvalCliToolFixtureFlags` also turns on when any selected case declares `mocks`. `casesFile` is already passed in.
- No new flags. `--on-fixture-miss live` lets unmocked, unrecorded calls run live; `--offline true` forbids that (A-3).
- A summary line is printed when any case has mocks: `mocks: <used> used, <unused> unused (<requiredUnused> required), <unmatched> unmatched calls`.

## Data Models

There are no entities and no migration. The changes are to file, manifest and report schemas, all zod-validated.

### `EvalSetFileCase.mocks` (file, `evalSetFile.ts`) and `EvalSetManifestCase.mocks` (manifest, `manifest.ts`)

```ts
const toolMockMatchSchema = z.enum(['strict', 'ordered', 'any'])

const toolMockSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._#-]*$/).optional(),
  tool: z.string().min(1).max(200),
  match: toolMockMatchSchema.optional(),
  args: jsonSchema.optional(),
  output: jsonSchema.optional(),
  error: z.string().min(1).max(2000).optional(),
  required: z.boolean().optional(),
}).strict()
  // refinements: exactly one of output | error; args required iff effective match === 'strict',
  // forbidden otherwise (a silently ignored args block is a trap)

const caseMocksSchema = z.object({
  match: toolMockMatchSchema.optional(),          // case default, defaults to 'strict'
  tools: z.array(toolMockSchema).min(1).max(EVAL_CASE_MAX_TOOL_MOCKS), // 100
}).strict()
  // refinement: ids (explicit or defaulted) unique within the case
```

- The manifest stores `mocks` after normalization: the case default is applied to every mock (`match` always set), ids are filled in, and `strict` mocks keep `args`. This way the content hash does not depend on how the author spelled the defaults. `normalizeManifest` sorts nothing inside `mocks`, because file order is meaningful for `ordered` and for repeated `strict` mocks.
- `fileFromManifest` writes `mocks` back, so export and import round-trip unchanged.
- Validation issues use the existing `EvalSetFileIssue` path codes (for example `cases[3].mocks.tools[0].args`).
- **DB import** (`POST /eval-sets/import`, `commands/evalSets.ts`): `AgentEvalCase` has no column for mocks. Import maps only `key`, `name`, `input`, `expected` and the assertion refs into DB rows, so `mocks` is not stored, just as `fixtures` is not stored today. There is no code change and no new response field. The docs state that mocks (like fixtures) take effect only when the file itself is run (`--cases`) or its frozen snapshot is replayed.

### `EvalCaseMockUsage` (report and summary)

```ts
{
  used: Array<{ id: string; tool: string; match: 'strict' | 'ordered' | 'any'; calls: number }>,
  unused: Array<{ id: string; tool: string; required: boolean }>,
  unmatched: Array<{ tool: string; argsKey: string; occurrence: number; toolCallId: string | null;
                     resolution: 'fixture' | 'live' | 'error' }>,
  unmatchedTruncated: boolean,   // journal capped at 50 entries per trial
}
```

- The suite summary stores `__evalRun.mocks = { byCaseRun: Record<caseRunId, EvalCaseMockUsage>, totals: { cases, used, unused, requiredUnused, unmatched } }`. The summary is encrypted at rest (`encryption.ts` → `agent_eval_suite_run.summary`). Call args are never copied into the usage: an unmatched call carries `argsKey` + `toolCallId`, and the reader opens the trial's trace (`trials[].tracePath`, already access-checked) to see the args.
- The size is bounded by `EVAL_SET_FILE_MAX_CASES` × repeat × (100 mocks + 50 unmatched) small entries. `assertManifestWithinCap` already bounds the manifest. When the serialized `__evalRun.mocks` would exceed `EVAL_MOCK_SUMMARY_MAX_BYTES` (1 MiB), `byCaseRun` is dropped and only `totals` is kept, plus `truncated: true`. The report then adds `mock_usage_truncated` to the existing optional `environment.warnings`.

## API Contracts

All changes are additive.

### `GET /api/agent_orchestrator/eval-runs/:id/report` (existing)
- `cases[].trials[].mocks?: EvalCaseMockUsage`: present only for trials whose case declared mocks.
- `environment.mocks?: { cases: number; requiredUnused: number }`.
- The Markdown report adds a "Mocks" table per mocked case (used / unused / unmatched). The JUnit report: a `required` unused failure becomes a `<failure message="mock_required_unused: …">`.
- `schemaVersion` is unchanged, because the fields are optional.

### `GET /api/agent_orchestrator/eval-sets/:version/export` (existing)
- Emits `cases[].mocks` when present in the manifest.

### `POST /api/agent_orchestrator/eval-sets/import` (existing)
- Accepts files that use `mocks` (the shared file schema validates them) and does not persist them to DB cases. The response is unchanged.

The report route's existing `openApi` export is updated to describe the new optional fields. Auth metadata (`requireAuth` / `requireFeatures`) is unchanged on every touched route.

### CLI `mercato agent_orchestrator eval` (existing)
- No new flags. Mocks turn on implicit replay. Exit codes are unchanged: a `required` unused trial lowers `passScore` and fails `--min-pass-score` / `--gate`, the same as any failed trial.

## Internationalization (i18n)

Nothing user-facing is added in the backend UI. The CLI and report strings are developer-facing; error codes are prefixed `[internal]`, following the existing eval CLI convention.

## UI/UX

None. The workbench is unchanged (Q6). The eval-run detail page does not show mock usage; regression views are A-5's scope.

## Configuration

No new environment variables. Constants: `EVAL_CASE_MAX_TOOL_MOCKS = 100`, `EVAL_MOCK_UNMATCHED_JOURNAL_MAX = 50` and `EVAL_MOCK_SUMMARY_MAX_BYTES = 1048576`.

## Migration & Backward Compatibility

- **Eval-set file / manifest (STABLE, additive):** `mocks` is an optional key. Existing files, manifests and their hashes are unchanged, because a case without `mocks` normalizes as before. A file that uses `mocks` is rejected by an older CLI (`.strict()`), which is intended.
- **`ToolReplayContext` (ai-assistant export, STABLE):** two optional fields. Existing callers and recorded files are unaffected.
- **Report schema (versioned):** optional fields only, and no new enum values.
- **Behaviour change:** none for cases without mocks. A case with mocks that used to run live (no `--replay`, no `fixtures.tools`) did not exist before, because the key was invalid.
- UPGRADE_NOTES: one entry ("eval cases may declare tool mocks; older CLIs reject such files").

## Implementation Plan

### Phase 1: Seam and resolver
1. `tool-replay-context.ts`: add optional `lookup` / `observeHit` on both context variants and wire them into `resolveToolReplayDecision`. Unit tests:
   - a `lookup` hit in replay, with `observeHit('lookup')`;
   - a fixture hit, with `observeHit('fixture')`;
   - a `lookup` hit in record mode, not sent to the sink;
   - an `isMutation` call never consults `lookup` (in either mode);
   - a throwing `lookup` is treated as no hit;
   - behaviour is unchanged without the new fields.
2. `lib/eval/toolMocks.ts`: `compileCaseMocks`, `createMockResolver` and usage. Unit tests: strict occurrences in file order; `ordered` consumption independent of `strict`; `any` never consumed; precedence strict → ordered → any; per-trial isolation; default ids.

### Phase 2: Schema and manifest
3. `evalSetFile.ts` + `manifest.ts`: `caseMocksSchema` with refinements, normalization (defaults applied, ids filled in), the `manifestFromFile` / `fileFromManifest` round-trip and hash stability. Tests: refinement issues with paths; a case without mocks has an unchanged hash; reordering mocks changes the hash.
4. Import: no code change. Add a test to the existing import command tests: a file with `mocks` imports, and the created cases carry none.

### Phase 3: Replay integration and usage report
5. `evalReplayService.ts`: bind the resolver in `prepareToolBinding` (replay, record, mock-only); unmatched journal; the A-3 offline check; `required` unused → `failed`; collect `ReplayCaseOutcome.mocks`; summary `__evalRun.mocks`.
6. `cli.ts` / `toolFixtures.ts`: implicit replay for cases with mocks; summary line.
7. Report: `reportSchema.ts` / `buildEvalReport.ts`, plus the Markdown and JUnit renderers.
8. Docs: `apps/docs/docs/framework/ai-assistant/agent-eval-ci.mdx` (a mocks section with an example), the AO `AGENTS.md` eval row, UPGRADE_NOTES, and the parent spec's changelog cross-link.

### File Manifest

| File | Change |
|------|--------|
| `packages/ai-assistant/src/modules/ai_assistant/lib/llm-adapters/tool-replay-context.ts` | optional `lookup` / `observeHit` |
| `packages/enterprise/src/modules/agent_orchestrator/lib/eval/toolMocks.ts` | new |
| `…/lib/eval/evalSetFile.ts`, `…/lib/eval/manifest.ts` | `mocks` schema and normalization |
| `…/lib/eval/evalReplayService.ts`, `…/lib/eval/evalRunSettings.ts` | binding, usage, `required` failure, summary |
| `…/lib/eval/toolFixtures.ts`, `…/cli.ts` | implicit replay, summary line |
| `…/lib/eval/report/reportSchema.ts`, `…/lib/eval/report/buildEvalReport.ts`, Markdown/JUnit renderers | optional mock fields |
| `apps/docs/docs/framework/ai-assistant/agent-eval-ci.mdx`, `…/agent_orchestrator/AGENTS.md`, `UPGRADE_NOTES.md` | docs |

## Testing Strategy

- **Unit** (Jest, enterprise + ai-assistant): the seam (step 1), the resolver (step 2), schema and hash (step 3), import (step 4), `fileFromManifest` round-tripping `mocks`, and the `runCase` binding with a fake runtime. The binding cases:
  - mock-only replay with no `toolFixtures` (the `POST /eval-runs` snapshot path);
  - mock-only replay under CLI implicit replay with `not_configured`;
  - mock + recording precedence;
  - record mode skips mocked calls;
  - `required` unused → `failed`, and `passScore` drops;
  - the offline check passes a mock-only case and rejects `onMiss: live`.
- **Integration** (`__integration__`, self-contained, fixtures created in setup and removed in teardown):
  - `TC-AGENT-EVAL-MOCK-001` (library-level, same harness as A-3's `TC-AGENT-EVAL-REPLAY-001`): a case with `strict` + `any` mocks runs under model fixtures with no recorded tool file. The real tool handler never executes (it is a spy). `usage.used` lists both mocks.
  - `TC-AGENT-EVAL-MOCK-002` (library-level): a `required` mock the agent does not call → `usage.unused[].required = true`, and the trial is `failed`. A mock + recording case → the mocked call is answered inline and the other call is answered by the recording (`unmatched[].resolution = 'fixture'`).
  - `TC-AGENT-EVAL-MOCK-003` (API-level): `POST /eval-sets/import` with a file using `mocks` succeeds, and the created cases carry no mocks.
- **Affected API paths:**
  - `eval-sets/import`: covered by 003.
  - `eval-sets/:version/export` and `eval-runs/:id/report`: their new optional fields are covered by unit tests (`fileFromManifest`; `buildEvalReport` over a seeded `__evalRun.mocks` summary).
  - `POST /eval-runs` with a `snapshot`: the `runCase` binding unit test above.
  
  These paths need a file-sourced manifest, which only reaches the start command through `runEvalGate`'s internal `evalSet` input (the CLI). The public `POST /eval-runs` schema accepts DB case ids or a `snapshot` of a manifest that already exists. An API-level test would therefore have to spawn the CLI. This exception is recorded in the compliance report.
- There are no UI paths.

## Risks & Impact Review

### Data Integrity Failures
- **An `ordered` mock is consumed by a retried tool call.** The AI SDK may re-issue a call after a tool error, which consumes the next `ordered` mock. *Severity:* medium (the case is flaky, not wrong data). *Mitigation:* this is documented; a retry shows up in `used[].calls` and `unmatched`; authors use `any` for idempotent reads. *Residual:* low.
- **A mock answers with a payload shape the real tool never returns.** The agent passes against a fiction. *Severity:* medium. *Mitigation:* the docs recommend seeding mocks from a recording (`--record`, then copying the output). Validating mocks against output schemas is a possible follow-up, because tools do not all declare an output schema. *Residual:* medium, accepted. This is inherent to hand-written mocks.

### Cascading Failures & Side Effects
- **A mock hides a live call path.** A mock-only case binds `replay` with `onMiss: 'error'`, so an unmocked call fails the trial instead of running live. Mutation refusal still runs before the lookup. *Severity:* low. *Residual:* none.
- **The summary grows past the size cap.** The mock block is dropped with a warning; the run itself is unaffected. *Severity:* low.

### Tenant & Data Isolation Risks
- Mock content comes from a committed file, not tenant data. Unmatched journals hold `argsKey` only; `args` are added to the report only with `--include-payloads`, read from the scoped trace. The summary is encrypted. *Residual:* low.

### Migration & Deployment Risks
- Mixed CLI versions: an older CLI rejects new files instead of ignoring mocks. *Severity:* low (a clear validation error).

### Operational Risks
- A mock for a tool the agent does not have can never match. *Mitigation:* it shows as `unused`; if it is `required`, the trial fails, which is the right signal. *Residual:* low.

## Final Compliance Report — 2026-11-17

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`
- `packages/ai-assistant/AGENTS.md`
- `.ai/qa/AGENTS.md` (integration coverage)
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | N/A | No entities |
| root AGENTS.md | Filter by `organization_id`; no cross-tenant data | Compliant | No new queries. Existing scoped replay and report paths; the summary is written through `findOneWithDecryption(..., scope)` |
| root AGENTS.md | Validate inputs with zod | Compliant | `caseMocksSchema` / `toolMockSchema` with refinements |
| root AGENTS.md / core → Encryption | Sensitive data via encryption maps and `findWithDecryption` | Compliant | No new columns; `agent_eval_suite_run.summary` and `agent_eval_case_run.error_message` are already mapped; call args are never copied |
| root AGENTS.md | Never hard-code user-facing strings | Compliant | No UI; CLI/report codes `[internal]`-prefixed, following the eval CLI convention |
| root AGENTS.md | Ask before changing public contracts | Compliant | Additive only: file/manifest key, optional seam fields, optional report fields; decided with the maintainer (Q1–Q8) |
| root AGENTS.md | Optimistic locking on new user-editable entities | N/A | No new entity |
| root AGENTS.md | Provider-specific code in provider packages | N/A | — |
| BACKWARD_COMPATIBILITY.md | Types / signatures STABLE, additive only | Compliant | `ToolReplayContext` optional fields; no removal or rename |
| BACKWARD_COMPATIBILITY.md | API routes STABLE | Compliant | Optional response fields only; `openApi` updated |
| BACKWARD_COMPATIBILITY.md | DB schema | N/A | No migration |
| core → API Routes | Routes export `openApi` and per-method auth metadata | Compliant | Existing routes; `openApi` updated, auth unchanged |
| core → Commands | Mutations as commands with undo | N/A | No new mutation; trial status writes stay in the existing replay pipeline |
| ai-assistant AGENTS.md | Tool execution goes through the agent tool wrapper; mutation gate intact | Compliant | `lookup` runs after the `isMutation` refusal and is never consulted for mutation calls |
| `.ai/specs/AGENTS.md` | `{date}-{title}.md` in `.ai/specs/enterprise/`; required sections | Compliant | All required sections present |
| `.ai/qa/AGENTS.md` / root | Integration coverage for every affected API path, shipped with the feature | Non-compliant (justified exception) | `eval-sets/import` is API-level (003). `eval-sets/:version/export`, `eval-runs/:id/report` and `POST /eval-runs` (snapshot) need a CLI-frozen file manifest, so they are covered by unit tests and library-level integration tests (001/002). Recommendation: add an API-level test once a test helper can create a file carrier without the CLI |

### Internal Consistency Check
- TLDR, Design Decisions, Data Models, API Contracts and Testing agree that there is no DB column, the import response is unchanged, recordings stay `strict`, and the seam fields are `lookup` + `observeHit(call, source)`.
- The mock-only binding rule covers the API snapshot path and CLI `not_configured`.
- `required` unused → `failed` is consistent with `aggregateSuiteRun` (`measurable` = passed + failed) and with the judge never setting the status.

### Verdict
Approved for implementation, with one justified exception to integration coverage.

## Changelog

- **2026-11-17:** Skeleton; Q1–Q7 answered; Q8 dropped the `api.request` phase (no eval consumer); full draft.
- **2026-11-17:** Implemented Phases 1–3 as specified (no design deviation).

### Review — 2026-11-17
- **Reviewer**: Agent (author), plus a fresh-context subagent for scope cohesion (verdict: cohesive)
- **Security**: Passed. Mutation calls never reach `lookup`; no args are copied into stored usage; encrypted summary.
- **Performance**: Passed. The resolver is O(mocks per tool) per call; usage is capped per trial (50 unmatched) and per run (1 MiB).
- **Cache**: Passed. `manifestCache` is keyed by content hash, which covers `mocks`.
- **Commands**: Passed. No new mutations.
- **Risks**: Passed after revision. Fixed from the cohesion review:
  - the fixture-hit observation gap (`observeHit(call, source)`);
  - the mock-only binding under `not_configured` and the API path;
  - the recordings-stay-`strict` scope;
  - the false premise about the import `warnings` field (removed);
  - the dedicated summary size cap;
  - the title/filename mismatch;
  - an explicit MVP statement.
- **Verdict**: Approved

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Seam and resolver | Done | 2026-11-17 | `lookup` / `observeHit` on `ToolReplayContext`; `lib/eval/toolMocks.ts` |
| Phase 2 — Schema and manifest | Done | 2026-11-17 | `cases[].mocks` file schema + refinements, normalized manifest `mocks`, export round trip; import stores no mocks |
| Phase 3 — Replay integration and usage report | Done | 2026-11-17 | Binding (replay, record, mock-only), `required` unused → `failed`, `__evalRun.mocks`, CLI implicit replay + summary line, report/Markdown/JUnit, docs; TC-AGENT-EVAL-MOCK-001/002/003 |
