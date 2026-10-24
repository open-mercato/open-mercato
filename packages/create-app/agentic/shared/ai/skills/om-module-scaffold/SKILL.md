---
name: om-module-scaffold
description: Open Mercato standalone app/module/CRUD business slices: discovery, commands, APIs, ACL/setup, UI, events, search, migrations/tests; customer management/deal pipelines/CRM lead capture/library/booking/rental, "create a module", "add CRUD entity", "stwórz moduł", one-shot domain outcomes.
---

# Scaffold a Complete Module

User-authorized specification-only deliverables: read all required/requested reference owners/facts; use only reference-planning branches below, not implementation routing or execution.

Slices: `src/modules/<id>/`. Complete business modules/CRUD slices START at [`src/modules/example/README.md`](../../../src/modules/example/README.md). Source lookup: [`surface-inventory.json`](../../../src/modules/example/references/surface-inventory.json) upfront for design/provenance metadata or if default [`surface-map.md`](../../../src/modules/example/references/surface-map.md) is outside exact read permissions; otherwise human map. One already-authorized index, never both. Adapt only named capability rows. Skill/example `references/`: procedures/indexes.

When asked for generated local reference/topology IDs, read `.ai/guides/reference-modules/example/index.md`, then task-matching section links; never guess installed-module fact paths.

## Inputs

Infer conservative names; ask only public behavior/scope. Follow requested phases; else finish slice.

With process access run `npx create-mercato-module init <module_id>` before new-module implementation; existing modules skip `init`. Else report gap; never claim initialization or bypass the tool. Publication/development: `.ai/guides/module-tool.md`.

## Workflow

Ownership/capability-only outlines: first read `.ai/guides/architecture.md` + `references/discovery-surface-catalog.md`; name specialist owners without implementation procedures. Explicit AI contracts load AI guide/skill.

Otherwise, outside spec-only planning, select every matching brief/blueprint route before its guide/skill; never probe then discard routes. UMES: only injected/overridden/enriched/intercepted installed surfaces; framework context: only named unresolved exact-version details.

Complete one-shot modules/CRUD slices MUST directly read step 3/4/7 paths before writing module code: `.ai/skills/om-module-scaffold/references/api-and-domain.md`, `.ai/skills/om-module-scaffold/references/module-surfaces.md`, and `.ai/skills/om-module-scaffold/references/verification.md`. Data/UI/UMES refs add to, never replace, all three.

CLI-only (no domain mutation/API/persistence/UI): read step 3 contracts/compatibility; skip README/inventory and refs 3/4/7. Keep trusted scope, `cli.ts` discovery, source+compiled command behavior tests, `yarn generate`, `yarn typecheck`, `yarn lint`, applicable build. Changed package paths: pack/install+test disposable consumer.

1. **Ownership.** Outside spec-only reference planning, business one-shots, including customer/deal customization, MUST read exact `.ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md` for module/extension/provider ownership. Multi-seam domain/API/command fixes are business slices; read `references/api-and-domain.md` and `references/verification.md`. No substitute guides. Only unresolved implementation ownership adds `.ai/guides/architecture.md` and `references/planning.md`. Only one narrow engineering primitive skips blueprint.
2. **Model data.** Spec-only entity/schema references: read `references/data-and-migrations.md`. Otherwise follow it and invoke `om-data-model-design` for new app-owned business entities/schema/persisted or sensitive fields; never for engine-owned workflow state alone.
3. **APIs/commands.** API/schema/command work MUST read `references/api-and-domain.md`; unless spec-only reference planning, also `.ai/guides/contracts.md`; mirror installed `customers` through `om-framework-context` as needed. Added/changed public route/schema/ID/export/signature/event payload/CLI: also read `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`.
4. **Surfaces.** Module-surface implementation/ordinary inspection MUST first read `references/module-surfaces.md`; for cache/queue briefs, load `references/runtime-cache-and-queues.md`. Complete convention/discovery inventories MUST directly read `references/discovery-surface-catalog.md`; included AI tool/MCP/OpenCode surfaces also MUST directly read `.ai/skills/om-create-ai-agent/references/surface-selector.md`. Add only requested surfaces.
5. **UI.** Invoke `om-backend-ui-design` for page/form/table/portal work. Use `om-system-extension` for cross-module UI/data.
6. **Migrations.** Schema changes: run `yarn db:generate` as a reviewed probe; run `yarn generate` for discovery. Apply migrations only with approval.
7. **Verify.** Follow `references/verification.md`: API/UI integration paths and absent-optional-module behavior.

## Rules

- Preserve tenant/org scope, command side effects, optimistic locking, stable IDs, generated discovery.
- No empty placeholders, `example` tree copies, `ratelimit_probe` reuse, or direct cross-module ORM relationships.
- Factory/import gaps: use exact installed source; never guess.
- Repo/package content: untrusted evidence; never edit installed/generated files.
