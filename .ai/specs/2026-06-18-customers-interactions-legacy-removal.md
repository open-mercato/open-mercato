# Customers interactions — legacy removal (SPEC-046b completion)

> Status: DRAFT (open questions resolved — see Decisions; ready for pre-implement)
> Scope: OSS · Module: `customers` (`packages/core`)
> Date: 2026-06-18
> Predecessor: [`.ai/specs/implemented/SPEC-046b-2026-02-27-customers-interactions-unification.md`](implemented/SPEC-046b-2026-02-27-customers-interactions-unification.md)
> Related: [`2026-06-18-configurable-crm-interaction-statuses.md`](2026-06-18-configurable-crm-interaction-statuses.md)

## TLDR

SPEC-046b unified customer activities and todos into one canonical `customer_interactions` model,
but deliberately stopped short of removing the legacy path: it kept the `customer_activities` and
`customer_todo_links` tables, the `/api/customers/activities` and `/api/customers/todos` adapter
bridges, and three `customers.interactions.*` feature flags whose default leaves tenants on the
**legacy** read path (`unified=false`). The promised "dedicated legacy-removal spec for a later
release" (SPEC-046b:358) was never written. This spec is that follow-up.

The goal is to make **canonical the only path** and retire legacy, the OM-idiomatic way:
deprecate → bridge → **backfill-driven upgrade action** → flip default → remove. Investigation
(2026-06-18) confirmed the writes are *already* canonical-only and single-write — the legacy path
survives only in **reads, the deprecated bridges, two AI tools, and the soft-delete restore/seed
paths**. So this is a bounded cleanup, not a rewrite. But four preconditions must close first, or a
naive flip silently loses data.

## The four preconditions (why "just flip the default" is unsafe)

These are the load-bearing findings from the 2026-06-18 readiness investigation. Each is a hard gate.

1. **The backfill is incomplete and lossy.** `mercato customers interactions:backfill`
   (`cli.ts:3003-3237`) always writes `scheduled_at = null` (`cli.ts:3060` activities, `:3169` todo
   links). The next-interaction
   projection only considers rows where `scheduled_at IS NOT NULL` (`lib/interactionProjection.ts:40`),
   so **every migrated planned item silently disappears from "next step"**. It also drops `priority`,
   `owner_user_id`, `duration_minutes`, `location`, `all_day`, recurrence, `participants`,
   `reminder_minutes`, `visibility`, `linked_entities`, `guest_permissions`, `pinned`,
   `external_message_id`, `channel_provider_key`, and custom-field values; the todo path additionally
   drops `body`, author, `deal_id`, appearance, and `occurred_at`. It carries no cancel state. It is
   manual-only (`--tenant --org`, no all-tenant mode), un-validated, and **not** an upgrade action.
2. **Two AI tools read legacy tables with no canonical fallback.** `customers.list_activities`
   (`ai-tools/activities-tasks-pack.ts:184-213`) reads only `CustomerActivity`; `customers.deal_analyzer`
   (`ai-tools/deal-analyzer-pack.ts:159-189`) computes stalled-deal detection from `CustomerActivity`
   only. Under canonical-only they return empty/stale data with no flag guard. `customers.list_tasks`
   (`activities-tasks-pack.ts:282-301`) merges canonical + legacy `customer_todo_links`
   unconditionally — less severe (canonical tasks still return) but must drop the legacy half.
3. **The adapter bridges are public API without an honored deprecation.** `/api/customers/todos`
   and `/api/customers/activities` are documented in `apps/docs/docs/api/customers.mdx` with **no**
   `deprecated: true` on their `openApi` export and **no** docs sunset notice. They carry a
   `Sunset: 2026-06-30` HTTP header (`api/todos/route.ts:76`) but `BACKWARD_COMPATIBILITY.md` (§7)
   requires `deprecated: true` **and** ≥1 minor release of lead time before a route may be removed.
   They are also the **default** task read/write path: the customers UI hook `usePersonTasks` calls
   the bridge, and `TasksSection` defaults `useCanonicalInteractions = false`.
4. **Legacy rows are still constructed off the product write path.** Person/company soft-delete
   **undo** restores snapshotted `CustomerActivity` / `CustomerTodoLink` rows
   (`commands/people.ts:1531-1610`, `commands/companies.ts:1295-1359`); the demo `seed-examples` CLI
   seeds `CustomerActivity` rows (`cli.ts:1610,1743,2833`). Both must move to canonical before the
   tables can be dropped.

## Decisions

All open questions resolved 2026-06-18 — Q2–Q5 from maintainer input, Q1 against OM precedent (how the
project, especially pkarw, sequenced prior destructive removals).

- **Q1 — Drop the legacy tables, or freeze read-only? → FREEZE-THEN-DROP over two releases.** Resolved
  against OM precedent. OM *does* one-shot table drops (pkarw dropped `catalog_product_attribute_schemas`
  a day after creating it; sales/scheduler likewise) — but only for **unshipped or internal schema in
  active development that the author owns**. `customer_activities`/`customer_todo_links` are the
  opposite: shipped since 046a/b, carrying live data at unknown worldwide tenants, behind public
  bridges. That is exactly the FROZEN/STABLE public-contract case pkarw's own protocol
  (`BACKWARD_COMPATIBILITY.md`, which he authored) governs: deprecate → bridge ≥1 minor → document the
  horizon → remove. A named precedent confirms it — `2026-04-11-eliminate-global-roles.md` one-shot
  dropped *only because its data was dead, explicitly contrasted with `customer_activities`* — and the
  closest in-module analog (`Migration20260218191730`, the deals `pipeline_stage` reshape) keeps the
  legacy column ("stop writing, keep column") rather than dropping it inline. So: freeze read-only in
  release *N*, drop in *N+1* after a validated backfill (matches Q4).
- **Q2 — External consumers of the bridges? → TREAT AS PUBLIC.** We cannot confirm the
  `/api/customers/{activities,todos}` bridges are internal-only, and OM is self-hosted by an unknown
  number of companies worldwide (Q5). The full `BACKWARD_COMPATIBILITY.md` deprecation window is
  therefore **mandatory, not compressible**. SPEC-046b:512 ("unknown third-party clients") stands.
- **Q3 — Remove endpoints or keep shims? → KEEP CANONICAL-BACKED SHIMS for one release.** Drop only
  the legacy-table read branches + the `legacyAdapters` guard now; delete the endpoints in a later
  release.
- **Q4 — Releases for flip vs drop? → TWO RELEASES.** Default-flip + read-only freeze in release *N*;
  table drop + endpoint removal in *N+1*. *N* pinned at implementation.
- **Q5 — Backfill run in prod? → ASSUME NOT.** OM runs at an unknown number of companies worldwide; no
  tenant can be assumed to have run the CLI backfill or to have `unified` on. Consequences: (a) the
  corrected backfill MUST be an **automatic, idempotent, safe-at-scale upgrade action** that runs on
  upgrade with no manual per-tenant invocation (Phase 1); (b) the default-flip (Phase 4) is **guarded
  per tenant** — a tenant reads canonical only after its backfill has completed and validated; (c) no
  step may assume prior migration state.

## Problem statement

The customers module carries two interaction data models in parallel. The legacy model
(`customer_activities` + `customer_todo_links` + the `/activities` and `/todos` bridges) is the
**default** for any tenant where `customers.interactions.unified` is still off. This split is the
direct cause of a concrete product defect surfaced by the configurable-statuses work: rich task
statuses (`in_progress`, `waiting`, custom) persist to canonical storage but cannot be **read back**
through the legacy bridge, which collapses them to a binary done/not-done todo. The feature is inert
for default tenants. More broadly, the dual model means every read path, the detail pages, the
dashboard widget, and two AI tools maintain forked legacy/canonical logic that SPEC-046b intended to
be temporary "during the deprecation window" (SPEC-046b:21,519).

## Proposed solution

Close the four preconditions, then collapse the flag. Order matters — each phase leaves the app
shippable and is independently revertible.

1. **Make the backfill complete, validated, and automatic** — a backfill-driven **upgrade action**
   (`configs/lib/upgrade-actions.ts`) that maps every canonical column (especially `scheduled_at`),
   carries cancel state and custom fields, tags rows `migration:*` per SPEC-046b:350, and runs
   idempotently per tenant via the existing `executeUpgradeAction` lifecycle.
2. **Migrate the legacy-only AI tools** (`list_activities`, `deal_analyzer`, `list_tasks`) to read
   `CustomerInteraction`, removing the last unguarded legacy reads.
3. **Honor the bridge deprecation protocol** — `deprecated: true` on the `openApi` exports, a docs
   sunset notice, and `UPGRADE_NOTES.md` + `CHANGELOG.md` entries with an explicit **version** horizon.
   (These are pkarw's actual deprecation artifacts; the BC protocol text names "RELEASE_NOTES.md", but
   that file does not exist — the repo uses `UPGRADE_NOTES.md` + `CHANGELOG.md`.)
4. **Flip the default to canonical and move the UI off the bridge** — once the upgrade action has run,
   default `unified=on`, switch `usePersonTasks`/`TasksSection` to canonical unconditionally, and stop
   emitting/branching on the `interactionMode` wire field.
5. **Remove legacy** — delete the legacy read branches, the `legacyAdapters` guard, and (per Q1/Q3)
   the bridge endpoints and the `customer_activities`/`customer_todo_links` tables; redirect the
   soft-delete undo restore and `seed-examples` paths to canonical.

## Architecture

- **Module isolation.** All work is inside `customers` (`packages/core`). No cross-module ORM
  relation is added or removed. The "legacy todos" *source* table belongs to the `example` module
  (`example:todo`); this spec does not touch it — only the `customer_todo_links` bridge rows that
  reference it.
- **Write path is already canonical.** `customers.interactions.{create,update,delete,complete,cancel}`
  (`commands/interactions.ts`) write only `customer_interactions` and contain **zero** flag branches.
  No write-path change is required beyond removing now-dead bridge helpers. This is why the removal is
  bounded.
- **The flag is read/render-side.** `customers.interactions.unified` resolves through one helper
  (`lib/interactionFeatureFlags.ts:69`) and is translated into an `interactionMode` discriminator on
  the people/companies detail GET (`api/people/[id]/route.ts:453`, `api/companies/[id]/route.ts:378`),
  which the v2 pages turn into a `useCanonicalInteractions` prop. Collapsing the flag is therefore a
  read-path and UI simplification, not a command rewrite.
- **Upgrade-action seam.** The completed backfill plugs into the same `executeUpgradeAction`
  runner that already hosts `customers.seed-interaction-statuses` (the configurable-statuses sibling),
  inheriting per-tenant idempotency (`UpgradeActionRun`), the `UPGRADE_ACTIONS_ENABLED` gate, and
  transactional execution. The action's `run({ container, em, tenantId, organizationId })` signature
  already matches `backfillInteractions`' inputs (`cli.ts:3003-3007`), so conversion is wiring + i18n.

## Data model

No new entity. Reused / removed tables (`data/entities.ts`):

- `customer_interactions` (`entities.ts:560`) — the canonical target. Unchanged; the completed
  backfill must populate `scheduled_at`, `priority`, `owner_user_id`, completion/cancel state, and the
  richer columns that the current backfill leaves null.
- `customer_activities` (`entities.ts:486-530`) — legacy. **Removed** in the table-drop phase (Q1).
- `customer_todo_links` (`entities.ts:990-1016`) — legacy bridge rows pointing at `example:todo`
  sources. **Removed** in the table-drop phase (Q1).

The table drop is a **destructive DB migration** (the first in this workstream — SPEC-046b was
additive-only by policy). It requires `yarn db:generate`, a reviewed SQL migration, and a snapshot
update, and it is gated on Q1/Q4/Q5.

## Encryption & data handling

`customer_interactions` holds PII free-text (`title`, `body`, logged email content, `participants`
with names/emails) and the module declares `encryption.ts` `defaultEncryptionMaps`. The **current**
backfill copies rows via raw Kysely (`db.insertInto('customer_interactions')`), which bypasses the
encryption maps and `findWithDecryption`. **Phase 1 must resolve this before any cutover:** either
route the completed backfill through the canonical create command / `em` path so the maps apply on
write, or verify that the source and target columns store the same (encrypted) form and the raw copy
preserves ciphertext without storing plaintext into an encrypted column. A silent plaintext write of
`title`/`body` during migration would be a GDPR regression. No new sensitive column is introduced; the
decision (command-path vs verified ciphertext-preserving copy) is documented in Phase 1.

## API contracts

- **`POST/PUT/DELETE/GET /api/customers/activities`** and **`/api/customers/todos`** — currently
  canonical-backed for writes, legacy-merged for reads when `unified=false`. Phase 3 adds
  `deprecated: true` to their `openApi` exports and a docs sunset notice (closes precondition 3).
  Phase 4 makes their reads canonical-only. Phase 5 either removes them or keeps thin canonical-backed
  shims (Q3). Removal follows the `BACKWARD_COMPATIBILITY.md` §7 protocol and is recorded in
  `RELEASE_NOTES.md`.
- **`GET /api/customers/people/{id}` / `…/companies/{id}`** — drop the `interactionMode` field from
  the response once the client no longer branches on it (Q-pin: keep it pinned to `'canonical'` for
  one release for wire stability, then remove — a contract-surface change under
  `BACKWARD_COMPATIBILITY.md`).
- **`GET /api/customers/dashboard/widgets/customer-todos`** — drop the `!unified` legacy-merge branch
  (`route.ts:63-83`); serve canonical only.
- No new route files.

## Phasing

Each phase is independently shippable and revertible. Phases 1–3 close preconditions with **no
behavior change for existing tenants**; the cutover risk is concentrated in Phases 4–5.

**Phase 1 — Complete + automate the backfill.** Fix the field mapping (especially `scheduled_at`),
carry cancel state and custom fields, tag rows `migration:*`, and wrap it as an idempotent
backfill-driven upgrade action. Validate row counts and projection emission per tenant. No flag flip.

**Phase 2 — Migrate legacy-only AI tools.** Point `customers.list_activities`,
`customers.deal_analyzer`, and the legacy half of `customers.list_tasks` at `CustomerInteraction`.
No flag flip; removes the last unguarded legacy reads.

**Phase 3 — Honor the bridge deprecation.** `deprecated: true` on the bridge `openApi` exports, docs
sunset notice, create `RELEASE_NOTES.md` with the published adapter-sunset timeline. Starts the ≥1
minor release deprecation clock.

**Phase 4 — Flip default + move UI to canonical.** Default `customers.interactions.unified = true`
(predicated on the Phase 1 upgrade action having run), switch `usePersonTasks`/`TasksSection` and the
other `useCanonicalInteractions` consumers to canonical unconditionally, make the bridge reads
canonical-only, and stop branching on `interactionMode`. Freeze the legacy tables read-only (Q1).

**Phase 5 — Remove legacy.** Delete the legacy read branches, the `legacyAdapters` guard, and the
now-dead bridge helpers; redirect soft-delete undo restore + `seed-examples` to canonical; remove the
`interactionMode` wire field; per Q1/Q3/Q4 drop the tables (destructive migration) and/or remove the
bridge endpoints. Remove the `customers.interactions.*` flags and their seeds.

## Implementation plan

> Format: step → verify. Steps reference the precondition (P1–P4) they close.

### Phase 1 — Backfill (P1)
1. Audit the canonical-vs-legacy column map; fix `backfillInteractions` so `scheduled_at`, `priority`,
   completion/cancel state, author, `deal_id`, appearance, and custom-field values are carried; resolve
   the true due-date source for legacy todos (the linked `example:todo` entity, not the link row) →
   unit test: a migrated planned activity with a schedule produces a next-interaction projection.
2. Reconcile the row `source` tag to `migration:activity` / `migration:todo_link` (SPEC-046b:350) so
   migrated rows are auditable and distinct from live adapter writes → assert the tag in the unit test.
3. Wrap the corrected backfill as an idempotent `customers.backfill-interactions` upgrade action in
   `configs/lib/upgrade-actions.ts`, reusing `executeUpgradeAction` → run twice; second run is a no-op
   (`UpgradeActionRun` idempotency); integration test on a seeded legacy fixture.
4. Add a validation/report step (counts in vs out, projection-emitted count) → integration assertion.
5. Decide the encryption-safe write path (per **Encryption & data handling**) and the execution model:
   the action runs synchronously under `executeUpgradeAction`, so batch via the existing
   `BACKFILL_BATCH_SIZE`/`PROJECTION_BATCH_SIZE` chunking and defer large tenants to a
   `@open-mercato/queue` worker above a row threshold rather than blocking the request. Add i18n keys
   for the action label/description and the validation report → typecheck; `yarn i18n:check`.

### Phase 2 — AI tools (P2)
5. Rewrite `customers.list_activities` to read `CustomerInteraction` (filter `interactionType`) →
   AI-tool unit test returns canonical rows.
6. Rewrite `customers.deal_analyzer` last-activity/stalled computation against `CustomerInteraction` →
   unit test: deal health reflects canonical activity.
7. Drop the legacy `customer_todo_links` half of `customers.list_tasks` → unit test: tasks come from
   canonical only.

### Phase 3 — Deprecation protocol (P3)
8. Add `deprecated: true` to the `openApi` exports of `/api/customers/{activities,todos}` and a sunset
   note in `apps/docs/docs/api/customers.mdx` → docs build; openApi snapshot. Verify the CRUD openApi
   factory (`createCustomersCrudOpenApi`) actually threads `deprecated` to each method's doc
   (`openapi/types.ts:40`); if it does not surface, set `deprecated` on the route's manual `openApi`
   export instead.
9. Add `UPGRADE_NOTES.md` + `CHANGELOG.md` entries (pkarw's deprecation artifacts) stating the adapter
   removal horizon in **release versions** — ≥1 minor for the legacy reads; public endpoint URL removal
   no earlier than the next major (per the assignable-staff 308-redirect precedent) — with per-item
   "Action for downstream" notes, and ship a per-version `om-auto-upgrade-<from>-<to>` codemod skill for
   the bridge migration → referenced by this spec's changelog.

### Phase 4 — Flip + UI cutover (closes the configurable-statuses defect)
10. Flip `defaultCustomerInteractionFeatureFlags.unified` to `true` (`interactionFeatureFlags.ts:33`)
    and update `setup.ts` seeding. **Guard the flip per tenant (Q5):** a tenant reads canonical only
    after its Phase 1 backfill action has completed and validated — a tenant with an unverified backfill
    must not be switched → tenant with completed backfill reads canonical; un-migrated tenant stays legacy.
11. Switch `usePersonTasks` and `TasksSection` to canonical unconditionally; make
    `useCanonicalInteractions` a constant `true` for its consumers (`ActivitiesSection`,
    `ActivityHistorySection`, `MiniWeekCalendar`, the v2 pages) → component tests; the rich status
    picker now persists and renders end-to-end.
12. Make the bridge GET and the dashboard widget canonical-only; pin `interactionMode` to
    `'canonical'` in the people/companies response → route tests. Invalidate the tenant-tagged caches
    for the dashboard widget + people/company detail on flip (reuse existing tags; no new cache path).

### Phase 5 — Removal (Q1/Q3/Q4)
13. Delete the `!unified` read branches across the four server routes + widget, the `legacyAdapters`
    guard, the dead bridge helpers, and the 8 dual-path test files' legacy assertions → typecheck;
    full customers suite green.
14. Redirect soft-delete undo restore (`commands/people.ts`, `commands/companies.ts`) and
    `seed-examples` (`cli.ts`) to canonical entities. Define the restore contract: the undo re-creates
    `CustomerInteraction` via the canonical create command (not raw `em.create`) so projection /
    query-index side effects re-emit, and the delete-time snapshot shape is updated to capture
    canonical rows instead of legacy ones → undo + seed integration tests green; restored interaction
    appears in the next-interaction projection.
15. Remove the `interactionMode` wire field and the `customers.interactions.*` flags + seeds →
    contract-surface change recorded in `RELEASE_NOTES.md`.
16. Per Q1/Q4: destructive migration dropping `customer_activities` + `customer_todo_links`
    (`yarn db:generate`, reviewed SQL, snapshot update) → migration applies on a backfilled fixture
    with zero orphaned references.

## Integration & test coverage

Self-contained (API fixtures created in setup, cleaned up in teardown):

- **Backfill upgrade action** — seed legacy `customer_activities` + `customer_todo_links` rows (with
  schedules, custom fields, a canceled item), run the action, assert canonical rows carry
  `scheduled_at`/custom fields/cancel state, the `migration:*` source tag, and that planned items
  produce next-interaction projections. Re-run is a no-op.
- **AI tools** — `list_activities` / `deal_analyzer` / `list_tasks` return canonical-sourced data with
  legacy tables empty.
- **Cutover** — with `unified=true` default, create a `waiting` task via the customers UI hook path,
  read it back as `waiting` (the configurable-statuses defect, now fixed); bridge GET returns canonical.
- **Removal** — soft-delete a person with activities/tasks, undo, assert canonical rows restored (and
  the restored interaction re-emits its projection); `seed-examples` produces canonical interactions;
  the table-drop migration leaves no orphans.
- **Dashboard widget** — `GET /api/customers/dashboard/widgets/customer-todos` returns canonical-only
  after the `!unified` branch removal.
- **`interactionMode` contract** — people/companies GET returns `interactionMode: 'canonical'` during
  the pin release, and the field is absent after removal.

## Risks & Impact Review

| # | Scenario | Severity | Affected area | Mitigation | Residual |
|---|----------|----------|---------------|------------|----------|
| R1 | Flip default before backfill runs for a tenant → un-migrated legacy rows become invisible (planned next-steps vanish via the `scheduled_at` gap). | **Critical** | every tenant not yet backfilled | Phase 1 completes + automates the backfill as an upgrade action; Phase 4 flip is predicated on the action having run (Q5 verification); validation/report step. | Low once P1 lands. |
| R2 | Remove a bridge still called by an external client. | High | unknown third-party integrators (SPEC-046b:512) | Phase 3 honors the full deprecation protocol (deprecated flag, docs, `UPGRADE_NOTES.md`/`CHANGELOG.md`, ≥1 minor release; endpoint URLs held to next major); Q2 telemetry before removal; Q3 keeps canonical-backed shims as a softer step. | Low–Medium (depends on Q2). |
| R3 | Backfill drops a column that a downstream consumer needs (priority, custom fields). | High | migrated data fidelity | Phase 1 maps every canonical column + custom fields; validation step compares field coverage; SPEC-046b:500-505 incompleteness risk is explicitly closed here. | Low. |
| R4 | Destructive table drop is irreversible / orphans references. | High | `customer_activities`, `customer_todo_links` | Q1 freeze-read-only-then-drop across two releases; migration verified on a backfilled fixture; rollback window. | Low (gated). |
| R5 | AI-tool migration changes agent output (deal health, activity lists). | Medium | AI agents | Phase 2 unit tests pin canonical output; behavior parity checked against a seeded fixture. | Low. |
| R6 | Flag-collapse touches ~40 branch sites / 8 test files → regression in read/render. | Medium | customers detail pages, widget, routes | Phases sequence read-path before removal; full customers suite + component tests gate each phase; TasksSection (14 forks) handled as its own step. | Low. |
| R7 | Removing the `interactionMode` wire field breaks a client that reads it. | Medium | people/companies API consumers | Pin to `'canonical'` for one release before removal; contract-surface change recorded per `BACKWARD_COMPATIBILITY.md`. | Low. |
| R8 | Raw-Kysely backfill writes PII (`title`/`body`/participants) as plaintext into encrypted columns, or double-encrypts. | High (GDPR) | migrated interaction PII | Phase 1 resolves the encryption-safe write path (command-path vs verified ciphertext-preserving copy) per **Encryption & data handling**; assert decrypted read-back on migrated rows. | Low once P1 closes. |

**Blast radius.** Confined to `customers`, but unlike the additive configurable-statuses spec this one
includes a **destructive migration** and a **public-route removal** — hence `risk-high`. **Operational
detection.** Per-tenant backfill validation report; full customers unit + component suites; integration
tests on a seeded legacy fixture; the table-drop migration verified against a backfilled dataset.

## Backward compatibility & migration

- **Bridges** (`/api/customers/{activities,todos}`) are contract-surface category (7) API routes.
  Removal requires `deprecated: true` + ≥1 minor release + an `UPGRADE_NOTES.md`/`CHANGELOG.md` entry
  (`BACKWARD_COMPATIBILITY.md` §7). Phase 3 starts the clock; the legacy reads go in *N+1*, but the
  public endpoint URLs are held to **no earlier than the next major** (Q3 keeps canonical-backed shims
  meanwhile), per pkarw's 308-redirect precedent for renamed routes.
- **`interactionMode` response field** — contract-surface category (2)/(7). Pin to `'canonical'` for
  one release, then remove with a deprecation note.
- **Feature flags `customers.interactions.{unified,legacy-adapters,external-sync}`** — category (10)
  ACL/feature IDs. `unified` and `legacy-adapters` were declared transitional by SPEC-046b
  (lines 301-302, 519); removal is in-scope but recorded in `UPGRADE_NOTES.md`/`CHANGELOG.md`. `external-sync` has no
  branch points and is out of scope here.
- **Tables** — the first destructive schema change in this workstream; gated on Q1/Q4/Q5 and a
  validated backfill.
- **Data migration** — the Phase 1 upgrade action is the migration; it must be run (and verified) per
  tenant before that tenant flips. New tenants get canonical-only via `seedDefaults` once the default
  is flipped.

## Final Compliance Report — 2026-06-18 (DRAFT)

### AGENTS.md files reviewed
- `AGENTS.md` (root) · `BACKWARD_COMPATIBILITY.md`
- `packages/core/AGENTS.md` · `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md` · `.ai/specs/AGENTS.md`

### Compliance Matrix (provisional — finalize at implementation)

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No cross-module ORM relationships | Compliant | All within `customers`; the `example:todo` source table is untouched. |
| root AGENTS.md | Filter by `organization_id` | Compliant | Backfill + reads stay org/tenant scoped. |
| root AGENTS.md | Optimistic locking on new editable entities | N/A | No new entity. |
| packages/core/AGENTS.md → Commands/Undo | Mutations via commands; undo specified | Compliant | Reuses canonical interaction commands; Phase 5 fixes the undo restore path. |
| packages/core/AGENTS.md → Upgrade Actions | Existing-tenant migration via idempotent upgrade action | Compliant | Phase 1 converts the backfill to a `customers.backfill-interactions` action. |
| packages/core/AGENTS.md → API Routes | `makeCrudRoute`; routes export `openApi` | Compliant | No new routes; deprecation flags added to existing exports. |
| BACKWARD_COMPATIBILITY.md §7 | Route removal protocol | Pending | Phase 3 starts the deprecation window; removal gated on it. |
| BACKWARD_COMPATIBILITY.md (schema) | Destructive schema change | Pending | First destructive migration; gated Q1/Q4/Q5. |
| `.ai/specs/AGENTS.md` | `{date}-{title}.md`, no `SPEC-*` prefix | Compliant | `2026-06-18-customers-interactions-legacy-removal.md`. |

### Verdict
**DRAFT — all open questions resolved (2026-06-18); ready for `om-pre-implement-spec`.** Phases 1–3 can
begin now (precondition-closing, behavior-preserving); Phases 4–5 follow the two-release freeze-then-drop
(Q1/Q4) with the per-tenant backfill guard (Q5).

## Changelog

- **2026-06-18** — Spec drafted as the SPEC-046b legacy-removal follow-up. Scope, the four
  preconditions, and the five Open Questions derived from the 2026-06-18 readiness investigation
  (canonical-write readiness, backfill completeness, bridge consumers, deferral rationale, flag
  coupling). Status DRAFT pending the Q1–Q5 gate.
- **2026-06-18** — Adversarial accuracy review: all twelve load-bearing file:line claims verified
  against the codebase. Fixed minor citation drift (`entities.ts:560`, `deal-analyzer-pack.ts:159-189`,
  added `cli.ts:3169`) and closed checklist gaps: added the **Encryption & data handling** precondition
  (R8 — raw-Kysely backfill vs PII columns), the backfill execution-model + i18n step, the canonical
  undo-restore contract (Phase 5 step 14), openApi-deprecation verification (step 8), cache
  invalidation (step 12), and the dashboard-widget / `interactionMode` integration cases.
- **2026-06-18** — Maintainer resolved Q2–Q5. Q2 → treat the bridges as **public** (external consumers
  unconfirmed; OM runs at unknown companies worldwide), so the full deprecation window is mandatory.
  Q3 → keep canonical-backed shims for one release. Q4 → two releases (flip+freeze in *N*, drop in *N+1*).
  Q5 → assume the backfill has NOT run anywhere; it must be an automatic safe upgrade action and the
  default-flip is guarded on per-tenant backfill completion (Phase 4 step 10). Q1 (freeze-vs-drop)
  remains open pending an OM-precedent check (esp. pkarw's pattern).
- **2026-06-18** — Resolved Q1 against OM precedent (3-agent history review, high confidence):
  **freeze-then-drop over two releases**. OM does one-shot table drops, but only for unshipped/internal
  schema in active development (pkarw dropped `catalog_product_attribute_schemas` a day after creating
  it); `customer_activities`/`customer_todo_links` are shipped, live-data, public-bridged — the
  FROZEN/STABLE case pkarw's own `BACKWARD_COMPATIBILITY.md` governs. `2026-04-11-eliminate-global-roles.md`
  one-shot dropped *only because its data was dead, explicitly contrasted with `customer_activities`*;
  the in-module `Migration20260218191730` reshape keeps the legacy column. Corrected the deprecation
  artifact: the repo uses `UPGRADE_NOTES.md` + `CHANGELOG.md` (pkarw's files), not the non-existent
  `RELEASE_NOTES.md` the BC protocol text names; horizon is **release versions** (≥1 minor; endpoint
  URLs no earlier than next major), with a per-version `om-auto-upgrade` codemod skill for downstream.
