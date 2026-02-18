# SPEC-028: Multiple Sales Pipelines (Deals)
**Author:** @itrixjarek 
**Status:** Draft 
**Date:** 2026-02-16 
**Related Issue:** #561

## Overview
This spec introduces support for **multiple sales pipelines** in CRM Deals:
- First-class `Pipeline` entity
- Pipeline-specific `PipelineStage` entities
- Deal assignment to `(pipelineId, pipelineStageId)`
- Stage configuration UI in **Settings > Customers > Pipeline stages**
- A direct link to Pipeline stages settings from the Deals Kanban view
- Default pipelines/stages seeded in the `yarn mercato init` example data seeding

## Problem Statement
Deals currently expose only a single stage field (`pipelineStage`), which effectively results in a single default pipeline. This blocks real-world CRM usage where companies require distinct sales motions (e.g., New Business vs Renewals, Partnerships vs Direct Sales, different product lines) each with different stages and board columns.

We need:
1) Multiple pipelines
2) Configurable stages per pipeline
3) Deal create/edit to select pipeline + stage
4) Kanban to switch pipeline
5) Safe migration from the current `pipelineStage`
6) Example data seeding that produces a usable pipeline out of the box

## Business Value & Real-World Use Cases

### Why this matters
- Sales teams need different processes for different sales motions. A single stage list forces teams to “mentally translate” stages, which reduces adoption and data quality.
- Multiple pipelines improve clarity (right stages for the right motion) and enable cleaner reporting per motion later.

### Use cases (examples)
1) **New Business vs Renewals**
   - New Business: Qualify → Discovery → Demo → Proposal → Negotiation → Won/Lost
   - Renewals: Health Check → Renewal Offer → Negotiation → Won/Lost

2) **Direct Sales vs Partnerships**
   - Direct Sales pipeline stages differ from partnership lifecycle milestones.

3) **Multiple Product Lines**
   - Standard sales vs custom solutions (requires engineering/review stages).

## Proposed Solution

### Core concepts
- **Pipeline**: named sales process (e.g., "New Business", "Renewals")
- **PipelineStage**: stage inside a pipeline (e.g., "Discovery", "Proposal", "Won")
- **Deal** belongs to exactly one pipeline and one pipeline stage

## User Stories
- As a sales manager, I want separate pipelines (e.g., New Business vs Renewals) so my team sees only relevant stages.
- As an admin, I want to configure stages per pipeline so the board reflects our real process.
- As a sales rep, I want to select pipeline + stage when creating a deal so it is categorized correctly from the start.
- As a user, I want the Kanban board to switch pipelines so I can focus on one sales motion at a time.

### MVP definition of done
1) **Pipeline + Stage configuration**
   - Admin can manage pipelines and stages
   - Stages configurable in **Settings > Customers > Pipeline stages**
   - Deletion rules (MVP): block deleting a pipeline when it contains active deals

2) **Deal create/edit**
   - Pipeline selector
   - Stage selector filtered by pipeline
   - Defaults: default pipeline + first stage

3) **Deals board & list**
   - Kanban: switch pipeline (tabs or dropdown), columns reflect selected pipeline stages
   - Kanban: link to **Settings > Customers > Pipeline stages**
   - List: pipeline filter and/or pipeline column

4) **Seeding**
   - `yarn mercato init` example data seeding must create a default pipeline and default stages

## Architecture
Primary ownership: Customers/Sales (CRM) domain.
Pipelines & stages should follow existing tenant/org scoping and module patterns.

UI entrypoint:
- Settings > Customers > Pipeline stages
- Link from Deals Kanban to Pipeline stages settings

## Data Models

### Pipeline
Fields:
- `id` (uuid)
- `tenantId`, `organizationId`
- `name` (string)
- `isDefault` (boolean)
- `createdAt`, `updatedAt`

Constraints:
- Exactly one default pipeline per org (enforced)
- Deleting pipeline with active deals is blocked in MVP

### PipelineStage
Fields:
- `id` (uuid)
- `tenantId`, `organizationId`
- `pipelineId` (FK -> Pipeline)
- `label` (string)
- `order` (int)
- `createdAt`, `updatedAt`

Constraints:
- `order` unique within a pipeline (or stable ordering via reorder operation)

### Deal changes
Add:
- `pipelineId` (FK -> Pipeline)
- `pipelineStageId` (FK -> PipelineStage)

Integrity:
- `pipelineStageId` must belong to `pipelineId`

Notes:
- Deal-level `probability` (“Probability (%)”) already exists and stays deal-specific.
- Stage-level probability defaults are out of scope for MVP.

## API Contracts (high-level)
Exact routes should follow existing CRUD/command conventions.

### Pipelines
- list / create / update / delete
- enforce a single default pipeline per org

### Pipeline stages
- list by pipeline
- create / update / delete
- reorder stages within pipeline

### Deals
- create/update accepts `pipelineId` + `pipelineStageId`
- validate stage belongs to pipeline



## UI/UX (screen-by-screen)

### Settings > Customers > Pipeline stages
- Pipeline selector (dropdown).
- Stage list for selected pipeline: add / rename / reorder / delete.
- Reorder via drag&drop or simple controls (implementation choice).
- Deletion rules: block deleting a pipeline with active deals (MVP); stage deletion policy TBD.
- Pipelines can be created/renamed and set as default in the same Settings area (either on the same screen or a dedicated subpage).

### Deals: Create/Edit
- Add **Pipeline** selector.
- **Stage** dropdown filtered to stages of selected pipeline.
- Defaults: org default pipeline + first stage.
- Validation: prevent saving if stage does not belong to pipeline.

### Deals: Kanban
- Pipeline switcher (tabs or dropdown).
- Columns reflect stages of selected pipeline.
- Add a link/button: “Manage pipeline stages” → Settings > Customers > Pipeline stages.

## Acceptance Criteria & QA (high-level)

1) Given an admin user, when creating a pipeline with stages, then the pipeline and its stages are persisted and visible in Settings.
2) Given multiple pipelines exist, when creating a deal, then the pipeline defaults to the org default pipeline and stage defaults to its first stage.
3) Given a user changes pipeline on the deal form, when pipeline changes, then stage dropdown updates to stages of the selected pipeline and auto-selects the first stage.
4) Given a deal belongs to pipeline A, when opening Kanban for pipeline B, then the deal is not shown and columns match pipeline B stages.
5) Given Kanban pipeline switcher, when switching pipelines, then columns update and stage counts reflect the selected pipeline.
6) Given a pipeline has active deals, when attempting to delete it, then deletion is blocked (with a helpful error).
7) Given an invalid combination (pipelineId + pipelineStageId from another pipeline), when saving via UI/API, then the request is rejected.
8) Given a fresh environment created via `yarn mercato init`, then a default pipeline and default stages exist and the Kanban is usable without manual setup.


## Configuration
No new env vars required.

## Alternatives Considered
1) Encode pipeline into the stage string (`sales:qualified`) — rejected: weak UX, no real pipeline management.
2) Separate board views independent of pipeline — rejected for MVP: adds complexity; stages already define columns.
3) Stage-level probability defaults — deferred: deal already has deal-level `probability`.

## Implementation Approach (suggested phases)
Phase 1: Data model + migrations + validation  
Phase 2: Settings UI (Pipeline stages)  
Phase 3: Deals create/edit + Kanban pipeline switch + settings link  
Phase 4: `yarn mercato init` example data seeding (default pipeline + stages)  
Phase 5: Integration tests + QA scenarios  

## Migration Path
1) Create a Default Pipeline per org.
2) Create stages in Default Pipeline matching existing `pipelineStage` values.
3) For each deal:
   - set `pipelineId` to Default Pipeline
   - map `pipelineStage` → `pipelineStageId`
4) Keep backward compatibility only if needed temporarily.

## Success Metrics
- Admin can create 2+ pipelines with different stages.
- User can create/edit a deal and select pipeline + stage.
- Kanban can switch pipelines and show correct columns.
- Settings > Customers > Pipeline stages is usable.
- Fresh `yarn mercato init` environment includes default pipeline + stages.

## Open Questions
- Define “active deals” for deletion blocking (exclude Closed Won/Lost?). Proposal: treat deals as active unless stage is Closed Won/Lost.
- Stage deletion rules: block deletion if used by any deal (preferred) vs enforce reassignment.

## Changelog
### 2026-02-16
- Initial spec for multiple sales pipelines with configurable stages
- UI location aligned: Settings > Customers > Pipeline stages + link from Kanban
- Added requirement: seed default pipeline + stages via `yarn mercato init` example data
