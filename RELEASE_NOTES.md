# Release Notes

Deprecations and migration instructions, per the Backward Compatibility contract (see [`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md)). Release history lives in [`CHANGELOG.md`](CHANGELOG.md); this file tracks deprecations and the migrations they require.

## Unreleased

### Deprecated — `MODULE_FACTS_ALLOWLIST` export (module fact-sheet auto-discovery)

The module fact-sheet generator no longer gates on a hard-coded 9-module allowlist. It now **auto-discovers** every enabled, source-available module: the monorepo `yarn generate` enumerates the app's enabled set (`resolver.loadEnabledModules()`), and the `create-app` build bundles a fact-sheet for every package-provided module. As a result, `apps/mercato/src/module-facts.generated.json` widened from 9 to the full enabled set (core + other packages; enterprise modules appear when the enterprise package is enabled; app-local demo modules are excluded in the monorepo).

- **Deprecated:** `MODULE_FACTS_ALLOWLIST` and `ModuleFactsModuleId` (exported from `@open-mercato/cli/lib/generators/module-facts`). They are retained (`@deprecated`, values unchanged) for **at least one minor version** and still drive the legacy `core.<module>.md` redirect-stub bridge, but no longer gate which modules receive fact-sheets. They will be removed in a future release.
- **Additive, non-breaking API:** `extractModuleFacts` gained an optional `moduleRoot`, and `extractAllModuleFacts` gained an optional `sources`. The legacy `{ coreSrcRoot, moduleIds? }` call shape still works and still defaults to the allowlist.

**Migration:** callers that iterate `MODULE_FACTS_ALLOWLIST` to enumerate documented modules should instead read the keys of `module-facts.generated.json` (or call `discoverEnabledModuleSources` / `discoverPackageModuleSources` from `@open-mercato/cli/lib/generators/module-facts-discovery`). No action is required to keep existing calls working during the deprecation window.

Spec: [`.ai/specs/2026-07-06-module-facts-auto-discovery.md`](.ai/specs/2026-07-06-module-facts-auto-discovery.md).

### Deprecated — per-module standalone AI guides → generated fact-sheets

The hand-written per-module standalone guides that shipped into scaffolded apps as `.ai/guides/core.<module>.md` (for the user-facing core modules `auth`, `catalog`, `currencies`, `customer_accounts`, `customers`, `data_sync`, `integrations`, `sales`, `workflows`) are replaced by two layers:

- **Generated per-module fact-sheets** — `.ai/guides/modules/<module>.md` plus a combined `.ai/guides/module-facts.json` sidecar, extracted from module source (entities, events, ACL features, API routes with per-method auth, DI service tokens, searchable entities, host extension tokens, notifications, CLI) at build time.
- **One hand-written conceptual guide** — `.ai/guides/module-system.md`, covering the timeless module-system concepts (anatomy, auto-discovery, naming, mandatory mechanisms, data integrity, migrations).

**Migration:** reference `.ai/guides/modules/<module>.md` for a module's concrete facts and `.ai/guides/module-system.md` for conceptual guidance. For backward compatibility, the legacy `.ai/guides/core.<module>.md` names remain bundled as thin redirect stubs that point at the new fact-sheets for **at least one minor version**; freshly scaffolded apps link only the new paths. The redirect stubs will be removed in a future release.

Spec: [`.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md`](.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md).
