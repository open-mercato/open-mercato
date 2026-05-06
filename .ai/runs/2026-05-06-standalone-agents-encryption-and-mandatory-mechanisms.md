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
