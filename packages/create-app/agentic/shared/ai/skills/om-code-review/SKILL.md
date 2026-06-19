---
name: om-code-review
description: Review code changes for architecture, security, conventions, and quality compliance. Use when reviewing pull requests, code changes, or auditing code quality.
---

# Code Review

Review code changes against Open Mercato architecture rules, security requirements, and quality standards.

## Review Workflow

1. **Scope**: Identify changed files. Classify by layer (entity, API route, validator, backend page, subscriber, worker, command, widget).
2. **Gather context**: Read `AGENTS.md` for module conventions. Check `.ai/specs/` for active specs. Read `.ai/lessons.md` for known pitfalls.
3. **CI/CD verification gate (MANDATORY)**: Run the checks below. Every gate MUST pass. See **CI/CD Gate** section.
4. **Run checklist**: Apply rules from `references/review-checklist.md`. Flag violations with severity, file, and fix suggestion.
5. **Test coverage**: Verify changed behavior is covered by tests. Flag missing coverage.
6. **Cross-module impact**: If the change touches events, extensions, or widgets, verify consumers handle the contract correctly.
7. **Output**: Produce the review report.

## CI/CD Verification Gate (MANDATORY)

**NEVER claim code is "ready to merge" without running these checks.** If any step fails, it MUST be fixed before the review can pass.

| # | Command | What it checks | If it fails |
|---|---------|----------------|-------------|
| 1 | `yarn generate` | Module registries are up to date | Run it — it generates missing files |
| 2 | `yarn typecheck` | TypeScript types are correct | Fix type errors |
| 3 | `yarn test` | All unit tests pass | Fix failing tests |
| 4 | `yarn build` | The app builds successfully | Fix build errors |

**Rules**:
- Steps 2 and 3 can run in parallel.
- Every failure is a **Critical** finding — even if it appears unrelated to the current changes.
- The review output MUST include actual pass/fail results. Do not assume — run and report.

## Output Format

```markdown
# Code Review: {change description}

## Summary
{1-3 sentences: what the change does, overall assessment}

## CI/CD Verification

| Gate | Status | Notes |
|------|--------|-------|
| `yarn generate` | PASS/FAIL | |
| `yarn typecheck` | PASS/FAIL | |
| `yarn test` | PASS/FAIL | |
| `yarn build` | PASS/FAIL | |

## Findings

### Critical
{Security, data integrity, tenant isolation violations}

### High
{Architecture violations, missing required exports}

### Medium
{Convention violations, suboptimal patterns}

### Low
{Suggestions, minor improvements}

## Checklist
{From references/review-checklist.md — mark [x] passing, [ ] failing with explanation}
```

Omit empty severity sections.

## Severity Classification

| Severity | Criteria | Action |
|----------|----------|--------|
| **Critical** | Security vulnerability, cross-tenant leak, data corruption, missing auth | MUST fix before merge |
| **High** | Architecture violation, missing required export, broken module contract | MUST fix before merge |
| **Medium** | Convention violation, suboptimal pattern, missing best practice | Should fix |
| **Low** | Style suggestion, minor improvement | Nice to have |

## Quick Rule Reference

`AGENTS.md` is the single source of truth for these rules — read it there instead of relying on a copy, so this skill never drifts from the canon. Map the dimension you are reviewing to the owning section:

- **Architecture** (FK-only cross-module links, `organization_id` scoping, DI/Awilix, events for side effects, extension entities) → `AGENTS.md` → Architecture Rules + Mandatory Module Mechanisms
- **Security** (zod validation, `findWithDecryption` over raw `em.find`/`em.findOne`, bcryptjs ≥ 10, never log credentials) → `AGENTS.md` → Data & Security
- **Authorization (RBAC)** — gate pages and routes with `requireFeatures`; **NEVER `requireRoles`** (role names mutate and can be spoofed) → `AGENTS.md` → Data & Security (RBAC) + Access Control
- **Data Integrity** (migration files + snapshots match intent, idempotent workers/subscribers, undoable commands) → `AGENTS.md` → CRITICAL Rules + Data & Security
- **Naming & standard columns** → `AGENTS.md` → Naming Conventions / Conventions
- **UI & HTTP** (`CrudForm`, `DataTable`, `flash()`, `apiCall` over raw `fetch`, dialog `Cmd/Ctrl+Enter`/`Escape`, `pageSize` ≤ 100) → `AGENTS.md` → UI & HTTP + Mandatory Module Mechanisms
- **Code Quality** (no `any`, no empty `catch`, no one-letter names, `parseBooleanToken`/`parseBooleanWithDefault`, don't comment code you didn't change) → `AGENTS.md` → Code Quality

## Review Heuristics

1. **New files**: Check if `yarn generate` is needed. Verify auto-discovery paths.
2. **Entity changes**: Check if migration and snapshot updates are needed. Look for missing tenant columns.
3. **Migration sanity**: Inspect SQL content and `.snapshot-open-mercato.json`. Reject unrelated schema churn.
4. **New API routes**: Verify `openApi` export, auth guards, zod validation, tenant filtering.
5. **Event emitters**: Verify event is declared in `events.ts` with `as const`.
6. **Commands**: Verify undoable, before/after snapshots.
7. **UI changes**: Verify `CrudForm`/`DataTable`, `flash()`, keyboard shortcuts, loading/error states.
8. **Test coverage**: Verify unit/integration tests cover new behavior.

## Reference Materials

- [Review Checklist](references/review-checklist.md)
- [AGENTS.md](../../../AGENTS.md)
