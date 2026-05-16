# Champion CRM — spec comparison and missing-element architecture plan

Status: Slice 2 implemented for PR #1948 follow-up
Scope: compare current `champion_crm` slice with the broad Champion Invest entity profile and the narrowed free-demo scope.

## Executive summary

The current module is a good Slice 0/1 foundation: it is app-local, owns the right core tables, has lead intake, dedup/contact creation, consent/audit/activity side effects, inbox/detail shells, optional AI adapter, and integration tests.

It is not yet a presentable free-demo happy path. The missing part is not another large CRM model dump; it is a small vertical orchestration layer plus a few demo-facing fields/pages/actions:

1. qualify a seeded/inbound lead,
2. create/open a contact and source deal,
3. attach investment + apartment,
4. reserve then sell the apartment through deal stage changes,
5. show Contact 360 with deal, investment, apartment, and timeline.

The broad client spec should be treated as the paid-PoC target model. For the free demo, we should deliberately implement only the narrow path while naming fields and relations so they can grow into the full model.

## Current implementation snapshot

Implemented now:

- module-owned entities: `ChampionLead`, `ChampionContact`, `ChampionDeal`, `ChampionInvestment`, `ChampionApartment`, `ChampionActivity`, `ChampionConsentEvent`, `ChampionAuditEvent`;
- lead intake: `/api/champion-crm/intake`;
- lead list/update CRUD: `/api/champion-crm/leads`;
- backend pages: `/backend/champion-crm/leads`, `/backend/champion-crm/leads/[id]`;
- dedup by email/phone into `ChampionContact`;
- side effects on intake: activity, audit, consent events;
- ACL/setup/search/events/i18n;
- test coverage for 20 approved paths, with some executable contracts documenting missing UI controls.

Current intentional limitation:

- no runtime dependency on core `customers`; current module owns a lightweight `ChampionContact` instead.

## Gap matrix

### Free demo acceptance criteria

| Area | Current | Gap | Decision |
| --- | --- | --- | --- |
| Lead list/detail | Basic inbox/detail exists | needs investment/message/owner visibility, demo seed | extend current pages, do not replace |
| Qualify lead | API can update `qualificationStatus` | no explicit business action, no guaranteed `qualifiedAt`, no timeline label | add a module domain action + API/client island |
| Contact creation/opening | intake creates/matches contact | demo needs explicit “open/create contact from qualified lead” story | reuse existing contact result; add clear links/360 page |
| Deal creation | entity exists, tests can seed | no route/action/page; no deal number/stage semantics | add domain action and deal detail shell |
| Investment | entity exists minimal | lacks slug, price range, demo seed/list/detail | extend minimally for demo |
| Apartment/Unit | entity exists minimal | direct `deal.apartmentId`, no join table; no sell/reserve action | keep direct primary link for demo, add `deal_apartments` foundation in paid-PoC slice |
| Deal pipeline | `status` + nullable `stage` | no controlled demo stages/actions | add demo stage enum and transition service now; full pipeline dictionary later |
| Contact 360 | embedded mini-card in lead detail | no standalone contact 360 | add contact detail page aggregating lead/deal/investment/apartment/activity |
| Activity timeline | entity exists | timeline not consistently written for demo actions | centralize writes in domain action service |
| Company | not implemented | demo acceptance says concept present, optional | add as deferred/minimal PoC foundation; not on critical demo path |
| E2E UI | specs exist | several are contracts, not real button flows | upgrade after action UI lands |

### Broad client spec

| Spec element | Current | Plan |
| --- | --- | --- |
| Lead source/form/idempotency/raw payload/message/investment context | partial | add demo-safe fields: `apiIdempotencyKey`, `formType`, `message`, `investmentId`, `submittedAt`, `receivedAt`; defer lead attachments/interests/geo/device |
| Lead sales status history/contact attempts | partial | add `qualificationStatusChangedAt`, `qualificationHistory`; defer full contact attempt matrix unless PoC selects it |
| Contact multi-email/phone/address/social/sensitive | simplified JSON arrays | keep simplified for demo; full multi-tables are paid-PoC only |
| Contact lifecycle | `lead/prospect/customer/lost/archived` | align `customer` to spec/demo `client` in a backward-safe migration or alias in UI |
| Deal pipeline dictionaries/stage events | absent | demo uses fixed stage enum/action service; paid-PoC adds `deal_pipelines`, `deal_stages_dictionary`, `deal_stage_events` |
| Deal ↔ Apartment M:N | currently direct `apartmentId` | demo uses one primary apartment; paid-PoC adds `ChampionDealApartment` and keeps `deal.apartmentId` as primary/cache |
| Investment rich profile/media/docs/amenities | minimal | add only slug/city/address/descriptionShort/price range for demo; defer rich content |
| Apartment rich fields/price history/media/ROI | minimal | add only `type`, `listPriceGross`, `state/status` mapping for demo; defer rich fields |
| Ownership/ManagementContract | absent | explicitly deferred; ownership starts after paid-PoC won flow is hardened |
| Company/B2B | absent | optional module-owned `ChampionCompany` or core customer adapter later; not required for Anna happy path |
| RODO/scoring/round-robin/webhooks/AI | mostly absent or optional | explicitly deferred; AI remains disabled by default |

## Architecture decisions

### ADR-1: Keep Champion CRM app-local and module-owned for demo/PoC

Use `apps/mercato/src/modules/champion_crm` as the bounded context. Do not wire a heavy dependency to core `customers` in this PR. Cross-module compatibility can be added later through adapter IDs (`externalRefs`, `corePersonId`, `coreCompanyId`) if Champion signs off on PoC.

Rationale: the Champion pipeline, real-estate apartments, and won/reserve side effects are domain-specific. Forcing them into core CRM now would increase regression risk.

### ADR-2: Add a domain action service before adding more UI

Create a module-local service layer, e.g. `lib/demo-flow.ts` or `lib/actions.ts`, responsible for mutations and side effects:

- `qualifyLead(leadId)`
- `createDealFromLead(leadId)`
- `assignApartmentToDeal(dealId, apartmentId)`
- `advanceDealStage(dealId, nextStage)`
- `markDealWon(dealId)`

Each action must write:

- the primary entity change,
- `ChampionActivity`,
- `ChampionAuditEvent`,
- lifecycle/status side effects.

UI and API routes call this service; they should not duplicate business rules.

### ADR-3: Demo stage model now, dictionary pipeline later

For the free demo, use a controlled string enum on `ChampionDeal.stage`:

- `qualified`
- `offer_open`
- `reservation_agreement`
- `won`
- optional `lost`

Map these to UI labels. Add `stageChangedAt` and `wonAt` fields. The full spec pipeline tables are paid-PoC work because they require stage dictionaries, validation, stage events, lost reasons, and reporting semantics.

### ADR-4: One primary apartment now, M:N relation later

The free demo only needs one unit (`A2.14`) attached to one deal. Keep `ChampionDeal.apartmentId` as the primary selected unit for the demo. Design the paid-PoC migration to add `ChampionDealApartment` with `deal_id`, `apartment_id`, `status`, price snapshot, and `is_primary`; then keep `deal.apartmentId` as a denormalized primary/cache if useful.

### ADR-5: Contact 360 is a read model page, not a separate CRM rewrite

Add `/backend/champion-crm/contacts/[id]` that aggregates module-owned contact, leads, deals, investments, apartments, activities, audit/consents. This is enough for demo and remains compatible with a future adapter to core `customers.person`.

## Proposed implementation slices

### Slice 2A — demo data model alignment

Implementation note: Slice 2 kept all schema changes additive. Existing `leadId`, `budgetAmount`, `budgetCurrency`, `priceAmount`, `priceCurrency`, `address`, and `status` fields remain in place; demo-facing aliases/fields were added beside them instead of destructively renaming contracts.

Small additive migration/entity updates:

- Lead: `message`, `investmentId`, `submittedAt`, `receivedAt`, `qualifiedAt` already exists, `qualificationStatusChangedAt`, `qualificationHistory`, optional `apiIdempotencyKey`, `formType`.
- Contact: lifecycle alias/enum should include `client`; optional `notes`.
- Deal: `dealNumber`, `sourceLeadId` (or rename/alias current `leadId` in UI/API), `stageChangedAt`, `valueGross`, `currency`, `wonAt`, `closedAt` already exists.
- Investment: `slug`, `descriptionShort`, `priceMin`, `priceMax`, `currency`, `addressLine1` alias over current `address`.
- Apartment: `type`, `listPriceGross` alias over current `priceAmount`, keep `status` as demo `state`.

### Slice 2B — business action API

Implemented as module-local service `lib/demo-flow.ts` plus resource routes:

- `POST /api/champion-crm/leads/{id}/qualify`
- `POST /api/champion-crm/leads/{id}/convert-to-deal`
- `POST /api/champion-crm/deals/{id}/assign-apartment`
- `POST /api/champion-crm/deals/{id}/stage`
- `POST /api/champion-crm/deals/{id}/win`
- `POST /api/champion-crm/demo/seed`

The server-rendered backend forms call the same service through server actions, so API and UI mutations share side-effect rules.

Add routes under `/api/champion-crm/demo-flow/*` or resource-oriented routes:

- `POST /api/champion-crm/leads/{id}/qualify`
- `POST /api/champion-crm/leads/{id}/convert-to-deal`
- `POST /api/champion-crm/deals/{id}/assign-apartment`
- `POST /api/champion-crm/deals/{id}/stage`
- `POST /api/champion-crm/deals/{id}/win`
- optional `POST /api/champion-crm/demo/seed` for idempotent Anna/Hussar seed.

Prefer resource-oriented routes for PoC longevity; keep `demo/seed` explicitly demo-only.

### Slice 2C — backend UI/client islands

Implemented as lightweight server shells with server-action forms:

- lead detail: qualify and create/open deal;
- deal detail: assign/reserve unit, fixed demo stage buttons, mark won;
- contact detail: Contact 360 read model with leads, deals, investment/unit context, and timeline.

Add server shells plus small client forms/buttons:

- lead detail: qualify button; create/open deal button; links to contact 360 and deal;
- deal detail: current stage, selected investment/unit, stage buttons, win button;
- investments/apartments simple list/detail or embedded selector for the demo seed;
- contact 360: contact header, related leads, deals, selected investment/unit, activity timeline.

### Slice 2D — demo seed

Implemented idempotently for Anna Kowalska, Hussar Loft, and units A2.14, A3.07, B1.03. The seed is exposed via both `seedExamples` and `POST /api/champion-crm/demo/seed`.

Add an idempotent seed command/route for:

- Investment: Hussar Loft, Kraków, selling;
- Apartments: A2.14, A3.07, B1.03;
- Lead: Anna Kowalska with message and source `landing page`;
- optional Company: Champion Invest Demo Partner / developer context.

The seed must be organization/tenant scoped and safe to rerun.

### Slice 2E — tests upgrade

Added TC-CHAMP-CRM-021 for the Anna/Hussar happy path: seed → qualify → create deal → reserve A2.14 → advance stages → win → verify apartment sold, contact lifecycle client/customer-compatible, activity/audit writes, and Contact 360 rendering.

Convert contract placeholders into real UI business path checks once UI actions exist:

- US1 lead inbox/detail;
- US2 qualify lead;
- US3 create/open contact + deal;
- US4 assign apartment/reserve;
- US5 advance stage/win/sold/client;
- US6 contact 360 timeline.

## Explicitly deferred to paid PoC

Do not implement now:

- full core customers synchronization;
- true multi-email/phone/address tables;
- contact sensitive encryption/PII access workflow;
- scoring, round-robin, automation, n8n webhooks;
- deal pipeline dictionaries and stage event analytics;
- deal documents/offers/Authenti/PDF;
- ownership/management contracts;
- dashboards/manager analytics;
- full RODO forget/anonymization;
- AI provider integration beyond disabled adapter seam.

## Recommended next coding task

Slice 2 has been implemented. The next focused slice should harden any demo feedback from manual QA and only then decide whether to add paid-PoC foundations such as deal-apartment M:N or pipeline dictionaries.

Implement Slice 2A + 2B + a minimal Slice 2C for the Anna/Hussar happy path. This is the smallest meaningful increment that makes the PR match the free-demo document without overbuilding the broad spec.

Acceptance gate for the next coding task:

- idempotent demo seed creates Anna/Hussar/A2.14 data;
- from UI: open lead → qualify → create/open deal → assign A2.14 → reserve → advance stages → win;
- contact 360 shows contact, deal, investment, apartment, timeline;
- Playwright targeted Champion CRM scenario passes or documents only environment blockers.
