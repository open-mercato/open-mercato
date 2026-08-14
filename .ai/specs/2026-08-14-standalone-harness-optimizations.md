# Standalone Harness Session Resilience & Deterministic Template Gates

**Date**: 2026-08-14
**Status**: Ready for implementation
**Evidence**: [#5266](https://github.com/open-mercato/open-mercato/issues/5266) — `opencode-library-task-glm52` session report (OpenCode 1.18.18 + GLM-5.2, high reasoning)

## TLDR

**Key Points:**
- Harden the standalone-app AI harness (`packages/create-app/agentic/**` + `packages/create-app/template/**`) against the failure modes proven by the #5266 session: a quota-killed run left a non-compiling file, a progress ledger that misrepresented eight written files as "not started", a missing migration, one design-token violation, and a session-share report that could not name its own stop cause.
- Two thrusts. **(a) Session resilience:** `om-implement-spec` gains a per-slice ledger-write invariant, a resume/reconciliation contract, and an atomic edit-sequence rule; `om-share-this-session`/`om-judge-agent-session` gain stop-cause extraction and classification. **(b) Deterministic template gates:** the emitted app's `typecheck` gets the same heap headroom its `build` already has, and the template ships `ds:check` and `i18n:check-hardcoded` scripts wired into the validation gate; the spec exit gate gains an ephemeral-database integration lane so skipping integration tests requires an explicit, reviewable `integration: blocked` ledger entry instead of passing silently.

**Scope:**
- Per-slice progress ledger invariant + resume reconciliation in `om-implement-spec` (repo-local emitted skill) and the `om-auto-implement-spec` override notes
- Atomic edit-sequence rule (agent-side exhaustion resilience)
- `NODE_OPTIONS=--max-old-space-size=8192` on the template `typecheck` script, with guard-test parity
- `ds:check` deterministic design-token checker shipped in `template/scripts/`, added to the standalone validation gate
- `i18n:check-hardcoded` checker shipped in `template/scripts/` (advisory first)
- Ephemeral integration lane (`test:integration:ephemeral` via `om-prepare-test-env`) wired into the final-phase exit gate of `om-implement-spec`
- Stop-cause field in `om-share-this-session` bundles/issue template + termination classification in `om-judge-agent-session`
- Framework-lib contract digest (`.ai/guides/framework-contracts.md`) closing the one context gap the implemented read-policy/facts specs do not own

**Concerns:**
- Bundles several independently shippable deliverables; kept in one spec because they share one evidence base (#5266) and one owning surface (the emitted harness), and every phase is individually shippable (see Resolved assumptions).
- The emitted root `AGENTS.md` sits at 10,983 of its 12,288-byte budget — every instruction change in this spec must fit ~1.3 KiB of headroom or trade bytes elsewhere.

## Resolved assumptions (autonomous defaults)

| # | Assumption | Default applied | Why |
|---|---|---|---|
| A1 | One spec vs split | One spec, five independently shippable phases — **explicit user instruction**; the adversarial scope review recommended SPLIT (boundaries = the five phases) and that recommendation is preserved here for the maintainer | The requester asked for a single spec covering the #5266 optimizations. Phases share no code-level dependencies (verified after the 2026-08-14 review fix: Phase 2 no longer touches `AGENTS.md`), so implementation can still ship one phase — or one split-out spec — per PR without renegotiation. |
| A2 | Where skill changes land | This repo (`packages/create-app/agentic/shared/ai/skills/**`) | `om-implement-spec`, `om-share-this-session`, `om-judge-agent-session`, `om-framework-context` are repo-local core-tier skills per `tiers.json`; only override notes touch the external `om-auto-implement-spec`. No `open-mercato/skills` PR is required. |
| A3 | 429/provider-exhaustion scope | Harness-side mitigations only | The OpenCode runner's retry behavior is out of our control; the harness can only make interruption cheap (continuous ledger, atomic edit sequences, resume contract). |
| A4 | `ds:check` / `i18n:check-hardcoded` severity | `ds:check` hard-fails; `i18n:check-hardcoded` advisory in this spec, promoted later | The DS rules checked are the same ones `writable-ast-oracles.mjs` already hard-fails in harness evals, so app code should meet the same bar; the i18n checker needs an allowlist workflow before it can gate (mirrors the monorepo's Phase-1-advisory precedent in `2026-05-26-missing-translations-audit-and-remediation.md`). |
| A5 | Context-replay ownership | Defer to implemented specs; add only the framework-lib digest | `2026-07-24-standalone-ai-development-harness.md` and `2026-08-01-standalone-harness-example-read-policy.md` own routing, budgets, and bounded `node_modules` reads. The #5266 session's residual gap — shared-lib contracts (CRUD factory hooks, `CommandHandler`, events emit semantics) have no fact sheet, so agents read `node_modules` sources — is the only new deliverable. |
| A6 | Existing scaffolds | New scaffolds get everything; existing apps adopt via upgrade notes | `.ai/agentic.config.json` is registered user-owned/never-overwritten by the harness manifest, so gate changes cannot be force-synced; `om-apply-upgrade-notes` is the adoption path. |

## Overview

The standalone harness is the AI context and skill set emitted into every `create-mercato-app` scaffold. Issue #5266 shared a complete, sanitized OpenCode + GLM-5.2 session implementing a two-phase library spec in such a scaffold. The session is the best full-length field evidence the harness has: one user turn, 115 assistant turns, Phase 1 delivered fully green, and then a hard stop on a provider quota error. The post-mortem (analysis comment on #5266) found the harness — not the model — left recoverable value on the table: the run's death was undetectable from its own report, its progress ledger was stale the moment it mattered, and three of the four residual code defects (DS token violation, hardcoded English server errors, missing integration tests) are mechanically detectable but nothing in the emitted app detects them.

> **Market reference**: the `om-auto-create-pr-loop` skill in this repo's own automation collection (run folders with a per-step Tasks table, one lean commit per step, checkpoint batching, resume via `om-auto-continue-pr-loop`) is the direct, in-house model for the per-slice ledger and resume contract — adopted. The digest-over-source-reading rule is adopted from the already-implemented read-policy and harness specs rather than re-specified. We reject building a runner-side retry/backoff wrapper: it belongs to OpenCode/Claude-Code upstream, not to an emitted repo harness.

## Problem Statement

Concrete failures from #5266, each mapped to the harness surface that should have absorbed it:

1. **Stale ledger on interruption.** `om-implement-spec`'s planning-and-progress contract already requires recording each slice after it lands, but the run updated the spec's Implementation Status only at the phase boundary. When the 429 hit mid-Phase-2, the ledger said "Loan entity + migration + commands — not started" while eight Phase-2 files existed on disk, one of them non-compiling. A resuming agent trusting the ledger re-does a phase; one trusting the tree misses the broken file. Nothing in the skill defines re-entry at all.
2. **Non-atomic edit sequence.** The final completed tool call removed an import; the statement referencing it (`void bookOptionSchema`) survived in the same file. The two-step removal left the tree broken in the window between edits — exactly where the quota kill landed.
3. **Typecheck OOM is a solved problem the template forgot.** The emitted `build` script carries `NODE_OPTIONS=--max-old-space-size=8192` (guarded by `template-build-memory.test.ts`); `typecheck` is bare `tsc --noEmit`. The session burned a turn and ~13k reasoning tokens rediscovering the flag — pure waste even for a model that diagnoses it correctly, and a misdiagnosis risk besides.
4. **DS rules are enforced in evals but not in apps.** `writable-ast-oracles.mjs#uiPolicyFailures()` deterministically rejects hardcoded palette classes, arbitrary Tailwind values, and manual `dark:` overrides — for harness eval cases only. The scaffolded app has no `ds:check`; the one starter DS test is stripped by `SKIP_DIRS`. The session shipped `text-amber-600 dark:text-amber-500` and passed the full gate.
5. **Hardcoded user-facing strings pass the gate.** The monorepo has `i18n:check-hardcoded`; the template ships nothing in that direction. The session shipped English-only server-side errors despite the spec requiring localized ones, and the gate stayed green. (The implemented locale-catalog oracle checks the *other* direction: referenced keys → catalogs.)
6. **The exit gate cannot run integration tests.** Migrations may not be applied to the dev DB without user confirmation (correct rule), and `om-implement-spec` never mentions the ephemeral runner `om-prepare-test-env` wraps — so "TEST-001/002 pending migration application" became a legitimate-looking way to declare a phase built with zero of the spec's mandated integration tests written. (The fix makes the skip explicit and reviewable rather than impossible: the gate is still agent-reported, but a `blocked` entry is a visible finding for review skills where today's silence is not.)
7. **The share report couldn't name the stop cause.** The #5266 issue says the session "stopped … with an empty final assistant entry"; `session.json` entry 115 plainly records `APIError 429 "Usage limit reached for 5 hour", isRetryable: true`. `om-share-this-session` has no stop-cause field and `om-judge-agent-session` no termination classification, so the single most diagnostic fact of the run was lost to the human reader.
8. **Shared-lib contracts have no digest.** The session read `crud/factory.ts`, `data/engine.ts`, `commands/*`, `events/factory.ts` under `node_modules/@open-mercato/shared` to answer questions ("does the factory double-emit when actions use commands?", "what is the `CommandHandler` shape?", "is there an `afterList` hook?") that are stable, documentable contracts. Module fact sheets exist per enabled module; nothing covers the shared libraries.

## Proposed Solution

Fix each failure at the smallest owning surface, and keep every emitted-knowledge change inside the knowledge-governance contract (failure-first harness case, then the knowledge change, then `harness:validate-knowledge-change`). Enforcement strategy is two-tier and stated honestly: where a script can own the check (heap flag, DS tokens, hardcoded strings, stop-cause extraction) the check is deterministic; where the contract is agent behavior (ledger discipline, resume, atomic edits, the ephemeral gate) it is necessarily prose — so each such rule is written to be *checkable in text* (a completed slice has a ledger line; a resumed run's plan names reconciliation) and gets a harness eval case that fails when the behavior is absent. Prose backed by an eval is weaker than a script but strictly stronger than today's prose backed by nothing.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Ledger-write is part of the slice, not a courtesy after it | "A slice is complete when its ledger line exists" is checkable in text and survives any interruption point; "update the ledger regularly" demonstrably does not. |
| Resume = reconcile, never trust | On re-entry the ledger is a hypothesis; `git status` + focused typecheck are the evidence. Cheapest ordering: typecheck first (finds the broken file from failure mode 2 immediately), then diff tree vs ledger. |
| `ds:check` reuses the oracle's rule family, not the oracle — and never modifies the oracle | The eval oracle is controller-owned, 115 KB, and coupled to case plumbing; refactoring it to import external data would risk regressing existing eval cases. Instead `ds-check.mjs` exports its rule table, and a create-app unit test asserts that table stays aligned with the oracle's `uiPolicyFailures` patterns. `writable-ast-oracles.mjs` is not touched. |
| Gate scripts live in `template/scripts/`, not `__tests__` | `SKIP_DIRS` strips `__tests__`/`__integration__` at scaffold time; scripts survive. |
| Ephemeral lane is an exit-gate step, not a validation command | `validation.commands` runs on every gate invocation; booting testcontainers Postgres each time is too slow. The final-phase exit gate is the right frequency, and `om-prepare-test-env` already owns provisioning, locking, and the never-touch-the-dev-DB rule. |
| Stop cause is extracted mechanically in `prepare-share-bundle.mjs` | The last session entry's `info.error` (name, status, message) is data the script already touches during sanitization; classification (`completed` / `provider-limit` / `provider-error` / `user-abort` / `unknown`) is a small closed enum the skill prose maps from it. |
| Framework digest is a static authored guide, not generated | Shared-lib contracts change with platform versions, not with the app's module set; the guide ships versioned with the harness and is refreshed through the normal `om-refresh-standalone-harness` flow when platform PRs change those contracts. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Runner-side 429 retry/backoff wrapper | Owned by OpenCode/Claude Code upstream; an emitted repo cannot intercept its own runner's API loop. |
| Force-syncing `validation.commands` into existing apps | `.ai/agentic.config.json` is user-owned by manifest contract; overwriting user config is a harness law violation. |
| One mega-`om-resume` skill | Resume is not a task type; it is a property of `om-implement-spec`'s contract. A separate skill would duplicate the phase/gate logic it must reconcile against. |
| Extending `uiPolicyFailures()` to also walk app `src/` | Couples the app gate to the eval controller's release cycle and packaging; a shared rule-table test gives alignment without coupling. |

## Architecture

All changes live in `packages/create-app/` and flow to apps through the existing emission pipeline (`copyTree(agentic/shared/ai → .ai/)`, template file copy, harness manifest ownership rules). No monorepo runtime package changes; no `apps/mercato` mirror obligations except where the Template Sync Checklist names a touched file class (only `template/scripts/*` and `package.json.template` here — no `src/app/**` surface is touched).

```
packages/create-app/
├── template/
│   ├── package.json.template          # typecheck heap flag; ds:check + i18n:check-hardcoded script entries
│   └── scripts/
│       ├── ds-check.mjs               # NEW — deterministic DS-token checker (uiPolicyFailures rule family)
│       └── i18n-check-hardcoded.mjs   # NEW — hardcoded user-facing string scanner (advisory)
├── agentic/shared/ai/
│   ├── agentic.config.json            # validation.commands += "yarn ds:check"
│   ├── guides/framework-contracts.md  # NEW — shared-lib contract digest
│   └── skills/
│       ├── om-implement-spec/         # ledger invariant, resume contract, atomic edits, ephemeral exit-gate step
│       ├── om-auto-implement-spec/    # override note: inherit the same resume/ledger contract
│       ├── om-share-this-session/     # stop-cause bundle field + issue-template section; script extraction
│       └── om-judge-agent-session/    # termination classification in report template
├── src/lib/template-build-memory.test.ts   # extended: typecheck parity guard
└── agentic/shared/ai/harness/         # new/extended cases + oracle hooks per knowledge governance
```

Contract relationships:

- **Ledger invariant (om-implement-spec).** Slice definition gains: _"A slice is not complete until its `- [x]` ledger line (files, evidence, exact command) is written to the spec's Implementation Status. Write the ledger line before starting the next slice; on any stop mid-slice, append a `- [ ] IN FLIGHT:` line naming files touched so far."_ This makes the ledger's staleness bound one slice, not one phase.
- **Resume contract (om-implement-spec, new reference section).** On invocation where the resolved spec already has an Implementation Status: (1) run the focused typecheck for the in-progress phase **first**; (2) reconcile — `git status`/tree vs ledger; tick slices that verifiably exist and compile, mark broken/partial files in an `IN FLIGHT` line; (3) resume from the first unticked slice. Never re-execute a ticked slice; never trust an unticked one.
- **Atomic edit-sequence rule (om-implement-spec only — deliberately not in the emitted `AGENTS.md`).** _"Paired edits (remove import + remove usage; rename + update call sites within a file) happen in one edit operation. Never end a tool batch with the tree in a known non-compiling state."_ Keeping this out of `AGENTS.md` removes any byte-budget contention between phases: Phase 5 is the only phase that edits `AGENTS.md`.
- **Ephemeral exit-gate step (om-implement-spec, phases-and-gates).** When the spec's Integration Coverage table lists integration tests, the final-phase exit gate MUST: write the test files in-phase, then run them through the `om-prepare-test-env` descriptor path (`yarn test:integration:ephemeral`), which applies migrations to the throwaway DB — the ask-before-`db:migrate` rule stays intact because the dev DB is never touched. If the ephemeral runner is unavailable (no Docker), the gate records `integration: blocked (<reason>)` in the ledger — an explicit blocker, not a silent pass.
- **Stop cause (om-share-this-session / om-judge-agent-session).** `prepare-share-bundle.mjs` emits `stopCause: { classification, lastEntryError: { name, statusCode, message } | null }` into `manifest.json`; the issue template gains `## ⏹ Stop cause`; the judge's report template requires a termination line and treats a `provider-limit` stop as context for — never an excuse from — artifact findings.
- **Framework contract digest.** `.ai/guides/framework-contracts.md` (~6–8 KiB) documents: `CommandHandler` (`prepare`/`execute`/`buildLog`) and `registerCommand`; `makeCrudRoute` surface (metadata gates, `list.transformItem`, `hooks.afterList`/`beforeList`, `actions.{create,update,delete}` command wiring, **commands own event emission — the factory does not double-emit**); `runCrudCommandWrite`; `createModuleEvents`/`eventsConfig.emit` post-commit semantics; optimistic-lock helpers (`assertOptimisticLock`, `expected_updated_at`); `readJsonSafe`; DataEngine `create/update/deleteOrmEntity`. Routing: the emitted `AGENTS.md` Axis-2 `framework-context` row points here **before** the bounded `om-framework-context` resolver; the guide links each contract to its exact installed source path so the escape hatch stays one hop away.

## Data Models

No database entities. Changed machine-readable shapes:

- `manifest.json` (share bundle): additive optional `stopCause` object as above; `manifest` consumers (judge input-normalization) treat absence as `unknown` (backward compatible).
- `agentic.config.json` (emitted): `validation.commands` gains `"yarn ds:check"` after `"yarn lint"`. Additive; existing apps unaffected (user-owned file).
- `harness/cases.json` + `validators.json`: new/extended cases and counts per the knowledge-governance workflow (exact case IDs assigned at implementation time by `om-refresh-standalone-harness` conventions; `expectedCaseCount` and family counts updated in the same change).

## API Contracts

None — no HTTP surface changes. CLI surface: two new package scripts in scaffolded apps, `ds:check` and `i18n:check-hardcoded`, both exit-code contracts (0 clean / 1 findings; `i18n:check-hardcoded` exits 0 in advisory mode with a findings summary on stderr). Both accept `--json` for machine consumption by review skills.

## Edge Cases & Failure Scenarios

- **Kill between edit and ledger write:** the slice's `IN FLIGHT` line or the reconciliation typecheck catches it; worst case is re-doing one slice, never a phase.
- **Ledger says done, file deleted/reverted:** reconciliation is tree-authoritative; the tick is removed and the slice re-queued.
- **`ds:check` false positives** (e.g. a legitimate arbitrary value in vendored code): per-file allowlist `.ds-check-ignore` (same shape as the i18n allowlist), each entry requiring a one-line reason; the script fails on allowlist entries that no longer match anything (stale-allowlist rot guard).
- **Ephemeral runner unavailable (no Docker/testcontainers):** exit gate records an explicit blocker; `om-implement-spec` reports it in its final report instead of claiming the gate green — mirroring the existing "pre-existing failure is a reported blocker" rule.
- **Heap flag on constrained machines:** `--max-old-space-size=8192` is an upper bound, not a reservation — Node allocates lazily, so small machines are unaffected; the value stays in lockstep with the `build` script via the shared guard test.
- **`AGENTS.md` byte budget overflow:** Phase 5 is the only phase that edits `AGENTS.md` (plus Phase 1's Validation-line word swap), and its routing delta rewrites the existing `framework-context` row rather than adding a new one, so the net byte delta is near zero; the `STANDALONE_ROOT_TARGET_BYTES` test decides, and on overflow the row is shortened until it fits — no other phase's content competes for the budget.
- **Stop-cause extraction on malformed session JSON:** classification falls back to `unknown`; the share flow never blocks on it (the field is additive evidence, not a gate).

## Risks & Impact Review

### Risk Register

| Risk | Category | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|---|
| `ds:check` rules drift from the eval oracle's rules | Operational | Medium | Split-brain enforcement (app passes, eval fails) | Create-app rule-parity test asserting the script's exported table matches the oracle's patterns; the oracle itself is never modified, so no eval-regression risk is introduced | Low |
| New gate command breaks existing user workflows | Migration | Low | Existing apps' gates unchanged (user-owned config); only new scaffolds affected | UPGRADE_NOTES entry + `om-apply-upgrade-notes` adoption path | Low |
| Knowledge-governance validator burden makes small prose fixes expensive | Operational | Medium | Slower iteration on skill text | The governance contract already exempts byte-identical asset-sync; batch the skill-text changes per phase so one validated knowledge-change covers each | Accepted |
| Ledger discipline inflates token usage per slice | Operational | Low | A ledger line is ~1–2 lines of output per slice — noise vs the 133k/turn replay measured in #5266 | — | Negligible |
| Ephemeral gate lengthens final-phase wall time | Operational | Medium | Minutes per spec completion | Runs once per spec (final phase), reuses the runner's 600 s build cache TTL | Accepted |
| `i18n:check-hardcoded` noise on framework chrome | Operational | Medium | Alert fatigue → checker ignored | Advisory mode + allowlist with reasons; promotion to hard gate is a separate future decision | Accepted |
| Interrupted mid-migration of harness case counts | Data integrity | Low | `harness:validate --all` fails closed until counts, schemas, and cases re-align | Governance validator is the backstop; changes land atomically per phase PR | Low |

Tenant isolation, encryption, and cascading cross-module failures: N/A — no runtime code, no data paths, no PII. The share-bundle `stopCause` field carries provider error text; `prepare-share-bundle.mjs` already sanitizes message strings (the #5266 bundle redacted the reset timestamp inside the 429 message), and `stopCause.message` goes through the same redaction pass.

## Phasing

Each phase is independently shippable and reversible (revert = restore prior emitted text/scripts; no data migrations anywhere).

- **Phase 1 — Template gate hardening** (typecheck heap parity, `ds:check`, `i18n:check-hardcoded`): pure template + emitted-config additions; ships without any skill change.
- **Phase 2 — Session resilience contract** (`om-implement-spec` ledger invariant, resume contract, atomic edits; `om-auto-implement-spec` override note): pure skill-text + harness-case change.
- **Phase 3 — Ephemeral integration exit gate**: `om-implement-spec` phases-and-gates + `om-prepare-test-env` cross-reference.
- **Phase 4 — Stop-cause reporting**: `om-share-this-session` script + templates, `om-judge-agent-session` report template.
- **Phase 5 — Framework contract digest**: new guide + `AGENTS.md` routing delta (byte-budget-gated).

## Implementation Plan

### Phase 1 — Template gate hardening

1. `template/package.json.template`: change `"typecheck"` to `"cross-env NODE_OPTIONS=--max-old-space-size=8192 tsc --noEmit"`; extend `packages/create-app/src/lib/template-build-memory.test.ts` to assert the flag on `typecheck` and keep it in lockstep with `build`. _Test: the extended guard test._
2. Add `template/scripts/ds-check.mjs`: scans `src/**/*.{ts,tsx}` (excluding `.mercato`, `node_modules`) for the `uiPolicyFailures` rule family — hardcoded palette/status classes (`/(text|bg|border|ring)-(red|green|emerald|amber|…)-\d{2,3}/`), arbitrary Tailwind values, manual `dark:` overrides on semantic/status tokens, inline `style`, raw `<table>` family tags in backend pages; supports `--json` and `.ds-check-ignore` with stale-entry failure. The script exports its rule table; a new create-app unit test asserts that table stays aligned with the oracle's `uiPolicyFailures` patterns — `writable-ast-oracles.mjs` itself is **not modified**. _Test: fixture files with each violation class + a clean fixture; stale-allowlist fixture; the rule-parity test._
3. Add `"ds:check": "node scripts/ds-check.mjs"` to `package.json.template`; add `"yarn ds:check"` to `agentic/shared/ai/agentic.config.json` `validation.commands` (after `"yarn lint"`); update the emitted `AGENTS.md` Validation line within the byte budget. _Test: `yarn agents:check-budget` equivalent for the standalone target (`STANDALONE_ROOT_TARGET_BYTES` test)._
4. Add `template/scripts/i18n-check-hardcoded.mjs` (advisory): flags string literals in JSX text positions, `label/title/placeholder/aria-label/alt` props, and `Error`/`toast`/`flash` calls outside `t(...)`, honoring the `[internal]` prefix opt-out and a module-scoped allowlist; wire `"i18n:check-hardcoded"` script; do **not** add to `validation.commands`. _Test: fixtures for each detection class + opt-outs._
5. Harness/governance sync: add or extend writable cases so a generated module violating the `ds:check` rule family or shipping hardcoded strings is caught in evals (the oracle already implements the family; cases reference it); run the nine-step knowledge-change workflow + `harness:validate-knowledge-change`. _Test: `yarn harness:validate --all` from a fresh scaffold._
6. UPGRADE_NOTES entry documenting manual adoption for existing apps (scripts + config line), consumable by `om-apply-upgrade-notes`.

### Phase 2 — Session resilience contract

1. `om-implement-spec/references/planning-and-progress.md`: add the ledger-write invariant (ledger line before next slice; `IN FLIGHT` line on mid-slice stop) and the ledger-line format including the exact focused command. _Test: harness routing/decision case asserting the invariant text is loaded for spec-implementation prompts._
2. New `om-implement-spec/references/resume.md` + SKILL.md step: the reconciliation procedure (typecheck-first → tree-vs-ledger reconcile → resume from first unticked slice), including the "never re-execute ticked / never trust unticked" rule; cross-link from `om-auto-implement-spec`'s override notes so the PR-delivery engine inherits it. _Test: writable harness case — fixture scaffold with a seeded half-done Implementation Status + one broken file; oracle asserts the agent's plan names reconciliation before new slices._
3. Atomic edit-sequence rule in `om-implement-spec` SKILL.md rules block (deliberately not in `AGENTS.md` — see Architecture; Phase 5 is the sole `AGENTS.md` owner). _Test: knowledge-governance validator run._

### Phase 3 — Ephemeral integration exit gate

1. `om-implement-spec/references/phases-and-gates.md`: final-phase exit gate requires — when the spec lists integration coverage — test files written in-phase and executed via `yarn test:integration:ephemeral` (through the `om-prepare-test-env` descriptor; never plain `test:integration`); unavailable runner → explicit `integration: blocked (<reason>)` ledger entry. _Test: harness decision case — a spec-completion prompt must route the ephemeral lane and must not claim done with an unstated integration gap._
2. Cross-reference from `om-prepare-test-env`'s repo-local SKILL.md ("consumed by the `om-implement-spec` exit gate") and from the emitted `AGENTS.md` integration line (already present: `yarn test:integration:ephemeral` — verify wording covers exit-gate use). _Test: knowledge-governance validator._

### Phase 4 — Stop-cause reporting

1. `om-share-this-session/scripts/prepare-share-bundle.mjs`: extract the final session entries' `info.error` (name, statusCode, sanitized message) and derive `stopCause.classification ∈ {completed, provider-limit, provider-error, user-abort, unknown}`; write into `manifest.json`; route `message` through the existing redaction pass. _Test: script unit fixtures — a 429 session (expects `provider-limit`), a clean-completion session, a malformed tail (expects `unknown`)._
2. `om-share-this-session` issue template: add `## ⏹ Stop cause` section rendering the classification + sanitized error line; update `references/report-templates.md`. _Test: bundle-preparation fixture snapshot._
3. `om-judge-agent-session/references/report-template.md`: mandatory termination line sourced from `manifest.stopCause` (fallback `unknown` for old bundles); rule text: an interrupted run scopes which acceptance criteria are judgeable, but never converts a found defect into a pass. _Test: judge fixture with the #5266-shaped bundle asserting the report names `provider-limit`._

### Phase 5 — Framework contract digest

1. Author `agentic/shared/ai/guides/framework-contracts.md` (~6–8 KiB) covering the contracts listed in Architecture, each with its exact installed source path (`node_modules/@open-mercato/shared/src/...`) as the verification hop. _Test: create-app test asserting every named source path exists in the workspace packages (anti-rot)._
2. Emitted `AGENTS.md`: point the Axis-2 `framework-context` row at the guide before the bounded resolver; stay within `STANDALONE_ROOT_TARGET_BYTES`. _Test: byte-budget test + harness routing cases for shared-lib contract questions (e.g. "does makeCrudRoute double-emit with command actions?") resolving to the guide, not `node_modules` reads._
3. Knowledge-governance run (new knowledge owner + source-link inventory rows + case updates). _Test: `harness:validate-knowledge-change` + `yarn harness:validate --all`._

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/create-app/template/package.json.template` | Modify | `typecheck` heap flag; `ds:check`, `i18n:check-hardcoded` scripts |
| `packages/create-app/src/lib/template-build-memory.test.ts` | Modify | Guard typecheck/build heap-flag parity |
| `packages/create-app/template/scripts/ds-check.mjs` | Create | Deterministic DS-token checker |
| `packages/create-app/template/scripts/i18n-check-hardcoded.mjs` | Create | Advisory hardcoded-string checker |
| `packages/create-app/agentic/shared/ai/agentic.config.json` | Modify | `validation.commands` += `yarn ds:check` |
| `packages/create-app/agentic/shared/ai/skills/om-implement-spec/**` | Modify | Ledger invariant, resume contract, atomic edits, ephemeral exit gate |
| `packages/create-app/agentic/shared/ai/skills/om-auto-implement-spec/SKILL.md` | Modify | Inherit resume/ledger contract in override notes |
| `packages/create-app/agentic/shared/ai/skills/om-share-this-session/**` | Modify | Stop-cause extraction + templates |
| `packages/create-app/agentic/shared/ai/skills/om-judge-agent-session/references/report-template.md` | Modify | Termination classification |
| `packages/create-app/agentic/shared/ai/guides/framework-contracts.md` | Create | Shared-lib contract digest |
| `packages/create-app/agentic/shared/ai/skills/om-prepare-test-env/SKILL.md` | Modify | Cross-reference: consumed by the `om-implement-spec` exit gate |
| `packages/create-app/src/lib/ds-check-rule-parity.test.ts` | Create | Assert `ds-check.mjs` rule table matches the oracle's `uiPolicyFailures` patterns |
| `packages/create-app/template/AGENTS.md` | Modify | Validation line, digest routing row (byte-budget-gated) |
| `packages/create-app/agentic/shared/ai/harness/{cases.json,validators.json,…}` | Modify | Governance-mandated cases/counts/oracle hooks |
| `UPGRADE_NOTES.md` | Modify | Existing-app adoption instructions |

### Testing Strategy

- Unit: `ds-check.mjs` / `i18n-check-hardcoded.mjs` fixture suites; `prepare-share-bundle.mjs` stop-cause fixtures; rule-manifest parity test; source-path anti-rot test; template guard tests (heap flags, byte budget).
- Harness: new/updated routing, decision, and writable cases per phase; `yarn harness:validate --all` green from a fresh scaffold; `harness:validate-knowledge-change` for every knowledge-contract diff.
- No Playwright/UI integration tests: this spec ships no rendered surface (the emitted app's UI is untouched).

## Migration & Compatibility

- All emitted-file changes affect **new scaffolds** on the next create-app release. Existing apps: `.ai/agentic.config.json` and `.ai/lessons.md` are user-owned (never overwritten); skills/guides/harness re-sync through `yarn install-skills` / harness update paths per the existing ownership manifest. UPGRADE_NOTES documents the two manual adoptions (config gate line, package.json script entries).
- `manifest.json` `stopCause` is additive-optional; old bundles remain valid judge inputs (classification `unknown`).
- No BACKWARD_COMPATIBILITY.md contract surface (API routes, DB schema, event IDs, DI keys, import paths) is touched; skill/guide text and template scripts are outside the frozen surfaces. The `validation.commands` addition is additive and lands only in newly emitted configs.
- Rollback per phase = revert the phase's PR; no persisted state anywhere.

## Final Compliance Report — 2026-08-14

### AGENTS.md Files Reviewed
- `AGENTS.md` (root) — Task Router rows: create-app/Template Sync, harness/agent-instructions, spec lifecycle
- `packages/create-app/AGENTS.md` — Template Sync Checklist, Dev Runtime Expectations
- `.ai/specs/AGENTS.md` — naming, lifecycle, changelog conventions
- `.ai/docs/agent-instructions.md` (routed) — instruction budget contract

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Check existing specs before modifying a module | Compliant | Overlap audit against 8 prior harness specs recorded in Resolved assumptions A5; owned topics deferred, not re-specified |
| root AGENTS.md | Never edit generated files by hand | Compliant | `design-system-inventory.json` untouched; harness counts updated through the governance workflow |
| root AGENTS.md | Preserve behavior unless a spec asks for change | Compliant | All behavior deltas are this spec's explicit subject |
| create-app AGENTS.md | Template Sync Checklist for `apps/mercato` mirrors | Compliant | No `src/app/**`/env surface touched; `template/scripts/` additions are template-only by design |
| create-app (emitted) | `STANDALONE_ROOT_TARGET_BYTES` 12 KiB budget | Compliant | Byte-budget test gates every `AGENTS.md` edit; explicit overflow fallback defined in Edge Cases |
| knowledge-governance spec | Knowledge-contract changes require failure-first cases + validator | Compliant | Named per phase; batched one validated change per phase |
| root AGENTS.md | No cross-module ORM / tenant scoping / encryption maps | N/A | No runtime entities, queries, or PII columns in scope |
| root AGENTS.md (DS rules) | No hardcoded status colors / arbitrary values | Compliant | The spec's deliverable enforces exactly this; no UI code shipped |
| BACKWARD_COMPATIBILITY.md | Contract surfaces frozen | Compliant | None touched (see Migration & Compatibility) |
| `.ai/qa/AGENTS.md` | Integration coverage listed and shipped in-change | Compliant | Testing Strategy is unit + harness; no API/UI paths exist to cover — and Phase 3's deliverable is precisely the enforcement of this rule in scaffolds |

### Internal Consistency Check
Every problem statement (1–8) is owned by exactly one phase, and every phase owns at least one problem (Phase 1 ← problems 3/4/5, Phase 2 ← 1/2, Phase 3 ← 6, Phase 4 ← 7, Phase 5 ← 8); every phase names its tests; the File Manifest covers every Implementation Plan step; assumptions A1–A6 are each referenced by the section they resolve. `AGENTS.md` has a single owning phase (5), so no cross-phase byte-budget negotiation exists.

Verdict: `Ready for implementation` (autonomous defaults surfaced for review on the spec PR).

## Changelog

| Date | Change |
|---|---|
| 2026-08-14 | Initial draft from #5266 session post-mortem; overlap audit vs implemented harness specs; autonomous defaults A1–A6 applied |
| 2026-08-14 | Adversarial fresh-context review applied: SPLIT recommendation recorded in A1 (kept as one per explicit user instruction; phases remain split-ready); removed the Phase 2↔5 `AGENTS.md` byte-budget dependency (Phase 5 is now sole owner); `ds:check` no longer modifies `writable-ast-oracles.mjs` (rule-parity test instead); enforcement two-tier strategy stated honestly; integration-gate claim softened to explicit-and-reviewable; File Manifest completed |

### Review — 2026-08-14
- **Reviewer**: Agent (fresh-context adversarial subagent, spec file only)
- **Security**: Passed (no runtime surface; stop-cause text routed through existing bundle sanitization)
- **Performance**: Passed (gate additions bounded; ephemeral lane once per spec completion)
- **Cache**: N/A (no cache usage)
- **Commands**: N/A (no commands/mutations; skill-text contracts only)
- **Risks**: Passed after fixes (oracle-regression risk eliminated by design change; byte-budget contention eliminated)
- **Verdict**: Approved as one spec per explicit requester instruction, with the SPLIT recommendation preserved in A1 for the maintainer
