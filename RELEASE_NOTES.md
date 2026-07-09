# Release Notes

Deprecations and migration instructions, per the Backward Compatibility contract (see [`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md)). Release history lives in [`CHANGELOG.md`](CHANGELOG.md); this file tracks deprecations and the migrations they require.

## Unreleased

### Deprecated — `MODULE_FACTS_ALLOWLIST` export (module fact-sheet auto-discovery)

The module fact-sheet generator no longer gates on a hard-coded 9-module allowlist. It now **auto-discovers** every source-available package module: the `create-app` build (and `mercato agentic:init`) bundle a fact-sheet for every package-provided module (`discoverPackageModuleSources`), shipped to scaffolded apps as `.ai/guides/module-facts.json` + per-module sheets. The monorepo no longer emits a committed `apps/mercato/src/module-facts.generated.json` — that artifact had no runtime or test consumer and has been removed along with its generator (`generateModuleFacts`) and the unused registry-driven `discoverEnabledModuleSources` path.

- **Deprecated:** `MODULE_FACTS_ALLOWLIST` and `ModuleFactsModuleId` (exported from `@open-mercato/cli/lib/generators/module-facts`). They are retained (`@deprecated`, values unchanged) for **at least one minor version** and still drive the legacy `core.<module>.md` redirect-stub bridge, but no longer gate which modules receive fact-sheets. They will be removed in a future release.
- **Additive, non-breaking API:** `extractModuleFacts` gained an optional `moduleRoot`, and `extractAllModuleFacts` gained an optional `sources`. The legacy `{ coreSrcRoot, moduleIds? }` call shape still works and still defaults to the allowlist.

**Migration:** callers that iterate `MODULE_FACTS_ALLOWLIST` to enumerate documented modules should instead read the keys of the bundled `.ai/guides/module-facts.json` (or call `discoverPackageModuleSources` from `@open-mercato/cli/lib/generators/module-facts-discovery`). No action is required to keep existing calls working during the deprecation window.

Spec: [`.ai/specs/2026-07-06-module-facts-auto-discovery.md`](.ai/specs/2026-07-06-module-facts-auto-discovery.md).

### Deprecated — per-module standalone AI guides → generated fact-sheets

The hand-written per-module standalone guides that shipped into scaffolded apps as `.ai/guides/core.<module>.md` (for the user-facing core modules `auth`, `catalog`, `currencies`, `customer_accounts`, `customers`, `data_sync`, `integrations`, `sales`, `workflows`) are replaced by two layers:

- **Generated per-module fact-sheets** — `.ai/guides/modules/<module>.md` plus a combined `.ai/guides/module-facts.json` sidecar, extracted from module source (entities, events, ACL features, API routes with per-method auth, DI service tokens, searchable entities, host extension tokens, notifications, CLI) at build time.
- **One hand-written conceptual guide** — `.ai/guides/module-system.md`, covering the timeless module-system concepts (anatomy, auto-discovery, naming, mandatory mechanisms, data integrity, migrations).

**Migration:** reference `.ai/guides/modules/<module>.md` for a module's concrete facts and `.ai/guides/module-system.md` for conceptual guidance. For backward compatibility, the legacy `.ai/guides/core.<module>.md` names remain bundled as thin redirect stubs that point at the new fact-sheets for **at least one minor version**; freshly scaffolded apps link only the new paths. The redirect stubs will be removed in a future release.

Spec: [`.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md`](.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md).
