# Architectural Review: CRM Call Transcriptions

## Summary

The spec is directionally strong: the provider boundary, many-to-many participant model, and unmatched inbox are all sensible for the product problem. It is not ready to implement as written, though, because several key sections assume contracts that do not exist in the current codebase or point at the wrong runtime surfaces.

The most important blockers are: the transcript ACL story currently leaks through the attachments library path, the retroactive-match subscriber is wired to nonexistent customer event IDs, the timeline plan uses response enrichers for query rewriting even though enrichers are additive-only, and the encryption plan does not match the actual module encryption contract.

## Findings

### Critical

1. **Transcript content would leak through the existing attachments library path**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:650-652`, `:736-763`, `:797`, `:831-835`
   - Current code: `packages/core/src/modules/attachments/api/library/route.ts:30-32`, `:124-137`; `packages/core/src/modules/attachments/components/AttachmentLibrary.tsx:742-789`
   - The spec relies on `<AttachmentLibrary partition="customer-call-recordings" readOnly>` and claims `customers.call_transcripts.view` controls transcript reads. In reality, `AttachmentLibrary` accepts no props, fetches the global `/api/attachments/library` endpoint, and that endpoint returns `content` for every attachment to anyone with `attachments.view`. As written, transcript text would be readable even without the new CRM transcript feature.
   - Fix: define a transcript-specific read path or tighten the attachments library contract before implementation. The spec needs an explicit decision on whether transcript content is served via customers APIs, a scoped attachment detail endpoint, or a new attachment capability gate.

### High

2. **Retroactive matching subscriber listens to event IDs that do not exist**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:238-250`, `:291-296`, `:606-609`
   - Current code: `packages/core/src/modules/customers/events.ts:8-12`
   - The spec subscribes to `customers.customer_person_profile.created` / `.updated`, but the customers module currently publishes `customers.person.created` / `.updated`. If implemented from the spec, backfill would never run.
   - Fix: update the spec to the real event IDs or explicitly add new bridge events if that is intentional.

3. **The timeline-union plan uses response enrichers for query rewriting, but enrichers cannot rewrite queries**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:256-258`, `:677-679`, `:906`
   - Current contract: `packages/shared/src/lib/crud/response-enricher.ts:8-10`, `:46-50`
   - The spec says a response enricher will widen the interactions list `$or` filter in timeline context. Response enrichers run after list fetching and are additive-only, so they cannot change which interactions are returned.
   - Fix: move this plan to an API interceptor that rewrites `query.ids`, or specify direct route/query changes in `api/interactions/route.ts`.

4. **The encryption plan does not match the actual encryption contract**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:455-470`
   - Current contract: `packages/shared/src/modules/encryption.ts:1-8`; current customers example: `packages/core/src/modules/customers/encryption.ts:1-71`
   - The spec uses `{ partitionCode, columns }` for attachments and `{ entity, columns }` for participants, but the real contract is `defaultEncryptionMaps: { entityId, fields: [{ field }] }[]`. There is also no existing `packages/core/src/modules/attachments/encryption.ts` file to extend. As written, the encryption section cannot be implemented verbatim and risks shipping transcript/participant PII unencrypted.
   - Fix: rewrite the spec against the real encryption map shape and explicitly decide whether attachment encryption is driven by entity fields, partition-aware logic, or a new attachment-module extension point.

### Medium

5. **The search story is underdefined and conflicts with current privacy guidance**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:60`, `:797`, `:804`, `:835`, `:926`
   - Current code: `packages/core/src/modules/customers/search.ts:589-620`
   - The spec says transcripts are fulltext-indexed and searchable, but the current customers search config does not index `customers:customer_interaction`, and the attachments module has no search config at all. Separately, the review checklist warns against indexing sensitive fields without an explicit policy. Right now the spec promises search behavior without defining the indexing owner, result entity, or privacy boundary.
   - Fix: add a concrete search design section: which entity is indexed, what fields are searchable, what is excluded from presenters/snippets, and how transcript privacy is preserved.

6. **The shared provider contract exports `unknown`-based public types**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:101-128`
   - The proposed `ProviderCtx.credentials: Record<string, unknown>` and `providerMetadata?: Record<string, unknown>` are exported from `packages/shared`, which violates the repo’s review guidance against exporting `unknown`/`any` from shared packages.
   - Fix: replace these with a typed JSON value helper, a generic parameter, or a narrower serializable metadata type.

7. **The spec assumes an existing interaction detail page and `translations.ts`, but neither is present in the current customers module**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:627`, `:732`, `:904`
   - Current repo state: `packages/core/src/modules/customers/backend/` contains people, companies, and deals pages only; `packages/core/src/modules/customers/translations.ts` is absent.
   - Fix: either define a new interaction detail page in the spec or point the UI work at existing person/company/deal detail surfaces. Also update the i18n/translatable-fields plan to reflect that `translations.ts` must be created, not merely amended.

## Recommendation

**Needs spec updates first.** I would not start implementation until the ACL/attachment access model, retroactive-match event IDs, timeline query strategy, and encryption contract are corrected in the document. Once those are fixed, the rest of the design looks implementable.

---

## Re-Check (2026-04-22)

I re-reviewed the revised spec after the author marked all findings as addressed.

### Still Open

1. **Subscriber event IDs are still inconsistent in the spec**
   - Fixed in one place: `.ai/specs/2026-04-21-crm-call-transcriptions.md:273-275`
   - Still wrong later: `.ai/specs/2026-04-21-crm-call-transcriptions.md:816-819`
   - The document now correctly says the backfill subscriber should listen to `customers.person.created` / `customers.person.updated`, but the later Subscribers section still uses the old nonexistent `customers.customer_person_profile.*` names. This needs one cleanup pass or implementation will be ambiguous.

2. **Timeline query strategy is still inconsistent in the UI section**
   - Corrected architecture/API plan: `.ai/specs/2026-04-21-crm-call-transcriptions.md:302-320`, `:732-743`
   - Stale old text remains: `.ai/specs/2026-04-21-crm-call-transcriptions.md:893-895`
   - The spec now correctly replaces response enrichers with a dedicated route / interceptor approach, but later the UI section still says to use a “participant-union response enricher.” That contradicts the earlier correction and should be removed.

3. **Old interaction-detail-page / AttachmentLibrary text still remains in the architecture block**
   - Corrected UI plan: `.ai/specs/2026-04-21-crm-call-transcriptions.md:837-868`
   - Stale architecture text remains: `.ai/specs/2026-04-21-crm-call-transcriptions.md:401-418`
   - The revised spec correctly says there is no interaction detail page in v1 and transcript rendering should go through the new CRM-owned transcript route, but the architecture diagram still describes the removed interaction detail page and `<AttachmentLibrary>` approach. That stale block should be updated so the document tells one story.

### Fixed Well Enough

1. **ACL leak via attachments library**
   - Addressed by the dedicated transcript route: `.ai/specs/2026-04-21-crm-call-transcriptions.md:686-725`

2. **Encryption contract mismatch**
   - Rewritten against the real `ModuleEncryptionMap` shape: `.ai/specs/2026-04-21-crm-call-transcriptions.md:519-555`

3. **Search story underdefined**
   - Now has a concrete indexing plan: `.ai/specs/2026-04-21-crm-call-transcriptions.md:561-633`

4. **Shared `unknown`-style contract looseness**
   - Improved by introducing typed JSON and generic credentials: `.ai/specs/2026-04-21-crm-call-transcriptions.md:103-167`

5. **Missing `translations.ts` / nonexistent interaction detail page assumption**
   - Explicitly corrected: `.ai/specs/2026-04-21-crm-call-transcriptions.md:837-868`, `:948-956`

### Updated Recommendation

**Much improved, but still needs one consistency cleanup pass before I would call all findings closed.** The major architectural problems are mostly addressed, but the spec still contains contradictory leftover text in a few sections.

---

## Re-Check 2 (2026-04-22)

I re-ran the review against the current spec revision and cross-checked the remaining questionable parts against the live customers module contracts.

### Findings

1. **The subscriber section still references nonexistent event IDs**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:816-819`
   - Current code: `packages/core/src/modules/customers/events.ts:10-12`
   - The spec correctly switched to `customers.person.created` / `customers.person.updated` in the retroactive-matching section, but the later Subscribers section still says `customers.customer_person_profile.created` / `.updated`. The actual customers module only declares `customers.person.created` and `customers.person.updated`, so the document is still internally inconsistent here.

2. **The architecture block still describes the removed interaction detail page and `AttachmentLibrary` approach**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:401-418`
   - Corrected plan elsewhere: `.ai/specs/2026-04-21-crm-call-transcriptions.md:839-868`
   - The spec now correctly says there is no interaction detail page in v1 and transcript content should render inline on Person / Company / Deal pages via a customers-owned route. But the architecture diagram still describes an “Interaction detail page” with `<AttachmentLibrary partition="customer-call-recordings">`. That stale block now contradicts the corrected UI plan.

3. **The UI section still reintroduces the old response-enricher design**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:893-895`
   - Corrected plan elsewhere: `.ai/specs/2026-04-21-crm-call-transcriptions.md:302-320`, `:732-743`
   - Earlier in the document, the spec correctly replaced the “response enricher widens the query” idea with a dedicated timeline route plus an optional interceptor. But later the UI section still says: “Modify the existing timeline data source to use the participant-union response enricher.” That wording is still wrong for the current architecture.

4. **The new timeline route uses an ACL feature that does not exist**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:312`
   - Current code: `packages/core/src/modules/customers/acl.ts:1-19`
   - The route ACL is written as `requireFeatures: ['customers.view', 'customers.interactions.view']`. There is no `customers.view` feature in the customers module ACL. The module defines granular view permissions such as `customers.people.view`, `customers.companies.view`, `customers.deals.view`, and `customers.interactions.view`. As written, the route guard cannot be implemented verbatim.

5. **The UI test plan still targets the removed interaction detail page**
   - Spec: `.ai/specs/2026-04-21-crm-call-transcriptions.md:1067-1069`
   - Corrected UI plan: `.ai/specs/2026-04-21-crm-call-transcriptions.md:839-843`
   - The UI tests still say “Interaction detail: Transcript tab…” and similar flows for a dedicated interaction detail page. But the current plan explicitly says there is no interaction detail page in v1 and transcript UI lives inline on existing Person / Company / Deal timelines. The test plan needs to be updated to match the real surface area.

### What Looks Fixed

1. **Transcript ACL model**
   - The dedicated customers-owned transcript route is now spelled out: `.ai/specs/2026-04-21-crm-call-transcriptions.md:686-725`

2. **Encryption contract**
   - The document now uses the real `ModuleEncryptionMap` shape: `.ai/specs/2026-04-21-crm-call-transcriptions.md:519-555`

3. **Shared provider typing**
   - The shared provider contract is materially cleaner and typed with `JsonValue`: `.ai/specs/2026-04-21-crm-call-transcriptions.md:103-167`

4. **Search design**
   - The indexing/search story is now concrete enough to implement: `.ai/specs/2026-04-21-crm-call-transcriptions.md:561-633`

### Updated Recommendation

**Improved, but still not fully consistent.** I would treat the major architectural concerns as mostly addressed, but I would still want one more cleanup pass before considering the review closed. The remaining issues are now mainly contradictions between corrected sections and stale older text.

---

## Re-Check 3 (2026-04-22)

I re-ran the review again after the latest spec edits, focusing on the previously open inconsistencies: wrong subscriber event IDs, stale interaction-detail-page text, stale response-enricher wording, the nonexistent `customers.view` ACL feature, and the stale UI test plan.

### Findings

No new findings from the previously reported set.

The spec now consistently reflects the corrected design:

1. **Subscriber event IDs are fixed**
   - Operative subscriber section now uses `customers.person.created` / `customers.person.updated`: `.ai/specs/2026-04-21-crm-call-transcriptions.md:828-835`

2. **Architecture block is aligned with the inline timeline design**
   - The old interaction-detail-page / `AttachmentLibrary` model is gone from the architecture block: `.ai/specs/2026-04-21-crm-call-transcriptions.md:404-418`

3. **Timeline query strategy is aligned with the dedicated route**
   - The spec now consistently describes the timeline source as `GET /api/customers/interactions/timeline` and explicitly says this is not a response enricher: `.ai/specs/2026-04-21-crm-call-transcriptions.md:302-320`, `:911`

4. **The nonexistent `customers.view` ACL reference is fixed**
   - The timeline route ACL now uses `customers.interactions.view` plus the per-subjectKind feature: `.ai/specs/2026-04-21-crm-call-transcriptions.md:312`, `:753`

5. **The UI test plan now targets the real inline UI surface**
   - The Playwright plan now tests Person / Company / Deal timeline behavior and `<CallTranscriptCard>` rather than a removed interaction detail page: `.ai/specs/2026-04-21-crm-call-transcriptions.md:1084-1095`

### Residual Risk

At this point the document looks materially consistent with my earlier review comments. I did not find another unresolved contradiction from that previous set during this rerun. Any further review would be a fresh architectural pass rather than a re-check of the already reported issues.
