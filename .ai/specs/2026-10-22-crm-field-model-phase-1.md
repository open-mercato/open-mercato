# CRM field model Phase 1 — decision record and delivery map

## 📝 TLDR

Specify the full CRM field-model proposal in [issue #7700](https://github.com/open-mercato/open-mercato/issues/7700) through thirteen capability documents, with classification explicitly divided into three independent delivery slices. Preserve existing integrations and data while improving identity, contact information, outreach permissions, classification, hierarchy, deal valuation, actual closure dates and contact recency. This umbrella is a decision/traceability document, not a monolithic implementation ticket; each capability or slice has its own approval, schema, API, migration, UI, risk and test plan.

## Overview

Status: **design complete for review; draft PR pending the marked migration/policy confirmations**. Created 2026-10-22. No runtime code, migrations, generated files, production dependencies or design-system governance files change in this PR. Merging a spec must not close #7700. Implementation follows separate PRs referencing the approved capability spec.

The issue was a proposal based on `main` `ab23d45ff`. Initial authoring inspected `main` `0c886d0a14c02106ff2abc9728be36c04c5a2ccd`; review remediation on 2026-10-25 merged `main` `db279a693eb283f6147b6e1ef24abfeeca6de646` and rechecked the affected customer fields, legacy custom-field defaults, nullable deal currency and existing currency selector/update path. Remote `git ls-remote --heads origin main develop` returned only main on 2026-10-22; configured `.ai/agentic.config.json` also selects main. At initial authoring, [PR #7625](https://github.com/open-mercato/open-mercato/pull/7625) was open at `a0ca00340a29549bada6558281fbc0fa7edbb9da` targeting main. Its configurable vocabulary is a dependency to compose with and recheck at implementation, not assumed shipped functionality. [#5106](https://github.com/open-mercato/open-mercato/issues/5106) was closed, and status-to-stage logic exists at the inspected baseline.

## Resolved assumptions (autonomous defaults)

| ID | Question | Applied default and rationale | Confirmation |
|---|---|---|---|
| A1 | One large spec or a set? | Thirteen capability specs plus this coordination map; classification has separate lifecycle, health and renewal slices. Approve/deploy each capability or slice independently; all issue requirements remain represented. | Reversible default. |
| A2 | Final lifecycle vocabulary and migration? | Offer lead/prospect/customer/former_customer/disqualified, preserve legacy/custom values and source evidence; no destructive subscriber/other rewrite or inferred consent. | **⚠ NEEDS HUMAN CONFIRMATION** of vocabulary and migration policy before implementation. |
| A3 | Missing year on Q1–Q4 renewal data? | Retain source value with a review-needed result; do not invent the current year. | **⚠ NEEDS HUMAN CONFIRMATION** of any bulk year mapping. |
| A4 | Does legacy newsletter/subscriber data authorize outreach? | Import unknown-quality assertions with original provenance, no invented consent date/basis; activate sender enforcement only after review. Built-in consent policy allows evidenced consent; other recorded bases require a separately approved evaluator. | **⚠ NEEDS HUMAN CONFIRMATION** because permission activation changes existing outbound behavior. |
| A5 | Reuse the auth consent ledger? | Customers-owned permission projection/history; reuse the evidence pattern, not an auth-user entity/service. | Reversible architectural proposal; no such reusable service exists at baseline. |
| A6 | Fixed win/lost spelling or configurable vocabulary? | Stage semantic outcomes are stable; persisted status tokens use #7625's resolver when integrated, with shipped win/lost defaults and all legacy aliases accepted. | Compatibility default; integration gate. |
| A7 | Authoritative historical close dates? | Estimate from eligible stage projection, otherwise snapshot updated_at; retain provenance and never emit fake historical sales events. | Historical accuracy is limited and disclosed. |
| A8 | Last contacted storage and visibility? | Caller-authorized computed API field over completed call/email/meeting occurrences, no shared private-email timestamp cache or new stored column. | Privacy-preserving implementation choice; no sort/filter feature added. |
| A9 | Value from lines or manual estimate? | Explicit manual/calculated mode; existing values start manual; single-currency four-place internal arithmetic, no tax/ARR/invoice logic. | Reversible additive model; precision compatibility tests required. |
| A10 | Creator on old records and service imports? | Null unless trusted human creation actor is actually available. | No invented history. |
| A11 | Country providers and enrichment behavior? | Optional provider-owned packages, no provider bundled; explicit version-bound preview/apply. | Matches country-neutral scope. |

These choices are proposals for review, not claims of product-owner or legal approval. A2–A4 intentionally keep the spec PR draft under `om-auto-write-spec`'s high-stakes rule. They do not prevent the authoring/research work from being completed. The same table is posted to the issue and PR for override.

## 📝 Problem Statement

The existing customers module conflates different business questions and lacks child records for important identity/contact/commercial information. A global B2B CRM needs to answer who this entity is, how it can be contacted, whether a specific outreach is permitted, how the relationship stands, what the deal is worth and when a sale actually closed. A modified timestamp cannot answer the last two questions. Adding flat fields without migration, concurrency and source-of-truth rules would reproduce the ambiguity.

The [research note](assets/crm-field-model-phase-1/research.md) compares Salesforce, HubSpot, Dynamics 365, Pipedrive, Odoo, SuiteCRM and EspoCRM using 17 inspected sources. Six dated first-person reports concern enrichment overwrites, duplicated contact histories, primary-email routing surprises, lifecycle terminology, modified-date reporting noise and imported lines not recalculating amounts. These reports are qualitative requirement probes, not a prevalence survey. The note separates vendor behavior from inferred Mercato design and does not claim universal legal compliance.

## 📝 Proposed Solution and requirement traceability

| Capability / issue requirements | Governing specification | Key acceptance invariant |
|---|---|---|
| Tax/registration identifiers, country/type registry, duplicate warning | [Company identifiers](2026-10-22-crm-company-identifiers.md) | Same-scope duplicate warnings and country-neutral typed identity without a provider. |
| Optional company lookup and enrichment diff preview/apply | [Company enrichment](2026-10-22-crm-company-enrichment.md) | No unconfirmed overwrite; version-bound application; manual CRM works without a provider. |
| Multiple email/phone points, labels, one primary/kind, legacy primary mirrors | [Contact points](2026-10-22-crm-contact-points.md) | Atomic child/primary projection with each child's own version and invalid legacy preservation. |
| Consent channel/purpose/basis/history, do-not-contact/email/call, email-bounced projection, newsletter migration | [Contact permissions and consent history](2026-10-22-crm-contact-permissions-and-consent-history.md) | Suppression overrides permission for the actual destination at enqueue and dispatch; no invented evidence. |
| lifecycle_stage, deprecated status/temperature | [Classification — lifecycle slice](2026-10-22-crm-classification.md#independent-approval-and-deployment-slices) | C1–C2 / A2 approval, own mapping version and reconciliation; health/renewal unchanged. |
| core relationship_health | [Classification — health slice](2026-10-22-crm-classification.md#independent-approval-and-deployment-slices) | Independent health approval/deployment with no C1–C3 prerequisite; retained native/CF bridge. |
| renewal_quarter | [Classification — renewal slice](2026-10-22-crm-classification.md#independent-approval-and-deployment-slices) | C3 / A3 approval and own reconciliation; no invented year or lifecycle/health rewrite. |
| Company-only multi-select relationship_type | [Company relationship types](2026-10-22-crm-company-relationship-types.md) | Scoped role assignments never grant access or propagate to people. |
| parent_company_id | [Company hierarchy](2026-10-22-crm-company-hierarchy.md) | Same-scope acyclic parent edge; hierarchy never implies access or financial rollup. |
| stage outcome, bidirectional sync, closed_at/backfill/index, closure_outcome, loss dialog/events | [Deal closure integrity](2026-10-22-crm-deal-closure-integrity.md) | One transition resolver; unrelated edits cannot move actual close date or repeat sales events. |
| deal_type dictionary classification | [Deal types](2026-10-22-crm-deal-types.md) | Classification never closes a deal or changes its amount. |
| Manual lines, quantity/unit price/discount/total, amount override | [Deal line items](2026-10-22-crm-deal-line-items.md) | UI/API/import use one calculation with explicit value authority. |
| Optional catalog product selection and price snapshots | [Deal catalog selection](2026-10-22-crm-deal-catalog-selection.md) | Catalog-owned resolution feeds the line contract; existing snapshots survive catalog removal. |
| last_contacted_at for people/companies/deals | [Interaction recency](2026-10-22-crm-interaction-recency.md) | Latest visible completed call/email/meeting, by occurrence, linked to that record. |
| created_by_user_id for people/companies/deals | [Creation provenance](2026-10-22-crm-record-creation-provenance.md) | Server-owned immutable actor; null where history is unknown. |

All issue fields are covered. Deliberate verified corrections are: preserve ambiguous lifecycle/renewal source values; import legacy subscription as evidence rather than valid consent; do not treat mutable stage rows as authoritative history; do not defeat tenant status vocabulary; compute recency after per-caller visibility. Person `relationship_type` is not added. Existing description limits, comments, forecast date, loss reason/notes remain. The current `DEAL_DESCRIPTION_MAX_LENGTH` is 50,000; the issue's 4,000-character description inventory is stale and must not narrow validation. Phase 1 excludes Poland-specific implementations, lead scoring, forecast categories, BANT/MEDDIC, ARR/MRR, structured deal competitors, annual-revenue currency promotion and removing old columns/status values.

## 📝 Architecture and source map

The `customers` module remains the owner of CRM records and the reference CRUD implementation. Source-of-truth files inspected include `data/entities.ts`, `data/validators.ts`, `commands/deals.ts`, `commands/people.ts`, `commands/companies.ts`, `customFieldDefaults.ts`, `encryption.ts`, `lib/dealStatus.ts`, `lib/closureStage.ts`, people/company/deal APIs and stage/bulk routes. New company links and existing person-company links are separate concepts. Cross-module data references use scalar UUIDs plus snapshots, never ORM relationships.

Related specifications reviewed:

- [Lead funnel](2026-04-03-customers-lead-funnel.md): proposed lead staging/dedupe should later reuse identifiers; no duplicate lead model is introduced here.
- [Tenant legal documents/consent versioning](2026-08-18-tenant-legal-documents-and-consent-versioning.md): an auth-user-specific proposal, not a currently available CRM ledger service.
- [Optimistic locking coverage](2026-05-28-optimistic-locking-coverage-completion.md) and the implemented optimistic-lock floor: child versions and aggregate transaction locks are complementary.
- Existing CRM email privacy and conversation-sharing code/specs: recency and contact resolution must reuse current visibility, including private-owner restrictions.

Optional provider packages register with a customers host contract; their credentials/configuration stay in their package. Catalog owns product-picker/resolver glue and uses its own pricing service. The contact-permission spec explicitly proposes a narrow messages-owned outbound-policy interface at actual sender boundaries; customers owns optional policy registration. The upstream modules never import customers policy. No arbitrary automation changes, global client providers, database application or submodule-pointer edits are part of this authoring work.

### Shared implementation contract

1. New mutable records have UUIDs, tenant/org scope, created/updated/deleted timestamps, Zod schemas and list/detail `updatedAt`. Parent lookups and referenced rows must be authorized in the same tenant/org; a foreign child ID yields indistinguishable 404. All-organizations views use existing scope filters; mutations resolve one organization.
2. Reuse `makeCrudRoute`/query engine/indexer for CRUD, command bus for writes, `runCrudCommandWrite` or transaction-safe `withAtomicFlush` for coupled state. Keep custom-field normalization and before/after snapshots. New custom action routes execute mutation guards, validate modified payload and run post-success callbacks. Every route exports per-method metadata and OpenAPI.
3. New UIs always send their own row's optimistic version through `CrudForm` or scoped shared headers; compound actions check every dependent version. Preserve legacy no-header behavior on existing APIs. Snapshot/undo is explicit; append-only evidence uses compensating records, not deletion. Effects/index/cache invalidation happen after commit for execute and undo.
4. Use existing `defaultEncryptionMaps`, `buildEncryptionMapBackfillSql`, decryption helpers and framework hash conventions for PII/evidence/identifiers/free text. No custom crypto, raw sensitive logs, vectorizing identifier/contact/consent values, or unencrypted sensitive caches. Bound every field/list/provider response. Failed decryption never falls back to exposing ciphertext/plaintext SQL.
5. Use typed `createModuleEvents`; keep existing event IDs/payload members and add only optional fields. Queue work through `@open-mercato/queue`, tenant/org-scoped payloads and `ProgressJob` for user-visible bulk/backfill work. Retries are idempotent and timeouts have actionable states. No custom queue or altered global delivery setting.
6. Do not change existing imports, routes, dictionary tokens, widget spots, ACL IDs or generated conventions incompatibly. New ACL features use wildcard-aware authorization and deliberate setup grants. Providers' absence is a tested deployment, not a boot exception. No production dependency is proposed.

New dictionary kinds keep existing custom-slug identity and 150-character value bounds. An absent-only seed must not assume existing commands provide kind-level serialization. Each owning capability uses the same narrow customers-owned `customers_dictionary_kind` advisory-lock convention across its seed, entry and kind-setting writes, with tenant/organization/kind key and one shared transaction/entity manager; this helper is additive and implemented once, then reused. Preserve existing configured/empty kinds and mark initial creation to prevent reseeding. The existing upgrade registry lives in `configs/lib/upgrade-actions.ts`; a registration there is the explicit infrastructure exception to customers-owned implementation. Seed/admin races and rollback belong in each affected capability's tests. New selector read endpoints enforce their parent capability's view permission without widening the existing generic dictionary guard.

### Shared classification normalization and journal conventions

Classification slices share conventions, not approvals or an all-fields migration. Normalize supported `cf_`, `cf:` and `customValues` payloads before choosing precedence; an omitted key preserves, explicit null clears a nullable value, and an explicit native key wins over its legacy mirror for that deployed slice. Preserve old keys/values, snapshot both representations and use customer aggregate commands for atomic writes/undo and after-commit effects. An undeployed slice retains its current writer/UI behavior.

Each reconciliation preview is immutable and pins exactly one slice, approved mapping version, tenant/org, eligible record IDs, input fingerprints, expected aggregate versions and expiry. Apply uses that preview, never a newly selected set. Receipts deduplicate by scope/record/slice/version; a receipt or approval for health cannot satisfy lifecycle or renewal. Compare that slice's inputs and the parent version under its command lock, record conflicts rather than overwriting edits, and limit domain writes/compensating undo to that slice's fields. Reuse queue/progress and these journal conventions without introducing a shared migration platform. Exact fields, request union, mappings and independent gates live in [classification](2026-10-22-crm-classification.md).

## 📝 Data Model, API and UI boundary

The capability documents are authoritative for their tables and exact requests/responses; this umbrella does not create a second schema. Dictionary-valued business fields remain tenant-editable, while semantic outcomes/channel enums are stable machine values. Multi-select company relationships use a scoped junction model, never an unbounded JSON array. Contact points and permissions distinguish identity, primary convenience and effective permission; product lines distinguish snapshot/catalog source and amount authority.

UI changes stay on current company/person/deal details, existing lists and pipeline settings. New sections use the shared backend component families rather than create a separate CRM shell. Forms use `CrudForm`, lists `DataTable` with stable extension identifiers, HTTP `apiCall`, non-form writes `useGuardedMutation` and conflict helpers. Preserve shared loading/error/not-found/empty states, current `Alert status/style/size`, `StatusBadge`, `SectionHeader`, form headers/footers and confirmation dialogs. All copy is localized; semantic tokens/scale, accessible icon labels and Ctrl/Cmd+Enter/Escape are required. Migration review must explain changes and show unresolved source values without exposing data from other organizations.

### Frontend Architecture Contract

| Surface | Boundary / data owner | Client reason and guardrail |
|---|---|---|
| Person/company create/detail | Existing route roots and scoped customers APIs; new contact/permission/identifier/hierarchy leaves | Form state, row selection, preview, focus and conflict recovery. Leaves ≤300 LOC; paged sections; no global providers. |
| Deal create/detail/list/pipeline | Existing route composition and command-backed API | Existing DnD/selection stays in its island; new closure dialog/lines/mode controls are bounded leaves. No business resolver in page root. |
| Pipeline/dictionary settings | Existing settings surface/API | Local form state and versioned submit; semantic outcome independent of translated label. |
| Creator/recency labels | Existing response data, private recency computed after shared cache | Reuse existing display component; no client-side event scan or new browser library. |

Every implementation PR must list actual new/touched `use client` files, exact browser-only reason, importer and cleanup risk. Existing large client page roots are a temporary exception only for composing new leaves: do not copy the existing oversized pattern into new files. No new unallowlisted page/layout-root client directives or heavy root imports. Provider SDKs, editors and charts are out of scope. Abort async preview/lookup on unmount; no process-global client subscription.

Budgets: per capability, zero new global providers, all new client leaves ≤300 LOC, no more than 10 KiB gzip per touched route (15 KiB for permissions, which includes history UI), ≤5% steady-state dev RSS delta under the same measured route scenario, and zero hydration errors. Combined rollout target ≤25 KiB gzip added per touched route; implementation must record before/after artifact measurements, not assert them from source size. Exceptions require documented review before merge. Static boundary checks plus route load/interactivity tests and build/bundle/RSS evidence are required.

Visual evidence for this spec run: **skipped**. `.ai/agentic.config.json` names the Playwright provider and its descriptor exists, but neither `.ai/qa/test-env.json` nor a generated native test-env entrypoint exists in the invoking checkout. The legacy env hint is not a verified running test environment. The auto-write skill permits text-only specifications in this case; no screenshots or browser QA are claimed. A local DS health scan succeeded as source context; customers had zero hardcoded status-color findings but existing typography/inline-SVG/empty-state debt, so touched lines must follow the Boy Scout rule. The generated health report is excluded from this PR.

## Migration & Backward Compatibility

Use expand → bridge → dry-run/backfill → reconcile → UI/read cutover, per capability. Migration receipts must preserve original values and source versions and be resumable without duplicating child rows or overwriting later human changes. New defaults apply to new records, not invented historical truth. No historical author, consent time, renewal year or true close time is inferred without evidence. Mark exceptions for operator review.

`status`, `temperature`, primary contact fields and superseded custom fields remain readable for at least one minor version; legacy writes use explicit adapters rather than silent data loss. Each implementation adds `@deprecated` metadata where applicable, bridge docs and an `UPGRADE_NOTES.md` entry naming a target removal version no earlier than the required window. No future removal is authorized by this spec. Queries, saved filters, imports/exports, AI tools, aggregate/report helpers and module-absent deployments are part of compatibility testing.

Applying migrations to a developer database still requires explicit approval. Generate/review module migrations and snapshot only; no hand-edited generated registries. Rollback preserves new data, pauses affected queues if old writers would bypass guards, and uses a compatibility release; do not drop columns/consent history/line items after writes. Meaning-changing cutovers (lifecycle/consent/report dates) require the marked human review and per-tenant reconciliation report.

A2 governs lifecycle reconciliation, A3 governs renewal/year mapping, and A4 governs legacy permission/sender activation. They remain unconfirmed and keep this spec PR draft. Independent approval of an unaffected capability or the health slice does not approve those decisions; its own implementation PR must carry its approval and tests. Health can be deployed without enabling lifecycle/renewal, changing their dictionaries/editors, or using their mapping versions.

## 📝 Risks & Impact Review

| Risk / severity | Affected area | Mitigation and residual risk |
|---|---|---|
| Legacy data silently changes meaning / high | Lifecycle, consent, renewal, close history | Preserve originals and evidence; dry-run classifications; confirmation gates. Historical certainty cannot be manufactured. |
| Cross-tenant or private-interaction leak / critical | Dedupe, contact links, hierarchy, recency | Same-scope parent checks; caller visibility before aggregates; no shared cache of private timestamps. Existing privileges still expose authorized data. |
| New rows lost under stale parent headers / high | Contact/identifier/line/consent children | Child versions plus parent lock/version for aggregate changes. Old clients retain established no-header behavior. |
| Provider/module absent or delivery race / high | Enrichment, catalog, outbound permission | Graceful manual paths; exact provider/context contracts; sender-time fail closed for activated CRM policy. Accepted external sends cannot be recalled. |
| Money or closure statistics drift / high | Deal value and reports | Exact server arithmetic, explicit authority, stable actual timestamp, date-source disclosure and integration tests. Legacy estimates remain estimates. |
| Over-broad implementation PR / medium | Review and deployment | Thirteen capability documents, independent classification slices and explicit dependency order. Shared conventions never couple their approval/deployment gates. |

## Integration and validation strategy

Every capability enumerates all affected HTTP verbs/routes, commands, real integration boundaries and key UI paths. Implementation tests ship in the same change under `packages/core/src/modules/customers/__integration__` (and the owning sender/catalog module when its contract changes). Use shared API/auth fixture helpers, create/clean data in finally, two tenants plus two organizations in one tenant, wildcard ACLs, encryption on/off, concurrent stale versions, retry/undo and no-demo-data fixtures. Provider tests use fake registered implementations and never require live registry or mailbox credentials.

Documentation-only validation for this PR: scope/architecture review, relative-link/path checks, issue coverage, source attribution checks and `git diff --check`. No application test or build result is claimed for unimplemented behavior. Implementation must choose runner once by the documented Docker probe and run configured commands in order: `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`; add affected integration suites, migration no-op check, module-decoupling tests, `yarn check:client-boundaries`, DS/i18n checks and declared performance evidence. A command failure is reported, never converted to success by skipping it.

## Final Compliance Report — 2026-10-22

| Rule group / reviewed source | Design result |
|---|---|
| Root Task Router; core/customers/shared AGENTS; `.ai/specs/AGENTS.md` | Capability ownership, scoped data, canonical commands/routes and bounded specifications are explicit. |
| `BACKWARD_COMPATIBILITY.md` | Additive columns/types/routes, stable status aliases/primary projections and ≥1-minor bridges. No runtime contract is changed in this PR. |
| Core encryption; cache/events/queue/progress guidance | Sensitive maps, decrypted reads, scoped cache, post-commit effects and retry/undo boundaries are specified. |
| Catalog/currencies and integration boundaries | Optional consumer-owned glue, scalar IDs/snapshots and canonical pricing; no provider-specific core bootstrap. |
| UI/backend and DS skills/rules | Shared primitives/guarded HTTP, frontend boundary ledger, accessibility, budgets and touched-line cleanup required. |
| QA/integration guides | Every capability maps API/UI behavior to same-change self-contained tests. |

Internal consistency review checks data-to-API, API-to-UI, command coverage, reversibility, cache/privacy, dependency absence and migration traceability. Structural compliance does not mean implementation verified or product/legal policy approved. **Verdict: suitable for specification review; A2–A4 keep this PR draft and require confirmation before their affected implementation/cutover.** Independent review split enrichment from identifiers, catalog selection from manual lines, deal types from closure, and relationship types/hierarchy from legacy classification. Classification now explicitly separates lifecycle, health and renewal approval/deployment slices. All issue requirements remain covered. Review also corrected closure-reader rollout order, version-bound migration previews, hierarchy undo locking, keyed-only identifier hashing, explicit line-create parent expectations, withdrawal references, canonical-equivalent delivery-health preservation and currency-null manual-line recovery. Findings and validation limits are recorded in the PR summary.

## Changelog

- 2026-10-22: Initial architecture-grounded spec set and 17-source research note for #7700; corrected historical/date/consent assumptions and retained all Phase 1 requirements.
- 2026-10-25: Address specification review with canonical-equivalent bounce preservation, guarded parent-currency recovery for manual lines, and independent lifecycle/health/renewal slice gates plus shared normalization/journal conventions. A2–A4 and the draft remain unapproved.

### Review — 2026-10-25

- **Reviewer:** Agent remediation self-check against @wojciechszyjka's review of `024fd84e`; human re-review requested separately.
- **Security:** Canonical-equivalent edits preserve delivery blocks/provenance and address-bound permission; scoped guards and encryption contracts remain required.
- **Performance:** Existing bounded queries, pages and frontend budgets remain; no runtime performance result is claimed.
- **Cache:** Existing after-commit parent/child invalidation and fresh sender decisions remain; no cached allow is introduced.
- **Commands:** Locked identity transitions, guarded parent-currency selection and slice-limited reconciliation/undo are explicit, with future API/UI regression cases.
- **Risks:** The three reported design findings are addressed; A2–A4 remain unconfirmed human gates, and implementation verification remains future work.
- **Verdict:** Ready for human specification re-review; no product/policy approval or runtime verification is implied.

## 📋 Phasing and Implementation Plan

1. Review this decision map and confirm A2–A4. Approve each capability contract separately; no monolithic implementation command should treat this umbrella as one coding task.
2. Land low-coupling foundations independently: creator provenance, company hierarchy, company relationship types, deal types, contact points and company identifiers. Each slice includes its own migrations/API/UI/tests and remains usable without the others.
3. Land classification slices independently: health after its own contract/mapping approval, lifecycle after C1–C2 / A2 confirmation, and renewal after C3 / A3 confirmation. Each has its own mapping version, preview/apply, full API/UI tests and cutover; health waits for neither lifecycle nor renewal. Identifiers support later optional lead-funnel work. Land recency independently after its current interaction/privacy predicates are verified.
4. Integrate/verify #7625, then land deal closure and line-item capabilities independently. Closure needs no consent/provider implementation; lines need no live catalog integration. Land optional company enrichment after identifiers and catalog selection after manual lines; neither delays the standalone foundation.
5. Land permission history after contact points; wire and verify both actual sender paths, review legacy evidence and explicitly activate policy. Country provider packages remain separate future PRs, not deferred missing work inside Phase 1 core.
6. For each approved slice run `om-auto-implement-spec <capability-path>` against the approved target head, referencing this spec PR with `Refs`, and complete that slice's tests/rollback evidence. #7700 stays open until all accepted capabilities and explicit verification criteria are implemented.
