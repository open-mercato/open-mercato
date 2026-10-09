# Standalone module tool guidance

## Goal

Teach agents in scaffolded Open Mercato applications to use `create-mercato-module` when creating, exporting, publishing, or continuing development of a custom module, and document that workflow for users.

## Scope

- Add concise routing and one authoritative tool guide to the standalone AI harness.
- Cover local authoring, GitHub/npm publication, saved preferences, authentication, dry runs, and linked development using the published tool's actual interface.
- Add a framework documentation page and relevant navigation links.
- Extend focused harness coverage and supply the required knowledge-change evidence.
- Repair validation prerequisites exposed by real execution: preserve supported Arch Linux merged-usr aliases in the existing sandbox whitelist, adapt Codex strict output schemas at the transport boundary, calibrate five stale compatibility context totals, and supply tenant/organization scope in two progress test fixtures. Canonical response contracts, sandbox permissions, and production progress behavior remain unchanged.

Non-goals: changing the framework CLI or module contracts, sandbox images, release automation, npm account permissions, or the user's PR #6688 checkout.

Source doc: `.ai/specs/2026-08-01-standalone-harness-knowledge-governance.md`

## Implementation Plan

### Phase 1: Guidance and documentation

1.1 Audit routing owners and add a focused regression for standalone module tool guidance.
1.2 Add the canonical standalone tool guide and route relevant module tasks to it.
1.3 Document the user workflow in the framework docs and link it from module development.

### Phase 2: Verification

2.1 Validate focused coverage, knowledge-change evidence, emitted assets, instruction budgets, and fresh scaffold output.
2.2 Run the applicable repository validation gate and record any external blockers honestly.

### Phase 3: Review and delivery

3.1 Run the authoritative `om-auto-review-pr` pass, address findings, and finalize the PR with verification evidence.

## Risks

- Agent routing is a knowledge contract: owner/case/evaluator evidence must remain consistent.
- npm publication requires the user's physical 2FA; the guide must distinguish supported authentication modes from configuration performed automatically.
- The harness release gate may require external runner credentials and isolated targets; unavailable prerequisites must be reported rather than represented as passing.
- Codex transport normalization must preserve canonical nullable values and leave invalid required fields, unknown fields, and duplicates for canonical rejection.
- Sandbox alias compatibility must preserve only explicit accepted relative targets; it must not add mounts or process permissions.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Guidance and documentation

- [x] 1.1 Audit routing owners and add a focused regression for standalone module tool guidance. — f2c47e2a5
- [x] 1.2 Add the canonical standalone tool guide and route relevant module tasks to it. — f2c47e2a5
- [x] 1.3 Document the user workflow in the framework docs and link it from module development. — 30a3e19d9

### Phase 2: Verification

- [x] 2.1 Validate focused coverage, knowledge-change evidence, emitted assets, instruction budgets, and fresh scaffold output. — focused31/31, evaluator58/58, real base/head knowledge controller PASS, final packed four-preset OMH-238 checks PASS, classic deterministic238/238, actual isolated Codex OMH-238 and OMH-216 PASS. Adjacent evidence, manifest, sanitized controller projection, and derived validation summary record the scope and limitations.
- [x] 2.2 Run the applicable repository validation gate and record any external blockers honestly. — local ordered gate passed: build:packages, generate, build:packages, i18n:check-sync, i18n:check-usage, typecheck, test, build:app. Documentation production build and agent instruction-budget check also passed.

### Phase 3: Review and delivery

- [x] 3.1 Run the authoritative `om-auto-review-pr` pass, address findings, and finalize the PR with verification evidence. — full review at3f704b864 found no blocker, major, minor, or nit findings. GitHub rejected formal self-approval; the complete review is posted as a comment and independent approval remains required. PR body, labels, and run summary record verification and pending CI. No merge performed.

PR: #7126
