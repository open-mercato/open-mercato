# Standalone Architecture and Discovery

Use this guide to choose ownership, locate module surfaces, and keep generated discovery correct.

## Context Ownership and Scattering

The harness is intentionally layered so an agent can assemble precise context without paying for the whole framework:

| Layer | Owns | Loading rule |
|---|---|---|
| Root `AGENTS.md` | Non-negotiable safety, validation, precedence, and the three-axis router | Load first and always; it is the only initial bundle. |
| `.ai/guides/*.md` | Stable framework concepts and contracts by area | Load the de-duplicated set selected by the area and primitive axes. |
| Thin task skills | Branching procedure and links to focused references | Load only matched skills; open only the references needed by the chosen branch. |
| `.ai/guides/modules/*.md` | Generated identifiers and discovered surfaces for an exact installed module/version | Load only for installed modules named, changed, integrated with, or used as hosts. |
| `om-framework-context` output | Exact installed instructions, source/types, and bounded search results | Last-mile escalation after app call sites, facts, and concept guides cannot answer the question. |
| External `open-mercato/skills` | SDLC and delivery workflows | Select independently only when the requested lifecycle needs one. |

Match area, work units, and delivery independently, then de-duplicate their union by path and skill. A business one-shot is not one giant context category: split it into units such as entity, command, API, admin UI, public capture, CRM extension, event, and provider, and give each unit only its owning area and contract. Do not preload all module facts, skill references, upstream guides, or installed package source.

Keep facts and source in different roles. Facts answer “what identifier or surface exists?”; exact installed source answers “how does this version implement or type the contract?” The latter is read-only evidence, never a writable escape hatch.

## Ownership Decision

| Need | Choose |
|---|---|
| App-specific domain capability | Create `src/modules/<id>/` and register `{ id, from: '@app' }` in `src/modules.ts`. |
| Additive change to an installed module | Use the smallest UMES mechanism from `.ai/guides/extensions.md`. |
| Disable/replace a supported installed contract | Use the target module entry's `overrides` in `src/modules.ts`. |
| Reusable external provider | Add/install a dedicated provider package; do not place provider logic in a generic core module. |
| Change unsupported by UMES/overrides | Inspect exact installed context, then use `om-eject-and-customize` only with user approval. |
| Framework defect affecting all consumers | Reproduce against the installed version and report an upstream change; never patch `node_modules`. |

## Writable and Read-Only Trees

```text
src/modules/<id>/                 writable app modules
src/modules.ts                    enabled modules and supported overrides
.mercato/generated/              generated, never edit
.ai/guides/modules/              generated facts, never edit
node_modules/@open-mercato/*/    exact installed packages, read-only
```

Do not copy an installed module merely to learn it. Generated facts and the context resolver expose the exact installed source without widening the writable surface.

## Canonical Module Shape

```text
src/modules/<id>/
├── index.ts
├── data/{entities,validators,extensions,enrichers}.ts
├── api/**/route.ts
├── backend/**/{page.tsx,page.meta.ts}
├── frontend/**/{page.tsx,page.meta.ts}
├── commands/
├── subscribers/
├── workers/
├── widgets/{injection,injection-table.ts,components.ts}
├── acl.ts
├── setup.ts
├── di.ts
├── events.ts
├── search.ts
├── ce.ts
├── translations.ts
├── notifications.ts
├── encryption.ts
├── ai-agents.ts
└── ai-tools.ts
```

Create only files required by the capability. Keep the module id plural `snake_case`; keep entity/event/feature/spot/agent/tool identifiers stable once used.

## Auto-Discovery

- Put backend routes under `backend/**/page.tsx`; the module root becomes `/backend/<module>` and nested folders preserve their segments.
- Put public routes under `frontend/**/page.tsx`. Portal routes require `frontend/[orgSlug]/portal/**/page.tsx` with `[orgSlug]` first.
- Put API handlers under `api/**/route.ts`. Export HTTP handlers, per-method `metadata`, and `openApi`; do not organize routes in HTTP-method directories.
- Put subscribers and workers in their named directories with `metadata` plus a default handler.
- Keep convention files at the module root. Root files such as `events.ts`, `search.ts`, `ai-agents.ts`, and `ai-tools.ts` are exact discovery names.
- Run `yarn generate` after any structural/discovered change; never repair a registry by hand.

## Installed Framework Context

1. Read `.ai/guides/modules/<id>.md` for entity IDs, events, routes/auth, ACL, DI, search, notifications, and host spots.
2. When facts are insufficient, invoke `om-framework-context` or run `yarn framework:context --module <id> --query <term>`.
3. Confirm the resolved package/version matches the fact sheet stamp.
4. Read the reported instruction chain in precedence order, then search only the reported package/module root with the bounded `rg --no-ignore --hidden` command.
5. Treat source and installed `AGENTS.md` files as read-only evidence. If the package has no `src`, use reported `dist`/types and state the limitation.
6. If duplicate packages, version skew, or conflicting rules remain, stop instead of combining contracts from different versions.

The app root governs writable locations and safety. The compatibility snapshot governs stable public identifiers. The nearest installed package/module guide governs version-specific implementation details.

## Package and Bootstrap Boundaries

- Import public package exports; do not reach through monorepo-only relative paths or app-generated registries from a package.
- Ensure package-backed modules are dependencies and enabled in `src/modules.ts` before assuming their services or files exist.
- Optional modules must degrade safely: the optional consumer owns glue and uses events, IDs/snapshots, widgets/enrichers, or a guarded DI resolve.
- Validate browser, API, CLI, worker, and queue bootstrap paths when a registry/global/service is consumed by more than one runtime.
- Prefer `globalThis` registries or structural type guards over chunk-local singleton/`instanceof` assumptions where bundlers may duplicate modules.

## Completion Check

1. Verify app code is under `src/modules/` and installed packages remain unchanged.
2. Verify every new discovered file uses its exact filename/export contract.
3. Run `yarn generate` and inspect warnings and the affected generated registration.
4. Run focused type/tests, then exercise every relevant runtime bootstrap.
