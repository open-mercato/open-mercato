# Standalone App AI Harness Rewrite

## Goal

Replace the AI development harness emitted by `create-mercato-app` with a standalone-only, progressively disclosed system that helps coding agents implement and debug Open Mercato applications in one shot while following the installed framework's real contracts.

## Scope

- Rewrite the generated root agent instructions as a compact task router with mandatory safety boundaries.
- Consolidate and rewrite the local standalone skills into thin routers with task-specific references.
- Keep the selected `open-mercato/skills` automation workflow available through a reliable cross-platform installer.
- Add on-demand access to the exact installed framework's source and package/module `AGENTS.md` hierarchy, plus the upstream root compatibility context.
- Add a repeatable skill and fixture workflow for extending the harness with newly discovered use cases.
- Add at least 40 representative standalone-app use cases and executable static/live-agent validation.
- Keep the create-app wizard and `mercato agentic:init` output equivalent, and verify a real generated app.

## Non-goals

- Do not rewrite the monorepo contributor harness or the shared `open-mercato/skills` collection.
- Do not change runtime business behavior, database schemas, framework APIs, event IDs, ACL IDs, or widget spot IDs.
- Do not teach agents to edit installed framework files under `node_modules`; upstream source is read-only reference material.
- Do not apply database migrations or publish packages/releases.

## Implementation Plan

### Phase 1: Research, specification, and readiness

1. Audit the current generated app, installer, prior specs, representative PR history, published package contents, and current Codex/Claude CLI capabilities.
2. Write a new standalone-only specification with architecture, compatibility strategy, failure modes, and a 40+ use-case optimization/evaluation matrix.
3. Run the pre-implementation compatibility/gap audit and remediate blocking spec findings before code changes.

### Phase 2: Context architecture and local skills

1. Replace the standalone `AGENTS.md` templates with a concise boundary-first task router and progressively loaded guides.
2. Rewrite the daily-driver local skills as thin routers with focused reference files, including module/CRUD, UMES, UI, integrations, workflows/AI, debugging, framework-context, and harness-extension paths.
3. Add exact installed-package source/AGENTS discovery and a version-aware upstream context escape hatch without allowing edits to `node_modules`.

### Phase 3: Installation and generation

1. Replace the fragile installer path with a cross-platform, manifest-driven skill installation flow and preserve supported CLI flags/layout compatibility.
2. Make both create-app and `mercato agentic:init` recursively emit the same harness tree, clean stale built assets, preserve placeholder substitution, and avoid hard-coded per-skill copy lists.
3. Update fallback template guidance, package scripts, manifests, ignores, and structural tests.

### Phase 4: Harness evaluation and regression coverage

1. Add the structured use-case catalog, schema, expected routing/contracts, and a deterministic validator used by the harness-extension skill.
2. Add an opt-in Codex/Claude live evaluation runner with structured output and safe read-only execution.
3. Add unit, scaffold, installer, context-resolution, and generated-app integration coverage; run the full use-case matrix and fix routing failures.

### Phase 5: Validation, review, and PR handoff

1. Run targeted create-app tests and a real standalone scaffold/install/generate validation, using Verdaccio where package changes require it.
2. Run every configured repository validation command with the required Docker/local runner decision recorded.
3. Run `om-auto-review-pr --autofix`, address actionable findings, publish the complete PR summary, and mark the draft ready.

## Risks

- The existing harness has stale `dist/agentic` artifacts and duplicated generator copy logic; cleanup must remove only generated assets and must not erase user-authored app files.
- Published package source is available under `node_modules`, but generic search tools ignore it; context resolution must use narrow explicit paths and remain version-correct/offline-capable.
- Overlapping skills can increase routing ambiguity; local skills need distinct trigger descriptions and shared reference ownership.
- Live LLM evaluations are non-deterministic and may be unavailable in CI; deterministic structure/fixture gates remain authoritative, with live runs recorded as additional evidence.
- External skill installation is network-dependent; offline mode must leave all local skills usable and produce an actionable retry message.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Research, specification, and readiness

- [x] 1.1 Audit current harness, history, packages, and agent CLIs — 8d676591d
- [x] 1.2 Write standalone harness specification and 40+ use-case matrix — 8d676591d
- [x] 1.3 Complete pre-implementation audit and spec remediation — 8d676591d

### Phase 2: Context architecture and local skills

- [ ] 2.1 Rewrite root routing and progressive guides
- [ ] 2.2 Rewrite local skills and add AI/workflow/context/evolution coverage
- [ ] 2.3 Implement exact-version upstream context escape hatch

### Phase 3: Installation and generation

- [ ] 3.1 Implement cross-platform manifest-driven skill installer
- [ ] 3.2 Unify recursive harness generation and stale-asset cleanup
- [ ] 3.3 Update fallback template, scripts, manifests, and structural tests

### Phase 4: Harness evaluation and regression coverage

- [ ] 4.1 Add structured use-case catalog and deterministic validator
- [ ] 4.2 Add safe Codex/Claude live evaluation runner
- [ ] 4.3 Add tests, run all cases, and remediate failures

### Phase 5: Validation, review, and PR handoff

- [ ] 5.1 Run targeted and standalone scaffold validation
- [ ] 5.2 Run the configured full validation gate
- [ ] 5.3 Complete authoritative review/autofix and PR handoff
