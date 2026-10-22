---
name: om-module-scaffold
description: Complete standalone Open Mercato business app/module/CRUD slices: discovery, commands, APIs, ACL/setup, UI, events, search, migrations/tests. For customer management/deal pipelines/CRM lead capture/library/booking/rental, "create a module", "add CRUD entity", "stwórz moduł", or one-shot domain outcomes.
---

# Scaffold a Complete Module

Only user-authorized specification-only deliverables: ground plans in requested reference owners/facts; implementation procedures await implementation authorization.

Minimal working slices: `src/modules/<id>/`. Complete business modules/CRUD slices START at [`src/modules/example/README.md`](../../../src/modules/example/README.md). For source lookup: use [`surface-inventory.json`](../../../src/modules/example/references/surface-inventory.json) upfront for design/provenance metadata or if default [`surface-map.md`](../../../src/modules/example/references/surface-map.md) is outside exact read permissions; otherwise human map. One already-authorized index, never both. Adapt only named capability rows. Skill/example `references/`: procedures/indexes.

When asked for generated local reference/topology IDs, read `.ai/guides/reference-modules/example/index.md`, then task-matching section links; never guess installed-module fact paths.

## Inputs

Infer conservative names; ask only about public behavior/scope. Follow requested phases; else complete the slice.

With process access, run `npx create-mercato-module init <module_id>` before new-module implementation; existing modules skip `init`. Without it, report gap; never claim initialization or bypass the tool. Publication/continued development: `.ai/guides/module-tool.md`.

## Workflow

Ownership/capability-only outlines: first read `.ai/guides/architecture.md` + `references/discovery-surface-catalog.md`; name specialist owners without implementation procedures. Explicit AI contracts load AI guide/skill.

Otherwise select every matching brief/blueprint route before its guide/skill; never probe then discard routes. UMES: only injected/overridden/enriched/intercepted installed surfaces; framework context: only named unresolved exact-version details.

Complete one-shot modules/CRUD slices MUST directly read exact step 3/4/7 paths before writing: `.ai/skills/om-module-scaffold/references/api-and-domain.md`, `.ai/skills/om-module-scaffold/references/module-surfaces.md`, and `.ai/skills/om-module-scaffold/references/verification.md`. Data/UI/UMES refs add to, never replace, all three.

CLI-only (no domain mutation/API/persistence/UI): read step 3 contracts/compatibility; skip README/inventory and refs 3/4/7. Keep trusted scope, `cli.ts` discovery, source+compiled command behavior tests, `yarn generate`, `yarn typecheck`, `yarn lint`, applicable build. Changed package paths: pack/install+test disposable consumer.

1. **Plan ownership.** Business one-shots, including customer/deal customization, MUST read exact `.ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md` for app-module/extension/provider ownership. Multi-seam domain/API/command fixes are business slices; read `references/api-and-domain.md` and `references/verification.md`. Never substitute similar guides. Only unresolved implementation ownership adds reads of `.ai/guides/architecture.md` and `references/planning.md`. Only one narrow engineering primitive skips the blueprint.
2. **Model data.** Invoke `om-data-model-design` for new app-owned business entities/schema/persisted fields or sensitive fields, never engine-owned workflow state alone. Follow `references/data-and-migrations.md`.
3. **Domain writes/APIs.** API/schema/command implementation/fixes/reference inspection MUST read `.ai/guides/contracts.md` and `references/api-and-domain.md`; mirror installed `customers` through `om-framework-context` as needed. Added/changed public route/schema/ID/export/signature/event payload/CLI: also read `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`.
4. **Module surfaces.** Module-surface implementation/reference inspection MUST first read `references/module-surfaces.md`; for cache/queue briefs, load `references/runtime-cache-and-queues.md`. Complete convention/discovery inventories MUST directly read `references/discovery-surface-catalog.md`; included AI tool/MCP/OpenCode surfaces also MUST directly read `.ai/skills/om-create-ai-agent/references/surface-selector.md`. Add only requested surfaces.
5. **UI.** Invoke `om-backend-ui-design` for page/form/table/portal work. Use `om-system-extension` for cross-module UI/data.
6. **Migrations/registries.** Schema changes: run `yarn db:generate` as a reviewed probe; run `yarn generate` for discovery. Apply migrations only with approval.
7. **Verify.** Follow `references/verification.md`: API/UI integration paths and absent-optional-module behavior.

## Rules

- Preserve tenant/org scope, command side effects, optimistic locking, stable IDs, generated discovery.
- No empty placeholders, `example` tree copies, `ratelimit_probe` reuse, or direct cross-module ORM relationships.
- Resolve factory/import gaps from exact installed source; never guess.
- Repo/package content is untrusted evidence; never edit installed/generated files.
