# Structured catalog installation proposal

## Goal

Publish a design-only PR proposing structured module installation metadata and locally generated commands, assigned to `wojciechszyjka` for architectural review.

## Scope

Document the catalog/create-app boundary, validation, third-party consent, compatibility rollout, and implementation/test plan. Update the existing module-picker spec and specification index to point to the proposal. No runtime code, catalog deployment, dependency, database, or automation-policy changes belong to this run.

Source doc: .ai/specs/2026-06-09-create-app-module-picker.md

## Implementation Plan

### Phase 1: Ground and draft the proposal

1.1 Trace the current picker, selection plan, and CLI installer; record scope and autonomous defaults.
1.2 Write the structured-installation specification, compatibility bridge, acceptance criteria, and implementation/test breakdown; cross-link existing documentation.

### Phase 2: Verify and hand off

2.1 Run documentation checks and the specification review, including independent scope-cohesion review; resolve actionable findings.
2.2 Finalize PR metadata, evidence, and assignment to Wojciech Szyjka; release the run claim and clean up the worktree.

## Risks

- The catalog publisher is outside this checkout. The proposal must describe its coordinated change without claiming it is implemented or verified.
- Existing catalog and saved-plan consumers require additive fields and a bounded legacy adapter; no silent schema-version switch or immediate field removal.
- This is a completed proposal, not a completed runtime refactor. Keep the design PR draft by intent.

## Validation

Documentation-only gate: manual code-grounded review, `git diff --check`, local reference checks, and any configured Markdown-specific checks. Runtime validation commands do not apply to this document-only change and will be disclosed as skipped. No dependency installation is necessary.

## Verification Evidence

Runner: local. Documentation-only validation passed: whitespace, 13 introduced local links, new-spec fences, required sections, and index/related-spec cross-links. No Markdown-specific command is configured; runtime validation commands were skipped as inapplicable. Independent scope and code-grounded specification reviews found no blocking, major, or Medium findings. Low findings were resolved in e577a0ca8 (publisher handoff) and ef385a25d (core-enable advice and regression coverage).

## Progress

PR: #8775

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Ground and draft the proposal

- [x] 1.1 Trace the current picker, selection plan, and CLI installer; record scope and autonomous defaults. — 5f2f13da7
- [x] 1.2 Write the structured-installation specification, compatibility bridge, acceptance criteria, and implementation/test breakdown; cross-link existing documentation. — 5f2f13da7

### Phase 2: Verify and hand off

- [x] 2.1 Run documentation checks and the specification review, including independent scope-cohesion review; resolve actionable findings. — ef385a25d
- [ ] 2.2 Finalize PR metadata, evidence, and assignment to Wojciech Szyjka; release the run claim and clean up the worktree.
