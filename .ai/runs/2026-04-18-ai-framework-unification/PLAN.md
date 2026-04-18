# Execution Plan — AI Framework Unification

**Date:** 2026-04-18
**Slug:** `ai-framework-unification`
**Branch:** `feat/ai-framework-unification`
**Owner:** @peter (piotr.karwatka@gmail.com)
**Source spec:** `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a
> Step, flip `Status` to `done` and fill the `Commit` column with the short SHA.
> The first row whose `Status` is not `done` is the resume point for
> `auto-continue-pr`. Step ids are immutable once a Step has a commit.
>
> Phase 1 (this PR's foundation) is done and rolled up. Phases 2–5 map one-to-one
> to the source spec's own Phase 0–3 and are split into commit-sized Steps
> grouped by the spec's own Workstream A/B/C/D structure so reviewers can bisect
> cleanly. A mid-Phase Step MAY be re-split later if it grows past one commit,
> but a Step that already has a commit MUST NOT be renumbered.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Skill harness foundation: per-spec run folders, flat `step-<X.Y>-checks.md`, three-signal in-progress lock, top-of-file Tasks table | done | 93440ec79 |
| 1 | 1.2 | Rephase PLAN.md to cover the full ai-tooling spec (Phases 2–5) and rename the PR title to the `ai-framework-unification` main goal | done | 80b335707 |
| 2 | 2.1 | Spec Phase 0 — Add `AiAgentDefinition` type and `defineAiTool()` helper; export both from `@open-mercato/ai-assistant` | done | a6191c741 |
| 2 | 2.2 | Spec Phase 0 — Generator extension for `ai-agents.ts`, emit additive `ai-agents.generated.ts` | done | 89cbbe56a |
| 2 | 2.3 | Spec Phase 0 — Restore loading of generated `ai-tools.generated.ts` contributions in the runtime tool-loader | done | dc5d865fa |
| 2 | 2.4 | Spec Phase 0 — Attachment-bridge contract types + prompt-composition primitive types in `@open-mercato/ai-assistant` | done | b3ea44b0c |
| 2 | 2.5 | Spec Phase 0 — Unit tests: existing `ai-tools.ts` modules still register and execute; new discovery paths are additive | done | 1e8e9d134 |
| 3 | 3.1 | Spec Phase 1 WS-A — `agent-registry.ts` loads `ai-agents.generated.ts` and exposes a typed lookup API | done | a87bd19f6 |
| 3 | 3.2 | Spec Phase 1 WS-A — Runtime policy checks: `requiredFeatures`, `allowedTools`, `readOnly`, attachment access, `executionMode` | done | 4f3b8b737 |
| 3 | 3.3 | Spec Phase 1 WS-A — `POST /api/ai/chat?agent=<module>.<agent>` route with `metadata` + `openApi` | done | aae4fc6f5 |
| 3 | 3.4 | Spec Phase 1 WS-B — AI SDK helpers: `createAiAgentTransport`, `resolveAiAgentTools`, `runAiAgentText` | done | e20c80c1e |
| 3 | 3.5 | Spec Phase 1 WS-B — Structured-output (`executionMode: 'object'`) support + `runAiAgentObject` helper | done | 56d06f921 |
| 3 | 3.6 | Spec Phase 1 WS-B — Contract tests for chat-mode + object-mode parity (shared policy checks) | done | 34e50e455 |
| 3 | 3.7 | Spec Phase 1 WS-C — Attachment-to-model conversion bridge (images/PDFs/text-like/metadata-only) | done | 86901a489 |
| 3 | 3.8 | Spec Phase 1 WS-C — General-purpose tool packs (`search.*`, `attachments.*`, `meta.*`) | done | 11c5a87b8 |
| 3 | 3.9 | Spec Phase 1 WS-C — Customers tool pack (people / companies / deals / activities / tasks / addresses / tags / settings) | done | c2f2e21cb |
| 3 | 3.10 | Spec Phase 1 WS-C — Catalog tool pack (products / categories / variants / prices / offers / media / product configuration) | done | 0a5395ff2 |
| 3 | 3.11 | Spec §7 (D18) — Catalog merchandising read tools (`search_products`, `get_product_bundle`, `list_selected_products`, `get_product_media` via bridge, `get_attribute_schema`, `get_category_brief`, `list_price_kinds`) | done | 6e0beccb8 |
| 3 | 3.12 | Spec §7 (D18) — Catalog AI-authoring tools (`draft_description_from_attributes`, `extract_attributes_from_description`, `draft_description_from_media`, `suggest_title_variants`, `suggest_price_adjustment`) | done | 14249bc68 |
| 3 | 3.13 | Spec Phase 1 WS-C — Integration tests: unknown agent / forbidden agent / invalid attachment / allowed-tool filtering / tool-pack coverage | done | f1cc6be3d |
| 4 | 4.1 | Spec Phase 2 WS-A — `packages/ui/src/ai/AiChat.tsx` (embeddable chat component) | done | aae5bdac8 |
| 4 | 4.2 | Spec Phase 2 WS-A — Upload adapter reusing attachments API, returns `attachmentIds` | done | 6acaa8487 |
| 4 | 4.3 | Spec Phase 2 WS-A — Client-side UI-part registry with Phase 3 approval-card slots reserved | done | 59f23edac |
| 4 | 4.4 | Spec Phase 2 WS-B — Backend playground page (`/backend/config/ai-assistant/playground`) with agent picker + debug panel + object-mode | done | f62aead47 |
| 4 | 4.5 | Spec Phase 2 WS-B — Backend agent settings page (`/backend/config/ai-assistant/agents`) with prompt overrides + tool toggles + attachment policy | done | ce011a9e5 |
| 4 | 4.6 | Spec Phase 2 WS-B — i18n keys, keyboard shortcuts (`Cmd/Ctrl+Enter`, `Escape`), debug support | done | ee68a0030 |
| 4 | 4.7 | Spec Phase 2 WS-C — First customers agent with prompt template (read-only) | done | c4cba55ad |
| 4 | 4.8 | Spec Phase 2 WS-C — First catalog agent with prompt template (read-only) | todo | — |
| 4 | 4.9 | Spec §10 (D18) — `catalog.merchandising_assistant` agent (read-only Phase 2 exit): definition in `packages/core/src/modules/catalog/ai-agents.ts`, `<AiChat>` sheet on `/backend/catalog/catalog/products`, selection-aware `pageContext`, structured-output proposals only | todo | — |
| 4 | 4.10 | Spec Phase 2 WS-C — Backend + portal examples using existing injection/replacement patterns | todo | — |
| 4 | 4.11 | Spec Phase 2 — Integration tests: playground + settings + D18 read-only demo | todo | — |
| 5 | 5.1 | Spec Phase 3 WS-A — Extract shared model factory from `inbox_ops/lib/llmProvider.ts` into `@open-mercato/ai-assistant/lib/model-factory.ts`; support `defaultModel` + `<MODULE>_AI_MODEL` env override | todo | — |
| 5 | 5.2 | Spec Phase 3 WS-A — Production `ai-agents.ts` files with `resolvePageContext` callbacks that hydrate record-level context | todo | — |
| 5 | 5.3 | Spec Phase 3 WS-B — Versioned prompt-override persistence with safe additive merge rules | todo | — |
| 5 | 5.4 | Spec Phase 3 WS-B — Surface `mutationPolicy` as a feature-gated field in the settings UI (separate from prompt editor) | todo | — |
| 5 | 5.5 | Spec Phase 3 WS-C — `AiPendingAction` MikroORM entity + repository + migration (one new additive table, incl. optional `records[]` and `failedRecords[]`) | todo | — |
| 5 | 5.6 | Spec Phase 3 WS-C — `prepareMutation` runtime wrapper: intercepts `isMutation: true` tools for non-read-only agents, creates `AiPendingAction`, emits `mutation-preview-card` UI part | todo | — |
| 5 | 5.7 | Spec Phase 3 WS-C — `GET /api/ai/actions/:id` route with `metadata` + `openApi` (reconnect/polling) | todo | — |
| 5 | 5.8 | Spec Phase 3 WS-C — `POST /api/ai/actions/:id/confirm` route with full server-side re-check contract from §9.4 | todo | — |
| 5 | 5.9 | Spec Phase 3 WS-C — `POST /api/ai/actions/:id/cancel` route | todo | — |
| 5 | 5.10 | Spec Phase 3 WS-C — Four new UI parts in `@open-mercato/ui/src/ai/parts/`: `mutation-preview-card`, `field-diff-card`, `confirmation-card`, `mutation-result-card` (with keyboard shortcuts + reconnect behavior) | todo | — |
| 5 | 5.11 | Spec Phase 3 WS-C — Typed `ai.action.confirmed` / `ai.action.cancelled` / `ai.action.expired` events via `createModuleEvents` | todo | — |
| 5 | 5.12 | Spec Phase 3 WS-C — Cleanup worker sweeping expired pending actions (`status=pending` + `expiresAt < now` → `expired` + event) | todo | — |
| 5 | 5.13 | Spec Phase 3 WS-C — First mutation-capable agent flow (candidate: `customers.account_assistant` for deal stage updates) end-to-end on the pending-action contract | todo | — |
| 5 | 5.14 | Spec §7 (D18) — Catalog mutation tools (`update_product`, `bulk_update_products`, `apply_attribute_extraction`, `update_product_media_descriptions`) with single `AiPendingAction` per batch + per-record `records[]` diff grouping | todo | — |
| 5 | 5.15 | Spec Phase 3 WS-D — Bind production agents to existing backend pages through normal injection/UI composition (pass `pageContext` from the page) | todo | — |
| 5 | 5.16 | Spec Phase 3 WS-D — Integration tests: page-context resolution + model-factory fallback chain + execution budget (`maxSteps`) | todo | — |
| 5 | 5.17 | Spec Phase 3 WS-D — Integration tests: pending-action contract (happy / cancel / expiry / stale-version / cross-tenant / idempotency / read-only-agent refusal / prompt-override escalation refusal / reconnect) | todo | — |
| 5 | 5.18 | Spec §10 (D18) — Full bulk-edit demo end-to-end: `catalog.merchandising_assistant` runs all four named use cases through `bulk_update_products` with single `[Confirm All]` approval, per-record `catalog.product.updated` events, DataTable refresh via DOM event bridge, and `partialSuccess` handling | todo | — |
| 5 | 5.19 | Spec Phase 3 WS-D — Docs + operator rollout notes (release notes, migration guide, coexistence with OpenCode) | todo | — |

## Goal

Unify the AI-facing framework surfaces in Open Mercato so every agent-oriented
capability (skills, MCP tools, AI assistant, automation runbooks, and
supporting specs) hangs off one coherent contract instead of the current
scatter of ad-hoc skills, separate MCP tools, and one-off scripts.

Phase 1 of **this PR** laid the autonomous-runbook foundation (how agents
plan, resume, and verify). Phases 2–5 execute the
[`2026-04-11-unified-ai-tooling-and-subagents`](../../specs/2026-04-11-unified-ai-tooling-and-subagents.md)
spec, which itself defines four phases (Phase 0 Alignment through Phase 3
Production Hardening + Mutation Approval). Those map one-to-one to Phases 2,
3, 4, 5 of this plan respectively, preserving the spec's own Workstream A/B/C
groupings so reviewers can trace each Step back to a numbered deliverable in
the source spec.

## Scope (Phase 1, landed)

Delivered as five incremental commits on this branch and rolled up into a
single Step (1.1) in the Tasks table for clarity:

- `.ai/runs/<date>-<slug>/` per-spec run-folder layout with `PLAN.md`,
  `HANDOFF.md`, and append-only `NOTIFY.md` as a uniform contract.
- Flat verification layout: `step-<X.Y>-checks.md` next to `PLAN.md` (required
  per Step) + optional `step-<X.Y>-artifacts/` only when real artifacts exist.
  No `proofs/` subfolder. Full-gate output under `final-gate-checks.md`.
- 1:1 step-to-commit discipline with per-commit verification (typecheck +
  unit tests always; Playwright + screenshot when UI-facing **and** env
  runnable — never a dev-blocking requirement).
- `HANDOFF.md` rewritten after every Step so a fresh agent can resume in
  <30 seconds; `NOTIFY.md` is an append-only UTC-timestamped log.
- Subagent parallelism capped at 2 (dev + reviewer), conflict avoidance over
  speed.
- Three-signal `in-progress` lock in `auto-create-pr` (assignee + label +
  claim comment) held throughout the run, temporarily released around
  `auto-review-pr`, and released in a trap/finally.
- Top-of-file `## Tasks` markdown table in `PLAN.md` (Phase | Step | Title |
  Status | Commit) as the authoritative status source, replacing the legacy
  bottom-of-file `## Progress` checklist. Legacy Progress section tolerated
  as a one-shot fallback for pre-migration PRs.
- Sibling skills (`auto-sec-report`, `auto-qa-scenarios`,
  `auto-update-changelog`) migrated or confirmed compatible with the new
  layout. `.ai/runs/README.md` documents the full contract.

## Scope (Phases 2–5, spec-driven)

Phases 2–5 implement the source spec's Phase 0–3 respectively. Each Step
below corresponds to a named deliverable in the spec's own Implementation
Plan. A Step that grows past one commit during execution MUST be split
(e.g. `3.9-a` / `3.9-b`) rather than fattened.

### Phase 2 (= spec Phase 0, Alignment Prerequisite)

Purpose: remove current runtime mismatches and land the additive contracts
every later phase depends on.

- 2.1 `AiAgentDefinition` type + `defineAiTool()` helper, exported from
  `@open-mercato/ai-assistant`.
- 2.2 Generator extension for `ai-agents.ts` → emits additive
  `ai-agents.generated.ts` next to the existing `ai-tools.generated.ts` in
  `apps/mercato/.mercato/generated/`.
- 2.3 Restore module-tool loading from `ai-tools.generated.ts` so registered
  module tools actually reach the runtime again (fixes the current
  Code-Mode-centric load path documented in Current-State Verification).
- 2.4 Attachment-bridge contract types (`AiResolvedAttachmentPart` and
  friends) + prompt-composition primitives (structured sections, not a
  single flat string).
- 2.5 Unit tests: existing modules' `ai-tools.ts` still registers through
  the restored loader; new `defineAiTool()` is compatible with the old
  plain-object shape; `ai-agents.generated.ts` discovery is additive.

Exit: `ai-tools.generated.ts` contributions visible to the runtime again;
`ai-agents.generated.ts` discoverable; attachment-bridge and prompt-section
types exist as implementation-ready shapes.

### Phase 3 (= spec Phase 1, Runtime + Tools + AI SDK DX)

Purpose: make the platform usable to a Vercel AI SDK consumer without any
custom glue, with baseline tool packs and the attachment bridge wired.

- **Workstream A — Core runtime.** Steps 3.1–3.3: agent registry loader,
  runtime policy gate, dispatcher HTTP route.
- **Workstream B — AI SDK adapters.** Steps 3.4–3.6: chat transport +
  tool/text helpers, `runAiAgentObject` for structured output, contract
  tests asserting chat-mode/object-mode parity.
- **Workstream C — Files + tool packs.** Steps 3.7–3.13: attachment-to-model
  bridge, general/customers/catalog tool packs, D18 catalog merchandising
  read + AI-authoring tools, integration tests for auth/attachment/tool
  filtering.

Exit: `createAiAgentTransport`, `runAiAgentText`, `runAiAgentObject` work
without custom glue; attachments flow through as file/text parts;
customers + catalog tool packs reach the same read models the UI exposes.

### Phase 4 (= spec Phase 2, Playground + Settings + First Module Agents)

Purpose: ship the operator-facing UI so agents are testable, configurable,
and demonstrable — including the read-only D18 demo embed.

- **Workstream A — Shared UI.** Steps 4.1–4.3: `<AiChat>` component, upload
  adapter, client-side UI-part registry with Phase 3 card slots reserved
  (so the registry API does not churn when mutation cards land).
- **Workstream B — Admin-facing screens.** Steps 4.4–4.6: playground page,
  agent settings page, i18n + keyboard + debug support.
- **Workstream C — First module agents.** Steps 4.7–4.11: first customers
  agent, first catalog agent, `catalog.merchandising_assistant` read-only
  demo embed on `/backend/catalog/catalog/products`, backend + portal
  examples, integration tests.

Exit: internal admin can test chat-mode + object-mode agents from the
playground; tenant admins can edit additive prompt overrides;
`catalog.merchandising_assistant` runs end-to-end in read-only mode with
selection-aware `pageContext` and the attachment bridge.

### Phase 5 (= spec Phase 3, Production Hardening + Mutation Approval + Expansion)

Purpose: prove the design on real production agents, unlock write-capable
focused agents behind the D16 pending-action contract, and harden the
customization model. Also delivers the full D18 demo end-to-end.

- **Workstream A — Production agent runtime.** Steps 5.1–5.2: shared model
  factory extraction, production `ai-agents.ts` with `resolvePageContext`.
- **Workstream B — Prompt + settings hardening.** Steps 5.3–5.4: versioned
  prompt-override persistence; feature-gated `mutationPolicy` surface in
  settings UI.
- **Workstream C — Mutation Approval Gate (D16).** Steps 5.5–5.14:
  `AiPendingAction` entity + migration, `prepareMutation` runtime wrapper,
  three pending-action routes (GET/confirm/cancel), four new UI parts,
  typed events, cleanup worker, first mutation-capable agent flow, and
  the D18 catalog mutation tool set (`update_product`,
  `bulk_update_products`, `apply_attribute_extraction`,
  `update_product_media_descriptions`) with batch-grouped `records[]` diff.
- **Workstream D — Production rollout.** Steps 5.15–5.19: bind production
  agents to real backend pages, integration tests across page context /
  model factory / mutation gate, full D18 bulk-edit demo, and operator
  docs.

Exit: at least one mutation-capable agent is live behind the pending-action
contract; the catalog merchandising demo runs all four named use cases
end-to-end on the products list; tenant prompt overrides can never escalate
mutation policy; all spec-defined integration tests pass.

## Non-goals (this PR)

- No changes to OpenCode Code Mode behavior, `/api/chat`, `/api/tools*`, or
  `mcp:serve*`. The spec explicitly preserves those contracts; this plan
  inherits that constraint.
- No new top-level `@open-mercato/ai` package (decided in D1).
- No per-module MCP endpoints (decided in D10 — deferred to Phase 4+).
- No RSC `streamUI` (deferred to Phase 4+).
- No Stacked Approval Queue runtime (D17 — design-only in the spec).

## Risks

- **Spec scope is large.** 40+ Steps across four delivery phases. Mitigated
  by 1:1 step-to-commit discipline, explicit Workstream grouping, and
  incremental pushes so reviewers can ride along. A Step that outgrows one
  commit MUST be re-split, not inflated.
- **BC contract surface is broad** (see spec's "Migration & Backward
  Compatibility" section). Every Step MUST re-check the 13 contract
  surfaces from `BACKWARD_COMPATIBILITY.md` before committing, especially
  Steps 2.1–2.4 (new types + generator), 5.5 (new DB table), and 5.7–5.9
  (new routes).
- **Phase 3 introduces a persistent `AiPendingAction` store.** Additive
  table only, but the migration must stay reversible and must not block
  the app build if the table is absent (graceful runtime fallback).
- **Tenant isolation + encryption** apply to `AiPendingAction`,
  attachments, and `resolvePageContext` output. The existing
  `findWithDecryption` / `findOneWithDecryption` contracts are mandatory;
  every Phase 3 Step MUST re-grep changed non-test files for raw
  `em.find(` / `em.findOne(` before commit.
- **Dogfooding deviation**: this run was executed in the user's primary
  worktree at the user's explicit request. The new skill forbids that by
  default; documented as a one-time exception in `NOTIFY.md`. Future
  Phase-2+ Steps MAY continue in-place, but any PR spun off from this
  plan MUST use an isolated worktree.

## External References

- None outside this repo. The spec
  [`.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`](../../specs/2026-04-11-unified-ai-tooling-and-subagents.md)
  is the single source of truth.

## Source spec

- [`.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`](../../specs/2026-04-11-unified-ai-tooling-and-subagents.md)
- Every Step in Phases 2–5 cites a numbered deliverable in that spec's
  Implementation Plan. If the spec changes after a Step has a commit,
  reconcile via a follow-up Step (e.g. `X.Y-spec-drift-fix`), never by
  rewriting history.

## Implementation Plan

### Phase 1 — Skill harness foundation (landed)

- **Step 1.1** Skill harness foundation. Landed as five incremental commits
  to keep review easy; rolled up as one Step in the Tasks table for
  readability. Commit breadcrumbs (newest last):
  - `bacbc59ec` — initial rework of `auto-create-pr` / `auto-continue-pr`
    and sibling skills to per-spec run folders.
  - `4a782bbd1` — repair placeholder UTC timestamps in `NOTIFY.md` /
    `HANDOFF.md` to match real session time.
  - `98ec6abb2` — add three-signal `in-progress` lock discipline to
    `auto-create-pr`; dogfooded on this PR.
  - `6a1afab69` — flatten verification layout: `step-<X.Y>-checks.md` +
    optional `step-<X.Y>-artifacts/` replace the `proofs/<step-id>/` nest.
  - `93440ec79` — introduce the top-of-file `## Tasks` table in `PLAN.md`
    as the authoritative Step-status source; update both skills to
    read/write the table.
  - Per-commit verification notes remain as `step-1.1-checks.md` through
    `step-1.5-checks.md` in this run folder for audit.
- **Step 1.2** Rephase `PLAN.md` to cover the full source spec and rename
  the PR so the title names the overall `ai-framework-unification` goal
  (the skill harness was the first step of it, not the whole goal). No
  code changes, docs-only; verification notes in `step-1.2-checks.md`.

### Phase 2 — Spec Phase 0 (Alignment Prerequisite)

Each Step below is one commit. Every commit includes:

- code + types under `packages/ai-assistant/src/modules/ai_assistant/`
  (Steps 2.1, 2.3, 2.4) or `packages/cli/` (Step 2.2);
- unit tests exercising the change;
- a `step-<X.Y>-checks.md` file next to `PLAN.md` recording typecheck +
  unit test outcomes;
- a `step-<X.Y>-artifacts/` folder ONLY when real artifacts are produced.

- **Step 2.1** Add `AiAgentDefinition` type and `defineAiTool()` helper.
  Export both from `@open-mercato/ai-assistant`. `defineAiTool()` returns an
  object assignable to the existing `AiToolDefinition`. The
  `AiAgentDefinition` includes every optional field from the spec
  (`executionMode`, `mutationPolicy`, `resolvePageContext`, `maxSteps`,
  `keywords`, `domain`, `dataCapabilities`, `output`, …).
- **Step 2.2** Generator extension for `ai-agents.ts`. Scan module roots,
  emit additive `ai-agents.generated.ts` in
  `apps/mercato/.mercato/generated/`. No route emission in v1
  (dispatcher-based HTTP layer).
- **Step 2.3** Restore module-tool loading from `ai-tools.generated.ts` in
  the runtime tool-loader. Keep `mcp-tool-adapter.ts` as the foundation
  for AI SDK tool resolution; do not introduce a second adapter stack.
- **Step 2.4** Attachment-bridge contract types (`AiResolvedAttachmentPart`
  with `source: 'bytes' | 'signed-url' | 'text' | 'metadata-only'` plus
  `AiUiPart`, `AiChatRequestContext`) and prompt-composition primitives
  (`PromptSection`, `PromptTemplate`, named sections per §8).
- **Step 2.5** Unit tests: existing `ai-tools.ts` modules still register
  through the restored loader; new `defineAiTool()` return value is
  compatible with the old plain-object shape; `ai-agents.generated.ts`
  discovery is additive; generator output is stable across runs.

### Phase 3 — Spec Phase 1 (Runtime + Tools + AI SDK DX)

Phase 3 ships the runtime before the UI. Every Step has a unit-test
partner; Steps 3.6 and 3.13 are integration-test Steps. Playwright is
skipped for 3.1–3.10 (no UI surface); Step 3.13 may exercise
`apiCallOrThrow` against an in-process mock if the dev env is unrunnable.

- **Step 3.1** `agent-registry.ts` loader for `ai-agents.generated.ts`.
- **Step 3.2** Runtime policy checks (`requiredFeatures`, `allowedTools`,
  `readOnly`, attachment access, `executionMode`).
- **Step 3.3** `POST /api/ai/chat?agent=<module>.<agent>` route with
  `metadata` + `openApi`.
- **Step 3.4** AI SDK helpers: `createAiAgentTransport`,
  `resolveAiAgentTools`, `runAiAgentText`.
- **Step 3.5** Structured-output support for `executionMode: 'object'` +
  `runAiAgentObject` helper.
- **Step 3.6** Contract tests for chat-mode + object-mode parity.
- **Step 3.7** Attachment-to-model conversion bridge.
- **Step 3.8** General-purpose tool packs (`search.*`, `attachments.*`,
  `meta.*`).
- **Step 3.9** Customers tool pack.
- **Step 3.10** Catalog tool pack (base coverage).
- **Step 3.11** Catalog merchandising read tools (D18).
- **Step 3.12** Catalog AI-authoring tools (D18).
- **Step 3.13** Integration tests for auth / attachment / tool filtering
  across the whole runtime.

### Phase 4 — Spec Phase 2 (Playground + Settings + First Module Agents)

Phase 4 is UI-heavy. Every UI-facing Step MUST run Playwright +
screenshot when the dev env is runnable (per the skill harness rules) and
note the outcome in `step-<X.Y>-checks.md`; when the env cannot be
started, the Step still lands but the check file MUST explain why.

- **Step 4.1** `<AiChat>` component in `packages/ui/src/ai/AiChat.tsx`.
- **Step 4.2** Upload adapter reusing attachments API; returns
  `attachmentIds`.
- **Step 4.3** Client-side UI-part registry with slots reserved for
  Phase 5 approval cards.
- **Step 4.4** Playground page (`/backend/config/ai-assistant/playground`).
- **Step 4.5** Agent settings page (`/backend/config/ai-assistant/agents`).
- **Step 4.6** i18n keys, keyboard shortcuts, debug support.
- **Step 4.7** First customers agent with prompt template.
- **Step 4.8** First catalog agent with prompt template.
- **Step 4.9** `catalog.merchandising_assistant` agent (read-only Phase 2
  exit): D18 demo embed on the products list page.
- **Step 4.10** Backend + portal examples.
- **Step 4.11** Integration tests covering playground, settings, and D18
  read-only demo.

### Phase 5 — Spec Phase 3 (Production Hardening + Mutation Approval Gate + Expansion)

Phase 5 is the largest and touches data, routes, UI, workers, and events.
Before Step 5.5 lands, the shared model factory (5.1) and first
production `ai-agents.ts` with `resolvePageContext` (5.2) must be in
place so the mutation gate can exercise a realistic agent. Every Step in
Workstream C MUST re-grep for raw `em.find(` / `em.findOne(` before
committing — `AiPendingAction` carries tenant-scoped data.

- **Step 5.1** Shared model factory extraction.
- **Step 5.2** Production `ai-agents.ts` with `resolvePageContext`.
- **Step 5.3** Versioned prompt-override persistence.
- **Step 5.4** `mutationPolicy` field in settings UI (feature-gated).
- **Step 5.5** `AiPendingAction` MikroORM entity + repository + migration.
- **Step 5.6** `prepareMutation` runtime wrapper + `mutation-preview-card`
  emission.
- **Step 5.7** `GET /api/ai/actions/:id` route.
- **Step 5.8** `POST /api/ai/actions/:id/confirm` route + full re-check
  contract (§9.4).
- **Step 5.9** `POST /api/ai/actions/:id/cancel` route.
- **Step 5.10** Four new UI parts in `@open-mercato/ui/src/ai/parts/` with
  keyboard shortcuts + reconnect behavior.
- **Step 5.11** Typed `ai.action.*` events via `createModuleEvents`.
- **Step 5.12** Cleanup worker for expired pending actions.
- **Step 5.13** First mutation-capable agent flow (candidate:
  `customers.account_assistant` for deal-stage updates).
- **Step 5.14** Catalog mutation tools (D18) with batch-grouped
  `records[]` diffs and single-approval-card flow.
- **Step 5.15** Bind production agents to backend pages through normal
  injection/UI composition.
- **Step 5.16** Integration tests for page-context resolution +
  model-factory fallback chain + `maxSteps` budget enforcement.
- **Step 5.17** Integration tests for the pending-action contract: happy
  path, cancel, expiry, stale-version, cross-tenant confirm denial,
  idempotent double-confirm, read-only-agent refusal, prompt-override
  escalation refusal, page-reload reconnect.
- **Step 5.18** Full D18 bulk-edit demo end-to-end (all four named use
  cases through `catalog.bulk_update_products` with single `[Confirm
  All]`, per-record `catalog.product.updated` events, DataTable refresh
  via DOM event bridge, `partialSuccess` handling).
- **Step 5.19** Docs + operator rollout notes (release notes, migration
  guide, coexistence with OpenCode).
