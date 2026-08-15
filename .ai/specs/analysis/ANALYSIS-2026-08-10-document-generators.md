# Pre-Implementation Analysis: Document Generators (`.ai/specs/2026-08-10-document-generators.md`)

> **Status update (2026-08-15):** all four Critical gaps and the four Important gaps below have since been applied directly to the spec in this same PR (see the spec's 2026-08-15 changelog entries). This report is kept as-is as the point-in-time audit that drove those fixes — read the spec itself for current state, not this report.

## Executive Summary

None of this feature's code exists in this repository yet (it was only copied in as a spec from the unmerged PR #5170); everything below was verified against the *actual* current codebase, not the PR. The spec is unusually mature — Phases 1–6 read as implementation-accurate, the Migration & Backward Compatibility section is thorough, and no new identifier it proposes (ACL feature, event, widget spot, generator-plugin key) collides with anything that exists today. However, four concrete, cheap-to-fix gaps must be closed before implementation starts in this repo: the `TemplateRegistry` singleton doesn't follow this repo's own `globalThis`-persistence convention (two separate lessons in `.ai/lessons.md` describe exactly this failure mode for publishable packages); the new `resource_label` column is a GDPR-relevant cached PII field with no `encryption.ts` declaration, which `packages/core/AGENTS.md` requires; the spec's claim that it reuses an "existing frozen PDF-oriented injection ID" for the order/quote document tab is factually wrong — no such spot exists, only a generic tabs spot currently occupied by an unrelated history widget; and the `/generate` route's persistence side effect doesn't reference this repo's mutation-guard-registry pattern for non-CRUD writes. **Recommendation: needs spec updates first** — none of these require a design rethink, all four are scoped text/contract corrections that should land in the spec before it moves to `om-implement-spec`.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | Widget Injection Spot IDs (§6) | Spec asserts it will inject into an "existing frozen PDF-oriented injection ID" for order/quote detail (spec lines ~524, 671, 780). Verified against the real `packages/core/src/modules/sales/widgets/injection-table.ts:4,12`: the actual spots are `sales.document.detail.order:tabs` and `sales.document.detail.quote:tabs`, and today they hold exactly one entry each — `sales.injection.document-history` (a change-history *timeline*, not a document-generation panel). No PDF-oriented spot exists. | Warning | Rewrite the widget-injection section to name the real spot IDs, state plainly that the new widget is a *new, additive array entry* alongside the existing `sales.injection.document-history` entry (both are `kind: 'tab'`, so they render as separate tabs — this is not a slot collision), and drop the "existing frozen" framing since nothing frozen exists yet for this purpose. |
| 2 | Auto-Discovery Convention Files / generator plugin key (§1, Generator Plugin design decision) | Spec's `generators.ts` plugin uses key `document-generators.templates` (hyphenated). Every real `GeneratorPlugin` in the repo (`packages/webhooks/src/modules/webhooks/generators.ts`: `webhooks.sources`, `webhooks.handlers`; `packages/enterprise/src/modules/security/generators.ts`: `security.mfa-providers`, `sudo`) keys off the module's actual snake_case module id, not a hyphenated package-style prefix. | Warning | Rename the plugin id to `document_generators.templates` to match the module id (`document_generators`) used everywhere else in `Module Structure` and `acl.ts`. |
| 3 | API Route URLs / wire contract with the `attachments` module (Phase 7) | Spec's upload step says `entity_id`/`record_id`. Verified in `packages/core/src/modules/attachments/api/route.ts:94-97,307-308`: the actual multipart/query field names are camelCase, `entityId`/`recordId`. DB columns are snake_case (`data/entities.ts:58-63`) but that's the persistence layer, not the wire contract this spec's upload code will call. | Warning | Fix Phase 7 step 2 to read `entityId`/`recordId`. Low blast radius today since Phase 7 is Not Started, but must be corrected before that phase begins or the upload call will silently no-op the association. |

No Critical (hard-blocking, already-shipped-surface) BC violations were found — expected, since none of this module's surfaces have shipped in this repo yet. The three items above are best read as "the spec's factual claims about existing platform surfaces don't hold," not as rule violations of an already-published contract.

### Missing BC Section

Not missing — `## Migration & Backward Compatibility` (line 782 onward) is present and unusually detailed for an unreleased feature (it correctly reasons through why no deprecation bridge is needed for most items, since nothing has shipped yet, while still adding a real bridge for the one surface — `@open-mercato/document-generators` root exports — that.was briefly a public path).

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---------|--------|---------------|
| Integration Test Coverage (dedicated section) | The spec does not summarize its test coverage in one place — evidence is scattered across Phase-level bullets ("Verification evidence: ..." in Phase 6) and the compliance matrix. This makes it hard to audit "does every API/UI path have a test" without cross-referencing the PR's file list. | Add a table mapping each of the 16 already-existing `TC-DOCUMENT-001` … `TC-DOCUMENT-016` integration specs (confirmed present in PR #5170's file list: templates listing, filter options, preview success/failure, generate success/failure, generation history, template-access RBAC hiding/forbidding for both preview and generate, backend navigation, and the four `*-requires-auth` routes) to the API/UI surface each one covers. The content already exists — this is a low-cost, high-value addition, not new test-writing work. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| Data Contracts → Template Registry | No mention of `globalThis` persistence for the `TemplateRegistry` singleton. Two lessons in this exact repo (`global-registries-in-publishable-packages-must-use-globalthis...md`, `store-global-event-bus-in-globalthis-to-survive-module...md`) describe the identical failure mode: a publishable package's module-local singleton registry goes silently empty when bootstrap and a request/route resolve through different module instances (dev HMR duplication; standalone-app multi-instance loading). The spec's own May-2026 changelog entries mention "globalThis-based dual registry" was once the design, but the current normative Template Registry section (line ~205) doesn't carry that forward. | State explicitly that `templateRegistry` persists via a stable `globalThis` key (module-local variable as fallback only), matching the pattern already used for the event bus and ORM entity registry. |
| Data Contracts / Document Services | No `encryption.ts` / `defaultEncryptionMaps` declaration for `GeneratedDocument.resource_label`. Per `packages/core/AGENTS.md:529`, any GDPR-relevant field a spec adds MUST declare or update the owning module's encryption map. `resource_label` is explicitly described as a customer/company-derived display label (the same class of field `customers/encryption.ts` already encrypts for `customer_entity.display_name`). | Add a `document_generators/encryption.ts` exporting `defaultEncryptionMaps` covering `document_generators:generated_document.resource_label` (no `hashField` needed unless exact-match filtering on the label is required), following the shape at `packages/core/src/modules/customers/encryption.ts` or the `hashField` example at `packages/core/src/modules/auth/encryption.ts:5-9`. |
| API Contracts → `/generate` | No mention of this repo's mutation-guard-registry pattern for non-CRUD writes with side effects (`runMutationGuards`, `bridgeLegacyGuard`, `afterSuccessCallbacks`), documented in `packages/core/AGENTS.md` and used concretely in `packages/core/src/modules/sales/api/quotes/send/route.ts:10-15,44-61,136-148,221-232`. `/generate` persists a `GeneratedDocument` row as a side effect of an otherwise read-shaped POST, which is exactly the shape this pattern exists for. | Add a line to the `/generate` API Contract and Phase 3/5 implementation notes: classify the write as `create` for `runMutationGuards`, collect registered guards plus `bridgeLegacyGuard(container)`, and run `afterSuccessCallbacks` after the history row commits — mirroring the `quotes/send` route. |
| Phase 7 — Attachment Storage | Step 1 says the `pdfDocuments` partition can be "seeded in `setup.ts`." Verified against `packages/core/src/modules/attachments/lib/partitions.ts:14-26,40-59`: the only two partitions today (`productsMedia`, `privateAttachments`) come from a hardcoded `DEFAULT_ATTACHMENT_PARTITIONS` array plus lazy `ensureDefaultPartitions()` — there is no existing DSL letting another module register a new partition from its own `setup.ts`, and a repo-wide grep found zero modules doing this. | Before Phase 7 starts, decide explicitly between (a) creating the partition lazily at runtime via a service call the first time `/generate` needs it (mirroring `ensureDefaultPartitions`'s idempotent-create pattern), or (b) being the first module to `em.create(AttachmentPartition, ...)` directly in `setup.ts` — and get that new precedent reviewed, since no other module does it today. |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| `packages/core/AGENTS.md` Encryption: "When adding GDPR-relevant fields, declare or update the module's `encryption.ts` `defaultEncryptionMaps` export" (line 529) | `GeneratedDocument.resource_label` (spec's new "Persisted History Entity" table) | Add `document_generators/encryption.ts` — see Incomplete Sections above. |
| `packages/core/AGENTS.md` API Routes: custom write routes must use the mutation-guard registry (`runMutationGuards`/`bridgeLegacyGuard`) | `POST /api/document-generators/generate` | Wire the guard pipeline as `sales/api/quotes/send/route.ts` does — see Incomplete Sections above. |
| Root `AGENTS.md` Task Router — global registries / shared runtime singletons convention (reinforced by two `.ai/lessons.md` entries, not a literal AGENTS.md line but a documented, repo-verified failure mode for exactly this kind of publishable-package singleton) | `TemplateRegistry` (Data Contracts) | Persist via `globalThis` with a stable key. |
| Code-review checklist §7 Concurrency: "Is shared mutable state (globals, singletons, module-level caches) safe under concurrent requests... (blocker/major)" | Same `TemplateRegistry` singleton | Same fix — this is the same gap surfaced from the review-checklist angle, reinforcing its severity. |

Everything else checked out clean:
- **Module structure**: `packages/document-generators/` for the plugin, `packages/shared/src/modules/document-generators/` for neutral contracts, `packages/core/src/modules/sales/document-generators/` for Sales' own services/templates — all correctly placed per root `AGENTS.md` "Where to Put Code," and no code is proposed directly under `apps/mercato/src/` outside generated registries.
- **`setup.ts` / `acl.ts`**: `document_generators.documents.view`/`.generate` are additive, non-colliding (confirmed via repo-wide grep across every `acl.ts`), and the spec's compliance matrix already confirms `defaultRoleFeatures` wiring.
- **Zod validation, `findWithDecryption`**: already used correctly per the spec text and confirmed precedent (`QuotesDocumentService`/`OrdersDocumentService` use `findOneWithDecryption`, no raw SQL — the historical raw-SQL workaround was already removed per the spec's own 2026-08-08 changelog entry).
- **API route `metadata` convention** (`requireAuth`/`requireFeatures` per HTTP method, not a top-level `export const requireAuth`): confirmed as the universal pattern (`sales/api/quotes/send/route.ts:30-32`); nothing in the spec text contradicts it, though the spec doesn't show route-level code so this should be double-checked at implementation time.
- **DataTable/CrudForm/`apiCall`/`useGuardedMutation`**: all correctly referenced (Preview/History tables use `DataTable`, download uses `useGuardedMutation`, `Cmd/Ctrl+Enter` is specified).
- **Events/side effects**: no cross-module event coupling proposed in the (now correctly out-of-scope) core spec; the auto-generation-trigger event was moved out of this spec's scope by the prior spec-writing revision, which also avoids introducing an unverified event ID prematurely.
- **Commands / undo**: not applicable — `/generate` and history rows have no update/delete path and no optimistic-locking requirement, since `GeneratedDocument` is read-only history, not a user-editable entity.
- **Design System**: no hardcoded status colors, arbitrary Tailwind sizes, or raw `<button>`/`<svg>` usage appear in the spec's UI/UX description; nothing to flag from spec text alone (verify at implementation/DS-review time as usual).

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `TemplateRegistry` singleton not declared `globalThis`-backed | In dev (HMR/Turbopack module duplication) or a standalone `create-mercato-app` deployment, bootstrap registration and route resolution could hit different module instances, leaving the registry silently empty — templates vanish from `/api/document-generators/templates` with no error, exactly the failure mode both cited lessons describe for this repo's other publishable-package registries (ORM entity registry, event bus). | Persist `templateRegistry` via a stable `globalThis` key, module-local variable as fallback only — same fix already applied to `packages/shared/src/modules/events/factory.ts` and the ORM entity registry. |
| `GeneratedDocument.resource_label` and (later) Phase 7 `Attachment` bytes carry unencrypted customer PII/amounts, with no retention/erasure story | No platform-wide GDPR erasure orchestration exists yet (confirmed: `.ai/specs/enterprise/2026-07-08-gdpr-data-erasure.md` is an unimplemented enterprise spec, and `packages/core/src/modules/attachments` has no `encryption.ts` today). Absent explicit handling, this spec both under-encrypts a field the encryption convention already covers for equivalent columns elsewhere, and adds another surface the eventual GDPR sweep will need to know about. | Close the `resource_label` encryption-map gap now (cheap, in scope). For the broader erasure/retention question, follow this repo's one real shipped precedent — `communication_channels/subscribers/user-deleted-cascade.ts:26-29` soft-preserves rather than hard-deletes on `auth.user.deleted`, deferring to "a future tenant-level GDPR sweep" — and say so explicitly in the spec's Risks section (already partially done in the current revision's "Sensitive Data & Retention" entry; extend it to name this precedent). Treat full erasure wiring as a follow-up once the enterprise erasure module ships, not a blocker for Phases 1–6. |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `/generate`'s history-persistence side effect bypasses the mutation-guard registry | Other write paths in this repo (role/permission changes, workflow interceptors) can hook into `runMutationGuards` for cross-cutting policy; a document-generation route that doesn't participate is invisible to any future guard that should apply to it (e.g. a tenant-level "pause all document generation" kill switch implemented as a guard). | Wire `/generate` through the same pattern as `sales/api/quotes/send/route.ts`. |
| Attachments partition-seeding has no established pattern | Implementer may improvise a solution during Phase 7 that doesn't match how `ensureDefaultPartitions` already handles idempotent lazy creation, risking a parallel, slightly-inconsistent mechanism. | Decide explicitly (lazy runtime creation vs. new `setup.ts` precedent) before Phase 7 starts; documented above. |
| Dual `next.config.ts` CSP directive (`apps/mercato/next.config.ts` + `packages/create-app/template/next.config.ts`) must stay in sync | Already an established, repo-wide requirement (root `AGENTS.md` Template Sync Checklist), not unique to this spec — but worth calling out since the spec explicitly touches this exact file pair. | No new mitigation needed beyond following the existing checklist; the spec already states the requirement correctly. |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Widget spot naming/framing inaccuracy (Warning #1 above) | Low technical risk once corrected — both order and quote `:tabs` spots already support multiple array entries, so adding the new widget alongside `sales.injection.document-history` is additive, not a collision. The risk is purely that an implementer copies the spec's wrong assumption and either invents a new spot ID unnecessarily or fails to find the real one. | Correct the spec text; no code-level fix needed beyond using the real IDs. |
| Generator-plugin key naming drift (`document-generators.templates` vs. `document_generators.templates`) | Cosmetic/consistency risk only — the mechanism works regardless of the key string chosen, but a mismatched convention makes the codebase harder to grep/reason about alongside `webhooks.sources`-style keys. | Rename before implementation. |

## Gap Analysis

### Critical Gaps (Block Implementation)

- **`TemplateRegistry` globalThis persistence**: not specified anywhere in the current spec text; required by two direct repo lessons and the code-review checklist's shared-mutable-state check.
- **`document_generators/encryption.ts`**: entirely absent; required by `packages/core/AGENTS.md:529` for the new `resource_label` GDPR-relevant column.
- **Widget injection spot accuracy**: the spec's core UI mechanism (Section "Widget pattern") rests on a factually wrong premise about a pre-existing spot; must be corrected to the real `sales.document.detail.order:tabs` / `sales.document.detail.quote:tabs` IDs before any widget code is written against it.
- **Mutation-guard-registry integration for `/generate`**: the spec's central write path doesn't reference this repo's required pattern for non-CRUD writes with side effects.

### Important Gaps (Should Address)

- **Attachments wire-contract field names** (`entityId`/`recordId`, not `entity_id`/`record_id`) — scoped to Phase 7, not yet started, but must be fixed before that phase begins.
- **Attachments partition-seeding approach** — no existing precedent for a module creating a new partition from `setup.ts`; needs an explicit decision before Phase 7.
- **Generator-plugin key naming** (`document_generators.templates`) — cheap rename, avoids convention drift.
- **Integration Test Coverage section** — the 16 `TC-DOCUMENT-*` tests already exist per the PR; the spec should summarize them in one table rather than leaving coverage evidence scattered.

### Nice-to-Have Gaps

- **Attachments module's own lack of an `encryption.ts`** — a genuine platform-level gap (stored file bytes/filenames are unencrypted at rest today), but it predates and exceeds this spec's remit; worth flagging as a candidate follow-up spec rather than solving here.
- **Explicit GDPR-erasure forward-reference** — naming `communication_channels/subscribers/user-deleted-cascade.ts` as the soft-preserve precedent to follow once/if a tenant-level erasure sweep is built, so a future implementer doesn't have to rediscover it.

## Remediation Plan

### Before Implementation (Must Do)

1. **Persist `TemplateRegistry` via `globalThis`**: add a stable `globalThis` key as the canonical reference, module-local variable as fallback only, matching `packages/shared/src/modules/events/factory.ts`'s pattern.
2. **Add `document_generators/encryption.ts`**: declare `defaultEncryptionMaps` for `GeneratedDocument.resource_label`, following `packages/core/src/modules/customers/encryption.ts`'s shape (no `hashField` unless exact-match lookups on the label are needed).
3. **Correct the widget-injection section**: name the real spot IDs (`sales.document.detail.order:tabs`, `sales.document.detail.quote:tabs`), state the new widget is an additive array entry alongside the existing `sales.injection.document-history` entry, and drop the "existing frozen" framing.
4. **Wire `/generate` through the mutation-guard registry**: classify the write as `create`, collect guards plus `bridgeLegacyGuard(container)`, run `afterSuccessCallbacks` post-commit — mirror `packages/core/src/modules/sales/api/quotes/send/route.ts`.

### During Implementation (Add to Spec)

5. Fix Phase 7's attachment field names to `entityId`/`recordId`.
6. Decide and document Phase 7's partition-creation approach (lazy runtime vs. new `setup.ts` precedent) before writing that phase's code.
7. Rename the generator-plugin key to `document_generators.templates`.
8. Add an "Integration Test Coverage" table mapping the 16 existing `TC-DOCUMENT-*` specs to their API/UI surface.

### Post-Implementation (Follow Up)

9. Once the enterprise `data_erasure` module (`.ai/specs/enterprise/2026-07-08-gdpr-data-erasure.md`) ships, revisit `GeneratedDocument.resource_label` and Phase 7 `Attachment` rows for inclusion in its erasure ledger (that spec's own design already targets "id + masked label, never plaintext" for exactly this kind of cached display field).
10. Consider a separate, platform-wide follow-up spec for encryption-at-rest of `attachments` file bytes/metadata — out of scope here, but Phase 7 will otherwise store full-PII PDFs through a module that has no encryption map at all today.

## Recommendation

**Needs spec updates first.** All four Critical gaps are scoped, mechanical corrections (a `globalThis` persistence note, an `encryption.ts` stub, a widget-spot-ID correction, and a reference to an existing route pattern) rather than open design questions — this spec does not need a major revision, but it should not move to `om-implement-spec` until items 1–4 in the Remediation Plan are reflected in the spec text.
