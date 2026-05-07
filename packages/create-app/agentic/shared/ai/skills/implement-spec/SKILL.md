---
name: implement-spec
description: Implement a specification (or specific phases of a spec) using coordinated subagents. Handles multi-phase spec implementation with unit tests, integration tests, documentation, and code-review compliance. Use when the user says "implement spec", "implement the spec", "implement phases", "build from spec", or "code the spec". Tracks progress by updating the spec with implementation status.
---

# Implement Spec Skill

Implements a specification (or selected phases) end-to-end using a team of coordinated subagents. Every code change MUST pass the code-review checklist before the phase is considered done.

## Pre-Flight

1. **Identify the spec**: Locate the target spec file in `.ai/specs/`.
2. **Load context**: Read spec fully. Match affected tasks to the **Task → Context Map** in `AGENTS.md` and read all listed files (guides and skills).
3. **Load code-review checklist**: Read `.ai/skills/code-review/references/review-checklist.md` — this is the acceptance gate for every phase.
4. **Load lessons**: Read `.ai/lessons.md` for known pitfalls.
5. **Scope phases**: If the user specifies phases (e.g. "phases c-e"), filter to only those. Otherwise implement all phases sequentially.

## Implementation Workflow

For **each phase** in the spec, execute these steps:

### Step 1 — Plan the Phase

Read the phase from the spec. For each step within the phase:
- Identify files to create or modify (all paths under `src/modules/`)
- Identify which guides and skills apply (use the Task → Context Map in `AGENTS.md`)
- List required exports, conventions, and patterns from the relevant guides
- Note any cross-module impacts (events, extensions, widgets, enrichers)

Present a brief plan to the user before coding.

### Step 2 — Implement

Use subagents liberally to parallelize independent work:
- **One subagent per independent file/component** when files don't depend on each other
- **Sequential execution** when there are dependencies (e.g., entity before API route before backend page)

For every piece of code, enforce these code-review rules inline:

| Area | Rule |
|------|------|
| Types | No `any` — use zod + `z.infer` |
| API routes | Export `openApi` and per-method `metadata` with `requireAuth` / `requireFeatures` (no top-level `export const requireAuth`) |
| **CRUD APIs** | **Use `makeCrudRoute({ entity, entityId, operations, schema, indexer: { entityType } })` from `@open-mercato/shared/lib/crud/factory`. Custom write routes MUST call `validateCrudMutationGuard` before the mutation and `runCrudMutationGuardAfterSuccess` after success. See `AGENTS.md` → Mandatory Module Mechanisms.** |
| Entities | Standard columns, snake_case, UUID PKs, indexed `organization_id` + `tenant_id` |
| Security | `findWithDecryption`, tenant scoping, zod validation |
| **Encryption maps** | **For every PII / GDPR-relevant column the phase touches, declare in `<module>/encryption.ts` exporting `defaultEncryptionMaps` (type from `@open-mercato/shared/modules/encryption`). Reads via `findWithDecryption` / `findOneWithDecryption` (5-arg `(em, entity, where, options?, scope?)`). Equality-lookup columns declare a sibling `hashField`. NEVER hand-rolled AES/KMS, `crypto.subtle`, or "encrypt later" stubs. See `AGENTS.md` → CRITICAL Rule #11 (Encryption maps) + the "Encryption maps" row of the Mandatory Module Mechanisms table; `.ai/skills/data-model-design/SKILL.md` § Sensitive Data and Encryption Maps; `.ai/skills/module-scaffold/SKILL.md` § Encryption maps.** |
| UI | `<CrudForm>`/`<DataTable>` (with stable `entityId` + `extensionTableId`), `apiCall` (never raw `fetch`), `flash()`, `<LoadingMessage>`/`<ErrorMessage>` |
| **Design System** | **Semantic status tokens (no `text-red-*` / `bg-green-*`); Tailwind text scale (no `text-[13px]` / `text-[11px]`); shared primitives `StatusBadge` / `Alert` / `FormField` / `SectionHeader` / `CollapsibleSection` / `LoadingMessage` / `Spinner` / `DataLoader` / `EmptyState`; lucide-react icons in PAGE BODY (never inline `<svg>`); `aria-label` on every icon-only button; Boy Scout rule on touched lines. See `AGENTS.md` → CRITICAL Rule #10 (Strict Design System alignment) + `.ai/skills/backend-ui-design/SKILL.md`.** |
| **Cache** | **Resolve via DI (`container.resolve('cache')`); tag with `tenant:<id>` / `org:<id>`; declare invalidation per write path. NEVER `new Redis(...)` or raw SQLite.** |
| Events | `createModuleEvents()` with `as const`, subscribers export `metadata`; cross-module side effects via subscribers, never direct imports |
| i18n | `useT()` client, `resolveTranslations()` server, no hardcoded strings |
| Imports | Package-level `@open-mercato/<pkg>/...` for framework imports |
| Mutations | `useGuardedMutation` when not using CrudForm; pass `retryLastMutation` in injection context |
| Keyboard | `Cmd/Ctrl+Enter` submit, `Escape` cancel on dialogs |
| Naming | Modules plural snake_case, events `module.entity.past_tense`, features `module.action` |

### Step 3 — Unit Tests

For every new feature/function implemented in the phase:
- Create unit tests colocated with the source (e.g., `*.test.ts` or `__tests__/`)
- Test happy path + key edge cases
- Test error paths for validation and authorization
- Mock external dependencies (DI services, data engine)
- Verify tests pass: `yarn test`

### Step 4 — Integration Tests

If the spec defines integration test scenarios (or the phase adds API endpoints / UI flows):
- Follow the `integration-tests` skill workflow (`.ai/skills/integration-tests/SKILL.md`)
- Place tests in `src/modules/<module>/__integration__/TC-{CATEGORY}-{XXX}.spec.ts`
- Tests MUST be self-contained: create fixtures in setup, clean up in teardown
- Tests MUST NOT rely on seeded/demo data
- Run and verify: `npx playwright test --config .ai/qa/tests/playwright.config.ts <path> --retries=0`

If the spec does not explicitly list integration scenarios but the phase adds significant API or UI behavior, propose test scenarios to the user before writing them.

### Step 5 — Documentation

For each new feature:
- Add/update locale files for new i18n keys
- If new entities with user-facing text: create `translations.ts`
- If new convention files: run `yarn generate`
- Update relevant guides or `AGENTS.md` if the feature introduces new patterns developers should follow

### Step 6 — Self-Review (Code-Review Gate)

Before marking a phase complete, run a self-review against the checklist (`.ai/skills/code-review/references/review-checklist.md`):

1. **Architecture & Module Independence** (section 1)
2. **Security** (section 2)
3. **Data Integrity & ORM** (section 3)
4. **API Routes** (section 4) — if applicable
5. **Events & Commands** (section 5) — if applicable
6. **UI & Backend Pages** (section 6) — if applicable
7. **Naming Conventions** (section 7)
8. **Anti-Patterns** (section 8)

Fix any violations before proceeding to the next phase.

### Step 7 — Update Spec with Progress

After completing each phase, update the spec file:
- Add an `## Implementation Status` section at the bottom (or update it if it exists)
- Use this format:

```markdown
## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase A — Foundation | Done | 2026-02-20 | All steps implemented, tests passing |
| Phase B — Menu Injection | Done | 2026-02-21 | 3/3 steps complete |
| Phase C — Events Bridge | In Progress | 2026-02-22 | Step 1-2 done, step 3 pending |
| Phase D — Enrichers | Not Started | — | — |
```

- For the current phase, mark individual steps:

```markdown
### Phase C — Detailed Progress
- [x] Step 1: Create event definitions
- [x] Step 2: Implement SSE bridge
- [ ] Step 3: Add client-side hooks
```

### Step 8 — Verification

After all targeted phases are complete:

1. **Generate check**: `yarn generate` — must complete without errors
2. **Type check**: `yarn typecheck` — must pass (if available)
3. **Build check**: `yarn build` — must pass
4. **Unit test check**: `yarn test` — must pass
5. **Integration test check**: run any new integration tests — must pass
6. **Migration check**: `yarn db:generate` — if any entities changed (verify the resulting SQL is scoped correctly; manual SQL is acceptable only when avoiding unrelated churn, and the touched `.snapshot-open-mercato.json` must match)

Report results to the user. If any check fails, fix and re-verify.

## Subagent Strategy

| Task | Agent Type | When |
|------|-----------|------|
| Research existing patterns | Explore | Before implementing unfamiliar patterns |
| Implement independent files | general-purpose | When files have no dependencies on each other |
| Run tests | Bash | After each phase |
| Self-review | general-purpose | After each phase, against checklist |
| Integration tests | general-purpose | After phases with API/UI changes |

**Concurrency rule**: Launch parallel subagents only for truly independent work. Sequential for dependent files.

## Rules

- MUST read the full spec before starting implementation
- MUST read all guides and skills listed in the Task → Context Map before coding
- MUST pass every applicable code-review checklist item before marking a phase done
- MUST update the spec with implementation progress after each phase
- MUST run `yarn build` after final phase to verify no build breaks
- MUST create unit tests for all new behavioral code
- MUST create or propose integration tests for phases with API endpoints or UI flows
- MUST NOT skip the self-review step — it is the quality gate
- MUST NOT introduce `any` types, hardcoded strings, raw `fetch`, or other anti-patterns
- MUST keep subagents focused — one task per subagent, clear boundaries
- MUST report blockers to the user immediately rather than working around them silently
- MUST run `yarn generate` after creating or modifying module convention files
- MUST run `yarn db:generate` after creating or modifying entities (and confirm migration with user before applying)
