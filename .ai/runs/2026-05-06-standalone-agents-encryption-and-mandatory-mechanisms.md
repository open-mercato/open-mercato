# Standalone agent guidance: encryption maps + mandatory module mechanisms

## Goal

Make the AGENTS.md / SKILL.md guidance that ships into a standalone Open Mercato app (`packages/create-app/agentic/shared/...` and `packages/create-app/template/...`) explicit about two things:

1. When a user asks anything about **data encryption** ("we need to encrypt X", "this needs to be encrypted at rest", "GDPR fields"), agents are routed to the framework's **encryption maps mechanism** (`<module>/encryption.ts` exporting `defaultEncryptionMaps: ModuleEncryptionMap[]`) and to `findWithDecryption` for read paths — not to ad-hoc AES calls or "I'll add a comment to encrypt this later".
2. When a user asks to **create a new application or a new module**, agents land on a single, prescriptive list of the **mandatory mechanisms** every Open Mercato module MUST use: module structure (auto-discovered files), CRUD factory APIs (`makeCrudRoute`), authorization (`metadata` with `requireAuth` / `requireFeatures`), multi-tenant scoping (`organization_id` / `tenant_id` always indexed and always in WHERE clauses), CRUD forms in admin (`CrudForm`), data tables (`DataTable`), cache (DI-resolved `@open-mercato/cache`, never raw Redis/SQLite), events (`createModuleEvents`), and encryption maps for sensitive fields.

## Scope

In scope:

- `packages/create-app/agentic/shared/AGENTS.md.template` — agentic-mode AGENTS.md generated for standalone apps (Task → Context Map + Critical Rules + Module Anatomy).
- `packages/create-app/template/AGENTS.md` — bare-scaffold AGENTS.md for standalone apps that did not opt into the agentic wizard.
- `packages/create-app/agentic/shared/ai/skills/module-scaffold/SKILL.md` — the skill that triggers on "create module" / "scaffold module" / "new module" inside standalone apps.
- `packages/create-app/agentic/shared/ai/skills/data-model-design/SKILL.md` — the skill that triggers on "design entity" / "add entity" / sensitive-data discussions.

Out of scope (Non-goals):

- Changing the actual encryption runtime, KMS adapters, or CLI under `packages/shared/src/lib/encryption/*` and `packages/core/src/modules/entities/*`.
- Touching the monorepo's root `AGENTS.md` or `packages/core/AGENTS.md` — they already cover encryption maps under "Encryption" and the Task Router; the gap is the **standalone app** experience that ships via `create-mercato-app`.
- Editing module-level `encryption.ts` files in core modules or rewiring how `defaultEncryptionMaps` are collected at boot.
- Code/runtime changes; this PR is documentation-only.

## Source spec

No prior spec — this is a documentation/guidance update. The encryption maps mechanism it documents is the existing implementation: `packages/shared/src/modules/encryption.ts` (the `ModuleEncryptionMap` type), `packages/core/src/modules/<module>/encryption.ts` (per-module `defaultEncryptionMaps` exports), the `auth:setup` collection step described at `apps/docs/docs/user-guide/encryption.mdx`, and the read-side helpers `findWithDecryption` / `findOneWithDecryption` from `@open-mercato/shared/lib/encryption/find`.

## Implementation Plan

### Phase 1: Plan + worktree

Plan committed first on `feat/standalone-agents-encryption-and-mandatory-mechanisms`.

### Phase 2: AGENTS.md.template (agentic standalone wizard)

- Add an explicit "Encrypt sensitive data" task row in the Task → Context Map (Framework Feature Usage section) pointing to the module-scaffold + data-model-design skills and the user-guide URL.
- Add a new "Mandatory Mechanisms (every module MUST use)" section that lists, with one-liners, the framework primitives a new module must wire: module structure, CRUD factory, authorization metadata, multi-tenant defaults, CrudForm/DataTable, cache, events, encryption maps. This section is referenced from CRITICAL rule 11 (the "BEFORE writing ANY code" gate) so agents must read it before scaffolding.
- Add `encryption.ts` to the Module Anatomy file tree.
- Add a Critical Rule for encryption maps: any sensitive / GDPR field MUST be declared in the module's `encryption.ts` `defaultEncryptionMaps` and reads MUST go through `findWithDecryption` / `findOneWithDecryption`.

### Phase 3: module-scaffold SKILL

- Add an "Encryption maps" subsection under Optional Features (section 11) with the `encryption.ts` template, the `ModuleEncryptionMap` import, `defaultEncryptionMaps` export, and the seed/setup CLI.
- Add `MUST declare encryption.ts when the entity stores sensitive / GDPR-relevant fields` to the rules list at the bottom.
- Update Step 1 (Gather Requirements) to include "Sensitive / GDPR-relevant fields" as a feature checkbox.
- Update the directory tree in section 2 to show `encryption.ts` (optional).

### Phase 4: data-model-design SKILL

- Add a new section "Sensitive Data and Encryption Maps" between section 7 (Advanced Patterns) and section 8 (Anti-Patterns), with the `encryption.ts` template, `findWithDecryption` usage, and the dev-only fallback warning.
- Replace the line "MUST NOT store sensitive data without encryption (use `findWithDecryption`)" with a fuller rule that also requires the encryption map declaration.
- Add anti-pattern rows: "Hand-rolled AES/KMS calls" → use the framework's encryption maps; "Reading encrypted columns with `em.find`" → use `findWithDecryption`.

### Phase 5: Bare-scaffold template AGENTS.md

- Add a "Data Encryption (sensitive / GDPR fields)" section between "Feature Grants" and "Design System" that mirrors the rule from the agentic version (declare `encryption.ts`, use `findWithDecryption`, link to the `user-guide/encryption` doc).
- Add a brief "Mandatory Module Mechanisms" callout that mirrors the agentic version's section so the bare scaffold also routes contributors to the right primitives when adding their first module. Link to the docs site for the deep guides since the bare scaffold has no `.ai/skills/` to reference.

### Phase 6: Validation gate (docs-only)

- Re-read every diff hunk before committing.
- Run `yarn lint` if it exists, otherwise document the docs-only nature in the PR body.
- No unit tests required (no code changed).

## Risks

- **Risk:** Drift between `template/AGENTS.md` and `agentic/shared/AGENTS.md.template`. Mitigation: phrase the encryption rule the same way in both, link both to the same docs URL, keep the bare-scaffold version short and the agentic version load-bearing (Task Router + skills).
- **Risk:** Over-broad guidance pushes agents to declare encryption maps for non-sensitive fields, bloating performance. Mitigation: scope the rule to "sensitive / GDPR-relevant fields" and call out in the SKILL that PII, contact info, addresses, free-text comments referencing people, financials, and integration credentials are the targets; non-PII enums and counters are not.
- **Risk:** The bare-scaffold template has no `.ai/skills/` paths to point at, so agents reading it cannot follow the same Task Router pattern. Mitigation: link to docs site URLs (`docs.openmercato.dev/...`) and keep the inline rule self-contained.
- **Risk:** The Mandatory Mechanisms list could rot if the framework adds new primitives. Mitigation: phrase items as one-liners + "see [link]" rather than copying long examples; the list is short enough to maintain.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Plan + worktree

- [x] 1.1 Draft and commit execution plan on a fresh `feat/` branch in an isolated worktree — 07a92a276

### Phase 2: Agentic standalone AGENTS.md

- [x] 2.1 Add "Encrypt sensitive data" task row + Module Anatomy `encryption.ts` entry to `packages/create-app/agentic/shared/AGENTS.md.template` — f31fd7f76
- [x] 2.2 Add "Mandatory Mechanisms" section + Critical Rule for encryption maps to `packages/create-app/agentic/shared/AGENTS.md.template` — d158348ee

### Phase 3: module-scaffold SKILL

- [x] 3.1 Add Encryption maps subsection + rules + tree entry to `packages/create-app/agentic/shared/ai/skills/module-scaffold/SKILL.md` — e3d168c49

### Phase 4: data-model-design SKILL

- [x] 4.1 Add "Sensitive Data and Encryption Maps" section + updated rules + anti-patterns to `packages/create-app/agentic/shared/ai/skills/data-model-design/SKILL.md` — a62bb4bd3

### Phase 5: Bare-scaffold template AGENTS.md

- [x] 5.1 Add "Data Encryption" section + "Mandatory Module Mechanisms" callout to `packages/create-app/template/AGENTS.md` — 5135747ba

### Phase 6: Validation gate

- [x] 6.1 Re-read full diff, fixed pre-existing numeric anchor in AGENTS.md.template (b977e1128); docs-only run — `yarn lint` is TS-only and does not parse `.md` / `.template` content, so the validation is the manual diff re-read plus frontmatter spot-check.
- [x] 6.2 Self-review caught fabricated docs URLs and an incorrect domain (`docs.openmercato.dev` vs `docs.open-mercato.dev`); replaced with verified real doc paths under `apps/docs/docs/` — c0dab9c91
- [x] 6.3 Peer review (general-purpose subagent against the live PR) caught a real BLOCKER — the `findWithDecryption` / `findOneWithDecryption` examples used a 4-arg call shape, but the real signature is 5-arg `(em, entity, where, options?, scope?)`. Passing the scope object in slot 4 makes MikroORM read it as `FindOptions` and silently breaks decryption. Fixed in all three files — 080584f6f
- [x] 6.4 Applied the peer-review NITPICK on the "Use encrypted queries" Task Router row to defer authoring agents to the new "Encrypt sensitive / GDPR-relevant fields" row — 820554f7f

### Phase 7: spec-writing skill (monorepo + standalone) — link, don't duplicate

The user pointed out a follow-up gap: the spec-writing / spec-checklist / compliance-review files do not require specs to address the encryption-maps mechanism, the Mandatory Module Mechanisms canon (CRUD factory, CrudForm, DataTable, `apiCall`, `useGuardedMutation`, cache via DI, events via `createModuleEvents`), or the Design System token rules (no hardcoded `text-red-*` / `bg-green-*`, no arbitrary sizes like `text-[11px]`, mandatory `StatusBadge` / `Alert` / `FormField` / `SectionHeader` / `CollapsibleSection` / `LoadingMessage` / `EmptyState`, lucide-react in page body, dialog `Cmd/Ctrl+Enter` / `Escape`, icon-only button `aria-label`). Specs that pass review today can still ship hand-rolled crypto, raw `<form>`, and hardcoded Tailwind status colors. Fix by extending the checklists and SKILL pointers in both monorepo and standalone trees — references only, no copy-paste.

- [x] 7.1 Extend monorepo `.ai/skills/spec-writing/SKILL.md` Quick Rule Reference + Review Heuristics with encryption-maps, Mandatory Mechanisms, and Design System pointers — 4dda05fcc
- [x] 7.2 Extend monorepo `.ai/skills/spec-writing/references/spec-checklist.md` (Data & Security § 3, API/UI § 5) with explicit checkboxes for encryption maps, CRUD factory, CrudForm/DataTable host pattern, `apiCall` / `useGuardedMutation`, DS tokens / shared UI primitives, dialog keyboard contract, lucide page-body icons — 832bcc2d5
- [x] 7.3 Extend monorepo `.ai/skills/spec-writing/references/compliance-review.md` Compliance Matrix template with rows showing encryption maps, DS rules, and CRUD factory MUSTs (plus a footnote remapping rule sources for standalone-app specs) — a9e8a198f
- [x] 7.4 + 7.5 Mirror the encryption-maps + canonical-mechanisms + DS guidance into standalone `packages/create-app/agentic/shared/ai/skills/spec-writing/SKILL.md` and `references/spec-checklist.md`, pointing at the standalone canon (`AGENTS.md` Mandatory Mechanisms / Data Encryption / Design System sections + the in-repo `data-model-design` / `module-scaffold` / `backend-ui-design` SKILLs) — 95d366aa7

### Phase 8: implement-spec / pre-implement-spec (monorepo + standalone)

- [x] 8.1 + 8.2 Add `Encryption maps`, `CRUD APIs`, `Cache`, `Design System` rows to the inline review table in both `.ai/skills/implement-spec/SKILL.md` and `packages/create-app/agentic/shared/ai/skills/implement-spec/SKILL.md` — ee5564de7
- [x] 8.3 Extend monorepo `.ai/skills/pre-implement-spec/SKILL.md` Phase 4 with the same encryption-maps + canonical-mechanisms + Design System compliance items (standalone tree has no pre-implement-spec — confirmed; mirroring not required) — d9fe6f3ab

### Phase 9: Validation + push

- [x] 9.1 Audited every new file path / section reference against the worktree (root + standalone trees) — all 23 cited paths exist; pushed all Phase 7-8 commits to `feat/standalone-agents-encryption-and-mandatory-mechanisms`
- [x] 9.2 Peer review (general-purpose subagent) caught 2 BLOCKERS and 1 MINOR in the new spec-skill extensions: (a) agentic AGENTS.md.template's section heading was "Mandatory Mechanisms" but skills + bare template used "Mandatory Module Mechanisms" — unified to the longer name; (b) standalone skills referenced non-existent agentic AGENTS.md sections ("Data Encryption ...", "Design System (Strict ...)") that only live in the bare template — re-pointed at the actual `Critical Rule #10` (DS) / `Critical Rule #11` (Encryption maps) + Mandatory Module Mechanisms table row that exist in the agentic file; (c) CRUD form import path was wrong in five places — fixed `CrudForm` to `@open-mercato/ui/backend/CrudForm`, `createCrud`/`updateCrud`/`deleteCrud` to `@open-mercato/ui/backend/utils/crud`, kept `createCrudFormError` at `@open-mercato/ui/backend/utils/serverErrors` (real-caller-verified) — 824a041c4
