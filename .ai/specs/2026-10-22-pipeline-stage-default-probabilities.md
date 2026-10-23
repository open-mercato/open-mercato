# Pipeline stage default probabilities

## TLDR

Each CRM pipeline gets an opt-in checkbox, **"Use default stage probabilities"**. When it is enabled, every stage of that pipeline can carry a default win probability (0–100%). Whenever a deal moves into a stage — Kanban drag & drop, a plain API call, the deal detail stepper, the deal edit form, bulk stage change, the AI stage tool, or closing a deal as won/lost — the deal's `probability` is set to that stage's default. The value stays an ordinary deal field: users can override it at any time and the override sticks until the deal changes stage again.

## Overview

- **Module:** `customers` (deals, pipelines, pipeline stages)
- **Edition:** OSS
- **Related specs:** `2026-07-02-customers-deals-kanban-card-quick-actions.md`, `2026-07-02-deal-create-initial-values.md`, `2026-09-24-crm-deal-owner-assignment.md`
- **Related issue context:** #4329 (the quick-add dialog's hard-coded `probability: 25` overriding pipeline automation)

## Problem Statement

`CustomerDeal.probability` is entered by hand. Sales teams usually tie the probability to the pipeline stage (Qualification 10%, Proposal 40%, Negotiation 70%, …). The create sidebar even tells users to do this by hand (`DealCreateSidebar` hint). Because nothing updates the number when a deal moves, weighted pipeline values drift: a deal dragged from *Qualification* to *Negotiation* keeps its 10%.

## Proposed Solution

1. **Pipeline flag:** `customer_pipelines.stage_probabilities_enabled boolean not null default false`.
2. **Stage default:** `customer_pipeline_stages.default_probability int null`, range 0–100. `null` means "no default for this stage".
3. **Server-side rule (single source of truth)** in `createDealCommand` and `updateDealCommand`:
   - The rule applies when the deal **enters a stage**. On update, that means the resolved `pipelineStageId` differs from the previous one; this covers explicit stage changes and the terminal-stage move triggered by won/lost closure. On create, any initial stage counts.
   - …and the request did **not** send `probability`. An explicit value always wins, so it acts as the user override.
   - …and the target stage's pipeline has `stageProbabilitiesEnabled = true` and the stage has a non-null `defaultProbability`.
   - Then `deal.probability = stage.defaultProbability`.
4. **Client prefill in forms.** The deal edit form (`DealForm`) and the create form (`CreateDealForm`) send `probability` explicitly, so the server rule alone would not fire. When the user picks a stage in these forms, the form copies that stage's default into the Probability field, where the user sees it and can still edit it before saving. The Kanban quick-add dialog pre-fills the lane's stage default instead of the hard-coded 25% when the pipeline has defaults enabled.
5. **Settings UI.** Both pipeline management surfaces get the same controls:
   - the *Customers → Configuration* accordion (`components/PipelineSettings.tsx`)
   - *Settings → Pipeline stages* (`backend/config/customers/pipeline-stages/page.tsx`)

   The changes on each surface:
   - The pipeline dialog gets a "Use default stage probabilities" checkbox.
   - When the flag is on, the stage dialog gets a "Default probability (%)" number input, and the stage list shows each stage's default as a `NN%` badge.

### Design decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | The rule lives in the commands, not in each UI | Kanban drag, the stepper, bulk stage updates, the AI tool, and third-party API callers all go through `customers.deals.update`. A single implementation keeps them consistent. |
| D2 | An explicit `probability` in the request wins | This is how a user override works. It also keeps backward compatibility: existing clients that send `probability` behave exactly as before. |
| D3 | Applies on any stage entry (forward, backward, or closure), not only "next stage" | Moving back from *Negotiation* to *Qualification* should also lower the probability. *Won*/*Lost* terminal stages typically carry 100/0. |
| D4 | Re-saving a deal without a stage change never resets probability | The override stays until the next stage change. |
| D5 | Disabling the flag keeps stored stage defaults but stops applying them | Toggling the flag off and on again loses no configuration. |
| D6 | Changing a stage default does not rewrite existing deals | No surprise mass updates. Deals pick up the new default on their next stage entry. |
| D7 | Kanban "Add stage" dialog is out of scope | Its default probability is set in the settings surfaces (follow-up candidate). |

## Architecture

```
PUT /api/customers/deals {id, pipelineStageId}           (Kanban / stepper / API / bulk worker / AI tool)
  └─ customers.deals.update
       phase 1 (reads): resolve next stage snapshot  ──► load CustomerPipeline(stage.pipelineId)
                         → stageDefaultProbability = pipeline.stageProbabilitiesEnabled ? stage.defaultProbability : null
       phase 2 (writes): if stageEntered && parsed.probability === undefined && stageDefaultProbability != null
                         → record.probability = stageDefaultProbability
```

- A new helper, `lib/stageDefaultProbability.ts` → `resolveStageDefaultProbability(em, { stageId, tenantId, organizationId })`, returns the effective default: `null` when the pipeline flag is off or the stage has no default. Both lookups are tenant/org scoped.
- All reads stay in the read phase of `runCrudCommandWrite` / `withAtomicFlush`. No read happens between scalar mutation and flush (SPEC-018).
- Undo needs no change. `DealSnapshot` already captures `probability`, and the undo path restores it.

## Data Models

```ts
// CustomerPipeline
@Property({ name: 'stage_probabilities_enabled', type: 'boolean', default: false })
stageProbabilitiesEnabled: boolean = false

// CustomerPipelineStage
@Property({ name: 'default_probability', type: 'int', nullable: true })
defaultProbability?: number | null
```

Migration (`Migration20261022120000_customers`), additive only. The module snapshot is updated to match:

```sql
alter table "customer_pipelines" add column "stage_probabilities_enabled" boolean not null default false;
alter table "customer_pipeline_stages" add column "default_probability" int null;
```

## API Contracts

All changes are additive. Field names are optional on write and always present on read.

| Endpoint | Change |
|----------|--------|
| `GET /api/customers/pipelines` | item gains `stageProbabilitiesEnabled: boolean` |
| `POST/PUT /api/customers/pipelines` | optional `stageProbabilitiesEnabled: boolean` |
| `GET /api/customers/pipeline-stages` | item gains `defaultProbability: number \| null` |
| `POST/PUT /api/customers/pipeline-stages` | optional `defaultProbability: int 0..100 \| null` (`null` clears) |
| `GET /api/customers/deals/:id` | each `pipelineStages[]` item gains `defaultProbability: number \| null` (seeds the edit form) |
| `POST/PUT /api/customers/deals` | No schema change. When `probability` is omitted and the deal enters a stage with an effective default, the response record and the persisted row carry that default. |

## UI

- **Pipeline dialog:** a checkbox labelled "Use default stage probabilities", with the help text "Automatically set a deal's probability when it moves to a stage."
- **Stage dialog:** a "Default probability (%)" number input (0–100, can be empty), shown only when the pipeline flag is on.
- **Stage list:** a `NN%` badge (neutral `bg-muted text-muted-foreground`, no status colors) next to the stage label when the flag is on and a default is set.
- **DealForm / CreateDealForm:** when the stage selection changes and the stage has an effective default, set the Probability field to that default.
- **Kanban quick-add dialog:** when the lane's stage has an effective default, use it as `defaultProbability`. Otherwise keep the existing 25.
- All strings go through i18n (`customers.pipelines.form.stageProbabilities*` and `customers.pipelines.stageForm.defaultProbability*`) in `en`, `pl`, `de`, `es`, and `ko`. Both settings surfaces share these keys.

## Integration Test Coverage

`__integration__/TC-CRM-STAGE-PROB-001-stage-default-probabilities.spec.ts` (API, self-contained fixtures):

1. A pipeline created with `stageProbabilitiesEnabled: true` and stages with defaults (20, 60) round-trips through GET.
2. Creating a deal in stage A without `probability` gets 20.
3. `PUT {id, pipelineStageId: B}` (the Kanban/stepper payload) sets probability to 60.
4. `PUT {id, probability: 33}` with no stage change keeps 33 (the override).
5. `PUT {id, pipelineStageId: A, probability: 45}` keeps 45 (explicit value wins).
6. With the pipeline flag disabled, a stage move keeps the deal's probability unchanged.

Unit tests:

- `commands/__tests__/deals.stage-default-probability.test.ts`: the command rule (10 cases). It covers enabled/disabled, forward and backward moves, explicit override, no stage change, a null default, won-closure terminal stage, and the create seed.
- `data/__tests__/pipelineStageProbabilitySchemas.test.ts`: validator tests for the new fields' ranges.
- `components/__tests__/PipelineSettings.test.tsx`: the flag payload, the stage default input and badge, and that both stay hidden when the flag is off.
- `backend/config/customers/pipeline-stages/__tests__/page.test.tsx`: both checkboxes are shared `Checkbox` primitives.

Browser verification: the settings UI, Kanban drag, the deal detail stepper, and the deal edit form.

## Backward Compatibility

- DB: two additive columns with safe defaults (flag `false`, so the feature is off for every existing pipeline).
- API: additive optional request fields and additive response fields.
- Behavior: unchanged unless a pipeline opts in.
- No event ID, ACL feature, widget spot, or DI changes.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|------|----------|-----------|----------|
| API clients that always send the full deal (including a stale `probability`) never get the auto value | Low | Documented in D2. Omitting `probability` opts in. | Accepted |
| Extra `findOne(CustomerPipeline)` per stage change | Low | Runs only when a stage snapshot is resolved. One primary-key lookup. | Negligible |
| Kanban card shows the stale probability until refetch | Low | The board already invalidates lane queries after a move. | None |
| Bulk stage update overwrites hand-tuned probabilities on many deals | Medium | Intended semantics (stage entry = default). Only active for opted-in pipelines. | Accepted |

## Final Compliance Report

- Tenant scoping: the pipeline lookup is scoped by `tenantId`/`organizationId` of the stage.
- Commands: all writes go through existing commands. Undo is preserved through the deal snapshot.
- Optimistic locking: the existing headers are untouched. New fields ride the existing PUTs.
- i18n: no hard-coded strings. DS: no status colors and no arbitrary values.

## Changelog

- 2026-10-22: Initial spec and implementation.
  - Verified in an isolated Docker dev stack (`om-contrib3`).
  - Unit, validator, and component suites pass. The full customers suite is green, except the encryption-env-dependent `listSearchAndDates` test, which passes with `TENANT_DATA_ENCRYPTION=false`.
  - `TC-CRM-STAGE-PROB-001` passes.
  - Browser checks passed: both settings surfaces, Kanban drag (10% → 50%), deal header stage switch (→ 75%), and edit-form prefill (30%) with a manual override (42%) persisting.
