# Kimi CLI Runner and Harness Evaluation Follow-up

## Goal

Add Kimi CLI as an authenticated standalone-harness runner, evaluate the complete 184-case catalog with Kimi, remediate model-specific failures in the smallest shared knowledge owner, and prove the existing Codex baseline remains green.

Source doc: `.ai/specs/2026-07-24-standalone-ai-development-harness.md`

## Scope

- Stack this follow-up on PR #4483 head `e6c38e0be` while keeping the configured PR base `develop`; the PR depends on #4483 until it merges.
- Add `kimi` additively to evaluator/release runner selection, model configuration, result schemas, help text, operator docs, and tests.
- Integrate Kimi through its non-interactive JSONL contract (`kimi --output-format stream-json --prompt <prompt>`) with the same exact-path MCP, filesystem containment, environment narrowing, trace verification, and result validation used by existing runners.
- Run deterministic validation plus all 184 authenticated routing cases on Kimi, use measured failures to optimize only the smallest relevant shared harness owner, and rerun affected/mandatory cases after each adjustment.
- Rerun all 184 authenticated routing cases on Codex as the compatibility baseline.
- Exercise writable/release coverage that the current host can safely support; preserve the existing fail-closed Linux/Bubblewrap requirement and report any environment-blocked release lane without weakening it.
- Update the existing source specification and harness documentation with the additive runner contract and evaluation evidence.

## Non-goals

- No changes to runtime modules, APIs, database schema, ACLs, events, widgets, or tenant behavior.
- No per-case fallback, mixed runner ownership, or relaxation of routing, write allowlist, oracle, generated-test, review, secret-redaction, or containment gates.
- No change to Codex or Claude invocation semantics or default model selectors except fixes required by evidence and covered by regression tests.
- No provider credentials, authentication stores, raw model transcripts, or local-only evaluation artifacts committed to the repository.
- No attempt to bypass the Linux-only full release preflight on macOS.

## Implementation Plan

### Phase 1: Additive Kimi runner contract

1. Add a tested Kimi invocation, credential isolation/environment handling, JSONL final-response and trace parsing, and additive runner validation without changing Codex/Claude paths.
2. Extend release matrices, schemas, generated assets, operator docs, and the governing spec for Kimi while preserving current public CLI/result contracts.

### Phase 2: Evidence-driven Kimi optimization

1. Run the deterministic catalog and complete 184-case authenticated Kimi routing matrix, recording only sanitized aggregate evidence.
2. Classify Kimi failures, modify the smallest shared harness knowledge owner or adapter contract, and rerun affected plus mandatory cases until the complete Kimi routing matrix passes.
3. Exercise supported Kimi writable/review/release lanes without weakening containment and document any host-gated Linux release work.

### Phase 3: Codex compatibility and delivery gates

1. Run the complete 184-case Codex routing baseline and fix any compatibility regression without Kimi-specific forks in shared guidance.
2. Run targeted create-app/CLI tests, standalone/Verdaccio coverage where package boundaries require it, and the configured repository validation gate using the selected local runner.
3. Complete backward-compatibility/security self-review, automated PR review/autofix, PR evidence, labels, and ready-for-review handoff.

## Risks

- Kimi persists sessions and has no top-level sandbox flag. Mitigation: fresh process per case, isolated writable home/config where supported, no session resume, mandatory outer containment, and the evaluator-owned exact-path MCP as the only accepted model tool surface.
- Kimi stream JSON differs from Codex/Claude events. Mitigation: a runner-specific parser with malformed/no-final-response failures and unit fixtures for assistant, tool, meta, and error events.
- Model-specific prompt tuning could regress Codex. Mitigation: shared knowledge-owner edits only, affected/mandatory reruns during tuning, then the complete Codex matrix.
- PR #4483 is not merged. Mitigation: keep this branch based on its exact head, target configured `develop`, state the dependency in the PR, and avoid duplicating or rewriting #4483 history.
- The full writable/browser release gate requires trusted Linux Bubblewrap and private loopback, unavailable on the native macOS authoring host. Mitigation: do not weaken preflight; run every safely supported lane and report the exact remaining operator command if Linux evidence is blocked.

## Progress

PR: #4528

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Additive Kimi runner contract

- [x] 1.1 Add and test the Kimi runner adapter and trace contract — 838606492, 9765854a5
- [x] 1.2 Extend schemas, matrices, docs, generated assets, and source spec — 838606492

### Phase 2: Evidence-driven Kimi optimization

- [ ] 2.1 Run deterministic and complete authenticated Kimi routing evaluation
- [ ] 2.2 Remediate measured Kimi failures and prove the final Kimi matrix
- [ ] 2.3 Exercise supported Kimi writable and release lanes without weakening containment

### Phase 3: Codex compatibility and delivery gates

- [ ] 3.1 Prove the complete Codex baseline remains green
- [ ] 3.2 Run targeted, standalone, and configured full validation gates
- [ ] 3.3 Complete reviews, PR evidence, labels, and ready handoff

## Handoff — 2026-07-26

### Completed

- Added Kimi 0.29.1 as a third additive evaluator/release runner, including CLI validation, schemas, release matrix selectors, help text, operator docs, and the governing source spec.
- Isolated Kimi `HOME`/`KIMI_CODE_HOME`, copied only allowlisted regular authentication/config files with private modes, disabled discovered skills, and selected a custom v2 agent whose only tools are the evaluator-owned MCP `read` plus `write` for explicitly writable cases.
- Parsed Kimi JSONL final Assistant output and function-call argument strings, retained exact trace enforcement, and added Kimi `tool_call_id` correlation for refused MCP reads.
- Added focused fake-runner coverage for isolated configuration, exact arguments, MCP-only tooling, auth redaction inputs, JSONL parsing, and refused-read evidence.
- Merged the current Sonnet sibling branch (#4529) at `19f67fc88`, including its shared Claude adapter, refused-read, routing-guidance, and instruction-budget fixes. The combined harness/release/budget suite passed: 120 passed, 5 platform skips, 0 failed.
- Generated a fresh standalone controller from this branch and passed deterministic validation for all 184 cases.
- Restored the machine's Kimi device authorization with the documented `kimi login` flow after the CLI reported an empty/expired local credential; no credential values or raw transcripts were persisted or committed.
- Ran `yarn build:packages` successfully with the local validation runner.

### TODO for continuation

- Rebuild a fresh controller and rerun authenticated `OMH-001` after `9765854a5`. The prior real run reached the exact-path MCP server and observed `AGENTS.md` plus `.ai/guides/architecture.md`, but timed out at the 180-second model bound and its refused extra-route probes were misclassified because the JSON-string argument recursion dropped Kimi's `tool_call_id`; that correlation bug is now fixed and unit-tested but has not yet been re-proven against the real CLI.
- Run the complete authenticated Kimi routing matrix: `PATH="/Users/piotrkarwatka/.kimi-code/bin:$PATH" node scripts/evaluate-agent-harness.mjs --runner kimi --all`. Classify aggregate sanitized failures, tune only the smallest shared knowledge owner, and rerun affected plus mandatory cases until 184/184 passes.
- Exercise representative writable/review coverage with Kimi on disposable fresh targets. Do not weaken the full release preflight: the native macOS host cannot safely run the Linux/Bubblewrap loopback lanes, so the complete 39-case writable/generated-test/review release command remains a Linux handoff if no suitable host becomes available.
- Run the complete authenticated Codex routing baseline (`--runner codex --all`) after Kimi tuning and resolve any shared-guidance regression.
- Fetch #4529 again before final review and merge any commits added after `19f67fc88`; preserve its shared Sonnet tuning rather than reimplementing or overwriting it.
- Run the remaining configured validation sequence after the already-passing first `yarn build:packages`: `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app` (Runner: local).
- Complete `om-code-review`, `om-auto-review-pr`, PR labels/evidence, remove `in-progress`, and mark #4528 ready only after the Kimi and Codex matrices and all executable gates pass.
