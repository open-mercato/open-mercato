# Sonnet Harness Evaluation Optimization Follow-up

## Goal

Optimize the standalone AI development harness so the complete 184-case evaluation catalog passes with the Claude runner on the `sonnet` model selector, while the Codex baseline (`modelSelector: "default"`) keeps passing exactly as it does today.

Source doc: `.ai/specs/2026-07-24-standalone-ai-development-harness.md`
Depends on: #4483 (`feat/standalone-app-ai-harness`), stacked from its head `e6c38e0be`.
Sibling follow-up: #4528 (`feat/kimi-cli-runner-harness-evals`) adds a third runner from the same base.

## Scope

- Stack this follow-up on PR #4483 head `e6c38e0be` while keeping the configured PR base `develop`; #4483 must not be modified.
- Measure first: run the deterministic catalog gate, then the complete authenticated Claude/`sonnet` routing matrix, and record sanitized aggregate evidence only.
- Classify each measured failure, then remediate the **smallest shared knowledge owner** — the emitted `AGENTS.md` task router, `.ai/guides/*`, standalone skill `SKILL.md`/`references/*`, or the evaluator's shared prompt contract — never a runner-specific fork of shared guidance.
- Recalibrate `cases.json` expectations only where an expectation is genuinely over-specified against a correct alternative answer; record the justification per case.
- Keep any new tunable additive with defaults byte-identical to today's behavior, per `packages/create-app/AGENT-HARNESS.md` Part 2.
- Rerun the complete Codex routing matrix as the compatibility baseline after remediation.
- Exercise the writable/review lanes the host can safely support (this controller is Linux with attested Bubblewrap, which #4483 could not use on macOS) and report any lane that stays environment-blocked without weakening it.
- Update the governing spec and harness documentation with the measured evidence.

## Non-goals

- No change to runtime modules, APIs, database schema, ACLs, events, widgets, or tenant behavior.
- No new runner: `sonnet` is already the Claude runner's shipped model selector.
- No weakening of any fail-closed gate — routing trace verification, write allowlists, containment/sandbox preflight, oracle integrity, generated-test attestation, review verdict rules, or secret redaction.
- No per-case runner fallback, mixed primary ownership, or model-specific branch inside shared guidance.
- No gratuitous edits to runner-enumeration lines or `release-matrix.json` `routing.runners` keys that #4528 must extend with `kimi`.
- No provider credentials, authentication stores, raw model transcripts, or local evaluation artifacts committed.

## Implementation Plan

### Phase 1: Reproducible measurement controller

1. Build a harness-equipped controller app from this branch and prove the deterministic 184-case gate passes.
2. Establish a reusable, sanitized sweep driver that runs a full routing matrix per runner and emits a per-case failure classification.

### Phase 2: Baseline measurement

1. Run the complete authenticated Claude/`sonnet` routing matrix and record the baseline pass rate and per-case violation classes.
2. Run a Codex control sample over the same cases to separate model-specific failures from harness defects that affect every runner.

### Phase 3: Evidence-driven remediation

1. Remediate shared-owner routing/authority defects surfaced by the sweep and rerun the affected plus mandatory cases.
2. Remediate the remaining declaration/observation discipline failures in the shared prompt contract and emitted router.
3. Recalibrate only genuinely over-specified catalog expectations, with a per-case justification, and prove the complete `sonnet` matrix.

### Phase 4: Compatibility baseline

1. Rerun the complete Codex routing matrix and fix any regression without forking shared guidance.
2. Exercise the writable/review lanes this Linux host supports and report every environment-blocked lane exactly.

### Phase 5: Delivery gates

1. Add regression coverage for every changed contract and run the targeted create-app/CLI suites.
2. Update the governing spec, `AGENT-HARNESS.md`, and operator documentation with measured evidence.
3. Run the configured repository validation gate, complete review/autofix, publish PR evidence, and hand off.

## Risks

- Live model evaluation is non-deterministic; a single passing sweep can hide a marginal case. Mitigation: rerun the cases touched by every remediation batch plus a fixed mandatory set, and report attempt/correction counts rather than a bare pass rate.
- Optimizing for one model can regress another. Mitigation: shared knowledge-owner edits only, a Codex control sample during tuning, and the complete Codex matrix before delivery.
- Recalibrating `cases.json` can silently hide a real defect. Mitigation: every expectation change carries a written justification naming the correct alternative answer it admits, and no change may remove a `required` route, skill, context path, or decision.
- #4483 is unmerged and #4528 is stacked from the same head. Mitigation: keep this branch on 4483's exact head, prefer shared-owner edits, avoid runner-enumeration churn, and re-check #4528 for convergence during implementation.
- The full writable/browser release gate needs trusted Bubblewrap and private loopback. Mitigation: do not weaken preflight; run every safely supported lane and report the exact remaining operator command for anything blocked.
- Provider cost/time for repeated 184-case sweeps is significant. Mitigation: batch execution, target reruns to affected plus mandatory cases, and keep full sweeps for baseline and final proof.

## Progress

PR: #4529

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Reproducible measurement controller

- [x] 1.1 Build the harness controller app and prove the deterministic gate — 184/184 deterministic on a Linux controller scaffolded from this branch
- [ ] 1.2 Add the sanitized full-matrix sweep driver and failure classifier
- [x] 1.3 Fix the Claude runner adapter tool-exposure defect

#### 1.3 finding (root cause of the whole Claude lane failing)

The Claude lane could never pass a single case, for adapter reasons rather than model capability. Measured against the real CLI (2.1.220):

- `--tools` selects only from the **built-in** tool set, so passing `mcp__harness__read` there resolved to **zero** tools. That also removed the built-in deferred-discovery tool, which is the only way an MCP tool becomes callable in this CLI — the model reported "No read tool is exposed in this session's function list".
- `--safe-mode` disables every customization **including `--mcp-config` servers**; the init event reported `mcp: []` with it and `mcp: [{name:"harness"}]` without it.
- `--permission-mode plan` returns a plan instead of performing the reads the trace gate requires.

The MCP tool server itself was proven conformant (correct `initialize`, `notifications/initialized`, and `tools/list` exchange over stdio). Fixed by exposing exactly one built-in discovery tool, permission-allowlisting the harness MCP tools, and using a non-plan mode. Isolation is preserved by `--setting-sources ''`, verified by probe: skills NONE, hooks no, project instruction files not auto-injected — so the traced MCP read stays the only route to app content. `OMH-001` went from fail to pass immediately.

The existing tests could not catch this: the fake `claude` binary asserted exactly the flags the code passed, so the contract was self-confirming. Replaced with property assertions about the real contract.

### Phase 2: Baseline measurement

- [ ] 2.1 Measure the complete Claude/sonnet routing baseline
- [ ] 2.2 Measure the Codex control sample for the same cases

### Phase 3: Evidence-driven remediation

- [ ] 3.1 Remediate shared-owner routing authority defects
- [ ] 3.2 Remediate declaration/observation discipline in the shared contract
- [ ] 3.3 Recalibrate over-specified expectations and prove the complete sonnet matrix

### Phase 4: Compatibility baseline

- [ ] 4.1 Prove the complete Codex routing baseline remains green
- [ ] 4.2 Exercise host-supported writable/review lanes and report blocked lanes

### Phase 5: Delivery gates

- [ ] 5.1 Add regression coverage and run targeted suites
- [ ] 5.2 Update spec, harness, and operator documentation with measured evidence
- [ ] 5.3 Run the configured gate, complete review/autofix, and publish PR evidence
