# Pre-Implementation Analysis: EUDR Compliance Module

Spec: `.ai/specs/2026-07-06-eudr-compliance-module.md` · Analyzed: 2026-07-06 · Verified against worktree code (customers reference module, guard tests, generated registries).

## Executive Summary
The spec proposes a purely additive new core module (`eudr`) mirroring the sanctioned `customers` reference architecture. No existing contract surface is renamed, removed, or narrowed — zero BC violations across all 13 categories. The spec is complete per the required-section checklist; four implementation-accuracy corrections surfaced by code verification (command-id style, generated entity-id slugs, a second guard-test registration, decryption path for detail reads) have been folded back into the spec. **Ready to implement.**

## Backward Compatibility

### Violations Found
None. Category-by-category:

| # | Surface | Finding |
|---|---------|---------|
| 1 | Auto-discovery files | New files only, all conventional names (`acl.ts`, `setup.ts`, `events.ts`, `ce.ts`, `encryption.ts`, `data/entities.ts`, `api/*/route.ts`, `backend/**`, `commands/*`). Nothing renamed/removed. |
| 2 | Types & interfaces | New module-local types only; nothing exported from shared surfaces changes. |
| 3 | Function signatures | No existing function touched. |
| 4 | Import paths | No moves. New module imports platform helpers only. |
| 5 | Event IDs | New ids `eudr.{product_mapping,evidence_submission,due_diligence_statement}.{created,updated,deleted}` — verified no collision (repo-wide grep: no `eudr.` events exist). |
| 6 | Widget spot IDs | None added/renamed in v1. |
| 7 | API routes | New `/api/eudr/*` namespace — no existing route collides (no `eudr` module exists). Response shapes are new. |
| 8 | DB schema | Three new tables (`eudr_product_mappings`, `eudr_evidence_submissions`, `eudr_due_diligence_statements`) — additive DDL only, no existing table touched. |
| 9 | DI keys | None registered in v1 (scoring is a pure lib function). |
| 10 | ACL feature IDs | New `eudr.*` ids only. |
| 11 | Notification type IDs | None in v1. |
| 12 | CLI commands | None. |
| 13 | Generated file contracts | Regeneration adds `eudr` entries; no generated export renamed. `apps/mercato/src/modules.ts` gains one entry (hand-edited registry, sanctioned). |

### Missing BC Section
Spec includes "Migration & Compatibility" — adequate (additive-only, rollback = disable module entry).

## Spec Completeness
All required sections present (TLDR, Overview, Problem, Solution, Architecture, Data Models, API Contracts, i18n, UI/UX, Migration & Compatibility, Implementation Plan + Phasing, Integration Test Coverage, Risks with register, Final Compliance Report, Changelog). No missing sections.

### Incomplete/Corrected Items (verified against code, fixed in spec 2026-07-06)
| Item | Gap found | Correction |
|------|-----------|------------|
| Command ids | Spec drafted singular (`eudr.product_mapping.create`); repo convention (customers) is plural-resource command ids (`customers.people.create`) with singular EVENT ids | Commands now `eudr.product_mappings.*`, `eudr.evidence_submissions.*`, `eudr.statements.*`; events stay singular |
| Entity-id slugs | Generator derives slug from snake_cased ORM class name → `E.eudr.eudr_product_mapping` (`'eudr:eudr_product_mapping'`), not `E.eudr.product_mapping` | Spec + encryption `entityId`s use exact generated slugs |
| Guard tests | Spec listed only `optimistic-lock-editable-entities.test.ts`; `record-locks-coverage.test.ts` `RECORD_LOCKS_DECISIONS` is in lockstep and also mandatory; `acl.ts`/`encryption.ts` need named **and** default exports | Registration checklist expanded |
| Encrypted detail reads | Spec didn't state how encrypted fields (producer_name, notes) reach detail/edit responses | afterList hook merges `findOneWithDecryption` values for `?id=` requests; export route reads via `findOneWithDecryption`; grid projections exclude encrypted columns |

## AGENTS.md Compliance
Verified against `packages/core/AGENTS.md`, customers module AGENTS.md, root AGENTS.md, `packages/ui` rules:

| Rule | Status |
|------|--------|
| `makeCrudRoute` + `indexer.entityType` + per-method `metadata` + `openApi` on every route (incl. custom export GET) | Planned, mirrors `customers/api/people/route.ts` |
| Writes via undoable commands (`registerCommand`, snapshots, `emitCrudSideEffects`/`emitCrudUndoSideEffects`) | Planned, mirrors `customers/commands/people.ts` |
| Custom GET route pattern (`context.params` Promise, metadata, openApi) | Mirrors `attachments/api/file/[id]/route.ts` |
| Encryption maps + `findWithDecryption` | `eudr:eudr_evidence_submission` → `producer_name`, `notes` |
| Optimistic locking (updated_at + CrudForm auto-header + guard maps) | All 3 entities; both guard tests registered |
| zod validators in `data/validators.ts`, types via `z.infer` | Planned |
| Tenant/org scoping via factory + `withScopedPayload` (`packages/shared/src/lib/api/scoped.ts`) | Planned |
| Backend pages: metadata-driven sidebar (`pageGroup`/`pageGroupKey`), CrudForm/DataTable, `useGuardedMutation` for row deletes with lock header | Mirrors customers people pages; UI-coverage allowlist stays empty |
| i18n 4 locales, flat dotted keys, no hardcoded strings | Planned (`eudr.*` namespace) |
| DS: StatusBadge primitive (`@open-mercato/ui/primitives/status-badge`), semantic tokens, no arbitrary values | Planned |
| Events `module.entity.action` singular past-tense with `as const` | Planned |

No violations.

## Risk Assessment

### High
None (module-local, additive).

### Medium
| Risk | Impact | Mitigation |
|------|--------|-----------|
| `yarn db:generate` may emit unrelated-module churn or need iteration for a brand-new module | Migration noise / wrong snapshot | Repo rule: keep only eudr SQL + snapshot; re-run as no-op check |
| Partial unique (mapping product+commodity) via raw `@Index` expression | Typo breaks migration | Copy exact expression style from `customers/data/entities.ts` (`where deleted_at is null`) with `create unique index` |
| Encrypted fields in list/detail path | Ciphertext leaking into UI or plaintext in grid | Exclude from grid projection; decrypt-merge only on `?id=` detail reads; integration test asserts round-trip |

### Low
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Sidebar group ordering collides visually | Cosmetic | Distinct `pageGroup` 'Compliance' + explicit `pageOrder` |
| GeoJSON payload size | Row bloat | zod 1 MB cap; jsonb |

## Gap Analysis
- **Critical (block)**: none.
- **Important**: the four corrected items above (already folded into spec).
- **Nice-to-have**: `search.ts`, notifications, dashboards widget, CSV/PDF export — explicitly roadmapped, not v1.

## Remediation Plan
- **Before implementation**: spec corrections (done, changelog updated).
- **During implementation**: register module in `modules.ts` **before** running `yarn generate` (generation silently skips unregistered modules); ensure `acl.ts`/`encryption.ts` default exports; run both guard tests as packet acceptance.
- **Post-implementation**: `yarn mercato auth sync-role-acls` note in PR body; move spec to `implemented/` after deploy evidence.

## Recommendation
**Ready to implement.**
