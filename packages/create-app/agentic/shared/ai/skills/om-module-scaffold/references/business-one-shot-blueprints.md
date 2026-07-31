# Business One-Shot Blueprints

Load this reference when the user describes a business outcome rather than files or framework mechanisms. Pick the closest row, state inferred scope in one sentence, then build its smallest end-to-end slice. Combine rows only when the brief clearly spans them; do not scaffold every optional surface named here.

## Route Key

- `M` — `om-module-scaffold` plus architecture/contracts; add `om-data-model-design` when persisting records.
- `U` — `om-system-extension` plus the extensions guide for additive installed-module behavior.
- `P` — `om-integration-builder` plus the integrations guide for a reusable external provider.
- `B` — `om-backend-ui-design` for admin, public, or portal UI.
- `W` — `om-build-workflow` for durable business-process state, activities, or human tasks; not schedules, queues, retries, or progress alone.
- `A` — `om-create-ai-agent` only when the brief actually requests agentic behavior.

`App module` owns app-specific records and behavior under `src/modules/`. `UMES` augments an installed module without copying it. `Provider` is a dedicated package/module for a reusable external system. A mixed choice names the owner of each leg.

Once a row matches, its route key is binding: invoke every unparenthesized route letter and its skill before implementation. Scalar IDs or snapshots keep modules independent, but they do not remove `U` when the slice still links to, enriches, guards, or renders installed-module behavior. A parenthesized route remains conditional on the parenthesized reason.

## Canonical Staff Record Inference

Before applying this mapping or writing files, directly read all three complete-module procedures: `.ai/skills/om-module-scaffold/references/api-and-domain.md`, `.ai/skills/om-module-scaffold/references/module-surfaces.md`, and `.ai/skills/om-module-scaffold/references/verification.md`. Their canonical exports, callbacks, placements, and verification paths are binding; do not substitute plausible alternatives such as `locales/` for `i18n/` or module-level tests for `commands/__tests__/`.

Business briefs should describe outcomes; translate familiar staff record-management language into the framework's canonical surfaces without making the user name them:

- “Browse/search/filter, add, correct, remove, and recover from mistakes” means a controlled-search `DataTable` with an add link and guarded `RowActions`, backed by `CrudForm` create/edit/delete flows. Preserve `initialValues`, use the documented CRUD helpers, and expose stable DataTable and CrudForm host IDs unless the domain requires a purpose-built interaction.
- “Extra fields administrators add later must survive create, edit, clear, and reload” means one stable custom-field entity ID across the route and forms, `collectCustomFieldValues` at submission, initial custom-field values on edit, and reset/restore maps during update and delete undo.
- “Permissions, concurrent editors, audit, all-or-nothing changes, retry, undo, and downstream consistency” means registered create/update/delete commands. Every command owns concrete undo through `extractUndoPayload` and `emitCrudUndoSideEffects`; update and delete each restore custom fields with `buildCustomFieldResetMap`; each multi-part write uses `withAtomicFlush`; update/delete enforce optimistic locking; and event/cache/index effects run only after commit in both forward and undo paths.
- “Protect sensitive notes” requires both a stable encryption map and scoped read paths through `findWithDecryption`, `findOneWithDecryption`, or `findAndCountWithDecryption`; an encryption declaration alone is incomplete.
- “Other modules can add fields, columns, actions, or response data later” makes `U` mandatory: publish stable widget/form/table IDs and an intentional API enricher host instead of copying or coupling modules.
- Activating a new app module is additive. Preserve every statically discoverable baseline entry in `src/modules.ts` and append with exactly `enabledModules.push({ id: '<module>', from: '@app' })`; never rewrite the registry from memory or fold the new entry into the baseline array.

Treat this mapping as a completion checklist, not optional examples. Verify each contract in the owning command, read path, form, table, API, and activation file before generation.

## Customers and CRM

| One-shot business brief | Mechanism | Routes | Smallest complete vertical slice | Key invariants |
|---|---|---|---|---|
| “Build a customer and contact management module.” | Enable/use installed `customers`; UMES for app-specific behavior; app module only for genuinely separate records | `U+B` (`+M`) | verify activation/capabilities, customer list/detail/forms/search, then add only requested fields, policies, widgets, or related records | do not duplicate the installed customer identity; tenant+organization scope; encrypted PII reads; optimistic locking; stable IDs |
| “Add customer success health, owner, and renewal fields to CRM customers.” | App module extension entity + UMES widgets/enricher/interceptor | `M+U+B` | health record keyed by customer ID, list/detail enrichment, editable panel, renewal filter, reminder event | read `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` before extending existing customer response, event, or ID surfaces; no cross-module ORM relation; complete read/write/UI round trip; optional CRM absence degrades safely; lock extension records |
| “Manage communication consent and channel preferences for every customer.” | App module + mandatory UMES customer panel and mutation guard | `M+U+B` | consent history, current preferences, customer widget, API, audit event, suppression query | append-only consent evidence; encrypted PII; purpose/channel granularity; deny sends without valid consent |

## Deals Pipeline

| One-shot business brief | Mechanism | Routes | Smallest complete vertical slice | Key invariants |
|---|---|---|---|---|
| “Modify the deals pipeline with our stages, probabilities, and required fields.” | UMES over the installed `customers` deal/pipeline surfaces; app module only for extra persisted policy | `U+B` | inspect exact `customers` hosts/contracts, then add stage-aware fields/validation, board/table rendering, translations, and transition tests | preserve shipped IDs; validate transitions server-side; wildcard ACL; unsupported replacement requires approval |
| “Add qualification scoring and next-best-action to every deal.” | App module extension entity + UMES enricher/widgets; optional AI tool only if requested | `M+U+B` (`+A`) | score inputs, deterministic calculator, deal list/detail field, recompute event, explainable action panel | score is reproducible and scoped; no hidden AI mutation; optional deals module safe; stale writes conflict |
| “Build a sales forecast and pipeline coaching dashboard.” | App analytics module + UMES reads/enrichers | `M+U+B` | scoped forecast query, stage-weighted totals, owner/time filters, drill-down, snapshot/export | currency/time-zone correctness; access-filtered aggregates; deterministic totals; no cross-tenant cache keys |

## CRM-Integrated Lead Capture

| One-shot business brief | Mechanism | Routes | Smallest complete vertical slice | Key invariants |
|---|---|---|---|---|
| “Generate an app that gathers website leads and adds them to the CRM.” | App module owns public capture + UMES/events create or link CRM customer/deal; MUST invoke `om-data-model-design` and report `smallest-validation` for the lead record and scalar CRM link | `M+U+B` (`+W` for async handoff) | public form, spam/consent validation, lead inbox, dedupe, qualification command, CRM handoff, attribution, success/error paths | public input never supplies scope; idempotent submission key; PII encryption; CRM optional/degraded; handoff retry cannot duplicate |
| “Build partner referral intake connected to CRM.” | App module + UMES CRM handoff | `M+U+B` | partner-authenticated form, referral record/status, customer/deal match, owner assignment, partner-visible outcome | partner sees only its referrals; deterministic dedupe; immutable attribution; CRM IDs stored as scalars |
| “Assign incoming leads fairly across eligible staff.” | App assignment policy + UMES customer/staff seams | `M+U` | read both `customers` and `staff` facts; scoped cursor, deterministic selector, availability resolver, assignment command/audit, fallback | concurrency-safe round robin; retries preserve the winner; unauthorized/unavailable staff excluded; staff module optional |
| “Import trade-show badge scans and turn qualified leads into deals.” | App module + data-sync provider when scanner API is reusable + UMES | `M+P+U+W` | upload/sync, mapping preview, lead staging, dedupe, qualification queue, CRM conversion report | resumable/idempotent batches; row-level errors; encrypted credentials; no partial duplicate conversions |

## Catalog and Sales

| One-shot business brief | Mechanism | Routes | Smallest complete vertical slice | Key invariants |
|---|---|---|---|---|
| “Add customer-specific assortments and price lists.” | App module + UMES catalog/customer enrichment and guards | `M+U+B` | assortment/pricing entities, assignment UI, catalog query enrichment, effective-date selection, tests | money uses exact decimal/currency; deterministic precedence; no cross-module ORM; scoped cache invalidation |
| “Build product bundles with configurable components.” | App module + UMES catalog/order widgets and guards | `M+U+B` | bundle definition, compatibility rules, pricing calculation, catalog editor, order-line expansion | snapshot price/config on sale; prevent invalid/cyclic bundles; lock edits; absent sales module safe |
| “Reserve limited stock during checkout.” | App reservation module + UMES catalog/checkout guards | `M+U` | read `catalog` and `checkout` facts; reservation entity, atomic reserve/release commands, availability hook, expiry worker | no oversell; scoped atomic writes; idempotent winner/retry/release; quantity never negative; designed conflict handling is not debugging |
| “Receive purchase orders into catalog inventory.” | App purchasing/receipt module + UMES catalog posting | `M+U+B` | partial receipt, discrepancy reasons, atomic inventory posting, cumulative receiving UI | never over-receive; retry-safe scan/submission; receipt and stock commit together; scalar host IDs |
| “Track expiring lots through fulfillment and recall.” | App lot ledger + UMES catalog/sales links | `M+U` | lot/receipt/movement records, allocation guard, shipment links, scoped recall query | earliest-safe-expiry allocation; immutable movement lineage; audited adjustments; no cross-scope recall leakage |
| “Bulk-update product prices with progress and undo.” | App operation module + UMES catalog actions/UI | `M+U+B` | chunked command, progress page, failure ledger, cancellation boundary, compensating undo | exact money; scoped ACL; completed chunks are retry-safe; undo is authorized/audited |
| “Add quote approval and convert approved quotes into orders.” | App module policy/workflow + UMES sales actions | `M+U+B+W` | approval rules, submit/approve/reject commands, task UI, guarded conversion, audit/events | aggregate optimistic lock; command-only state changes; approval ACL/separation; conversion exactly once |
| “Create a returns and RMA management module.” | App module + UMES order/customer links | `M+U+B+W` | return request, item eligibility, approve/receive/disposition/refund states, order widgets, portal status | quantities never exceed fulfillment; scalar snapshots; idempotent state transitions; refund requires explicit guarded action |

## Payments and Shipping

| One-shot business brief | Mechanism | Routes | Smallest complete vertical slice | Key invariants |
|---|---|---|---|---|
| “Integrate a new payment gateway.” | Provider; small app glue only for app-specific policy/UI | `P+U+B` | credentials, health check, authorize/capture/refund adapter, webhook verification, payment UI/status mapping | encrypt credentials; verify signatures; idempotent external IDs; exact money/currency; no secret logging |
| “Build payment reconciliation and dispute handling.” | App module + payment-provider/data-sync seams | `M+P+B+W` | statement import/sync, match engine, exception queue, dispute lifecycle, audit/export | deterministic re-runs; unmatched records retained; money totals reconcile; privileged writes and locked cases |
| “Integrate a shipping carrier with labels and tracking.” | Provider + UMES sales/fulfillment glue | `P+U+B` | credentials/health, rate quote, shipment/label commands, tracking webhook/poll, order widget | encrypted credentials; webhook dedupe; label retry does not duplicate shipment; tracking state monotonic |
| “Choose the cheapest valid carrier and track fulfillment.” | App orchestration module + carrier providers + UMES | `M+P+U+W+B` | read `shipping_carriers`, `sales`, and `progress` facts; shipment rules, rate comparison, guarded selection, booking workflow, progress/exceptions | provider-neutral domain; deterministic rule order; retry/idempotency; package/weight/address validation |

## Portal and Notifications

| One-shot business brief | Mechanism | Routes | Smallest complete vertical slice | Key invariants |
|---|---|---|---|---|
| “Let customers view quotes/orders and approve quotes in a portal.” | App portal module + UMES sales/customer links | `M+U+B` | `[orgSlug]/portal` pages, scoped list/detail, approval command, navigation injection, notifications | derive customer from portal principal; never trust route IDs alone; aggregate lock; mobile/loading/error states |
| “Build a customer support case portal.” | App module with portal/admin surfaces + UMES customer context | `M+U+B+W` | cases/messages/attachments, portal create/reply, admin triage/SLA, notifications, search | portal ownership on every read/write; attachment policy; PII protection; idempotent SLA escalation |
| “Notify deal owners before stale opportunities breach SLA.” | App module subscriber/scheduler + UMES deal link | `M+U+W` | SLA policy, due query, notification type/renderer, deep link, acknowledge/snooze action | ACL-filtered renderer; dedupe per deal/window; tenant time zone; optional deals module safe |
| “Run customer renewals at each customer’s local time.” | App scheduler over customer IDs; load both `scheduler` and `customers` facts | `M` | annual renewal schedule, restart-safe claim, customer time-zone/DST policy, renewal command | trusted host scope (`host-scope-contract`); worker idempotency; no timer loop; retries cannot duplicate |
| “Create an operations exception center for low stock and failed orders.” | App module + event subscribers/enrichers from catalog/sales | `M+U+B+W` | normalized exception record, inbox/filter/detail, resolution commands, source deep links | idempotent event projection; source IDs as scalars; scoped reads; resolved exceptions do not reopen without a new cause |

## Workflows and Data Sync

| One-shot business brief | Mechanism | Routes | Smallest complete vertical slice | Key invariants |
|---|---|---|---|---|
| “Require manager approval for discounts above a threshold.” | Workflow/policy app module + UMES sales mutation guard/UI | `M+U+W+B` | threshold policy, approval task, submit/approve/reject, guarded discount mutation, audit | server-side money comparison; separation of duties; stale document conflict; decision replay cannot double-apply |
| “Automate customer onboarding across sales, tasks, and email.” | App module + durable workflow + optional providers/UMES | `M+W+U+P+B` | trigger, checklist/tasks, email steps, waits/escalations, progress UI, retry/recovery tests | idempotent steps; explicit compensation; no credentials in workflow state; missing optional provider yields actionable pause |
| “Synchronize customers and products with our ERP.” | Data-sync provider + thin app mapping/UMES layer | `P+M+U+B` | credentials/health, cursors, inbound/outbound mappings, conflict policy, run UI/progress, retry/CLI | stable external mapping; scope every cursor; deterministic conflict ownership; resumable exactly-once effects |
| “Add scheduled CSV/SFTP imports and exports with custom mappings.” | Provider for reusable SFTP/storage; app module owns format/mapping | `P+M+B` | format schema, preview/validate, batch job, row errors, export, schedule/progress | path/CSV hardening; encrypted credentials; resumable batches; no scope in untrusted file; formula-injection-safe export |

## External Integrations

| One-shot business brief | Mechanism | Routes | Smallest complete vertical slice | Key invariants |
|---|---|---|---|---|
| “Sync CRM segments and campaigns to an email marketing platform.” | Provider + UMES customer/consent reads | `P+U+B+W` | connection/health, segment mapping, incremental sync, suppression handling, run report | consent enforced before export; encrypted token; remote-ID uniqueness; delete/unsubscribe convergence |
| “Export invoices to accounting and reconcile their status.” | Provider + UMES sales/document glue | `P+U+B+W` | account/tax mapping, guarded export, attachment/status import, exception/retry UI | immutable financial snapshots; exact currency/tax totals; idempotent document key; no silent mapping fallback |
| “Expose signed webhooks for CRM lifecycle events and receive updates.” | Provider/webhook module + UMES events/interceptors | `P+U` | endpoint config, signed delivery/retry log, inbound verification/dedupe, mapping commands | rotate/encrypt secrets; standard signature verification; replay protection; post-commit outbound delivery |

## Content, Onboarding, and Greenfield Apps

| One-shot business brief | Mechanism | Routes | Smallest complete vertical slice | Key invariants |
|---|---|---|---|---|
| “Add localized privacy, terms, and help pages.” | App content module; UMES menu injection when linked in installed UI | `M+B+U` | versioned content, locale resolution, public routes, navigation/footer links, publish preview | safe rendering; explicit publication/version dates; locale fallback; legal history remains retrievable |
| “Create a tenant onboarding wizard for CRM setup.” | App onboarding module + UMES setup hooks/widgets | `M+U+B+W` | resumable steps, defaults/import/invitations, completion state, welcome notification | setup hooks idempotent; scoped progress; safe retry; secrets never stored in wizard state |
| “Build a library management system.” | New app module | `M+B+W` | books/copies/members, checkout/return/renew/reservation commands, admin UI/search, overdue jobs | copy availability is transactional; no double checkout; due dates use tenant zone; member PII protected |
| “Build a field-service management app tied to CRM customers.” | App module + UMES customer links + optional mapping provider | `M+U+B+W+P` | work orders, technicians, schedule, visit notes/photos, customer panel, dispatch notifications | scalar customer IDs/snapshots; assignment conflicts prevented; mobile/error states; jobs retry idempotently |
| “Build an equipment rental business app.” | New app module + optional payment/shipping providers | `M+B+W+P` | assets, availability, reservations, checkout/return, damage/deposit, calendar | overlapping reservations rejected atomically; money snapshots; asset condition audit; provider failures recoverable |
| “Build appointment booking connected to CRM.” | App module + UMES customer handoff + notification provider | `M+U+B+W+P` | public availability, booking/reschedule/cancel, CRM match/create, reminders, admin calendar | public scope derived server-side; slot hold is atomic; time-zone/DST correctness; submission/reminder dedupe |
| “Build membership and subscription management.” | App module + payment provider + customer portal | `M+B+P+W+U` | plans/memberships, enrollment, renewal/cancel, payment status, portal/admin views | explicit billing state machine; webhook idempotency; entitlement derived from paid periods; PII/money protection |
| “Build purchasing and vendor approval management.” | New app module + optional accounting provider | `M+B+W` (`+P` only when an accounting provider is requested) | vendors/requests/POs/receipts, approval thresholds, budget view, export | separation of duties; exact money/currency; locked approvals; PO/export exactly once |

## Completion Rule

Before coding, turn the chosen row into concrete stable IDs, routes, actors, lifecycle states, optional-module behavior, and acceptance paths. A one-shot is complete only when its named API/UI path works through real commands, generation is refreshed, migrations are reviewed but not applied, and integration tests cover scope, denial, stale writes, failure/retry, and every external boundary used.
