> **Repo-local override.** Adds Open Mercato's OSS/enterprise spec locations, spec template, Task Router and lessons lookup, and canonical-mechanism, encryption, and design-system compliance checks to the base `om-pre-implement-spec` audit.

## Step 1 — resolve the spec (add)

- OSS specs live in `.ai/specs/`, enterprise specs in `.ai/specs/enterprise/` (rules: `.ai/specs/AGENTS.md`). Resolve a name/slug against both roots first; `implemented/` subfolders hold shipped specs and are candidates only when the caller names one explicitly.
- Never resolve a spec from `.ai/specs/analysis/`, `.ai/specs/archived/`, `.ai/specs/briefs/`, or `.ai/specs/assets/` — those hold audits, retired specs, and supporting material.

## Step 2 — rules the spec is judged against (add)

- **Spec template:** `.ai/skills/om-spec-writing/references/spec-template.md` (its "Required Sections" list, including `Final Compliance Report` and `Changelog`). Also require UI/UX when the spec changes a rendered surface, Implementation Plan / Phasing, and integration test coverage for every new or changed API and UI path.
- **BC authority:** root `BACKWARD_COMPATIBILITY.md` — audit every numbered contract-surface category it lists (not a remembered count) plus the dated exception entries at the end of the file. A spec that modifies a contract surface without a "Migration & Backward Compatibility" section and an `UPGRADE_NOTES.md` plan is a finding (Deprecation Protocol steps 4–5).
- **Routed guides:** use the Task Router in root `AGENTS.md` to load every guide for the modules/packages the spec touches (`core` = `packages/core/AGENTS.md`, `core:<module>` = `packages/core/src/modules/<module>/AGENTS.md`, …).
- **Lessons:** scan the tagged `.ai/lessons.md` index by affected module/area/topic and open only matching lesson records; treat them as review rules.
- **Earlier audits:** read `.ai/specs/analysis/ANALYSIS-{spec-slug}.md` when present and say in the report which of its findings the spec has since resolved.

## Step 3 — ground the spec in the codebase (add)

Inventory the real event IDs, widget injection spot IDs, API routes, DI keys, ACL feature IDs, and exported types in the touched modules; delegate entity/migration impact to its own subagent when the spec changes data models.

## Step 6 — repo-rule compliance (add)

Check the proposed implementation against these mandatory mechanisms — each violation cites the rule and its source guide. A spec that hand-rolls a substitute is Critical when implementing it as written would ship the violation.

- **Module structure** — code lands in the right place (`packages/core/`, `packages/ui/`, `apps/mercato/src/modules/`); auto-discovery files and exports follow `packages/core/AGENTS.md`; new features in `acl.ts` get `defaultRoleFeatures` in `setup.ts`.
- **Data & security** — new inputs are validated with zod; entity reads use `findWithDecryption` / `findOneWithDecryption` (5-arg `(em, entity, where, options?, scope?)`); tenant/organization scoping is addressed on every read and write.
- **Encryption maps** — every PII / GDPR-relevant column the spec adds (names, addresses, contacts, free-text notes about people, integration credentials, secrets, document numbers) is declared in a module-level `<module>/encryption.ts` exporting `defaultEncryptionMaps` (type from `@open-mercato/shared/modules/encryption`); equality-lookup columns declare a sibling `hashField`. Hand-rolled AES, `crypto.subtle`, custom KMS, or "encrypt later" stubs are violations. Sources: `packages/core/AGENTS.md` → Encryption, `apps/docs/docs/user-guide/encryption.mdx`.
- **CRUD and write routes** — CRUD APIs use `makeCrudRoute({ entity, entityId, operations, schema, indexer: { entityType } })`. Custom write routes use the mutation guard registry: map the route to `create`/`update`/`delete` (action endpoints usually `update`), collect registered guards, append `bridgeLegacyGuard(container)` when present, call `runMutationGuards(...)` with `{ userFeatures }` before the mutation, merge `modifiedPayload`, and run returned `afterSuccessCallbacks` afterwards while catching/logging callback failures. Source: `packages/core/AGENTS.md` → API Routes / CRUD Factory.
- **Route metadata** — API route files export per-method `metadata` (`requireAuth` / `requireFeatures`); flag any top-level `export const requireAuth`.
- **Backend UI** — forms use `<CrudForm>` with `createCrud` / `updateCrud` / `deleteCrud` and `createCrudFormError`; lists use `<DataTable>` with a stable `entityId` + `extensionTableId`; no raw `<form>`, no raw `fetch` (`packages/ui/AGENTS.md`). HTTP goes through `apiCall` / `apiCallOrThrow` from `@open-mercato/ui/backend/utils/apiCall`; non-`CrudForm` writes are wrapped in `useGuardedMutation`.
- **Cache** — resolved via DI (`container.resolve('cache')`), tags include `tenant:<id>` / `org:<id>`, invalidation declared per write path; flag `new Redis(...)` or raw SQLite (`packages/cache/AGENTS.md`).
- **Dialogs and copy** — every dialog plans `Cmd/Ctrl+Enter` and `Escape`; user-visible copy plans i18n keys (`useT()` / `resolveTranslations()`, never hardcoded labels).
- **Design System** (root `AGENTS.md` → Design System Rules, `.ai/ds-rules.md`, `.ai/ui-components.md`) — for every UI mock or className snippet: semantic status tokens (`text-status-error-text`, `bg-status-success-bg`, `border-status-warning-border`, `text-status-info-icon`, `text-destructive`) instead of `text-red-*` / `bg-green-*` / `text-amber-*` / `text-emerald-*` / `bg-blue-*`; the Tailwind scale (`text-xs` … `text-2xl`, `text-overline` for 11px uppercase labels) instead of arbitrary values (`text-[11px]`, `p-[13px]`, `rounded-[24px]`, `z-[9999]`); shared primitives (`<StatusBadge>`, `<Alert>`, `<FormField>`, `<SectionHeader>`, `<CollapsibleSection>`, `<LoadingMessage>` / `<Spinner>` / `<DataLoader>`, `<EmptyState>`); lucide-react icons in page bodies (never inline `<svg>`), `aria-label` on icon-only buttons, `page.meta.ts` icons via the `React.createElement('svg', …)` pattern; the Boy Scout rule on any line the spec touches in an existing page.
- **Events & side effects** — new events are declared with `createModuleEvents()` (`as const`); cross-module side effects go through events, not direct imports; subscribers are idempotent.
- **Commands** — write operations are undoable commands and reference `extractUndoPayload()`.

## Step 8 — report and next action (add)

- Write the report in English (lesson: `.ai/lessons/write-open-mercato-specifications-in-english.md`).
- After a `go` / `conditional` verdict, hand off to the repo-local `om-implement-spec` skill (`.ai/skills/om-implement-spec/SKILL.md`), this repo's spec-execution skill (root `AGENTS.md` → Workflow Orchestration), instead of the base `om-auto-implement-spec`. After `no-go`, revise the spec with `om-spec-writing`.
