---
name: code-review
description: Review code changes for Open Mercato compliance with architecture, security, conventions, and quality rules. Use this skill when reviewing pull requests, reviewing code changes, performing code review, auditing code quality, or when asked to review files, diffs, or commits. Covers module structure, naming conventions, data security, UI patterns, event/cache/queue rules, and anti-patterns.
---

# Code Review

Review code changes against Open Mercato's architecture rules, security requirements, naming conventions, and quality standards. Produce actionable, categorized findings.

## Review Workflow

1. **Scope**: Identify changed files. Classify each file by layer (API route, entity, validator, backend page, frontend page, subscriber, worker, command, search config, setup, ACL, events, DI, widget, test).
2. **Gather context**: Read relevant AGENTS.md for each touched module/package. Check `.ai/specs/` for active specs on the module. Read `.ai/lessons.md` for known pitfalls.
3. **Run checklist**: Apply all applicable rules from `references/review-checklist.md`. Flag violations with severity, file, line, and fix suggestion.
4. **Test coverage**: Verify changed behavior is covered by unit tests and/or integration tests. If coverage is missing, flag it with severity, file references, and exact test cases to add.
5. **Cross-module impact**: If the change touches events, extensions, or widgets, verify the consuming side handles the contract correctly.
6. **Output**: Produce the review report in the format below.

## Output Format

Use this structure for every review:

```markdown
# Code Review: {PR title or change description}

## Summary
{1-3 sentences: what the change does, overall assessment}

## Findings

### Critical
{Violations that MUST be fixed before merge — security, data integrity, tenant isolation}

### High
{Architecture violations, missing required exports, broken conventions}

### Medium
{Style issues, missing best practices, suboptimal patterns}

### Low
{Suggestions, minor improvements, nits}

## Checklist
- [ ] No `any` types introduced
- [ ] All API routes export `openApi`
- [ ] Validators in `data/validators.ts` (not inline)
- [ ] Tenant isolation: queries filter by `organization_id`
- [ ] No hardcoded user-facing strings
- [ ] CRUD routes use `makeCrudRoute` with `indexer`
- [ ] Events declared in `events.ts` before emitting
- [ ] Workers/subscribers export `metadata`
- [ ] Custom fields use `collectCustomFieldValues()`
- [ ] `modules:prepare` needed after file additions
- [ ] No cross-module ORM relationships
- [ ] Encryption helpers used instead of raw `em.find`
- [ ] Forms use `CrudForm`, tables use `DataTable`
- [ ] Non-`CrudForm` backend writes use `useGuardedMutation(...).runMutation(...)` with `retryLastMutation` in context
- [ ] `apiCall` used instead of raw `fetch`
- [ ] ACL features mirrored in `setup.ts` `defaultRoleFeatures`
- [ ] Behavior changes covered by unit and/or integration tests (or explicitly justified as not applicable)
- [ ] No empty `catch` blocks (all catches must handle, log, rethrow, or explicitly document intentional ignore)
```

Omit empty severity sections. Mark passing checklist items with `[x]` and failing with `[ ]` plus explanation.

## Severity Classification

| Severity | Criteria | Action |
|----------|----------|--------|
| **Critical** | Security vulnerability, cross-tenant data leak, data corruption risk, missing auth guard | MUST fix before merge |
| **High** | Architecture violation, missing required export (`openApi`, `metadata`), broken module contract | MUST fix before merge |
| **Medium** | Convention violation, suboptimal pattern, missing best practice | Should fix |
| **Low** | Style suggestion, minor improvement, readability | Nice to have |

## Quick Rule Reference

These are the highest-impact rules. For the full checklist, see `references/review-checklist.md`.

### Architecture (Critical/High)

- **NO direct ORM relationships between modules** — use FK IDs, fetch separately
- **Always filter by `organization_id`** for tenant-scoped entities — never expose cross-tenant data
- **Use DI (Awilix)** to inject services — never `new` directly
- **NO direct module-to-module function calls** for side effects — use events
- **Cross-module data**: use extension entities + `data/extensions.ts` — never add columns to another module's table

### Security (Critical)

- **Validate all inputs with zod** in `data/validators.ts` — never trust raw input
- **Use `findWithDecryption`** instead of raw `em.find`/`em.findOne`
- **Hash passwords with bcryptjs (cost >= 10)** — never log credentials
- **Auth endpoints**: return minimal error messages — never reveal if email exists
- **Every endpoint MUST declare guards** (`requireAuth`, `requireRoles`, `requireFeatures`)
- **Sensitive fields**: MUST define `fieldPolicy.excluded` in search config
- **MUST NOT cache** passwords, tokens, PII without encryption

### Data Integrity (Critical/High)

- **Never hand-write migrations** — update entities, run `yarn db:generate`
- **Use `withAtomicFlush`** when mutating entities across phases that include queries
- **Flush scalar changes BEFORE** relation syncs — avoid `__originalEntityData` reset
- **Workers/subscribers MUST be idempotent** — they may be retried
- **Commands MUST be undoable** — include before/after snapshots

### Naming & Structure (High/Medium)

- Modules: **plural, snake_case** (folders and `id`)
- JS/TS identifiers: **camelCase**
- Database tables/columns: **snake_case**, table names plural
- Common columns: `id`, `created_at`, `updated_at`, `deleted_at`, `is_active`, `organization_id`, `tenant_id`
- UUID PKs, explicit FKs, junction tables for many-to-many
- Code MUST NOT be added directly in `apps/mercato/src/` — use `apps/mercato/src/modules/`
- Shared package (`@open-mercato/shared`) has **zero domain dependencies** — MUST NOT import from `@open-mercato/core`

### Required Exports (High)

| File | Required Export | Rule |
|------|----------------|------|
| API routes | `openApi` | MUST export for doc generation |
| API routes | `metadata` | MUST declare auth guards |
| Subscribers | `metadata` with `{ event, persistent?, id? }` | MUST for auto-discovery |
| Workers | `metadata` with `{ queue, id?, concurrency? }` | MUST for auto-discovery |
| `events.ts` | `eventsConfig` via `createModuleEvents()` with `as const` | MUST for type-safe events |
| `acl.ts` | `features` | MUST mirror in `setup.ts` `defaultRoleFeatures` |
| `search.ts` | `searchConfig` with `checksumSource` in every `buildSource` | MUST for change detection |

### UI & HTTP (Medium/High)

- Forms: `CrudForm` — never custom form implementations
- If a backend page cannot use `CrudForm`, every write (`POST`/`PUT`/`PATCH`/`DELETE`) MUST go through `useGuardedMutation(...).runMutation(...)`
- `useGuardedMutation` context MUST include `retryLastMutation` so conflict resolution can auto-retry without extra save prompts
- Tables: `DataTable` — never manual table markup
- Notifications: `flash()` — never `alert()` or custom toast
- API calls: `apiCall`/`apiCallOrThrow` — never raw `fetch`
- JSON reading: `readJsonSafe(response, fallback)` — never `.json().catch()`
- CRUD errors: `createCrudFormError(message, fieldErrors?)` — never raw throw
- Dialogs: MUST support `Cmd/Ctrl+Enter` (submit), `Escape` (cancel)
- `RowActions` items MUST have stable `id` values (`edit`, `open`, `delete`)
- `pageSize` MUST be <= 100
- i18n: `useT()` client-side, `resolveTranslations()` server-side — never hardcode strings

### Code Quality (Medium)

- **No `any` types** — use zod + `z.infer`, narrow with runtime checks
- **No empty `catch` blocks** — catch blocks MUST handle, log, rethrow, or include explicit rationale for intentional ignore
- **No one-letter variable names**
- **No inline comments** — code should be self-documenting
- **Boolean parsing**: use `parseBooleanToken`/`parseBooleanWithDefault` from `@open-mercato/shared/lib/boolean`
- **Prefer functional, data-first utilities** over classes
- **Don't add docstrings/comments/annotations** to code you didn't change

### Testing Coverage (High/Medium)

- **Behavioral changes MUST include test coverage** through unit tests, integration tests, or both
- **Risk-heavy paths MUST include integration coverage** (permissions, tenant isolation, workflows, billing, undo/redo, events)
- **Missing tests are findings**: report exact files/areas lacking coverage and list the tests to add
- **If tests are intentionally skipped**, reviewer MUST verify a documented rationale and residual risk

## Review Heuristics

When reviewing, pay special attention to:

1. **New files added**: Check if `modules:prepare` is needed. Verify auto-discovery paths are correct.
2. **Entity changes**: Check if `yarn db:generate` is needed. Look for missing tenant scoping columns.
3. **New API routes**: Verify `openApi` export, auth guards, zod validation, tenant filtering.
4. **Event emitters**: Verify event is declared in `events.ts` with `as const`. Check subscriber exists.
5. **Search config changes**: Verify `checksumSource`, `fieldPolicy.excluded` for sensitive fields, `formatResult` for token strategy.
6. **Cache usage**: Verify DI resolution, tenant scoping, tag-based invalidation on writes.
7. **Queue workers**: Verify idempotency, `metadata` export, concurrency <= 20.
8. **Commands**: Verify undoable, before/after snapshots, `withAtomicFlush` for multi-phase mutations.
9. **Setup changes**: Verify `defaultRoleFeatures` matches `acl.ts` features. Hooks MUST be idempotent.
10. **UI changes**: Verify `CrudForm`/`DataTable` usage, `flash()` for feedback, keyboard shortcuts, loading/error states.
11. **Behavior changes**: Verify unit and/or integration tests cover new behavior, regressions, and edge cases.
12. **Mutation guard coverage**: For backend pages with manual save/delete logic (non-`CrudForm`), verify `useGuardedMutation` is wired for all writes and context includes `retryLastMutation`; for custom write API routes, verify `validateCrudMutationGuard` + `runCrudMutationGuardAfterSuccess` are both wired.

## Lessons Learned

Check these known pitfalls from `.ai/lessons.md`:

1. **Stale snapshots in `buildLog()`**: Always load via forked `EntityManager` or `refresh: true`
2. **Lost updates on flush**: Flush scalar changes BEFORE relation syncs that query on same `EntityManager`
3. **Undo payload duplication**: Use centralized `extractUndoPayload()` from `@open-mercato/shared/lib/commands/undo.ts`
