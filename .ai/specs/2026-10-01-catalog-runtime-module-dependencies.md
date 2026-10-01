# Catalog Runtime Module Dependencies

## 📝 TLDR

Make Catalog's existing runtime dependencies explicit so generation rejects incomplete standalone module selections before setup or product CRUD fails. Keep the Sales integration optional and skip commerce demo seeding when Sales is disabled.

## Resolved assumptions (autonomous defaults)

| Decision | Choice | Reason |
| --- | --- | --- |
| Declare or decouple existing integrations? | Declare genuine dependencies through existing `ModuleInfo.requires`. | The issue expressly accepts early rejection; this avoids redesigning custom fields, media and currency UI. |
| Sales dependency? | Keep optional. | Sales already requires Catalog; the reverse edge would create a cycle. Its demo data is conditional. |
| Split delivery? | One dependency-correctness fix. | Metadata and optional-demo handling together make Catalog's supported module closure accurate. |

## 📝 Proposed Solution

Declare Attachments, Currencies, Dictionaries and Entities. Entities brings Query Index transitively. Verify all three registry generators reject missing direct and transitive dependencies and accept the complete selection without Sales.

## 📝 Problem Statement and Evidence

Issue #6517 reproduces an app enabling only Auth, Directory, Configs, Audit Logs and Catalog. It generates successfully, then setup fails on an unregistered Dictionary and product creation fails on CustomFieldValue. Catalog currently has no `requires` declaration.

The direct dependencies are already real call sites:

- Dictionaries: `setup.ts` always calls `seedCatalogUnits`, which queries Dictionary and DictionaryEntry.
- Entities: the shared CRUD custom-field path reads CustomFieldDef/CustomFieldValue; Catalog declares custom entities and fieldsets.
- Attachments: Catalog's product-media API and variant-media commands query Attachment; the shipped media manager uses the attachment upload API.
- Currencies: the shipped product/pricing controls load currencies and Catalog ACL features explicitly depend on `currencies.view`.
- Query Index is already required by Entities and remains transitive.

The existing CLI generator already enforces `ModuleInfo.requires`. The nearby module-sets specification (`2026-09-29-module-sets-for-standalone-apps.md`) concerns a separate future resolver; this repair uses today's generator and does not implement that feature.

## 📝 Architecture and Contracts

Add the dependency values to Catalog metadata. Do not change the metadata type, generator algorithm, registry output shape, CLI flags, API request/response shapes, entity schema, DI tokens, feature IDs or imports.

Catalog's examples create Sales channels and select Sales tax rates. If Sales entities are not registered, return the existing false/no-seed result before creating partial demo state. Catalog defaults and normal CRUD still run. When Sales is registered, the existing example path is unchanged. No reverse `requires` edge is introduced.

## Related Work

The price-kind currency selector still uses the Customers currency hook on this baseline. Issue #6691 and active PR #6696 separately remove that incorrect UI coupling. This change declares the actual Currencies dependency used by price-scope controls and does not absorb that selector repair or claim every Catalog UI path is standalone-ready before it lands.

## Migration & Backward Compatibility

A previously incomplete Catalog module selection now fails at generation with the existing actionable dependency diagnostic. Enable `attachments`, `currencies`, `dictionaries`, `entities` and `query_index` in `src/modules.ts`, then generate and follow the normal operator-controlled initialization/migration workflow. This change does not apply migrations automatically.

Default module sets already contain these dependencies. The public `ModuleInfo` shape and every existing export remain unchanged; this corrects dependency metadata for features that already require those modules. No public symbol is removed or narrowed. Sales remains optional; enable it when the commerce demo dataset is desired.

## 📝 Risks and Failure Scenarios

A custom minimized app may newly fail generation even if it used only a narrow Catalog API subset. The required modules support the existing Catalog feature surface; the upgrade note gives the exact closure. Removing optional Sales must not cause a cycle, ORM metadata error, or partially seeded demo dataset. Reverting the metadata/guard is code-only; no persistent state or migration needs reversal.

## 🧪 Validation

Use the real Catalog and Entities metadata, compiled into disposable standalone package fixtures, through the full, app and CLI registry generators. The original five-module selection must fail; omission of transitive Query Index must fail; the complete closure without Sales must pass. Preserve the existing preset-closure test. A focused demo-seed test must prove absence of Sales produces no reads/writes, with present-Sales behavior unchanged. These are generator/setup regressions; no API or UI behavior is added, so no new browser flow is needed.

## 📋 Implementation Plan

1. Capture the missing-generation-error regression.
2. Declare dependencies and guard Sales-dependent examples.
3. Verify generation, optional-peer behavior and the configured validation gate.

## Changelog

- 2026-10-01: Skeleton and autonomous decisions documented before production edits; initial generator regression fails in all three registry modes on unchanged Catalog metadata.
- 2026-10-01: Independent scope review found no separate capability or scope creep. Nine registry regressions and the optional-Sales seed regression pass; production changes are limited to metadata and a pre-write demo guard. Validation completed locally: 70 generator-file tests and one seed regression passed; six preparation/typing gates and the application build passed. The full unit run passed 46/47 tasks (33441 Jest assertions); create-app alone hit the Homebrew libuv sandbox boundary, then passed 892 tests with five existing skips under self-contained Node 24.19. No sandbox rule was weakened.
