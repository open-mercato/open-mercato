# Execution plan — AGENTS.md budget: headroom warnings, per-file sizes, module coverage

- **Issue:** #5866
- **Base branch:** `develop`
- **Branch:** `feat/agents-md-budget-headroom-and-coverage`
- **Engine:** om-auto-create-pr (steps: 10, --loop: no)

## Goal

Extend the existing `yarn agents:check-budget` gate so it warns *before* an `AGENTS.md` file
trips a hard limit, measures every `AGENTS.md` in the repo rather than only the four baseline
chains, and reports which modules and packages have no `AGENTS.md` at all — all as advisory
findings that never change the exit code, with a written criterion for making them blocking later.

## Context

`scripts/check-agents-md-budget.mjs` already exists on `develop` (#4484) and is blocking in CI.
It enforces exactly two byte rules: a root hard limit (`rootMaxBytes`, 31 232) and a shrink-only
ratchet on four representative root-to-module chains. Both stay exactly as they are — this run
only adds advisory findings alongside them.

The motivating measurement: the root `AGENTS.md` is 31 224 bytes against a 31 232-byte limit,
i.e. **8 bytes of headroom**, with no warning before the cliff.

## Scope

- `scripts/check-agents-md-budget.mjs` — warnings channel, `--strict`, per-tool limit table,
  per-file scan, coverage scan.
- `scripts/agents-md-budget.baseline.json` — additive keys (`warnAtPercent`, `tools`).
- `scripts/agents-md-coverage-allowlist.json` — new, seeded with today's gaps.
- `scripts/__tests__/check-agents-md-budget.test.mjs` — new cases.
- `package.json` — new `agents:check-budget:ci` script.
- `.ai/docs/agent-instructions.md` — document the warnings, the allowlist, and the escalation criterion.

## Non-goals

- Shrinking any oversized `AGENTS.md` (the ratchet already freezes that debt).
- Authoring the missing `AGENTS.md` files (they are allowlisted with reasons instead).
- Flipping the CI step to `--strict` (deliberately deferred by a few releases).
- The standalone create-app root budget (`STANDALONE_ROOT_TARGET_BYTES`) — separate surface, #5437.
- Adding a real tokenizer dependency; token figures stay documented estimates.

## Design decisions

1. **Extend, do not add a script.** One baseline, one CI step, one doc.
2. **Two channels.** `failures` keeps its exact current meaning and exit code 1. New findings go
   to `warnings`, which print always and only affect the exit code under `--strict`.
3. **Per-tool limits table** with `unit` (`bytes`/`tokens`), `limit`, `enforced`, and `source`.
   Codex stays byte-based because its `project_doc_max_bytes` truncation is a byte cap; Claude
   Code has no documented hard cap, so its entry is an explicitly labelled project policy budget
   in estimated tokens.
4. **Token figures are estimates** (`bytes / 4`), labelled as such, and may only ever raise a
   warning — never a blocking failure. Keeps the script zero-dependency like every other
   `scripts/` scanner.
5. **Coverage allowlist is seeded** with today's gaps so the check starts green and only *new*
   modules without an `AGENTS.md` surface — which is the behaviour the request actually asks for.
   A reasonless allowlist entry is a config error (exit 2), not a silent suppression.

## Deviations from the plan

- **Step 2.2 does not warn per chain.** The plan said "for the root file and each chain". Chains
  turned out to be fully covered already: the existing report prints each chain's total, its
  over-budget delta and its ratchet drift, so a second advisory line saying the same thing in
  different units would be noise. Chains instead gained an estimated-token figure on their existing
  report line, and the warning is limited to the root file (against its own hard limit) and to
  individual files (against the tools table). The step title is kept verbatim per the Progress
  convention.
- **Step 3.1 gained a collapse rule.** First discovery run produced 71 findings, ~20 of which were
  single-module packages such as `packages/webhooks/src/modules/webhooks`, whose package-level
  `AGENTS.md` already *is* the module's sheet. A package shipping exactly one module is therefore
  treated as that module, which cut the real gap list to 53.

## Risks

- Changing `analyze()`'s return shape could break the `--json` consumers. Mitigated by adding keys
  additively and keeping `rootBytes`, `chains`, `failures` untouched.
- Over-eager coverage discovery could flood the report. Mitigated by scoping discovery to workspace
  packages and module directories, and by the seeded allowlist.
- A wrong Claude Code limit would be worse than none. Mitigated by recording it as a policy budget
  with that fact stated in the file.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Baseline schema and tool limits

- [x] 1.1 Extend the baseline JSON with `warnAtPercent` and a per-tool limits table — acb394d6a
- [x] 1.2 Make `readBaseline` validate the new keys and default them when absent — acb394d6a

### Phase 2: Warning channel, headroom and per-file sizes

- [x] 2.1 Add the `warnings` channel and the `--strict` flag without touching existing failures — 3bd34cf01
- [x] 2.2 Warn at `warnAtPercent` of every applicable tool limit for the root file and each chain — 3bd34cf01
- [x] 2.3 Scan every AGENTS.md in the repo and warn on individually oversized files — 3bd34cf01

### Phase 3: Coverage guard

- [x] 3.1 Discover workspace packages and module directories, add the seeded coverage allowlist — e62df6dee
- [x] 3.2 Emit coverage warnings and reject reasonless allowlist entries — e62df6dee

### Phase 4: Wiring, tests and docs

- [x] 4.1 Add the `agents:check-budget:ci` script and leave the CI step advisory — 64702eddc
- [x] 4.2 Extend the node:test suite with headroom, strict-mode, coverage and round-trip cases — 64702eddc
- [x] 4.3 Document the warnings, the allowlist and the warn-to-block escalation criterion — 64702eddc
