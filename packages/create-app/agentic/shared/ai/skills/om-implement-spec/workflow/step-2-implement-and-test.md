# Step 2 — Implement, Test & Document

## Implement

Use subagents liberally to parallelize independent work:

- **One subagent per independent file/component** when files don't depend on each other
- **Sequential execution** when there are dependencies (e.g., entity before API route before backend page)

For every piece of code, enforce these code-review rules inline:

| Area | Rule |
|------|------|
| Types | No `any` — use zod + `z.infer` |
| API routes | Export `openApi` and per-method `metadata` with `requireAuth` / `requireFeatures` (no top-level `export const requireAuth`) |
| **CRUD APIs** | **Use `makeCrudRoute({ entity, entityId, operations, schema, indexer: { entityType } })` from `@open-mercato/shared/lib/crud/factory`. Custom write routes MUST use the mutation guard registry: map the route to `create`/`update`/`delete` (action endpoints usually `update`), collect registered guards, append `bridgeLegacyGuard(container)` when present, call `runMutationGuards(...)` with `{ userFeatures }` before the mutation, merge `modifiedPayload`, and run returned `afterSuccessCallbacks` after success while catching/logging callback failures. See `AGENTS.md` → Mandatory Module Mechanisms.** |
| Entities | Standard columns, snake_case, UUID PKs, indexed `organization_id` + `tenant_id` |
| Security | `findWithDecryption`, tenant scoping, zod validation |
| **Encryption maps** | **For every PII / GDPR-relevant column the phase touches, declare in `<module>/encryption.ts` exporting `defaultEncryptionMaps` (type from `@open-mercato/shared/modules/encryption`). Reads via `findWithDecryption` / `findOneWithDecryption` (5-arg `(em, entity, where, options?, scope?)`). Equality-lookup columns declare a sibling `hashField`. NEVER hand-rolled AES/KMS, `crypto.subtle`, or "encrypt later" stubs. See `AGENTS.md` → CRITICAL Rule #11 (Encryption maps) + the "Encryption maps" row of the Mandatory Module Mechanisms table; `.ai/skills/om-data-model-design/SKILL.md` § Sensitive Data and Encryption Maps; `.ai/skills/om-module-scaffold/SKILL.md` § Encryption maps.** |
| UI | `<CrudForm>`/`<DataTable>` (with stable `entityId` + `extensionTableId`), `apiCall` (never raw `fetch`), `flash()`, `<LoadingMessage>`/`<ErrorMessage>` |
| **Design System** | **Semantic status tokens (no `text-red-*` / `bg-green-*`); Tailwind text scale (no `text-[13px]` / `text-[11px]`); shared primitives `StatusBadge` / `Alert` / `FormField` / `SectionHeader` / `CollapsibleSection` / `LoadingMessage` / `Spinner` / `DataLoader` / `EmptyState`; lucide-react icons in PAGE BODY (never inline `<svg>`); `aria-label` on every icon-only button; Boy Scout rule on touched lines. See `AGENTS.md` → CRITICAL Rule #10 (Strict Design System alignment) + `.ai/skills/om-backend-ui-design/SKILL.md`.** |
| **Cache** | **Resolve via DI (`container.resolve('cache')`); tag with `tenant:<id>` / `org:<id>`; declare invalidation per write path. NEVER `new Redis(...)` or raw SQLite.** |
| Events | `createModuleEvents()` with `as const`, subscribers export `metadata`; cross-module side effects via subscribers, never direct imports |
| i18n | `useT()` client, `resolveTranslations()` server, no hardcoded strings |
| Imports | Package-level `@open-mercato/<pkg>/...` for framework imports |
| Mutations | `useGuardedMutation` when not using CrudForm; pass `retryLastMutation` in injection context |
| Keyboard | `Cmd/Ctrl+Enter` submit, `Escape` cancel on dialogs |
| Naming | Modules plural snake_case, events `module.entity.past_tense`, features `module.action` |

## Unit Tests

For every new feature/function implemented in the phase:

- Create unit tests colocated with the source (e.g., `*.test.ts` or `__tests__/`)
- Test happy path + key edge cases
- Test error paths for validation and authorization
- Mock external dependencies (DI services, data engine)
- Verify tests pass: `yarn test`

## Integration Tests

If the spec defines integration test scenarios (or the phase adds API endpoints / UI flows):

- Follow the `om-integration-tests` skill workflow (`.ai/skills/om-integration-tests/SKILL.md`)
- Place tests in `src/modules/<module>/__integration__/TC-{CATEGORY}-{XXX}.spec.ts`
- Tests MUST be self-contained: create fixtures in setup, clean up in teardown
- Tests MUST NOT rely on seeded/demo data
- Run and verify: `npx playwright test --config .ai/qa/tests/playwright.config.ts <path> --retries=0`

If the spec does not explicitly list integration scenarios but the phase adds significant API or UI behavior, propose test scenarios to the user before writing them.

## Documentation

For each new feature:

- Add/update locale files for new i18n keys
- If new entities with user-facing text: create `translations.ts`
- If new convention files: run `yarn generate`
- Update relevant guides or `AGENTS.md` if the feature introduces new patterns developers should follow

Then proceed to `step-3-review-and-progress.md`.
