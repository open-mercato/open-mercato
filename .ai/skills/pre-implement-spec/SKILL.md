---
name: pre-implement-spec
description: Analyze a specification before implementation to assess backward compatibility impact, identify risks, find gaps, and produce a readiness report. Use when the user says "analyze spec", "pre-implement", "check spec impact", "spec readiness", "BC analysis", "backward compatibility check", "what can go wrong", or "spec gap analysis". Produces an actionable report with BC violations, missing sections, risk assessment, and suggested spec improvements.
---

# Pre-Implement Spec Skill

Performs a thorough pre-implementation analysis of a specification to catch issues before any code is written. Produces a structured report covering backward compatibility, spec completeness, risk assessment, AGENTS.md compliance, and a remediation plan.

## Workflow

### Phase 1 — Load Context

1. Read the target spec file(s) fully from `.ai/specs/` or `.ai/specs/enterprise/`.
2. Read `BACKWARD_COMPATIBILITY.md` — the 13 contract surface categories.
3. Read `.ai/lessons.md` for known pitfalls.
4. Using the Task Router in `AGENTS.md`, identify all relevant AGENTS.md guides for affected modules/packages.
5. Read the code-review checklist at `.ai/skills/code-review/references/review-checklist.md`.
6. Identify all existing modules, entities, events, and API routes that the spec touches (use Explore subagents for large scopes).

### Phase 2 — Backward Compatibility Audit

For each phase/step in the spec, check against ALL 13 contract surface categories:

| # | Surface | Check |
|---|---------|-------|
| 1 | Auto-discovery file conventions | Does the spec rename/remove any convention files or exports? |
| 2 | Type definitions & interfaces | Does the spec remove/narrow required fields on public types? |
| 3 | Function signatures | Does the spec change required params or return types? |
| 4 | Import paths | Does the spec move modules without re-export bridges? |
| 5 | Event IDs | Does the spec rename/remove event IDs or payload fields? |
| 6 | Widget injection spot IDs | Does the spec rename/remove spot IDs? |
| 7 | API route URLs | Does the spec rename/remove API endpoints or response fields? |
| 8 | Database schema | Does the spec rename/remove columns or tables? |
| 9 | DI service names | Does the spec rename registration keys? |
| 10 | ACL feature IDs | Does the spec rename feature IDs (stored in DB)? |
| 11 | Notification type IDs | Does the spec rename notification type strings? |
| 12 | CLI commands | Does the spec rename/remove CLI commands? |
| 13 | Generated file contracts | Does the spec change generated export names or BootstrapData? |

For each violation found:
- Classify severity: **Critical** (must fix before implementation) or **Warning** (needs deprecation bridge)
- Propose a migration path (re-export, dual-emit, alias, etc.)
- Note if a "Migration & Backward Compatibility" section is missing from the spec

### Phase 3 — Spec Completeness Check

Verify the spec includes all required sections (per spec-writing skill):

- [ ] TLDR & Overview
- [ ] Problem Statement
- [ ] Proposed Solution
- [ ] Architecture (design decisions)
- [ ] Data Models (entity structures, if applicable)
- [ ] API Contracts (endpoint definitions, if applicable)
- [ ] UI/UX (wireframes or descriptions, if applicable)
- [ ] Risks & Impact Review (failure scenarios, severity, mitigation)
- [ ] Phasing (delivery breakdown)
- [ ] Implementation Plan (detailed steps per phase)
- [ ] Integration Test Coverage (test scenarios for API + UI paths)
- [ ] Final Compliance Report (spec-writing checklist results)
- [ ] Changelog

For each missing section, note what should be added and why.

### Phase 4 — AGENTS.md Compliance

Check that the spec's proposed implementation follows all relevant AGENTS.md rules:

**Module structure**:
- Does the spec place code in the correct location? (`packages/core/`, `packages/ui/`, `apps/mercato/src/modules/`)
- Does it follow auto-discovery conventions? (files in correct directories with correct exports)
- Does `setup.ts` declare `defaultRoleFeatures` for new features in `acl.ts`?

**Data & security**:
- Does the spec mention zod validation for new inputs?
- Does it use `findWithDecryption` for entity queries?
- Are tenant scoping requirements addressed?
- Are GDPR/encryption considerations mentioned for PII fields?

**Events & side effects**:
- Are new events declared with `createModuleEvents()`?
- Do cross-module side effects use events (not direct imports)?
- Are subscribers idempotent?

**UI conventions**:
- Does the spec use `CrudForm`/`DataTable` for CRUD UI?
- Are keyboard shortcuts mentioned (Cmd+Enter, Escape)?
- Are i18n keys planned (not hardcoded strings)?

**Commands**:
- Are write operations implemented as undoable commands?
- Is `extractUndoPayload()` referenced?

### Phase 5 — Risk Assessment

Identify risks in these categories:

**Technical risks**:
- Cross-module coupling introduced
- Performance implications (N+1 queries, large payloads)
- Migration complexity (data backfill, schema changes)
- Concurrency issues (race conditions in events/workers)

**Integration risks**:
- Impact on existing tests
- Impact on existing UI flows
- Impact on existing API consumers
- Impact on search indexes

**Dependency risks**:
- Requires changes in multiple packages
- Depends on features not yet implemented
- Circular dependency potential

For each risk, assign: **High** / **Medium** / **Low** severity and a mitigation strategy.

### Phase 6 — Gap Analysis

Identify what's missing from the spec that would be needed for implementation:

- Missing entity definitions or unclear data models
- Missing API endpoint specifications
- Missing error handling descriptions
- Missing undo/redo behavior descriptions
- Missing event declarations for side effects
- Missing search configuration
- Missing cache invalidation strategy
- Missing worker/queue definitions
- Missing permission/ACL definitions
- Missing i18n key planning
- Missing test scenarios

### Phase 7 — Output Report

Produce a structured report in this format:

```markdown
# Pre-Implementation Analysis: {Spec Title}

## Executive Summary
{2-3 sentences: overall readiness, critical blockers, recommendation}

## Backward Compatibility

### Violations Found
| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | {category} | {description} | Critical/Warning | {migration path} |

### Missing BC Section
{Note if spec lacks "Migration & Backward Compatibility" section}

## Spec Completeness

### Missing Sections
| Section | Impact | Recommendation |
|---------|--------|---------------|
| {section} | {what breaks without it} | {what to add} |

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| {section} | {what's missing} | {what to add} |

## AGENTS.md Compliance

### Violations
| Rule | Location | Fix |
|------|----------|-----|
| {rule from AGENTS.md} | {spec section/step} | {how to fix} |

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| {risk} | {impact} | {mitigation} |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|

## Gap Analysis

### Critical Gaps (Block Implementation)
- {gap}: {what's needed}

### Important Gaps (Should Address)
- {gap}: {what's needed}

### Nice-to-Have Gaps
- {gap}: {what's needed}

## Remediation Plan

### Before Implementation (Must Do)
1. {action}: {description}

### During Implementation (Add to Spec)
1. {action}: {description}

### Post-Implementation (Follow Up)
1. {action}: {description}

## Recommendation
{Ready to implement / Needs spec updates first / Needs major revision}
```

Save the report as `.ai/specs/analysis/ANALYSIS-{spec-id}.md`.

## Subagent Strategy

| Task | Agent Type | When |
|------|-----------|------|
| Explore existing code for BC impact | Explore | Always — scan for existing event IDs, spot IDs, API routes, types |
| Read multiple AGENTS.md files | Explore | When spec touches 3+ modules |
| Scan for affected test files | Explore | Check which tests might break |
| Analyze entity/migration impact | general-purpose | When spec includes data model changes |

Launch parallel Explore agents for independent code areas (events, API routes, widgets, types).

## Rules

- MUST read the full spec before starting analysis
- MUST check ALL 13 backward compatibility categories — no shortcuts
- MUST verify against actual codebase (not just spec text) — use Explore agents to find real event IDs, spot IDs, API routes
- MUST produce the structured report format — no free-form summaries
- MUST save the report to `.ai/specs/analysis/`
- MUST classify every finding with severity
- MUST propose concrete fixes for every violation and gap
- MUST NOT modify any code — this skill is analysis only
- MUST NOT modify the spec directly — propose changes in the report for user review
- MUST check `.ai/lessons.md` for known pitfalls relevant to the spec's domain
