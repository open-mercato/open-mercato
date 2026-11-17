# Privacy table coverage

> **Program:** package C5 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (open-mercato/open-mercato#8593). Ships with C1's first phase. The verification suite keeps its scan and end-to-end tests, not delivery of this gate.
> **Builds on:** [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md), especially R3-2 — The registry carries the whole `privacy.ts` default export, Export shape. **Shares the snapshot reader with** [`2026-11-16-tenant-exit-export.md`](2026-11-16-tenant-exit-export.md). DEC-G keeps `tableExports` separate from coverage.
> **Evidence:** source and canonical snapshots at `main` @ `08dada9624`, re-counted for this revision. This is a design; no coverage implementation was run.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/GDPR/2026-11-16-privacy-data-class-contract.md

## 📝 TLDR

A module can declare a data class, but nothing notices a module that declares none. There are 345 tables in the active source trees. **Proposed (future):** every table, or every declared row subset of a mixed table, has exactly one coverage owner, a reasoned classification or an explicit backlog entry. The existing unit suites enforce ownership and references. Coverage is complete only when every backlog is empty and every shared-store remainder is classified; the two remainders the product cannot bound are named Known limits, gated by checks rather than waived.

**Not in this spec:** proving that erasure removed a value (the verification suite), runtime data processing, or new API/UI paths.

## 📝 Overview

Data inventories classify stores explicitly; strict linters adopt a backlog for existing gaps. This design uses both. Column names are a second net, not a personal-data classifier or proof of handler correctness.

## 📝 Resolved assumptions (autonomous defaults)

| Id | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Table ownership | Optional class `tables`, required before claiming coverage; module `tables` map for other classifications | An export-only class is not complete export-and-erasure coverage. |
| 2 | Mixed tables | Named discriminator subsets plus a mandatory remainder | Person rows cannot waive company rows or unhandled entity types. |
| 3 | Existing gaps | One per-package baseline with module/table/subset, owner and reason | It starts with the inventory below and only shrinks; no numeric cap. |
| 4 | Inventory source | Exact `migrations/.snapshot-open-mercato.json` per module | `getMigrationSnapshotName` in `packages/cli/src/lib/db/commands.ts:136-139` returns `.snapshot-open-mercato`; ignore legacy and backup basenames. |
| 5 | Runner | Thin tests in existing package and app unit suites | No pipeline command or label change. |
| 6 | Edition | OSS with C1 (DEC-2) | The gate checks OSS module-owned handlers and the MIT contract, so it ships in OSS with C1 Phase 1. Enterprise packages run the same shared helper from their own tests. |
| 7 | Operational bound publication | Pruners publish static metadata as `retentionBounds` entries of kind `operational_pruner` | One member and one definition type serve record sets and pruners, so R4-13's dropped duplicate shape does not return. |

## 📝 Problem Statement

- Today's definition has no table list; its three root classes cover only a slice of the inventory.
- The active package/app trees have 57 canonical snapshots describing 345 tables. Two mirrored example-module snapshots in `packages/create-app/template` add five physical table definitions; they are tested as template copies, not counted twice in the active inventory.
- `customer_entities` contains both person and company rows. A person class cannot cover the entire table, and exporting a linked company's name does not make every company a subject.
- Custom-field values, attachments and history are shared stores. A seam covers only entity types actually served by declared classes; its existence cannot waive all other rows.
- A string naming a class, seam or retention set proves nothing unless the declaration resolves. Duplicate claims and foreign-module keys must fail.
- Existing snapshot/source guards provide the test placement precedent (`packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts`, `hot-path-indexes.test.ts`).

## 📝 Proposed Solution

### Declarations and row subsets

A class gains optional `tables`, listing its own module's tables or named subsets that both its export and erase handle. A string is shorthand for the whole table. A `{ table, subset }` entry covers only that subset. Classes may also declare `entityIds`: the actual entity identifiers whose records they handle through shared seams, validated against entity-id discovery. Subject kinds such as `customers:person` are not substituted for entity ids such as `customers:customer_entity`.

The default object gains `tables`, keyed only by tables from the declaring module's canonical snapshot. An entry has either a whole-table classification or `subsets`, with a discriminator column and a finite map of named value groups. Every value group is disjoint; the column must exist in the snapshot. The implicit `remainder` contains every other value, including null and future values. Every subset, including `remainder`, needs exactly one classification, class claim or backlog entry. Reject an unsupported selector rather than assuming coverage. Complex relation-based slices that cannot be expressed this way leave the whole table on the baseline until a complete class or reviewed classification exists.

For example, `customer_entities` is partitioned by `kind`: `person` is claimed by `customers.people` once its erase ships; `company` and the remainder stay explicitly baselined until reviewed. Linked deals and company names in C1's export do not remove entire deal or company tables from the backlog. A shared store may partition on `entity_id` and declare only the entity ids reached by real classes. `action_logs` cannot be waived wholesale by its subject-history seam; “Audit history and shared-store remainders” below gives its exact partition and the only honest classification of its remainder.

| Classification | Meaning and required reference |
|---|---|
| `none` | No person data; a required reason |
| `reference_only` | Person ids or purpose-bound pseudonymous identifiers with minimal objection metadata; required note and per-column `reviewedColumns` reasons, no copied addresses/names or free text; hashes remain personal data; there is no `columns` member |
| `tenant_configuration` | Controller settings, with required reason |
| `credential` | Authentication material that export excludes or redacts; required note and per-column review reasons under rule 5. When the canonical snapshot has a subject-linkage column (rule 11), `erasedBy` names a same-module class that declares erase and whose owner erase tests delete the subject's rows; otherwise `subjectLinkage: 'none'` with a reason. A class that also exports the table (for example session timestamps) uses `covered_by_class` instead |
| `runtime_state` | Transient processing/retry state with a required note and per-column review reasons where rule 5 applies; `attachment_pending_deletions` rows disappear after a successful drain, with stale rows reported rather than deleted by age |
| `retention_bounded` | `boundedBy` is a declared record-retention set id or `{ kind: 'operational_pruner', prunerId: string }` resolving against the operational-pruners registry for the exact table/supported subset; a set id names a same-module set, or another module's set under the owner-qualified bound rule below; owner metadata and status state the actual finite, disabled or pending condition |
| `covered_by_class` | Same-module `classId` lists export and erase; owner unit tests verify method wiring |
| `covered_via_seam` | A declared seam id plus the exact `entityIds` and consuming `classIds` for this subset |
| `known_limit` | Only on the `remainder` of a shared store: `limitId` names an entry of the helper's reviewed known-limits list, each mirrored in the program's Known limits, with a required note. It is never coverage; it records a remainder the product honestly does not bound, and rule 12 gates it |

Seams are declared by their owning modules in optional `privacy.ts.seams` as `{ id, handlerService, entityIds }`. Collect and validate them with the same R3-2 member mechanism. A seam reference must resolve, its DI key must be declared in that module's seam metadata, its entity ids must be declared by the consuming classes and discovered for those modules, and its named classes must declare export and erase. The static helper validates references and declared capabilities; each owning module's handler unit tests, bootstrapped with its real DI registrar, assert the corresponding methods exist. It does not instantiate services or claim to verify their behavior. No generator change is needed. This metadata records C4's existing seam designs under DEC-B — The audit-history strip routine and R3-1 — The audit-history rule for every erasure; it does not redefine their behavior. Absent declarations never count as coverage.

Resolve the owner objects in C4's “Shared-store seam declarations” exactly. `attachments.records` uses `attachmentService`; `entities.custom_values` uses `entitiesPrivacyService`; `audit_logs.subject_history` uses `subjectHistoryService`. Their enumerated `entityIds` arrays are authoritative: the initial attachments set is `auth:user`, `customers:customer_entity`, `customers:customer_person_profile`, `customer_accounts:customer_user`, `staff:staff_team_member`, `eudr:eudr_plot` and `eudr:eudr_evidence_submission`. The entities/history sets additionally include `staff:staff_time_entry`, `staff:staff_time_project`, `staff:staff_time_task`, `staff:staff_time_report` and `staff:staff_time_tag`. Each consuming class must declare only its tested served intersection; future owner-declared additions require the same validation. No guessed subject-kind alias or whole-table waiver replaces these objects. Unsupported entity ids, snapshot-only history mentions and all remainders stay baselined until the closure rule below classifies them.

### Audit history and shared-store remainders

`action_logs` partitions on `resource_kind`, whose values are the dot-form kinds commands log (`customers.person`, `auth.user`). The history seam's `entityIds` are entity identifiers such as `auth:user`; they are never `action_logs` discriminator values and never select a subset. C4's colon-to-dot subject matching applies only inside its strip routine. `audit_logs/privacy.ts.tables.action_logs` declares exactly these named subsets:

| Subset | `resource_kind` values | Classification |
|---|---|---|
| `export_evidence` | `privacy.subject_export`, `privacy.subject_export_request` | `retention_bounded` by `privacy.export_evidence` (C1) |
| `tenant_export_evidence` | `privacy.tenant_export` | `retention_bounded` by `privacy.tenant_export_evidence` (tenant exit) |
| `erasure_evidence` | `privacy.subject_erasure`, `privacy.subject_erasure_progress`, `privacy.erasure_call` | `retention_bounded` by `privacy.erasure_evidence` (C4) |
| `retention_run_evidence` | `privacy.retention_run` | `retention_bounded` by `privacy.retention_evidence` (record retention) |
| `remainder` | Every other kind, null and future kinds: ordinary history, Enterprise `data_erasure.*` evidence, `audit_logs.export` and settings-command evidence | `known_limit` `audit_ordinary_history` |

Each evidence subset is an **owner-qualified bound**: the set belongs to another module, but the rows and the deleting method belong to `audit_logs`. A set id owned by another module is accepted only when all of these hold: the table owner declares the matching `retentionBounds` entry of kind `retention_set`, with that `retentionSetId`, its own `handlerService` and exact owner-local targets; the set resolves through `getRetentionSets` over the supplied `referenceModules` and its declaration includes the `records` target; the claim is a named discriminator subset, never a whole table or `remainder`; and the table owner's unit tests assert that the method the set's handler calls (`applyRetention` with `includeResourceKinds`, `expireTenantExportEvidence`, `expireErasureEvidence`) selects exactly that subset's values. The owner-qualified handler's `resolve` obtains the effective age through the set owner's DI-registered `privacySettingsService.get(scope, name)`, soft-optional; an absent service gives `unboundedReason`, never a finite deadline. A package gate whose reference inventory lacks the set's module leaves the subset baselined. Each subset is claimed only once its set ships.

The remainder is honest only as a named limit. In OSS nothing bounds ordinary history: C4 strips a subject's planned history records on erasure, and Enterprise's action-log retention bounds the remainder only once a policy is configured. Its rows also include evidence whose bound needs a second column (C1's settings evidence, selected by its clear-text related pair `privacy.settings_command` / `privacy.settings.set`) or an Enterprise set that a core declaration cannot reference; G6 evaluates those rows against their owners' bounds. In Enterprise, ordinary-history rows of the remainder are evaluated by the governance module's `dataErasureRetentionBounds` handler under bound ids `data_erasure.change_values` (snapshot/payload/change/context columns) and `data_erasure.change_history` (whole row), defined in the [action-log-retention spec](../enterprise/GDPR/2026-11-16-action-log-retention.md), "Retention bounds for C5/G6"; a pass that has not caught up by the next pass date projects `mode: 'pending'` with `unboundedReason: 'backlog_growing'`. `audit_ordinary_history` therefore records the edition-dependent state rather than a coverage claim, and every new module's history is inside it by construction.

`attachments` and `custom_field_values` partition on `entity_id`. At final closure their remainders become `known_limit` `shared_store_undeclared_entities`, accepted only with the **served-entity registry check** of rule 12: in the app composition gate and in Enterprise's own composition test, with the full discovered entity-id inventory, every discovered entity id is, for each of the `attachments.records` and `entities.custom_values` seams, either served by that seam and consumed by a class, or declared by the module that owns the entity id (the prefix before the colon) in its own `privacy.ts.sharedStoreEntities` as holding no personal data for that store, with a reason. An unaccounted entity id fails naming it, so a new module's files and custom fields cannot escape the gate. The remainder then holds only rows whose entity id no enabled module declares: rows left by removed or disabled modules, or malformed ids. Package gates check only their own entity ids; before closure the remainder stays baselined.

The helper's reviewed known-limits list (`packages/shared/src/lib/privacy/testing/knownLimits.ts`) holds exactly `audit_ordinary_history` and `shared_store_undeclared_entities`. Adding an id requires a matching entry in the program's Known limits; no other classification or table can use one.

### Retention bounds for independent verification

`retention_bounded.boundedBy` is a reference, never prose such as “successful drain” or a bare environment variable. A string resolves a real record set through `getRetentionSets(modules)`: a same-module set, or another module's set only under the owner-qualified bound rule above. R4-13 — Operational retention bounds extends that union with `{ kind: 'operational_pruner', prunerId: string }`, which resolves against the operational-pruners registry owned by [`2026-11-16-operational-retention-pruners.md`](2026-11-16-operational-retention-pruners.md), “Operational bound projection for C5/G6”. Besides the sixteen pruner tables, the [access-log-retention spec](2026-11-16-access-log-retention.md) declares the `audit_logs.access_logs` `operational_pruner` entry for `access_logs` through the same variant and collector; its effective window is in hours and a `keep` group projects `mode: 'off'`. The operational owner declares one such bound per pruned table or supported subset; there is no separate duplicate `operationalRetentionBounds` declaration. This does not turn a pruner into a record set. Both kinds publish their static target/column/anchor metadata in optional `privacy.ts.retentionBounds` under R3-2 — The registry carries the whole `privacy.ts` default export. A record-set entry has kind `retention_set` and links by `retentionSetId` to the real same-module set, or to an owner-qualified foreign set; a pruner entry has kind `operational_pruner`, its pruner id as `id` and its `scheduleKey`. `getPrivacyRetentionBounds(modules)` collects and validates every entry; `getOperationalRetentionBounds(modules)`, the operational-pruners registry, is its view of the `operational_pruner` entries. Every reference must match exact owner-table/supported-subset targets and allowed surviving columns. A broad table target cannot waive an unrelated subset. Missing target, column, subset, set, pruner, schedule or service metadata fails the static gate; metadata alone never grants coverage. Operational reference validation and survivor allowances apply once the owner ships those entries and handlers.

For record sets, G6's “1. Run-bound retained declarations” consumes the validated `PrivacyRetentionBoundDefinition` and the handler's `resolve({ scope, boundId, now, em })` projection below. Its owner supplies the effective window, eligibility/terminal-state rule and age anchor used by deletion, not a copied default or translated `ageBasis`. `evaluateFixtureRow` applies that same rule to the captured fixture row through the owning module, on the supplied read-only snapshot manager; it returns only the evaluated state/time, never row contents. For an `operational_pruner` bound, fixture evaluation belongs to the resolved pruner owner's `evaluateFixtureRow`, using the same deletion predicate and clock; no record-set adapter or separate operational-bound shape is required. G6 still matches the exact captured table/supported subset/row/column and does not ask the erasure handler to bless its own leftovers. Null windows, disabled/report/counting states, missing or disabled registration, unknown execution and outstanding continuation are explicit unbounded/pending conditions, never proof that an old survivor is within a finite deadline. Enabled registration alone proves no running worker. Pending file content still blocks erasure completion.

The operational owner returns the existing `PrivacyRetentionBoundProjection`: `effectiveWindow`, `mode`, `countingGraceEndsAt`, `enabled`, `scheduled`, `workerState` and optional `unboundedReason`. It derives the window and mode from `getOperationalRetentionWindows()`, the shared mode parser and first-count metadata. A counting period is `mode: 'report'` with its deadline in `countingGraceEndsAt`; a disabled bound is `mode: 'off'` with `enabled: false`. Missing or disabled schedule registration gives `scheduled: false`; unavailable or unobserved worker execution gives `workerState: 'unavailable'` or `'unknown'`; outstanding continuation is `mode: 'pending'`. Missing first-count metadata without an explicit mode and other unresolved enforcement conditions carry `unboundedReason` rather than a finite-deadline claim. Exact table/supported-subset, column, age-anchor, eligibility, window, schedule and owner-service metadata remain with that pruner. Validate the schedule key against `getRetentionScheduleDefinitions(modules)` and the service against owner metadata; schedule and worker observations remain scheduler-owned and are checked through fixture execution. Unsupported relation/discriminator subsets and remainders stay baselined. Tenant settings remain R3-3 — Tenant privacy settings live in `module_configs`, via C1's `privacySettingsService.get(scope, name)`. No cross-module table read is authorized. DEC-H — The counting-period bridge governs operational history, not expired-token cleanup. Under R4-5 — Attachment pending-deletion rows, the pending-deletion journal is `runtime_state`, not a `retention_bounded` claim or a dependency on a retry retention set; its successful `drainPendingDeletions` deletes the row. Failed storage deletion or no running retry leaves it pending, without an invented TTL. R3-8 — Retention drains its own pending file deletions keeps record-runner drains with the record-retention owner. Neither classification certifies finite deletion or program completion. Set/guard behavior remains DEC-C — Retention sets and holds and R3-5 — Holds, honestly; operational pruners do not gain subject holds.

C3's `data_erasure.governance_evidence` and `data_erasure.retention_failures`, and C9's `data_erasure.replay_evidence`, resolve their actual `privacy.ts.retentionSets` declarations through that same registry/reference inventory. Their owners' exact table/lifecycle/column metadata and current clocks remain required for survivor verification; a hand-written name allowlist or an unresolved bound never waives them.

### Failure rules

Build one index across class `tables`, module-map classifications and baseline entries, keyed by module, table and optional subset. A whole-table claim overlaps every subset; one table cannot be claimed whole in one place and split in another. Fail when:

1. any table/subset is absent from the index, appears more than once, or has overlapping whole/subset claims; this includes two classes and a class plus map, not only a leftover baseline;
2. a class or map key names another module's table, any baseline entry names an unknown module/table/subset, or any `tableExports` key is absent from that module's own canonical snapshot;
3. a named class, seam, set, pruner or entity id does not resolve, `boundedBy` is neither a same-module record-set id, an owner-qualified foreign record-set id meeting every condition of “Audit history and shared-store remainders”, nor an `operational_pruner` reference resolving against the operational-pruners registry, required exact table/supported-subset/column/predicate/window/schedule/owner-service metadata is missing, a class is foreign where same-module is required, or export/erase is absent from the referenced class declaration;
4. discriminator values overlap, the column is absent, a subset is unknown, or `remainder` is unaccounted for;
5. `none`, `reference_only`, `tenant_configuration`, `credential` or `runtime_state` has a suspicious column without a non-empty per-column review reason, or a reviewed column no longer exists;
6. a `credential` classification has no `tableExports` entry excluding the table or redacting each credential column once that member is available;
7. a `tableExports` entry uses `nullTenant: 'shared'` unless the whole-table coverage classification is `none` or `tenant_configuration`, with no data class listing that table (whole or subset); baselined, personal, credential and class/seam-covered tables cannot become shared by choosing a flag;
8. an export declaration violates the tenant-exit spec’s scoped tenant-less-table, nullable-tenant, secret/lookup-hash or all-JSON guards below;
9. a baseline adds an identity that was not in its initial ceiling or grows after becoming empty;
10. `exclude.reason` is `global` but the canonical migration snapshot has a `tenant_id` or `organization_id` column, the table is a scope-root table, the table is absent from the test's reviewed list with a non-empty one-line reason, or the declaration's `exclude.rationale` is missing or differs from that reason (R5-8); fail naming the table;
11. a `credential` table has a subject-linkage column but no `erasedBy` class that resolves in the same module and declares erase, or declares `subjectLinkage: 'none'` while such a column exists;
12. a `known_limit` is used outside a shared-store `remainder`, names an id absent from the reviewed known-limits list, or, for `shared_store_undeclared_entities`, the composition gate's served-entity registry check finds a discovered entity id that is neither served by the store's seam nor declared by its owning module in `sharedStoreEntities`; a `sharedStoreEntities` entry naming another module's entity id, an unknown seam or an undiscovered id also fails; or
13. a `runtimeTables` entry names a table present in any canonical snapshot, declares columns its owner's DDL test does not confirm, or fails the export guards of rules 8 and 10 against its declared columns.

Rule 5 splits snake_case into tokens and also matches contiguous phrases. It catches `email`, `phone`, `name`, `first_name`, `last_name`, `full_name`, `display_name`, `address`, `ip`, `user_agent`, `birth`, `note`, `notes`, `body`, `file`, `filename`, `file_name`, `storage_path` and `path`. Independently flag JSON/JSONB columns by snapshot type, whatever their name. `name` catches `owner_name`; `ip` does not match a substring of `shipping`. Acknowledgements are `reviewedColumns: Record<string, string>`, column to justification; a table-level note cannot acknowledge a column.

Rule 11's subject-linkage column is any column whose snake_case tokens end in `id` and include `user`, `person`, `customer`, `member`, `account` or `subject` (`user_id`, `customer_user_id`, `person_entity_id`), or any column with a snapshot foreign key to a table that a data class lists in `tables`. A `credential` table with such a column (for example Enterprise MFA methods, recovery codes and SSO identities) leaves the backlog only with an `erasedBy` class whose erase deletes it; an owner erase test with a user-linked fixture row proves the deletion. Only a credential table with no such column, such as a tenant-level integration secret, uses `subjectLinkage: 'none'`, and it is removed with its tenant.

A scope-root table is one whose primary key is itself the tenant scope. The helper pins exactly one: `directory.tenants`, whose canonical snapshot has only `id`, `name`, `is_active` and timestamps. It is never `global`: directory declares it with a scoped owner reader that filters `id = tenantId`, so tenant exit and scan attribute the leaving tenant's own row and nothing else. Adding a scope-root table changes the pinned list in review.

Beside rule 6, enforce tenant exit’s exact `TableExportEntry` contract rather than a second export schema. In particular, `nullTenant: 'shared'` is valid only for reviewed whole-table `none`/`tenant_configuration` rows outside every data-class table claim, as rule 7 specifies. Every declared tenant-less table, even an excluded one, needs `via` or a scoped owner-registered `reader` unless `exclude.reason` is `global`; every declared non-global entry needs that owning `reader`, including entries with a `via` plan. `scanReader` alone is insufficient. The static reader guard applies to declared `tableExports` entries; a table with no entry is not a static failure, because tenant exit reports it at runtime as a named gap until its owner registers the entry with its reader (tenant exit, “Reader delivery”). Every declared nullable-tenant table needs `nullTenant`. Under R5-8, validate a global exclusion only when the canonical migration snapshot has neither `tenant_id` nor `organization_id`, the table is not scope-root, and the table appears on the test's reviewed list with a non-empty one-line reason equal to the declaration's `exclude.rationale`. The declaration carries the rationale so that tenant exit's runtime plan validation enforces the same snapshot and reason checks; the static list keeps every global table visible in review. Either scope column fails even when nullable; no row-count assumption replaces the snapshot check. A missing reviewed entry, reason or rationale fails naming the table. Only a global exclusion that passes both checks is `not_applicable` to scan; other exclusions stay scoped and scannable. The shared-null-tenant rule does not waive attribution or any column guard.

Every JSON/JSONB column needs the tenant-exit `json` decision with rationale, or whole-table exclusion; a coverage-side `reviewedColumns` reason alone is not an export decision. Secret-name guards accept whole-table exclusion without redundant per-column redaction. All mapped `hashField` siblings and module-written address lookup hashes redact as `key_material` or belong to an excluded table. `reviewedChecksums` is exactly `Array<{ column: string; rationale: string }>` from tenant exit, for reviewed scalar checksums only; no identifier-purpose digest or mapped/module-written lookup hash qualifies. R4-9 — Suppression state in a tenant export governs C8's “Forms suppression metadata”: export `forms_invitation_suppressions` with both `recipient_hash` and `key_id` redacted, plus a row count. Name the redacted columns in the manifest; the digest's reason remains `key_material`. Neither column qualifies for a reviewed-checksum exception. Validate existing columns and non-empty rationales; a contradictory JSON export/secret decision fails. These are declaration checks, not runtime decryption or scan implementation. The receiving system cannot rebuild the opt-outs from this export, even with the original suppression key; that is a known limit of this version, with no suppression-state handover or SUPPRESSION-EXPORT exception.

A `tableExports` entry is never indexed as coverage (DEC-G — The tenant-export reader and its declarations). Covered, partially covered and baselined tables may all have one; its absence cannot turn export-only metadata into coverage.

Tables that code creates at runtime have no canonical snapshot: search's pgvector `vector_search` and `vector_search_migrations` (`packages/search/src/vector/drivers/pgvector/index.ts`). Their owner declares them in tenant exit's separate `runtimeTables` member, with the exact columns its DDL creates and a `TableExportEntry`. Rule 13 validates them against those declared columns, with the same export guards; they never enter the coverage index, and the verification suite's scan, not this gate, checks their content. The CLI's per-module `mikro_orm_migrations_<module>` tables are migration bookkeeping that tenant exit classifies itself; no module declares them.

### Baseline and monotonic ceiling

Baseline entries are `{ moduleId, table, subset?, owner, reason }`. Generate the initial inventory before removing reviewed claims. Commit a sibling `privacy-coverage-ceiling.json` with those initial identities. The helper requires the baseline to be a subset of this ceiling, and each coverage change removes its identities from both, so a new table cannot be added to the backlog. For partitioning an existing baselined table, replace its whole identity with named subsets and `remainder` in both files, preserving the same original module/table identity; this is narrowing, not adding a table. Keep the ceiling's original module/table set pinned in the package coverage test. Once a baseline is empty, set its test's `baselineClosed: true`; then any non-empty baseline fails even if its ceiling once allowed it. The first empty-baseline change removes the ceiling's remaining identities and pins an empty ceiling, so closure cannot silently reopen.

The review checklist requires both baseline and ceiling to shrink after initialization; a subset conversion needs explicit evidence that all rows, including the remainder, remain accounted for. This is a source-review and unit-test control, not a new CI workflow. A changed test can defeat any test: that residual is stated below.

### Inventory and closure owners

The counts below are starting table/backlog counts before root handlers and the first reviewed pass remove entries. They are not a claim that these tables are already covered. Rows marked C5 final inventory pass have no domain handler assigned today: C5 owns the classification review and must retain an explicit implementation backlog for any personal data it cannot classify honestly. That backlog blocks final completion and must be assigned to a domain carrier in the program; it cannot be waived as a long tail.

| Package/module | Starting tables | Closure carrier |
|---|---|---|
| `mercato/example` | 4 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `mercato/example_customers_sync` | 1 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `ai-assistant/ai_assistant` | 11 | Content-AI coverage (DEC-J for workflows) |
| `checkout/checkout` | 3 | Commerce coverage (DEC-J for the assigned modules) |
| `core/api_keys` | 1 | People-ops coverage |
| `core/attachments` | 3 | C4 attachments seam; C5 remainder: served-entity registry check and `shared_store_undeclared_entities` |
| `core/audit_logs` | 2 | Owner-qualified evidence bounds (C1, C4, tenant exit and record-retention sets); C4 history seam; C5 remainder: `audit_ordinary_history`; `access_logs`: whole table `retention_bounded` by `{ kind: 'operational_pruner', prunerId: 'audit_logs.access_logs' }`, declared with handler `auditLogsOperationalRetentionBounds` by the access-log-retention spec ("Retention bound for C5/G6") |
| `core/auth` | 11 | C1 exports; C4 erasure |
| `core/availability` | 1 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `core/business_rules` | 4 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `core/cart` | 5 | Commerce coverage (DEC-J for the assigned modules) |
| `core/catalog` | 13 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `core/communication_channels` | 8 | Communication coverage |
| `core/configs` | 2 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `core/currencies` | 3 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `core/customer_accounts` | 10 | C1 exports; C4 erasure |
| `core/customer_groups` | 3 | Commerce coverage (DEC-J for the assigned modules) |
| `core/customers` | 26 | C1 exports; C4 erasure; C5 company remainder review |
| `core/dashboards` | 3 | People-ops coverage |
| `core/data_sync` | 4 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `core/devices` | 1 | People-ops coverage |
| `core/dictionaries` | 2 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `core/directory` | 2 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `core/ecommerce` | 3 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `core/entities` | 6 | C4 custom-field seam; C5 remainder: served-entity registry check and `shared_store_undeclared_entities` |
| `core/eudr` | 6 | Content-AI coverage (DEC-J for workflows) |
| `core/feature_toggles` | 2 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `core/forms` | 11 | Content-AI coverage (DEC-J for workflows) |
| `core/inbox_ops` | 5 | Communication coverage |
| `core/integrations` | 4 | People-ops coverage |
| `core/messages` | 7 | Communication coverage |
| `core/notifications` | 4 | People-ops coverage |
| `core/payment_gateways` | 4 | Commerce coverage (DEC-J for the assigned modules) |
| `core/perspectives` | 2 | People-ops coverage |
| `core/phone_calls` | 2 | Communication coverage |
| `core/planner` | 2 | People-ops coverage |
| `core/progress` | 1 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `core/promotions` | 9 | Commerce coverage (DEC-J for the assigned modules) |
| `core/push_notifications` | 1 | People-ops coverage |
| `core/query_index` | 6 | Search-index protection; C5 classification |
| `core/resources` | 6 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `core/sales` | 27 | Commerce coverage (DEC-J for the assigned modules) |
| `core/shipping_carriers` | 3 | Commerce coverage (DEC-J for the assigned modules) |
| `core/staff` | 25 | People-ops coverage |
| `core/sync_excel` | 1 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `core/translations` | 1 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `core/warranty_claims` | 9 | Commerce coverage (DEC-J for the assigned modules) |
| `core/wms` | 12 | C5 final inventory pass: classify or retain an explicit implementation backlog |
| `core/workflows` | 9 | Content-AI coverage (DEC-J for workflows) |
| `documents/documents` | 11 | Content-AI coverage (DEC-J for workflows) |
| `enterprise/agent_orchestrator` | 21 | Enterprise coverage |
| `enterprise/record_locks` | 2 | Enterprise coverage |
| `enterprise/security` | 6 | Enterprise coverage |
| `enterprise/sso` | 6 | Enterprise coverage |
| `onboarding/onboarding` | 1 | People-ops coverage |
| `scheduler/scheduler` | 2 | Operational-retention pruners; C5 classification |
| `webhooks/webhooks` | 5 | Operational-retention pruners; C5 classification |

Active totals: `core` 272, `enterprise` 35, `ai-assistant` 11, `documents` 11, `webhooks` 5, app modules 5, `checkout` 3, `scheduler` 2, `onboarding` 1: 345. The template mirrors `example` (4) and `example_customers_sync` (1), not a second runtime owner. DEC-J — Modules with no coverage owner assigns the carrier and channel packages to commerce and communication; none adds a canonical snapshot to this census. The 345-table count is the current source census, not a ceiling for future declarations: portal email change adds `customer_user_email_changes`, unsubscribe headers adds `forms_invitation_suppressions`, C4 adds `attachment_pending_deletions`, and the planned `form_to_deals` module adds `form_to_deals_bindings` and `form_to_deals_submission_map`. These new tables ship with their declarations below, never a new baseline identity or a silent revision of the original census.

### First root inventories

C5 owns writing and testing the three roots' table lists; C1 does not already supply them. Before attaching a list, compare it with C1's export sections and C4's erase outcomes. Export-only roots remain baselined until C4 supplies erase. A unit fixture proves both that the lists match snapshots and that export alone removes nothing.

| Root | Candidate own tables/subsets; no whole-table coverage implied |
|---|---|
| `auth.users` | `users`, `user_roles`, `user_acls`, `user_consents`, `sessions`, `password_resets`, `user_sidebar_preferences`, `sidebar_variants` (per-user, named; today's user delete already removes it); shared role definitions remain separately classified |
| `customers.people` | `customer_entities` person subset, `customer_people`; review person-owned portions of `customer_addresses`, `customer_comments`, `customer_activities`, `customer_interactions`, tag/label assignments, person-company links/roles, entity roles, todo links and email-conversation shares; mixed tables stay baselined unless the subset is expressible and fully covered |
| `customer_accounts.users` | `customer_users`, `customer_user_sessions`, `customer_user_roles`, `customer_user_acls`, `customer_user_email_verifications`, `customer_user_password_resets`, `customer_user_invitations`; add account-owned `customer_user_email_changes` with its portal schema/export/erase change; shared role definitions remain separately classified |

### Newly declared account and objection tables

`customer_user_email_changes` belongs to `customer_accounts.users`, not a separate class or shared seam. The email-change owner adds encrypted `new_email`, nullable `token_hash`, `cancel_token_hash` and `approval_token_hash`, `approved_at` and `cancelled_via`; account export includes metadata only, and account erasure deletes every pending, used, cancelled or expired row and its capabilities, with every changed identity in `historyRecords` under R3-1 — The audit-history rule for every erasure. Attach its class table claim only when both export and full erasure ship. The new-table phase must deliver both before its coverage gate passes: `tableExports` or a metadata-only export is not sufficient. Tenant exit independently declares handling of encrypted `new_email` and redacts capability digests; ordinary subject export never includes the target or digests. The table stays account-scoped after the root is anonymized, so its erasure test includes orphan/retry state.

The planned core `form_to_deals` module declares `form_to_deals_bindings` as `tenant_configuration` and `form_to_deals_submission_map` as `reference_only` with `reviewedColumns` for all fifteen columns in its own `privacy.ts` when its Phase 1/2 tables ship ([form-to-deals spec](../2026-06-17-form-to-deals.md), Data Models → Privacy declarations); it declares no data class.

C4's Data Models owns the pending-deletion journal. Under R4-5 — Attachment pending-deletion rows, declare `attachments/privacy.ts.tables.attachment_pending_deletions` with `personalData.kind: 'runtime_state'`, a note explaining the retry lifecycle and the column review reasons required by rule 5. A successful `drainPendingDeletions` deletes the row. This coverage classification requires no `attachments.pending_deletions` retention set or handler. Age alone never removes the journal's encrypted coordinates: failed storage deletion or no running retry keeps the row pending and erasure incomplete, without a fixed TTL. Attachments declares `attachments.pending_deletions_stale` in its `privacy.ts.doctorChecks` with `needs: 'database'`; rows older than 7 days surface through that counting-only database-tier check, as the doctor spec cites R4-5. Pending-deletion rows are not audited records and write no action-log entries, so they need no planned history identities; C4 owns that exception to the history-record rule. Classification and a stale-row warning do not prove file deletion.

The unsubscribe-headers spec introduces `forms_invitation_suppressions`; content-ai's “Invitation objections and activity attribution” supplies its forms-owned classification. Declare it exactly once in forms `privacy.ts.tables` as `reference_only`, using `note` plus `reviewedColumns`, never an unsupported `columns` property. Review every column: `recipient_hash` is the purpose-bound pseudonymous recipient identifier; `key_id` detects suppression-key mismatch, not a secret; `id`, `tenant_id` and `organization_id` identify/scope the objection; `source` is the fixed `one_click`/`page` enum; `created_at` and `updated_at` record objection timing. Give each column its own non-empty reason in `reviewedColumns`; reject renamed columns, extra address/name/free-text fields or an unrestricted source string. It is personal data, not anonymous configuration, and is not a table claim of `forms.submissions`. Unsubscribe assumption 8 keeps it after subject erasure, with no age pruner, so invitations do not resume; it is removed only on the recipient's request, on tenant deletion or by that spec's assumption 10 discard of mismatched rows. This is a reasoned classification and a forms inventory/closure task, never a new baseline/ceiling identity. Its separate `tableExports` entry does not count as coverage under DEC-G — The tenant-export reader and its declarations. R4-9 requires that tenant export redact both `recipient_hash` and `key_id` and include a row count; content-ai, unsubscribe and C8 cite that same decision. No reviewed-checksum exception remains. A receiving system cannot rebuild the opt-outs; suppression-state handover is a known limit of this version.

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Infer person data from column names | Misses payload semantics; the net is a review aid only |
| Count a seam or person slice as a whole table | Leaves company rows and unhandled entity types invisible |
| One blanket string per exemption | Cannot validate the implementation or a renamed column |
| A named export for each declaration | This convention deliberately reads members of the default object; existing generators support other conventions' fallback exports |
| Live database check | Not needed for a static inventory; database checks belong to R3-4 — An opt-in database tier for the doctor |
| A separate pruner metadata member | Restores the duplicate operational-bound shape R4-13 removed; a `retentionBounds` kind serves both owners |

## 📝 Delta

### Capability: privacy-table-coverage

#### ADDED Requirement: Coverage ownership
The unit suite SHALL require exactly one valid owner, classification or backlog per table/subset.

##### Scenario: New or duplicate table claim
- WHEN a new table is undeclared, two classes claim it, or a class and map overlap
- THEN the test names the missing or duplicate ownership and fails

##### Scenario: Unresolved reference
- WHEN a class, seam, entity id, same-module retention set or operational bound reference is dangling, its required owner metadata is missing or a class lacks export/erase support
- THEN the test fails before coverage is reported

##### Scenario: Mixed table
- WHEN the person subset is covered and company rows are not
- THEN company/remainder entries stay on the baseline and block program completion

##### Scenario: Shared store
- WHEN a seam lists only the root classes' declared entity ids
- THEN only those subsets pass; unknown entity ids and the remainder are uncovered

##### Scenario: Shared-store remainder at closure
- WHEN the `attachments` or `custom_field_values` remainder is classified `known_limit` `shared_store_undeclared_entities` and a discovered entity id is neither served by the store's seam nor declared by its owning module in `sharedStoreEntities`
- THEN the composition gate fails naming that entity id; with every discovered id accounted for, the remainder passes as the named limit

##### Scenario: Audit evidence subsets
- WHEN `audit_logs` claims `action_logs` subset `export_evidence` as `retention_bounded` by `privacy.export_evidence`
- THEN the owner-qualified bound passes only with audit's own `retentionBounds` entry, a resolving `records` set in the reference inventory and an owner test proving `applyRetention` selects exactly the subset's kinds; a whole-table or `remainder` claim on a foreign set fails, and the remainder passes only as `known_limit` `audit_ordinary_history`

##### Scenario: User-linked credential table
- WHEN a `credential` table has a `user_id` column and no `erasedBy` class, or claims `subjectLinkage: 'none'`
- THEN the test fails naming the table; an `erasedBy` same-module class that declares erase passes, and suspicious credential columns still need review reasons

##### Scenario: Export metadata only
- WHEN a table has only `tableExports`
- THEN coverage fails; adding it to an otherwise valid claim neither covers nor duplicates that claim

##### Scenario: Review acknowledgement
- WHEN a suspicious or JSON column lacks a reason, or an acknowledged column was renamed
- THEN the test fails and identifies the column

##### Scenario: Operational pruner bound
- WHEN `boundedBy` is `{ kind: 'operational_pruner', prunerId }`
- THEN the reference resolves against the operational-pruners registry for the exact table or supported subset, fixture evaluation uses the pruner owner's `evaluateFixtureRow`, and G6 reports off/report/grace/unscheduled/pending enforcement without inventing a finite deadline

##### Scenario: Attachment retry state
- WHEN `attachment_pending_deletions` is declared as `runtime_state`
- THEN coverage requires its note and column reviews but no retention-set reference or planned history identities; a successful drain deletes its row and rows older than 7 days surface through `attachments.pending_deletions_stale` with `needs: 'database'`

##### Scenario: Minimal objection record
- WHEN the new forms suppression table carries only its reviewed scoped identifier, fixed source and timestamps
- THEN its `note`/`reviewedColumns` declaration passes without a baseline addition; an unsupported `columns` member, copied address/free text or export-only declaration fails

##### Scenario: Shared null-tenant restriction
- WHEN a personal, baselined or class-listed table declares `nullTenant: 'shared'`
- THEN the gate fails; only reviewed whole-table `none` or `tenant_configuration` without any data-class table claim qualifies

##### Scenario: Reviewed global exclusion
- WHEN a table declares `exclude.reason: 'global'`
- THEN the static coverage test accepts it only when the canonical migration snapshot has neither `tenant_id` nor `organization_id`, the table is not scope-root, and the table is on the test's reviewed list with a non-empty one-line reason equal to the declaration's `exclude.rationale`; otherwise it fails naming the table (R5-8)
- WHEN `directory.tenants` declares `global`
- THEN the test fails although its snapshot has no scope column; its scoped owner reader filters `id = tenantId`

##### Scenario: Runtime-created table
- WHEN search declares `vector_search` in `runtimeTables` with its DDL columns, `exclude: derived` and a scoped reader
- THEN the declaration passes the export guards against those columns; a `runtimeTables` name found in any canonical snapshot, or columns its DDL test does not confirm, fails

##### Scenario: Export declaration agreement
- WHEN an excluded tenant-less table lacks attribution, JSON lacks an export decision, or a lookup/identifier hash including the forms suppression digest is safe-listed
- THEN the same guard as tenant exit fails; coverage review reasons do not bypass export guards

##### Scenario: Suppression export cannot transfer opt-outs
- WHEN the tenant export writes `forms_invitation_suppressions`
- THEN both `recipient_hash` and `key_id` are redacted and a row count is included; neither a reviewed-checksum exception nor a claim that the receiver can rebuild opt-outs is accepted

##### Scenario: Snapshot decoys
- WHEN legacy `.snapshot-openmercato.json` and `.snapshot-open-mercato.json.backup` exist beside the canonical file
- THEN only `.snapshot-open-mercato.json` is read

##### Scenario: Baseline growth
- WHEN a new table is added to the baseline, or a closed baseline becomes non-empty
- THEN the existing unit test fails

## 📝 Architecture

- **Shared contract.** Add optional class table/entity metadata, module classifications, seams, `sharedStoreEntities` and record-set and pruner retention bounds to `packages/shared/src/modules/privacy.ts`. `getPrivacyTables` consumes `Module.privacy.tables`; `getPrivacyRetentionBounds` consumes `Module.privacy.retentionBounds`. Resolve actual sets with record retention's `getRetentionSets`; resolve `{ kind: 'operational_pruner', prunerId }` through the operational-pruners registry under R4-13, which is `getOperationalRetentionBounds(modules)` over the `operational_pruner` entries of that same member. All declaration members follow C1's R3-2 validation. Do not generate individual member fields or a duplicate operational-bound declaration. The legacy `privacyDataClasses` alias remains derived.
- **Helper.** `packages/shared/src/lib/privacy/testing/{index.ts,coverage.ts}` reads only canonical snapshots immediately under each module's `migrations` directory, loads its default declaration under the test runner, builds the cross-reference index and checks the static rules. No ORM load or database is needed. Its explicit `referenceModules` and `entityIds` inputs contain the declaration inventory needed for cross-package references; snapshots remain limited to `modulesRoot`. Package tests supply their own declarations and public dependency declarations only. A missing optional dependency cannot justify a seam claim: leave that slice on the baseline. The app composition test supplies the full enabled registry; Enterprise composition is tested within Enterprise, never imported into core tests. It also holds the reviewed known-limits and scope-root lists (`knownLimits.ts`) and exports the shared snapshot reader for tenant exit (DEC-G).
- **Packages.** `core`, `enterprise`, `ai-assistant`, `checkout`, `documents`, `onboarding`, `scheduler`, `webhooks` each receive `src/__tests__/privacy-table-coverage.test.ts` plus baseline and ceiling JSON files at their package root.
- **App.** Use `apps/mercato/src/modules/__tests__/privacy-table-coverage.test.ts` and `apps/mercato/src/modules/privacy-coverage-{baseline,ceiling}.json`; these live under the allowed module tree. Sync byte-identical mirrors into `packages/create-app/template/src/modules/` with `yarn template:sync:fix`. The current scaffolder skips `__tests__` (`packages/create-app/src/index.ts:430-446`), so mirrored tests alone do not ship a gate.
- **Standalone delivery.** Preserve that skip rule. Document the exact helper call and test file in the scaffold's discovery guide so a scaffold owner opts into this unit gate. Fresh apps carry the matching reviewed baseline/ceiling (initially five example tables, not an empty assertion of coverage); after presets remove example modules, filter their baseline/ceiling identities to the delivered snapshots. The template packaging test checks those JSON files and the mirrored opt-in test. Adding automatic test-copy behavior would change scaffold policy and is outside this fix.

| Touchpoint | Mechanism | Absent/failure behavior |
|---|---|---|
| Helper → module | Load default `privacy.ts` under test runner | No declaration means baseline; a load/validation error fails with file name |
| Runtime collectors → declarations | Whole `Module.privacy`, R3-2 | No member contributes none; invalid present member follows its collector's failure policy |
| Shared store → class | Validated seam/entity/class references | Missing capability is uncovered, not a blanket waiver |
| Tenant export → snapshots | `readModuleSnapshots` | Same canonical inventory; export declarations remain independent |

## 📝 Data Models

No database change. Baseline/ceiling JSON files are test artifacts; subset metadata is declarative source. This check never reads personal values, acquires a tenant manager or changes a record.

## 📝 API Contracts

```ts
type PrivacyTableClaim = string | { table: string; subset: string }
// optional on a data-class definition
tables?: PrivacyTableClaim[]
entityIds?: string[]

type PrivacyTableClassification =
  | { kind: 'none' | 'tenant_configuration' | 'runtime_state'
      note: string; reviewedColumns?: Record<string, string> }
  | { kind: 'credential'
      note: string; reviewedColumns?: Record<string, string> }
      & ({ erasedBy: { classId: string } } | { subjectLinkage: 'none'; reason: string })
  | { kind: 'reference_only'
      note: string; reviewedColumns?: Record<string, string> }
  | { kind: 'known_limit'; limitId: 'audit_ordinary_history' | 'shared_store_undeclared_entities'; note: string }
  | { kind: 'retention_bounded'; boundedBy: string | { kind: 'operational_pruner'; prunerId: string } }
  | { kind: 'covered_by_class'; classId: string }
  | { kind: 'covered_via_seam'; seam: string; entityIds: string[]; classIds: string[] }

type PrivacyTableEntry =
  | { personalData: PrivacyTableClassification }
  | { discriminator: string
      subsets: Record<string, { values: Array<string | number | boolean>
        personalData?: PrivacyTableClassification }>
      remainder?: PrivacyTableClassification }

// optional members of the privacy.ts default object
tables?: Record<string, PrivacyTableEntry>
seams?: Array<{ id: string; handlerService: string; entityIds: string[] }>
sharedStoreEntities?: Array<{ seam: string; entityIds: string[]; personalData: { kind: 'none'; note: string } }>

type PrivacyRetentionBoundTarget = {
  table: string
  subset?: string
  columns: string[]
  ageAnchor: { columns: string[]; rule: string }
  eligibility: string
}
type PrivacyRetentionBoundDefinition = {
  id: string
  handlerService: string
  targets: PrivacyRetentionBoundTarget[]
} & (
  | { kind: 'retention_set'; retentionSetId: string }
  | { kind: 'operational_pruner'; scheduleKey: string }
)
retentionBounds?: PrivacyRetentionBoundDefinition[]

type PrivacyRetentionBoundProjection = {
  boundId: string
  targets: Array<PrivacyRetentionBoundTarget & {
    effectiveWindow: { value: number; unit: 'hours' | 'days' | 'years' } | null
    mode: 'delete' | 'report' | 'off' | 'pending'
    countingGraceEndsAt: string | null
    enabled: boolean
    scheduled: boolean
    workerState: 'available' | 'unavailable' | 'unknown'
    unboundedReason?: string
  }>
}
type PrivacyRetentionBoundHandler = {
  resolve: (input: { scope: PrivacyScope; boundId: string; now: string; em: EntityManager }) =>
    Promise<PrivacyRetentionBoundProjection>
  evaluateFixtureRow: (input: {
    scope: PrivacyScope; boundId: string; table: string; subset?: string
    rowId: string; now: string; em: EntityManager
  }) => Promise<{
    status: 'within_window' | 'expired' | 'not_eligible' | 'unbounded' | 'not_found' | 'unknown'
    anchorAt: string | null; expiresAt: string | null; reason: string
  }>
}
```

All shapes have strict zod schemas and inferred types in the shared contract. Subset ids cannot be `remainder`, value lists are non-empty and unique across the table, reasons cannot be whitespace, and every reviewed column exists. Reject `reference_only.columns`; purpose-bound objection records use the same supported `note`/`reviewedColumns` shape. A `credential` has exactly one of `erasedBy` and `subjectLinkage`. `known_limit` is valid only as a `remainder` classification; its `limitId` enum mirrors the reviewed list. `sharedStoreEntities` entries name only the declaring module's own entity ids and a declared `attachments.records` or `entities.custom_values` seam; they are not index identities. Map entries without `personalData` locate a subset; its class or baseline owns it in the index. A class claimed through `covered_by_class` does not also list that identity in its own `tables`, avoiding a duplicate. `tableExports` is a separate optional member defined by tenant exit; it never enters this index.

`getPrivacyRetentionBounds(modules)` validates unique module-prefixed bound ids, owner-local targets, non-empty unique existing allowed/anchor columns, exact known subsets, non-empty stable `ageAnchor.rule`/`eligibility` identifiers for both kinds, and the real `retentionSetId` reference for `retention_set` entries: same-module, or a foreign set under the owner-qualified bound rule, whose targets remain owner-local. `getOperationalRetentionBounds(modules)` selects the `operational_pruner` entries and checks each `<moduleId>.<table>` pruner id and its `scheduleKey` against `getRetentionScheduleDefinitions(modules)`. These rule ids name the owning deleting code's shared predicates, never executable SQL or translated text. Missing declarations are errors even if a string matches a known environment variable, queue or method. Validate runtime projections against the immutable target/column/anchor inventory; reject omitted/extra targets, invalid timestamps, non-finite/negative windows or unknown states. Off/report/grace/unscheduled/unavailable-worker states state the missing enforcement rather than claiming a finite bound. The handler is read-only and cannot enqueue/drain, bootstrap, mutate or query another owner's tables. `EntityManager` is a type-only import from `@mikro-orm/postgresql`; owner services use the supplied transaction snapshot. Missing or failed runtime projection/evaluation is a G6 gate, never an exemption. Static imports validate metadata without instantiating the handler. `attachment_pending_deletions` uses `runtime_state` under R4-5 and needs no retention-bound projection.

For `{ kind: 'operational_pruner', prunerId }`, resolve `prunerId` against the operational-pruners registry under R4-13 and require the owner's same-module `operational_pruner` `retentionBounds` entry for the exact pruned table or supported subset. Validate same-module ownership, exact snapshot columns, age anchor, eligibility, effective window, schedule and owner-service references; unsupported subsets do not inherit a whole-table waiver. Fixture evaluation is performed by that pruner owner's `evaluateFixtureRow`, not the record-set handler or an erasure handler. Consume the owner's `PrivacyRetentionBoundProjection` with `boundId` equal to `prunerId`, using exactly `effectiveWindow`, `mode`, `countingGraceEndsAt`, `enabled`, `scheduled`, `workerState` and optional `unboundedReason` as enforcement evidence rather than coverage by itself. Counting periods map to report mode with `countingGraceEndsAt`, registration to `scheduled`, execution to `workerState`, and outstanding continuation to pending mode; disabled bounds retain off mode and `enabled: false`. Validate the same exact targets and strict projection schema used for record sets, without extending that shape. Disabled/report/counting/unknown, missing or disabled schedule, unobserved execution or outstanding continuation never establishes a finite enforced bound. Preserve credential/export redaction and fail closed on absent/failed metadata or services. No separate duplicate operational-bound declaration or record-set adapter is required.

`@open-mercato/shared/lib/privacy/testing` exports `assertPrivacyTableCoverage({ modulesRoot, baselinePath, ceilingPath, baselineClosed, referenceModules, entityIds })` and `readModuleSnapshots(modulesRoot)`. `referenceModules: readonly Module[]` carries actual validated default declarations from the same test-safe module loader or generated composition registry, not a hand-written target-name allowlist. `entityIds: readonly string[]` comes from existing entity-id discovery metadata, never ORM imports. A caller must supply every referenced target; missing targets fail closed. A valid string is still checked against this inventory. The app composition gate cross-checks package declarations against the enabled registry; collector validation alone is insufficient.

## 📝 Edge Cases & Failure Scenarios

| Case | Behavior |
|---|---|
| Canonical snapshot and no declaration | Tables remain baselined with an owner and reason |
| Missing canonical file but only a legacy snapshot | Fail inventory discovery for an entity-owning module; never treat it as zero tables |
| Foreign-module table key | Fail even when that table exists elsewhere in the package |
| Global exclusion on a scoped, scope-root or unreviewed table | R5-8 fails naming the table if the snapshot has either scope column, the table is `directory.tenants`, the reviewed-list entry lacks its one-line reason or the declaration's rationale differs |
| User-linked credential table without an erasing class | Rule 11 fails naming the table; no export exclusion alone closes it |
| New module adds attachments or custom fields to an undeclared entity type | Composition gate's served-entity registry check fails naming the entity id until a class serves it or its owner declares it in `sharedStoreEntities` |
| New module logs a new `resource_kind` | Falls in the `action_logs` remainder, the named `audit_ordinary_history` limit; C4's strip still removes the subject's planned history records |
| Table or acknowledged column renamed | Old reference fails; new identity needs reviewed coverage |
| Unhandled company or shared-store entity type | Remainder stays baselined; no false program completion |
| Export-only root | Candidate table list recorded; baseline retained until erase ships |
| Pending-deletion row older than 7 days | Database-tier `attachments.pending_deletions_stale` reports counts; keep retry coordinates until successful drain deletes the row |
| Suppression table exported | Redact `recipient_hash` and `key_id`, include a row count; receiver cannot rebuild opt-outs |
| Operational pruner reference is missing or covers another subset | Fail the reference; no duplicate metadata shape or whole-table waiver supplies coverage |
| Runtime-created vector table | Outside canonical snapshots; search declares it in `runtimeTables`, validated by rule 13 against its DDL columns; its content is covered by the verification-suite scan, never a claim this gate scans it |
| Side-effectful declaration import | Fail naming file; declaration imports must be side-effect-free, including optional doctor checks (DEC-I — The doctor's extension point) |
| Third-party author | Calls helper with empty baseline/ceiling and `baselineClosed: true`; new tables need declarations |
| Mirrored template snapshots | Check template separately; never duplicate active package counts |
| Scaffold without opted-in test | Documentation says the static gate is not installed; it must not claim equivalent coverage |

## 📝 Migration & Backward Compatibility

No database migration or existing API behavior changes. Class table metadata is new and optional at runtime; the new check requires complete metadata to claim coverage. All claims concern an unreleased convention. R5-8 tightens the static test: global exclusions require an unscoped, non-scope-root snapshot and a reasoned reviewed-list entry; the declaration carries the same reason as `exclude.rationale` (tenant exit's type) so runtime plan validation enforces it too. It adds no helper argument.

| Surface | Classification | Compatibility |
|---|---|---|
| Class `tables`/`entityIds`, module `tables`/`seams`/`sharedStoreEntities`/`retentionBounds` (including its `operational_pruner` kind and owner-qualified foreign set ids), `getPrivacyRetentionBounds` and record-set projection/handler types; `runtime_state`, `credential`'s `erasedBy`/`subjectLinkage`, `known_limit` and `boundedBy`'s `operational_pruner` reference | §1/§2/§3 additive | Members of `Module.privacy`; keep C1's derived alias and record-set string references; no new generator field; pruner entries, `getOperationalRetentionBounds` and `evaluateFixtureRow` remain pruner-owned, with no duplicate bound shape |
| `@open-mercato/shared/lib/privacy/testing` | §4 new stable test-only subpath | Add explicit types/default export entry for its directory `index.ts`, as shared `lib/testing` does; wildcard file exports do not resolve a directory automatically |
| `@open-mercato/shared/lib/privacy/placeholders` | §4, owned by C4 | New stable file subpath from the erasure spec; C4 must classify it there; this spec neither exports nor redesigns it |
| Baseline/ceiling format, helper arguments and the reviewed known-limits and scope-root lists | New test contract | Version together before release; existing runtime module contracts unchanged; a new known-limit id needs a program Known-limits entry |
| App/template parity | Additive opt-in test and JSON artifacts | Sync existing module tree; preserve test-copy skip behavior and state the opt-in limit |

## 📋 Phasing

| Phase | Outcome |
|---|---|
| 1, with C1 | Metadata, canonical reader, index/subset/class/seam/snapshot/credential/global/runtime-table rules and the gate with explicit initial baselines; `retention_bounded` references fail closed until their collectors exist, so those tables stay baselined |
| 2, with each carrier | Validated class/seam/subset declarations remove their exact backlog identities. When record retention lands, record-set and owner-qualified references resolve; when pruners land, `operational_pruner` references resolve |
| 3, final gate | All package/app baselines empty and closed, template in parity; remainders classified, with the two known limits gated by rule 12 and mirrored in the program's Known limits |

## 📋 Implementation Plan

1. **Phase 1.** Add schemas, member collectors and index validation through R3-2; no generator change beyond C1's whole-object transport. In `shared/src/lib/privacy/testing/__tests__/coverage.test.ts`, test every failure rule: two classes, class/map, baseline overlap, foreign key, dangling class/seam/bound/set/pruner/entity, missing bound target/column/anchor/eligibility, missing declared class action, subset overlap and missing remainder, renamed reviewed column, each name token and JSON type, credential export agreement, shared-null-tenant rejection for personal/class-listed/baselined and split tables, required non-global owner reader/tenant-less attribution, R5-8 acceptance of a reviewed global table with neither scope column and rejection naming the table for `tenant_id` or `organization_id` separately (including nullable columns), a missing reviewed-list entry or an empty/whitespace/multiline reason, every JSON decision, lookup-hash redaction, typed checksum/rationale validation, forms recipient-hash/key-id redaction and rejection of checksum bypasses for either, and baseline growth/closed baseline. Owner handler tests separately assert DI wiring and declared methods; the static helper never promises this check. Add local/dependency/app reference-inventory fixtures and reject missing cross-package targets. Test optional `tables` and `retentionBounds` of both kinds, including the `runtime_state` classification and `operational_pruner` reference, survive all five registries in C1's parity fixture. Add Phase 1 cases for the rules added since: a user-linked `credential` fixture with no class fails and one with a same-module erasing `erasedBy` class passes, `subjectLinkage: 'none'` with a `user_id` column fails and credential suspicious columns need reasons (rule 11); `known_limit` on a whole table or named subset, or with an unlisted id, fails (rule 12); a `runtimeTables` name present in a snapshot or with undeclared columns fails, and a global runtime table is checked against its declared columns (rule 13); `directory.tenants` declared `global` fails as scope-root; a global declaration whose `exclude.rationale` differs from the reviewed-list reason fails. In Phase 1, a `retention_bounded` reference resolves only against declarations supplied in the fixture's reference inventory; real tables that need a set or pruner stay baselined, and an unresolvable reference fails closed.
   - **When record retention lands (Phase 2).** Resolve record sets through actual `getRetentionSets` declarations, with no name allowlist. Test owner-qualified foreign sets: accept `audit_logs.action_logs` subsets bound by `privacy.*` sets with audit's own `retentionBounds` entry; reject a foreign set on a whole table or `remainder`, a set without `records`, a missing audit entry and a reference inventory lacking the set's module. Audit owner tests assert that `applyRetention`, `expireTenantExportEvidence` and `expireErasureEvidence` select exactly the declared subset kinds, including C4's `privacy.subject_erasure_progress` entries, which `expireErasureEvidence` deletes with their run group. C3/C9 evidence sets resolve in the Enterprise package's own `privacy-table-coverage.test.ts`, never in core or shared tests.
   - **When operational pruners land (Phase 2).** Resolve `prunerId` through the operational-pruners registry over `operational_pruner` `retentionBounds` entries, validate exact table/subset/column/window/schedule/service references, and reject missing/foreign pruners, a missing or unknown `scheduleKey` and unsupported subsets without a duplicate bound shape.
2. **Phase 1, attached in Phase 2.** Write the three root inventories above by reading their canonical snapshots and C1 exports/C4 erase outcomes. Test all listed names, scope of mixed tables and the export-only rejection. Add `customer_user_email_changes` with its portal phase: metadata-only export, encrypted target/three token digests, complete account erasure/history and independent tableExports redaction; reject export-only coverage. Attach only fully exportable/erasable lists when C4 lands; until then do not subtract them.
3. **Phase 1.** Add canonical reader fixtures with legacy and backup decoys, absent canonical file and mirrored templates. Add package/app tests plus baseline/ceiling files with the census counts above; initial ceilings are pinned in test fixtures. Name the negative fixture `unclassified-table` in `packages/core/src/__tests__/privacy-table-coverage.test.ts`: add a synthetic canonical-snapshot table with neither declaration nor baseline, invoke the real helper and assert failure names that module/table. Tests in each package run through its existing unit command.
4. **Phase 1, continued in Phase 2.** First reviewed pass: classify only verified id/timestamp/flag rows, acknowledging suspicious/JSON columns individually. When the unsubscribe schema ships, include the exact forms suppression `reference_only` declaration and retained-objection reason above; test all eight reviewed columns, fixed source enum, no copied address/free text, renamed column/unsupported `columns` rejection, no baseline/ceiling addition and export-only failure. Require C8's redaction of both `recipient_hash` and `key_id`, manifest entries, a row count and the known limit that a receiver cannot rebuild opt-outs; a reviewed-checksum entry cannot bypass either redaction. Register C4's exact `attachments.records`, `entities.custom_values` and `audit_logs.subject_history` owner objects but claim only validated consuming entity subsets; keep all remainders and unimplemented seam capabilities on the backlog. Resolve real same-module record sets and operational-pruner references before claiming them. Test `attachment_pending_deletions` as `runtime_state` with no retention-set/handler dependency and no baseline addition; reject missing notes and required column reviews. The attachments owner's drain tests assert that successful cleanup deletes the row, failure preserves retry coordinates and pending status, and the journal writes no action-log entries or planned history identities. Its doctor tests assert `attachments.pending_deletions_stale`, `needs: 'database'`, a strict older-than-7-days count and no personal values. Runtime projection and fixture-evaluation assertions belong to their owners' suites, not this gate: the verification suite's `retentionBounds.test.ts` and each deleting owner's tests (record-set handlers additionally test attempted writes on the supplied read-only manager; operational fixture evaluation remains pruner-owned). Before closure, claim the `action_logs` evidence subsets as each set ships and keep its remainder baselined. Give C5 inventory rows a reviewed exemption or a named blocking implementation task. Every domain PR removes only identities it actually covers, from both the baseline and its ceiling.
5. **Phase 1.** Add the shrinking-baseline/ceiling and closed-baseline rule to `.ai/review-checklist.md`, plus declaration docs in `.ai/docs/module-development.md` and the scaffold discovery guide. Sync app/template artifacts with `yarn template:sync:fix`. In `packages/create-app/src/lib/privacy-coverage-template.test.ts`, verify mirrored test, delivered JSON and preset filtering; state that standalone users must opt in. The program places C5 in C1's first phase; scan/E2E delivery stays with the verification spec.
6. **Phase 3.** Final closure: enumerate every row in the matrix; require empty baselines, pin empty ceilings and `baselineClosed: true`, and verify all shared-store remainders are classified. Classify the `action_logs` remainder `known_limit` `audit_ordinary_history` and the `attachments`/`custom_field_values` remainders `known_limit` `shared_store_undeclared_entities`; add `sharedStoreEntities` declarations for every discovered non-personal entity id and run the served-entity registry check in the app composition gate (Enterprise runs it in its own composition test). Test that an undeclared discovered entity id fails naming it and that both limit ids appear in the program's Known limits. Any unresolved person-data backlog blocks this phase and program completion. No silent cap or global waiver. Archive the Delta only if the capability taxonomy has been adopted.

### File manifest

| File | Action |
|---|---|
| `packages/shared/src/modules/{privacy.ts,registry.ts}`; `packages/shared/src/lib/privacy/testing/{index.ts,coverage.ts,knownLimits.ts,__tests__/coverage.test.ts}` | Modify / create metadata, validated references and canonical reader |
| `packages/shared/package.json` | Add explicit test-only directory export |
| `packages/{core,enterprise,ai-assistant,checkout,documents,onboarding,scheduler,webhooks}/src/__tests__/privacy-table-coverage.test.ts` | Create thin unit gate |
| `packages/{core,enterprise,ai-assistant,checkout,documents,onboarding,scheduler,webhooks}/privacy-coverage-{baseline,ceiling}.json` | Create initial inventory; only shrink |
| `apps/mercato/src/modules/__tests__/privacy-table-coverage.test.ts`, `apps/mercato/src/modules/privacy-coverage-{baseline,ceiling}.json` | Create app gate and explicit backlog |
| `packages/create-app/template/src/modules/__tests__/privacy-table-coverage.test.ts`, `packages/create-app/template/src/modules/privacy-coverage-{baseline,ceiling}.json` | Mirror via template sync; document standalone opt-in |
| `packages/create-app/src/lib/privacy-coverage-template.test.ts`; preset baseline filtering in `packages/create-app/src/index.ts` | Create / modify packaging checks and JSON filtering only; preserve skipped test copying |
| Root modules' and reviewed modules' `privacy.ts`; owning modules' bound resolver/pruner implementations/tests | Candidate lists, C4's exact seams and pending-deletion `runtime_state`/doctor check, record-set projections and operational-pruner references/fixture evaluation; attach full claims only when references resolve |
| `.ai/review-checklist.md`, `.ai/docs/module-development.md`, `packages/create-app/agentic/shared/ai/skills/om-module-scaffold/references/discovery-surface-catalog.md` | Add the ratchet and declaration/opt-in guidance |

## 🧪 Integration Coverage

No affected API or UI path. Static unit fixtures create temporary snapshot/declaration/baseline trees and remove them in `finally`; no database or seeded data. `coverage.test.ts` includes the full rule matrix, a person/company split and two served/unserved seam entity types, and C1's generator suite checks the whole-object transport. Bound/set/pruner references supplied by another package are validated from dependency declaration metadata without importing that package's runtime or enterprise source. Missing capability metadata fails closed. The template packaging test scaffolds an isolated temporary fixture, checks delivered baselines against selected snapshots and removes it. The named `unclassified-table` negative fixture lives in the core package gate itself, not only in the helper suite; it must exercise the canonical reader and report the exact missing identity. Fixtures also cover user-linked and unlinked credential tables, owner-qualified `action_logs` evidence bounds, both known limits with the served-entity registry check, a runtime-created table and the scope-root `directory.tenants` rejection. They cover the new email-change, pending-deletion and suppression declarations with no new baseline entry; pending-deletion `runtime_state` passes without a retention set, and suppression export redacts both named columns with a row count and no reusable opt-out claim. Attachments owns scoped successful/failed drain and stale-row doctor fixtures, including the 7-day boundary and absence of journal history/audit writes. Runtime record-set projections and operational-pruner fixture evaluation belong with G6 and each deleting owner: self-contained scoped database fixtures prove the same window/predicate as actual deletion, read-only enforcement and unknown/pending output; no static-gate database work is introduced. C1/C4 and domain carriers retain self-contained API/CLI and key UI integration coverage for the actual handlers; this static gate does not replace those tests.

## 📝 Risks & Impact Review

#### The backlog becomes permanent
- **Scenario**: A module has an owner name but nobody delivers its handler or reviews an exemption.
- **Severity**: High
- **Affected area**: program completion
- **Mitigation**: Census carrier per snapshot, explicit C5 classification owner for the remainder, and empty closed baselines as a final phase.
- **Residual risk**: A genuinely unimplemented class still blocks completion; the test cannot implement it.

#### A classification or subset is wrong
- **Scenario**: A claim hides free text, company rows or shared-store entity types, or retry state is mistaken for completed deletion.
- **Severity**: High
- **Affected area**: export/erasure completeness
- **Mitigation**: Disjoint subsets, mandatory remainder, reference checks, column/JSON acknowledgements and domain integration fixtures; pending-deletion `runtime_state` keeps storage failures incomplete and reports rows older than 7 days through the named database-tier doctor check.
- **Residual risk**: Column review is not semantic proof; values outside fixtures can still mention people. A stale-row warning does not complete a failed drain.

#### A named limit or credential class hides personal data
- **Scenario**: A remainder is labelled a known limit to close the baseline, or a user-linked credential table is classified without any erasure path.
- **Severity**: High
- **Affected area**: program completion and erasure completeness
- **Mitigation**: `known_limit` only on shared-store remainders, two reviewed ids mirrored in program Known limits, and the served-entity registry check for file and custom-field stores; rule 11 requires a same-module erasing class for any credential table with a subject-linkage column.
- **Residual risk**: OSS ordinary action-log history stays unbounded until an Enterprise policy or a future OSS set exists; it is disclosed, not solved. Rows under entity ids of removed modules remain in the named limit.

#### An operational bound is mistaken for enforced deletion
- **Scenario**: A valid pruner reference is treated as proof that an old survivor is within its retention window despite a disabled schedule, counting period or pending continuation.
- **Severity**: High
- **Affected area**: retention verification
- **Mitigation**: Resolve the exact table/subset through the operational-pruners registry, use its owner's `evaluateFixtureRow` and require current window/enforcement evidence; missing references or services fail closed without duplicate metadata.
- **Residual risk**: An enabled registration proves no worker liveness; unknown or pending enforcement remains unbounded.

#### A scoped table is hidden as global
- **Scenario**: An export declaration marks a tenant- or organization-scoped table global, suppressing its scan or export.
- **Severity**: High
- **Affected area**: tenant isolation and completeness
- **Mitigation**: R5-8 accepts the exclusion only when the canonical snapshot has neither scope column and the test's reviewed list gives the table a non-empty one-line reason; each failing condition names the table and has a negative fixture.
- **Residual risk**: A table without scope columns can still carry personal data through an owner relation; the reviewed reason remains a required human check.

#### A tenant export is assumed to transfer opt-outs
- **Scenario**: A receiving system treats exported suppression metadata as a reusable objection list.
- **Severity**: Medium
- **Affected area**: tenant migration
- **Mitigation**: R4-9 redacts both `recipient_hash` and `key_id`, includes a row count, removes the reviewed-checksum exception and states that the receiving system cannot rebuild opt-outs.
- **Residual risk**: Suppression-state handover is unavailable in this version.

#### The ceiling is edited to evade review
- **Scenario**: A new table is added to both baseline and ceiling/test pin.
- **Severity**: Medium
- **Affected area**: future modules
- **Mitigation**: Shrinking checklist, pinned initial inventory and empty closure lock; tests reject ordinary additions.
- **Residual risk**: A reviewer can approve changing the test itself; no source test prevents deliberate removal of its own control.

#### A scaffold is assumed to have the gate
- **Scenario**: Mirrored test is skipped on copying and the user assumes coverage is checked.
- **Severity**: Medium
- **Affected area**: standalone apps
- **Mitigation**: Preserve and document the opt-in boundary, deliver honest baseline/ceiling files and an exact test template, verify preset filtering.
- **Residual risk**: An app that does not opt in has no static gate; it cannot claim the program's verified coverage.

## Final Compliance Report — 2026-11-16

Reviewed root/spec rules, compatibility §1/§2/§4, shared/CLI rules and create-app's template-copy boundary. Counts and snapshot paths were checked in source. No runtime test was executed in this spec revision.

| Rule | Status | Notes |
|---|---|---|
| Additive contracts | Compliant | Optional metadata on the whole privacy declaration, retained alias and explicit test subpath |
| No pipeline or scaffold-policy change | Compliant | Existing unit suites; current test-copy skip retained and opt-in limit explicit |
| Module isolation | Compliant | Same-module table keys; cross-module metadata resolves through declared seams, no ORM imports |
| Exact ownership including partial rows | Compliant by design | One indexed claim per subset; unknown/shared remainder cannot disappear |
| R5-8 | Compliant by design | Global exclusions require no `tenant_id` or `organization_id` in the canonical snapshot, a non-scope-root table and a reviewed-list entry with a non-empty one-line reason equal to the declaration's rationale, which runtime validation also checks; failures name the table, with positive/negative static fixtures |
| Reachable closure | Compliant by design | Owner-qualified evidence bounds, edition-honest `known_limit` remainders with the served-entity registry check, runtime-table declarations and credential erasure linkage give every table a passable classification; phases map collectors to the carriers that ship them |
| Honest completeness | Compliant by design | Root export alone does not empty baselines; final closure is explicit |
| R4-5 — Attachment pending-deletion rows | Compliant by design | `runtime_state`; successful drain removes the row, older-than-7-days database doctor check, no action-log entries or planned history identities |
| R4-9 — Suppression state in a tenant export | Compliant by design | Both `recipient_hash` and `key_id` redact with a row count; no reviewed-checksum exception or suppression-state handover |
| R4-13 — Operational retention bounds | Compliant by design | Exact table/subset, existing `PrivacyRetentionBoundProjection` and pruner-owned `evaluateFixtureRow`; pruners publish `operational_pruner` `retentionBounds` entries (assumption 7), with no duplicate bound shape |
| Edition | Compliant | OSS with C1 Phase 1 under DEC-2 (assumption 6) |

**Verdict:** ready. C5 is OSS and ships with C1 Phase 1; retention references resolve as record retention and the pruners land. R4-5, R4-9 and R4-13 close the pending-deletion, suppression-export and operational-bound design gaps; pruner metadata uses the `retentionBounds` kind of assumption 7. Runtime coverage and final closure remain dependent on the named carriers.

## Changelog

### 2026-11-16
- Split from the verification-suite spec after its independent review, with that review's corrections: a reason for tables reached through another module's seam, without which the shared stores could never leave the baseline; one per-table entry shared with the exit export instead of two lists; no numeric cap; declarations as members of the default export, the convention chosen for privacy.ts; the helper on a test-only subpath; corrected counts.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g3-12 — export declarations no longer ride on the `tables` entry, which tables covered by a class or still on the baseline do not have; they live in the exit-export spec's separate `tableExports` member. The rule now says an export entry is not coverage, rule 3 also checks `tableExports` keys, and rule 6 checks the credential agreement against that member. Updated assumption 2, the design decisions, alternatives, Delta scenarios, the API comment, edge cases, unit tests, a risk entry and the compliance table. The import rule for `privacy.ts` now also allows modules with no side effects at load, such as shared predicates and `node:fs`, which the doctor's `doctorChecks` member needs.

- Council round two fixes (GPT-6.1 Sol workers): r3e-06 exact ownership and resolved references; r3e-20 whole-object registry; r3e-29 app/template paths and explicit opt-in; r3e-30 baseline ceiling and closure ratchet; r3e-33 canonical census and closure owners; r3e-40 C1 delivery handoff; r3e-41 exact snapshot basename; r3e-42 per-column reasons; r3e-43 file/path and JSON net; r3e-44 owned root inventories; g2-32 partial rows and shared-store remainders; g2-38 test/helper compatibility. Snake-case wording nit corrected.
- Council round two fixes, pass two (GPT-6.1 Sol workers): added account-owned email-change full export/erase coverage and the forms retained-objection reference_only declaration; aligned shared-null-tenant, excluded tenant-less attribution, all-JSON, lookup-hash and typed reviewedChecksums guards with tenant exit; added the named unclassified-table negative fixture and preserved the current-source census/new-table distinction. SUPPRESSION-EXPORT defaults the conflicting digest-export proposal to redaction pending human confirmation. Cross-owner corrections were carried out in the owning specs.
- Council round two fixes, pass three (GPT-6.1 Sol workers): removed the unsupported reference_only columns member, pinned the forms objection column/source review and new-table closure, consumed C8's exact suppression exception under an updated confirmation default, and aligned non-global/shared-null-tenant guards. Added owner-declared operational/set/pending retention bounds with exact column/anchor/window/enforcement projections for G6, fail-closed reference validation and delivery/tests. Remaining consumer changes were applied in the consuming specs.

- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): aligned suppression export to C8/unsubscribe redaction defaults, resolved C4's exact seam objects and real pending-deletion set, and consumed the operational owner's exact bound/status collector alongside actual record-set references. Preserved unsupported remainders and pending/unbounded enforcement limits; no new operational interface was designed.
- Council round two fixes, pass five gap closing (GPT-6.1 Sol workers): R4-5 classifies attachment pending deletions as `runtime_state`, with successful-drain removal, the 7-day database doctor check and no journal history identities; R4-9 redacts suppression `recipient_hash` and `key_id` with a row count and removes SUPPRESSION-EXPORT; R4-13 adds the `operational_pruner`/`prunerId` bound reference and pruner-owned `evaluateFixtureRow` without duplicate operational bounds. Aligned scenarios, tests, risks and compliance rows.
- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): align operational enforcement with the existing C5 projection, counting deadline, schedule/worker fields and pending mode without new members; preserve the owner's registry-publication design gate; R5-8 requires an unscoped canonical snapshot and a reasoned reviewed-list entry for global exclusions, with scenarios, static fixtures, risks and compliance coverage.

### 2026-11-17
- Closure is reachable and honest: `action_logs` partitions on `resource_kind` with owner-qualified bounds to the privacy evidence sets, and its remainder and the file/custom-field remainders become two reviewed `known_limit` ids, the latter gated by a served-entity registry check over `sharedStoreEntities`.
- `credential` requires an erasing same-module class whenever the table links to a subject, and its columns get rule 5 review; runtime-created tables are declared through tenant exit's `runtimeTables`; `directory.tenants` is a pinned scope-root table that can never be global; global exclusions carry their reviewed reason in the declaration for runtime validation.
- Undeclared tables are runtime gaps rather than static reader failures; implementation steps are mapped to phases, with record-set and pruner resolution arriving with their collectors and Enterprise/G6 assertions kept in their owners' suites. Added `sidebar_variants` to the `auth.users` inventory.
- Named the owners of the remaining `audit_logs` bounds: the access-log-retention `audit_logs.access_logs` pruner bound for `access_logs`, and in Enterprise `dataErasureRetentionBounds` for ordinary history with its `backlog_growing` projection; C1's settings evidence is selected by its clear-text related pair.
- The email-change table inventory lists the approval digest, `approved_at` and `cancelled_via`; the planned `form_to_deals` tables are recorded with their own coverage declarations.
- The `erasure_evidence` subset includes C4's `privacy.subject_erasure_progress` kind, which `expireErasureEvidence` deletes with its run group.
