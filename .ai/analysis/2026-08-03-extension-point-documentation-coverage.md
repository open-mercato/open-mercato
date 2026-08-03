# Extension Point Documentation Coverage Audit

## Audit boundary

- Source PR: [#4883](https://github.com/open-mercato/open-mercato/pull/4883)
- Source head audited: `092e56572c8dc5a22c5a53e913862fd8324cc842`
- Generated from: detached scratch worktree at that exact commit via the package builds that run [`packages/create-app/build.mjs`](https://github.com/open-mercato/open-mercato/blob/092e56572c8dc5a22c5a53e913862fd8324cc842/packages/create-app/build.mjs)
- Official docs searched: all 257 Markdown/MDX files under `apps/docs/docs/`, plus `apps/docs/sidebars.ts`
- Runtime/fact authorities: [`extension-points.ts`](https://github.com/open-mercato/open-mercato/blob/092e56572c8dc5a22c5a53e913862fd8324cc842/packages/shared/src/modules/widgets/extension-points.ts), [`module-extension-facts.ts`](https://github.com/open-mercato/open-mercato/blob/092e56572c8dc5a22c5a53e913862fd8324cc842/packages/cli/src/lib/generators/module-extension-facts.ts), [`module-facts.ts`](https://github.com/open-mercato/open-mercato/blob/092e56572c8dc5a22c5a53e913862fd8324cc842/packages/cli/src/lib/generators/module-facts.ts), [`overrides.ts`](https://github.com/open-mercato/open-mercato/blob/092e56572c8dc5a22c5a53e913862fd8324cc842/packages/shared/src/modules/overrides.ts), and [`module-override-targets.ts`](https://github.com/open-mercato/open-mercato/blob/092e56572c8dc5a22c5a53e913862fd8324cc842/packages/cli/src/lib/generators/module-override-targets.ts)

This report inventories generated families, not changing module-specific IDs. The generated standalone artifacts remain the authority for the exact installed package set.

## Generated inventory snapshot

| Fact group | Emitted count | Source-link posture |
|---|---:|---|
| Installed modules | 54 | Every module has a portable `sourceRoot`. |
| Hosts | 1,474 total / 1,390 bound | Direct declaration source or source-linked `fact-ref`; unbound helpers remain diagnostics. |
| Contributions | 414 | Every contribution carries `source.path`. |
| Active bindings | 77 | Every activation carries `sourcePath`, optionally with a line. |
| Incoming installed refs | 54 | Every incoming row carries the contributor's portable source. |
| Exact override targets | 1,161 | Every target carries a source and fact reference; zero override-target diagnostics were emitted. |
| Provenance index entries | 1,172 | Every entry carries `source.sourcePath`. |
| Owned contracts | 675 | Every owned fact carries `source.sourcePath`. |

### Portable-source validation

The audit walked every `sourceRoot`, indexed fact source, owned-contract source, direct host source, contribution source, activation source, incoming source, and override-target source in `module-facts.json`.

| Check | Result |
|---|---:|
| Source references inspected | 4,285 |
| Unique source paths | 1,009 |
| Non-portable paths (absolute, traversal, or outside `node_modules/@open-mercato/`) | 0 |
| Paths without a corresponding package source file/directory | 0 |
| Line anchors outside the source file | 0 |
| Empty source refs in actionable JSON fact groups | 0 |
| Unresolved first-party contributions | 0 |
| Override target diagnostics | 0 |

Validation mapped `node_modules/@open-mercato/<package>/...` to `packages/<package>/...` in the exact source checkout, checked existence, and checked every one-based line anchor against the file length. This is the portable path convention rendered by [`renderSourceLink` / `renderSourceRefLink`](https://github.com/open-mercato/open-mercato/blob/092e56572c8dc5a22c5a53e913862fd8324cc842/packages/cli/src/lib/generators/module-facts.ts).

## Contribution coverage matrix

| Generated contribution kind | Snapshot count | Official coverage before this PR | Gap/action |
|---|---:|---|---|
| `widget` | 35 | `framework/widget-injection.md` | Covered; add facts-first host/source routing. |
| `data-table` | 8 | `framework/admin-ui/data-grids.mdx`, widget injection | Covered; centralize bound/helper distinction. |
| `crud-form` | 6 | `framework/admin-ui/crud-form.mdx`, widget injection | Covered; centralize lifecycle and bound/helper distinction. |
| `component-override` | 1 | widget injection | Covered; add generated-handle routing. |
| `response-enricher` | 16 | widget injection, data extensibility, query extensibility | Covered; add activation-state interpretation. |
| `api-interceptor` | 7 | Listed in current-surfaces, but `extending-api.mdx` did not explain the contribution or bridge | Extend the API guide and canonical catalog. |
| `command-interceptor` | 1 | Listed in current-surfaces, but the commands guide did not explain interceptors | Extend the commands guide and canonical catalog. |
| `mutation-guard` | 5 | Scattered across CRUD/locking docs; target activation and page-guard distinction absent | Extend the API/override guidance and canonical catalog. |
| `entity-extension` | 7 | `framework/database/data-extensibility.mdx` | Covered; add topology/resolution interpretation. |
| `subscriber` | 82 | `framework/events/overview.mdx` | Covered; add incoming/capability-only interpretation. |
| `browser-reaction` | 69 | widget injection and event bridge docs | Covered; centralize transport/audience fact vocabulary. |
| `specialized-registry` | 177 | Scattered across notification, integration, search, AI, provider, currency, and workflow guides | Add one complete registry-to-specialist routing table. |
| `module-override` | 0 | `framework/modules/overrides.mdx` | Runtime is documented; add generated exact-target workflow and missing `ai.extensions`. |

The closed contribution union and its kind-specific fields come directly from [`ModuleExtensionContributionFact`](https://github.com/open-mercato/open-mercato/blob/092e56572c8dc5a22c5a53e913862fd8324cc842/packages/shared/src/modules/widgets/extension-points.ts).

### Specialized registry inventory

The snapshot emitted `ai` (72), `integration` (7), `notification` (47), `payment` (1), `search` (47), and `workflow` (3). The closed schema also supports `vector`, `shipping`, and `currency`; absence from this selected package snapshot does not remove those supported fact families ([source](https://github.com/open-mercato/open-mercato/blob/092e56572c8dc5a22c5a53e913862fd8324cc842/packages/shared/src/modules/widgets/extension-points.ts)).

## Activation and resolution coverage

| Activation kind | Snapshot count | Previous official coverage | Action |
|---|---:|---|---|
| `crud-response-enricher` | 6 | Mechanism documented, generated binding meaning absent | Add canonical activation table. |
| `query-enricher` | 6 | Query opt-in documented, generated binding meaning absent | Add canonical activation table. |
| `mutation-guard` | 42 | Guard runtime documented in parts, generated binding meaning absent | Add canonical activation table. |
| `api-interceptor-bridge` | 5 | Shared pipeline not explained in API extension guide | Extend API guide and catalog. |
| `command-interceptor-bridge` | 1 | Not covered in commands guide | Extend commands guide and catalog. |
| `widget-injection-consumer` | 17 | Widget runtime covered, generated binding meaning absent | Add facts-first routing to widget guide. |
| `component-extension-consumer` | 0 | Component replacement covered, activation vocabulary absent | Add canonical activation table. |
| `dashboard-host-consumer` | 0 | Dashboard registry covered, activation vocabulary absent | Add canonical activation table. |

The snapshot's contribution resolutions were `bound` (36), `capability-only` (355), `optional-target-missing` (10), and `wildcard` (13), with zero `unresolved`. All five supported states, including `unresolved`, are documented from the closed [`ModuleExtensionResolution`](https://github.com/open-mercato/open-mercato/blob/092e56572c8dc5a22c5a53e913862fd8324cc842/packages/shared/src/modules/widgets/extension-points.ts) union.

## Unified override coverage matrix

| Runtime path family | Snapshot targets | Previous official coverage | Action |
|---|---:|---|---|
| `ai.agents`, `ai.tools`, `ai.extensions` | 72 | Agents/tools covered; `ai.extensions` absent from module override catalog | Add `ai.extensions` and generated-target workflow. |
| `routes.api`, `routes.pages` | 238 | Covered with convenience page paths | Document the canonical generated page keys. |
| `events.subscribers` | 82 | Covered | Add facts-first exact registry ID/source workflow. |
| `workers` | 36 | Covered | Add facts-first exact registry ID/source workflow. |
| `widgets.injection`, `.components`, `.dashboard` | 43 | Covered | Distinguish injection registry key from target spot and link facts. |
| `notifications.types`, `.handlers` | 47 | Covered | Add facts-first exact ID/source workflow. |
| `interceptors` | 7 | Covered only as conceptual ID | Link exact contribution targets. |
| `commandInterceptors` | 1 | Covered only as conceptual ID | Link exact contribution targets. |
| `enrichers` | 16 | Covered only as conceptual ID | Link exact contribution targets. |
| `guards` | 3 | Page/mutation guard distinction absent | Explicitly limit this domain to page middleware. |
| `cli` | 101 | Covered | Add facts-first exact command/source workflow. |
| `setup` | 84 | Covered, but table described module ID instead of supported property | Correct identity and list supported properties. |
| `acl.features` | 252 | Covered | Add facts-first exact feature/source workflow. |
| `di` | 142 | Covered | Document safe-metadata-only source posture. |
| `encryption.maps` | 37 | Covered | Add facts-first exact entity/config source workflow. |
| `nav.groupOrder` | framework-only | Covered | Explicitly keep out of module-specific targets. |

The exhaustive domain union is [`ModuleOverrideDomain`](https://github.com/open-mercato/open-mercato/blob/092e56572c8dc5a22c5a53e913862fd8324cc842/packages/shared/src/modules/overrides.ts); modes and exact module target adapters come from [`FRAMEWORK_OVERRIDE_HOSTS`](https://github.com/open-mercato/open-mercato/blob/092e56572c8dc5a22c5a53e913862fd8324cc842/packages/cli/src/lib/generators/module-extension-facts.ts) and [`MODULE_OVERRIDE_TARGET_ADAPTERS`](https://github.com/open-mercato/open-mercato/blob/092e56572c8dc5a22c5a53e913862fd8324cc842/packages/cli/src/lib/generators/module-override-targets.ts).

## Documentation changes selected

- Add `framework/extensibility/extension-facts.mdx` as the canonical complete fact vocabulary and evidence-routing page.
- Add it to the Extensibility Directory landing page, Current Surfaces index, and Docusaurus sidebar.
- Extend Generator Architecture and Standalone AI Harness docs with artifact/provenance contracts.
- Extend Module Overrides with facts-first exact targets, `ai.extensions`, canonical page keys, and page-guard separation.
- Extend Widget Injection with bound-host/source routing.
- Extend API and Commands guides for previously listed-but-undocumented interceptor/guard contribution families.

## Upstream generator gap found

At the audited head, actionable JSON facts are source-linked, but three generated Markdown views omit those links:

1. per-module `## UMES hosts` rows omit the host source;
2. per-module `## UMES contributions` rows omit the contribution source;
3. `framework-extension-points.md` rows omit framework host sources.

Those rows are anonymous in the human-readable artifact even though the JSON has source data. The docs audit therefore does not treat their Markdown presentation as complete. PR #4883 must add portable Source columns before this report can record full generated-doc coverage; this docs PR will refresh against its final head before completion.
