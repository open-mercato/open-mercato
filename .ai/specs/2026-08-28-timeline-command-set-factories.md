# Timeline Command-Set Factories (comments / activities / addresses / notes)

## TLDR

The undoable command sets for the timeline sub-resources — `comment`, `activity`, `address`, `note` — are copy-pasted across `customers`, `staff`, `resources` and `sales`: **8 files, 4,089 lines**, each re-implementing the same create/update/delete skeleton (snapshot loader, scope checks, persist + `emitCrudSideEffects`, `buildLog`, undo/redo restore-from-snapshot) and differing only in entity class, parent resolution, indexer/events config and audit labels. This spec is the **follow-up spec that SPEC-051 explicitly deferred and required** before any extraction, and it delivers the three artefacts SPEC-051 named: a per-module behavior-parity matrix, targeted integration coverage, and a migration order. It proposes `makeCommentCommandSet` / `makeActivityCommandSet` / `makeAddressCommandSet` (plus reuse of the comment/note skeleton for `sales` notes), migrated one family at a time, with command IDs, audit labels, snapshot field names and event/index configuration held byte-identical so persisted undo payloads and the query index stay compatible.

This spec covers **the deferred extraction only**. It does not propose a generic CRUD-command factory.

## Status

Proposed — 2026-08-28 · Scope: OSS
Modules: `packages/core/src/modules/{customers,staff,resources,sales}/commands/`
Issue: [#3624](https://github.com/open-mercato/open-mercato/issues/3624) — DRY: extract shared command-set factories for comments/activities/addresses/notes
Supersedes: [#3611](https://github.com/open-mercato/open-mercato/issues/3611) (closed `not_planned` 2026-06-25, refiled as #3624 seven minutes later by the same author)
Originates in: [`SPEC-051`](SPEC-051-2026-03-02-sonarqube-code-deduplication.md) → *Deferred (Follow-up Spec)*

## Problem Statement

SPEC-051 deduplicated the safe clusters and explicitly deferred the command-set factories:

> **Deferred (Follow-up Spec)** — Out of scope for this spec: `makeAddressCommandSet`, `makeActivityCommandSet`, `makeCommentCommandSet`. A dedicated follow-up spec is required with: explicit behavior-parity matrix per module (customers/staff/resources) · targeted integration coverage for deal-linking/dictionary side effects · migration plan for command-level extraction order.

That follow-up spec was never written. The duplication has since become the largest remaining production clone cluster, and — the point that matters — **it is actively producing divergence**:

| Divergence | Where | Status |
| --- | --- | --- |
| `buildLog` re-loads the snapshot instead of reading `snapshots.after`/`before` | `resources/commands/comments.ts` | Live; costs an extra query per logged write |
| Delete-undo omits `address.companyName = before.companyName` while update-undo sets it (`:237`) | `customers/commands/addresses.ts` | Live; **user-visible data loss** — restoring a deleted address drops the company name |
| Hardened author resolution (`resolveResourceAuthorUserId`, verifies a super-admin-supplied author against a real `User`) added by security fix #4012 | `resources/commands/shared.ts` only | Live; `customers`/`staff` comments call `normalizeAuthorUserId` directly and did not receive the same hardening |

The first two are named in #3624. The third landed **after** the issue was filed (PR #4012, 2026-07-09) and is the clearest evidence of the cost: a security fix was applied to one copy of a duplicated handler and not the others. Whether `customers`/`staff` need the same hardening is an Open Question below — it is exactly the class of question a parity matrix exists to surface.

### Current inventory

| Family | Files | Lines | Parent resolution (the real per-module variation) |
| --- | --- | --- | --- |
| comments | `customers`, `staff`, `resources` | 429 / 437 / 385 | `requireTimelineParentEntity` + `requireDealInScope` · `requireTeamMember` · `requireResource` |
| activities | `staff`, `resources` | 588 / 537 | `requireTeamMember` · `requireResource` |
| addresses | `customers`, `staff` | 596 / 603 | `requireCustomerEntity` + `resolveParentResourceKind` · `requireTeamMember` |
| notes | `sales` | 514 | `requireContext` |
| **Total** | **8 files** | **4,089** | |

### Structural parity (verified against `421cefe66`)

The skeleton genuinely is the same shape in all 8 files, which is what makes a factory viable: each has `redo` on **create only**, two `prepare` hooks (update + delete), and a **hard** `em.remove` delete — no soft-delete anywhere. The differences are confined to injectable points:

| File | `makeCreateRedo` | Author resolution |
| --- | --- | --- |
| `customers/comments` | ✓ | `normalizeAuthorUserId` |
| `staff/comments` | ✓ | `normalizeAuthorUserId` |
| `resources/comments` | ✓ | `resolveResourceAuthorUserId` |
| `staff/activities` | hand-rolled | `normalizeAuthorUserId` |
| `resources/activities` | hand-rolled | `resolveResourceAuthorUserId` |
| `customers/addresses` | hand-rolled | — (no author) |
| `staff/addresses` | hand-rolled | — (no author) |
| `sales/notes` | ✓ | `resolveAuthor` (local UUID-regex variant) |

Two consequences. First, **`makeCreateRedo` adoption is partial** — comments and notes use it, activities and addresses hand-roll the equivalent. Standardizing on it is behavior-neutral but is a real change to those four files and must be pinned by Phase 0 tests, not assumed. Second, **three author-resolution implementations coexist** (`normalizeAuthorUserId`, the #4012-hardened `resolveResourceAuthorUserId`, and `sales`' local `resolveAuthor`), and they diverge *within* the same family: `staff/activities` and `resources/activities` differ from each other. Unifying them silently would be a security-behavior change, hence Open Question 3.

The repeated machinery inside each: `load*Snapshot`, the `{ before?, after? }` undo-payload type, an `em.findOne(...)` + `em.create(...)`/mutate "upsert-from-snapshot" block duplicated verbatim in both `undo` and `delete.undo`, and the `emitCrudSideEffects` / `emitCrudUndoSideEffects` call sites with an identical `identifiers` shape — 5 per comment/note file and 6 per activity/address file as of `421cefe66` (#3624 says "four"; the count has grown since it was filed).

### Explicitly out of scope (per #3624)

`customers/commands/activities.ts` and `customers/commands/todos.ts` are **not** part of this work. They are thin `@deprecated` SPEC-046b compatibility bridges delegating to the canonical `customers.interactions.*` handlers — a deliberately different and intentionally separate shape.

## Proposed Solution

Extract one factory per family returning the `{ create, update, delete }` handler trio, with all per-module behavior passed in as injected config so behavior is preserved exactly:

- `entityClass`, `indexer`, `events`, `auditLabels`, `resourceKind`
- `resolveParent(em, contextRef, scope)` — the largest variation. It must return **scope plus any relation entities the child persists**, not just a parent: `sales` notes store denormalized `order` / `quote` FKs alongside `contextType`/`contextId`, so `requireContext` returns `{ organizationId, tenantId, order, quote }`.
- `resolveParentResourceKind(snapshot)` — must be a **function, not a constant**. `staff` and `resources` use fixed kinds (`'staff.teamMember'`, `'resources.resource'`); `customers` addresses derives it via `resolveParentResourceKind(entityKind)`; `sales` notes computes `sales.${contextType}` per row.
- `resolveAuthorUserId(...)` — an injected hook, because **three different implementations exist today** (see the parity table below). Addresses have no author concept, so the hook is optional.
- `mapSnapshot(entity)` / `seedFromSnapshot(snapshot)` — and note the **persisted snapshot envelope is not uniform**: comments, addresses and notes store a flat record, while activities nest theirs under `activity` with an optional `custom` sibling for custom-field values. Both shapes already exist in `action_logs`, so the factory must reproduce each family's own envelope rather than normalizing to one. (Discovered by the Phase 0 parity tests; see below.)
- optional post-steps (`enforcePrimaryAddress` for addresses) and an optional `beforeRestore` hook for undo/redo, which `sales` notes needs to re-resolve the polymorphic context and conditionally reattach `order`/`quote`.

Each module's command file then collapses to a config object plus three `registerCommand(...)` calls.

**Reuse rather than re-inline** the existing primitives named in #3624: `makeCreateRedo` / `resolveRedoSnapshot` (`@open-mercato/shared/lib/commands/redo`) and `withAtomicFlush` (`@open-mercato/shared/lib/commands/flush`). This follows the proven SPEC-051 Phase-2 pattern (`makeStatusDictionaryRoute`, `makeSalesLineRoute`).

### Placement

#3624 offers two options: a per-module `commands/shared.ts`, or a new `@open-mercato/shared/lib/commands/timeline` helper. **This spec proposes `@open-mercato/shared/lib/commands/timeline`**, because the factories are consumed by four different modules and a per-module `commands/shared.ts` would reintroduce the duplication one level up. Placing it in `shared` makes it a contract surface (additive; see Backward Compatibility). This is flagged as an Open Question — if maintainers prefer to keep it module-local until the shape settles, `customers/commands/shared.ts` with later promotion is a viable phase-0.

### Interaction with the command-bus interceptor seam

The interceptor seam introduced since the issue was filed (`command-interceptor-runner.ts`, `CommandInterceptor`; PRs #4958, #5067, #5277) operates at **dispatch** time inside `CommandBus`. These factories change only how handlers are **constructed**. Handlers produced by the factories continue to flow through `CommandBus.execute`, so interceptors, `buildLog`, `captureAfter`, audit entries and the system-actor identity fix (#5277) apply unchanged. No interceptor work is in scope; the requirement is simply that the factory must not bypass `CommandBus` or hand-roll audit metadata.

## Phasing

Migration is **one family at a time**, per #3624, ordered by tightness of match and blast radius:

| Phase | Scope | Rationale |
| --- | --- | --- |
| **0** | Parity matrix + parity tests for the current behavior of all 8 files. No production change. | SPEC-051's stated precondition: parity evidence *before* extraction. |
| **1** | `makeCommentCommandSet` → `customers`, `staff`, `resources` | Tightest match; 3 call sites; smallest files. |
| **2** | `makeActivityCommandSet` → `staff`, `resources` | Largest near-duplicates (588/537), only 2 call sites. |
| **3** | `makeAddressCommandSet` → `customers`, `staff` | Adds the `enforcePrimaryAddress` post-step. |
| **4** | `sales` notes onto the comment/note skeleton | Least-aligned; see below. Do last. |

**Phase 4 evidence** (`sales/commands/notes.ts` read in full at `421cefe66`). The skeleton matches — same `redo`-on-create-only, same two `prepare` hooks, same hard delete, and it already uses `makeCreateRedo`. Its intra-file duplication is also the clearest single argument for the factory: the ~30-line upsert-from-snapshot block is repeated **verbatim** in `update.undo` and `delete.undo`, inconsistent indentation included. Four sales-specific behaviors the factory must absorb through the config surface above rather than special-case:

1. **Polymorphic parent** — `requireContext` resolves across four document kinds (`order`, `quote`, `invoice`, `creditMemo`) and returns relation entities, not just scope.
2. **Denormalized relation FKs** — the snapshot carries `orderId`/`quoteId` beside `contextType`/`contextId`, and every restore path reattaches them conditionally (`before.orderId ? context.order : null`). This is the `beforeRestore` hook.
3. **Dynamic `parentResourceKind`** — `sales.${contextType}`, computed per row.
4. **Author is derived, never accepted** — per #3998, `update` gates on `parsed.authorUserId !== undefined` but then ignores the supplied value and re-derives from `ctx.auth`, nulling API-key callers. Deliberate anti-spoofing; the parity matrix must pin this exact quirk so the factory does not "clean it up" into accepting the input.

Conclusion: the abstraction fits without special-casing **provided** the config surface carries a relation-aware `resolveParent`, a `resolveParentResourceKind` function, an injected author hook, and `beforeRestore`. If maintainers prefer a narrower factory, dropping `sales` notes from scope costs one of eight files and leaves the other three families intact — Phase 4 is deliberately last so that remains an option.

Each phase is an independently reviewable and independently revertable PR. Phase 0 ships first and alone.

### Drift resolution

The three divergences above are folded into the shared path as each family migrates, **except** the `customers/addresses` `companyName` delete-undo omission. That is a user-visible data-loss bug, not a refactor artefact, and should ship as its own small `fix(customers):` PR *before* Phase 3 so the fix is reviewable on its own merits and independently backportable. The `resources` `buildLog` re-load is a pure refactor artefact and is resolved by Phase 1.

## Implementation Plan

**Phase 0 — parity evidence** *(implemented; see `packages/core/src/modules/__tests__/timeline-command-set-parity.test.ts`)*
1. Build the behavior-parity matrix across all 8 files: command IDs, audit labels, snapshot field names, `identifiers` shape, event IDs, indexer config, scope checks, undo/redo payload shape, author resolution.
2. Add characterization tests pinning current behavior per module, so any Phase 1-4 divergence fails loudly. Delivered as one data-driven cross-module suite (41 assertions) following the existing `command-redo-coverage.test.ts` precedent: it pins the exact 24 command IDs, the `redo`-on-create-only / `undo`-on-all-three / `buildLog`-everywhere handler shape, each family's delete audit label and `resourceKind`, and the `payload.undo.before` + `snapshotBefore` persisted shape.
   - **Finding:** writing these tests surfaced a divergence the inventory above had missed — the activities families nest their snapshot under `activity` (with an optional `custom` sibling for custom fields) while every other family is flat. Four assertions failed until the fixture modelled both envelopes. This is precisely the class of silent breakage Phase 0 exists to catch, and it constrains `mapSnapshot`/`seedFromSnapshot` as noted above.
3. Add targeted integration coverage for the side effects SPEC-051 called out — deal-linking (`customers`), parent-resource resolution (`staff`/`resources`), dictionary sync — following the existing `TC-*` conventions.

**Phases 1-4 — per family**
4. Introduce the factory with the config surface above.
5. Migrate one module, diff the emitted command registration against the pre-migration snapshot, confirm byte-identical command IDs / labels / snapshot field names.
6. Migrate the remaining modules in the family; delete the superseded per-module code.
7. Run the validation gate (`yarn typecheck`, `yarn lint`, `yarn test`) plus the family's integration specs.

## Backward Compatibility

**This is a pure internal refactor. Command IDs, ACL features, API routes and event IDs are unchanged.**

The binding constraint is *persisted* data, not just runtime behavior: undo replays `logEntry` snapshots that already exist in customer databases. The factory must therefore reproduce **snapshot field names, command IDs, audit labels and event/index configuration byte-identically**. A renamed snapshot field would silently break undo for every already-recorded action.

Per `BACKWARD_COMPATIBILITY.md`: adding `@open-mercato/shared/lib/commands/timeline` is **additive** (new exports, category 3/4). No existing export changes signature. Module developers who copied the current handler shape are unaffected — the old shape keeps working; nothing is removed.

`risk-high` is retained: these handlers own tenant/organization scoping, CRUD event and index side effects, and optimistic-lock guards. That is precisely why SPEC-051 deferred them, and why Phase 0 ships before any extraction.

## Open Questions

1. **Placement** — `@open-mercato/shared/lib/commands/timeline` (proposed, avoids re-duplicating across four modules) or module-local `commands/shared.ts` first, promoted later?
2. **Scope split** — the four families are independently deployable (each phase functions without the others). Should this remain one spec with four phased PRs, or be split into per-family specs? Per `om-spec-writing`, raising this is mandatory; the recommendation is one spec, four PRs.
3. **Author-resolution parity** — there are **three** implementations today: `normalizeAuthorUserId` (customers/staff), the #4012-hardened `resolveResourceAuthorUserId` (resources), and `sales`' local `resolveAuthor`. They diverge inside a single family — `staff/activities` and `resources/activities` do not match. Should the factory converge them (and if so, on the hardened variant?), or preserve all three behind the injected hook? Preserving is the behavior-safe default and is what this spec assumes; converging is a security-relevant change that should be its own decision, and arguably its own issue.
4. **SPEC-051 housekeeping** — #3611 noted SPEC-051 is fully implemented but still sits in `.ai/specs/` root with a stale File Manifest. Fold the `git mv` to `implemented/` into Phase 0, or keep it separate?

## Changelog

- **2026-08-28** — Initial spec proposed. Delivers the follow-up spec deferred by SPEC-051; no implementation yet.
