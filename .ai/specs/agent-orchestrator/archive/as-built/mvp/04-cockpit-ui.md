> 🗂️ **Reorg 2026-06-22 · Status: IMPLEMENTED (as-built design record).** The design here has shipped; it is superseded as a *plan* by the baseline doc and kept for provenance. Authoritative current docs: `.ai/specs/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` and `packages/core/src/modules/agent_orchestrator/`.

# 04 · Cockpit UI

> **Status:** Ready to implement · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-20
> **Module:** `agent_orchestrator/backend` (+ `ui`) · **Depends:** [01](01-agent-sdk-core.md), [02](02-workflows-invoke-agent-activity.md), [03](03-disposition-and-proposals.md) · **Area of:** [`mvp/00-overview.md`](00-overview.md)

## TLDR

Translate [`om-agent-cockpit-mvp.html`](../om-agent-cockpit-mvp.html) into **real Open Mercato backend UI** under `packages/core/src/modules/agent_orchestrator/backend/` plus widget injection into the existing **workflows monitor** (`backend/instances/[id]`) and **My Tasks** (`backend/tasks`). UI-only — **no new entities**. Reads come from areas 01/03 (`GET /agents`, `/runs`, `/proposals`), the only write is the area-03 dispose (`POST /proposals/:id/dispose`) via `useGuardedMutation` + `surfaceRecordConflict`. The signature surfaces are the **operator caseload** (four-verb grouping), the **proposal disposition card** (Approve / Edit / Reject) with the **Agent I/O drawer**, the **process-detail timeline** (agent / system / human lanes), and the **dev Agent Playground**. Plus the **"Invoke Agent" node config UI** (3 fields) coordinated with area 02. Trace inspector + Audit ship as DS empty-state stubs. Strict DS: `brand-violet` ONLY for agent/AI touchpoints, status tokens for states, `apiCall*` (no raw fetch), `useT()` i18n.

## Scope (UI-only; no entities)

- **In:** new backend pages + widget-injection bundles in `agent_orchestrator`; a `StatusMap`/`TagMap` per cockpit state; the disposition write wired to area-03's API; the Invoke-Agent node config panel UI.
- **Out:** entities, API routes, the dispose Command, the workflow activity (areas 01/02/03 own these); eval/trace/cost/audit data (deferred overlays → stubbed empty states); ACL feature *definitions* (live in area 01's `acl.ts`; this area only *consumes* them in `page.meta.ts`).
- **Coordination with area 02:** the visual-editor **node registration + config persistence** is area 02. This area owns the **UI/UX of the 3-field config panel** (the `wb-insp` inspector in the mockup) and the agent-dropdown data source (`GET /agents`).

## Screen inventory

| Screen | MVP | Source mockup view | Backend path / injection spot | APIs consumed |
|---|---|---|---|---|
| Operator caseload (four-verb) | **BUILD** | `data-view="caseload"` | `backend/caseload/page.tsx` | `GET /proposals?disposition=pending` (01/03) |
| Proposal disposition card + I/O drawer | **BUILD** | `data-view="case"` + `.drawer` | `backend/caseload/[proposalId]/page.tsx` + `components/AgentIoDrawer.tsx` | `GET /proposals/:id`, `GET /runs/:id`, `POST /proposals/:id/dispose` (03) |
| Process-detail timeline (agent/system/human) | **BUILD (inject)** | `data-view="detail"` `.tl` | inject into `workflows` `backend/instances/[id]/page.tsx` via `injection-table.ts` | `GET /proposals?processId=`, `GET /runs/:id` (01/03) |
| Overview tiles (counts only) | **PARTIAL** | `data-view="overview"` | `backend/overview/page.tsx` | `GET /proposals` + `GET /runs` (count/aggregate client-side) |
| Agents registry (list) | **PARTIAL** | `data-view="agents"` | `backend/agents/page.tsx` | `GET /agents` (01) |
| Dev Agent Playground | **BUILD** | `data-view="playground"` | `backend/playground/page.tsx` | `GET /agents`, `POST /agents/:id/run` (01) |
| Invoke-Agent node config UI | **BUILD (coordinate 02)** | `data-view="builder"` `.wb-insp` | `components/InvokeAgentNodeConfig.tsx` (consumed by area-02 editor) | `GET /agents` (01) |
| My Tasks row action → proposal card | **BUILD (inject)** | folds into caseload | inject into `workflows` `backend/tasks` row-actions | (links to caseload detail) |
| Trace inspector | **STUB** | `data-view="trace"`/`traces` | `backend/traces/page.tsx` | — (EmptyState) |
| Audit & compliance | **STUB** | `data-view="audit"` | `backend/audit/page.tsx` | — (EmptyState) |

## Files to create/modify (real paths)

**Create (all under `packages/core/src/modules/agent_orchestrator/`):**

```
backend/caseload/page.tsx + page.meta.ts                  # operator caseload (four-verb)
backend/caseload/[proposalId]/page.tsx + page.meta.ts     # proposal disposition card
backend/overview/page.tsx + page.meta.ts                  # counts-only KPI tiles
backend/agents/page.tsx + page.meta.ts                    # agents registry list
backend/playground/page.tsx + page.meta.ts                # dev Agent Playground
backend/traces/page.tsx + page.meta.ts                    # STUB
backend/audit/page.tsx + page.meta.ts                     # STUB
components/ProposalCard.tsx                               # disposition card (shared by caseload + playground)
components/AgentIoDrawer.tsx                              # input/output/tools drawer
components/AgentTimeline.tsx                              # agent/system/human lanes (timeline)
components/InvokeAgentNodeConfig.tsx                      # 3-field config panel (area-02 consumes)
components/cockpitStatus.tsx                              # StatusMap/TagMap for cockpit states
widgets/injection-table.ts                               # injection spot registrations
widgets/injection/process-timeline/widget.ts + widget.client.tsx   # timeline into instance detail
widgets/injection/task-proposal-link/widget.ts + widget.client.tsx # My Tasks row-action link
i18n/en.json (+ pl.json …)                               # all cockpit strings
```

**Modify:** none of `workflows`'s own files — injection is additive via `injection-table.ts`. (Area 02 imports `InvokeAgentNodeConfig` into the editor palette; that wiring lands in area 02.)

## Screen specs

### Caseload + verbs (`backend/caseload/page.tsx`)

Operator's primary screen. Fetch pending proposals (`apiCall('/api/agent_orchestrator/proposals?disposition=pending&…')`); render with `LoadingMessage`/`ErrorMessage` and `EmptyState` on empty. The mockup's **four-verb grouping** is a client-side bucket of the proposal set by intent: **Decide** (actionable proposal awaiting dispose), **Answer** (agent blocked, needs input), **Do** (USER_TASK human step), **Know** (informative/awareness). For MVP every `AgentProposal` with `disposition='pending'` is **Decide**; the other three verbs are derived from the parked `USER_TASK` shape coming through area 02/03 (Do/Answer) — render them when present, otherwise show only Decide. Each verb group is a `SectionHeader title={t('agent_orchestrator.caseload.verb.decide')} count={n}` followed by clickable rows.

Rows use real primitives, not the mockup's raw HTML: agent initials via `<AvatarStack max={4}><Avatar label=… size="sm" variant="monochrome"/></AvatarStack>` (brand-violet ring is fine — AI touchpoint), the agent/proposal id in `font-mono text-xs text-muted-foreground`, confidence + SLA as `text-xs`. Verb is a left-accent border using **status tokens** (`border-l-4 border-status-warning-border` for Decide, `border-brand-violet` for Answer/AI, `border-status-info-border` for Do, `border-status-neutral-border` for Know). Row click → `/backend/caseload/{proposalId}`. Use the four summary tiles (Need you / Waiting / Running / Closed) as a counts strip; segment chips (Needs you / Waiting / Running / All) toggle the client-side filter. `pageSize` ≤ 100.

### Proposal disposition card + I/O drawer (`backend/caseload/[proposalId]/page.tsx`, `components/ProposalCard.tsx`, `components/AgentIoDrawer.tsx`)

**This is the signature HITL surface.** Load `GET /proposals/:id` (+ its `GET /runs/:run_id` for I/O) via `readApiResultOrThrow`; `LoadingMessage`/`ErrorMessage`/`RecordNotFoundState` for the three async states. `ProposalCard` renders, top to bottom:

- **Proposal header** — brand-violet strip (`bg-brand-violet/10 border-brand-violet/30`), agent avatar (brand-violet), `"<agent> proposes"`, confidence in `font-mono text-brand-violet`. (Brand-violet is correct here: it flags AI-generated content.)
- **Verdict block** — `Alert` (`status="success"` for an actionable approve verdict; brand-violet-tinted custom block for "needs your input"/ask). Amount, if any, in `text-xl font-semibold`.
- **Why / factors** — a list; `ok` factors use `text-status-success-icon` check, `flag` factors use `text-status-warning-icon` flag.
- **I/O trio** — three buttons (input · output · tools) opening `AgentIoDrawer`.
- **Gate** — left-accent `Alert status="warning"` explaining why disposition is gated to the human.

**Actions footer** (the disposition signature): `Reject` = `Button variant="destructive"`, `Edit` = `Button variant="outline"`, `Approve` = primary success `Button`. All three write through **area-03's dispose API** via `useGuardedMutation`:

```typescript
const { runMutation, retryLastMutation } = useGuardedMutation<{ proposalId: string; data: ProposalDetail | null; retryLastMutation: () => Promise<boolean> }>({
  contextId: `agent_orchestrator.proposal:${proposalId}`,
  blockedMessage: t('agent_orchestrator.proposal.flash.blocked'),
})
const dispose = (disposition: 'approved'|'edited'|'rejected', payload?: unknown, reason?: string) =>
  runMutation({
    operation: () => withScopedApiRequestHeaders(
      buildOptimisticLockHeader(detail?.updatedAt),
      () => apiCallOrThrow(`/api/agent_orchestrator/proposals/${proposalId}/dispose`, {
        method: 'POST', body: JSON.stringify({ disposition, payload, reason }),
      }),
    ),
    context: { proposalId, data: detail, retryLastMutation },
    mutationPayload: { disposition },
  })
```

- **Approve** → `dispose('approved')`, success `flash(...,'success')`, route back to caseload (workflow resumes via `agent_orchestrator.proposal.ready`).
- **Reject** → `useConfirmDialog({ variant:'destructive' })`, capture a required reason → `dispose('rejected', undefined, reason)`.
- **Edit** → inline editor of the proposal payload (`Textarea`/fields) → `dispose('edited', editedPayload, reason)` (the edited action is what executes; reason recorded). Optimistic-lock 409 → `surfaceRecordConflict(err, t)`; other errors → `flash`. `Cmd/Ctrl+Enter` submits the focused action; `Escape` closes the drawer.

`AgentIoDrawer` is a right-side panel (`z-modal`, `bg-black/20` scrim) with three `SectionHeader`-led blocks — **Input** (received), **Output** (produced), **Tools used** (list, brand-violet dots) — plus a raw `JsonDisplay` of the output payload. Lane eyebrow: brand-violet for agent, `status-info` for system.

### Process-detail timeline (extend workflows monitor instance view)

`components/AgentTimeline.tsx` injected into `packages/core/src/modules/workflows/backend/instances/[id]/page.tsx` via `injection-table.ts` (spot below). Reuses the existing instance detail header/stages; adds the three-lane timeline below it. Lanes: **agent** (proposes, brand-violet, left), **system** (Open Mercato disposes, `status-info`/`accent`, right), **human** (in the loop, `text-foreground`, right), with **handoff** rows centered. Fetch `GET /proposals?processId={instance.id}` + each `GET /runs/:id`; each agent/system card is clickable → opens the same `AgentIoDrawer`. The parked `INVOKE_AGENT` step renders a `StatusBadge variant="warning" dot` ("Parked · awaiting disposition"); the card links to the operator proposal card. **Boy-Scout note:** the current instance detail uses hardcoded `bg-blue-100 text-blue-800` status colors — the injected timeline MUST use `StatusBadge`/status tokens (do not copy the legacy classes).

### Overview tiles (counts only) (`backend/overview/page.tsx`)

Four `tile` KPIs derived **only from data we already have** (no eval/cost): **Auto-completed %** (`auto_approved` ÷ total dispositions over a window), **Needs a decision** (`disposition='pending'` count), **Queue depth** (parked agent steps = pending proposals with a `process_id`), **Operator ratio** (processes per supervisor — simple count, optional). Each tile = `bg-card border border-border rounded-lg p-4`, value `text-2xl font-semibold`, meta pill via `StatusBadge`. A "Needs attention" `DataTable` (or simple list) of breaching/parked proposals. Defer cost/token/trust-trend tiles (overlay). Empty → `EmptyState`.

### Agents registry (list) (`backend/agents/page.tsx`)

`GET /agents` → grid of `acard`s (or `DataTable` with `perspective.tableId='agent_orchestrator.agents.list'`). Each card: agent id (`font-mono`), version, capability description, an `agent` `Tag variant="brand" dot` (brand-violet AI marker), and a "Playground" `Button` linking to `/backend/playground?agent={id}`. Defer trust/eval/override-rate columns (overlay). `EmptyState` when no agents.

### Playground (`backend/playground/page.tsx`)

Dev wow. Form: agent `Select` (from `GET /agents`) + `Textarea` JSON input (label visible per DS). **Run** = `Button` with brand-violet treatment (AI op) → `POST /agents/:id/run` `{ input }` via `apiCallOrThrow` (read-only run; this is a dev tool, not a guarded entity write, but still `apiCall*` not raw fetch). `Cmd/Ctrl+Enter` runs. Render the returned `AgentResult`:

- `kind:'actionable'` → reuse `ProposalCard` (read-only variant: shows verdict, confidence, proposed actions; Approve/Edit/Reject are present but, in playground, Approve runs an ad-hoc dispose only if a proposal row was persisted — otherwise disabled with a hint).
- `kind:'informative'` → render `data` via `JsonDisplay`.
- **Collapsible trace** (`CollapsibleSection title={t('…trace')}`) — steps + tools-used list (brand-violet/`accent` dots), raw output `JsonDisplay`.

Loading → `Spinner` (brand-violet stroke acceptable for an AI op); pre-run → `EmptyState` ("No run yet"); error → `ErrorMessage` / `Alert status="error"`.

### Invoke-Agent node config UI (`components/InvokeAgentNodeConfig.tsx`) — coordinate with area 02

The 3-field config panel (mockup `wb-insp`), exported for area 02's visual editor to render when an `INVOKE_AGENT` node is selected. Brand-violet header (AI step). Fields:

1. **Agent** — `Select` populated from `GET /agents` (agent id + description).
2. **Input** — `Textarea` (`font-mono`) for the context expression, e.g. `{ dealId: {{deal.id}} }`.
3. **On result** — two radio options (`wb-radio` → DS radio group): ◉ *Auto-approve if confidence ≥* `[0.8]` (numeric input) · ○ *Always ask a human*. This is the `onResult: { autoApproveThreshold } | { alwaysAsk: true }` shape frozen in area 02.

The component is **controlled** (`value`/`onChange` over the area-02 activity-config schema) and stateless about persistence — area 02 owns reading/writing the node config. Use brand-violet focus ring on these AI fields (matches mockup). This area delivers the component + its i18n + the `GET /agents` data source; area 02 registers the palette item and the node status renderer (running/waiting/done) in the monitor.

## DS compliance checklist

- **Tokens:** `brand-violet` ONLY on agent/AI touchpoints (proposal header, agent avatars/lanes, AI markers, Run button, Invoke-Agent node, playground); all states via `{property}-status-{status}-{role}`; destructive Reject via `variant="destructive"`. No hardcoded hex/Tailwind status shades; no `dark:` on semantic/status tokens; no arbitrary sizes/spacing/radius/z-index.
- **Primitives:** `StatusBadge` + `StatusMap` (cockpit states), `Avatar`/`AvatarStack`, `Alert` (verdict/gate/errors), `EmptyState` (lists + stubs), `SectionHeader`/`CollapsibleSection`, `Separator`, `Spinner`, `Button`, `KbdShortcut`, `DataTable` + `RowActions` (overview/agents/My-Tasks injection), `CrudForm` (not needed — disposition is a custom write, Playground is a run).
- **Data calls:** `apiCall`/`apiCallOrThrow`/`readApiResultOrThrow` + `readJsonSafe` only — never raw `fetch`.
- **Guarded mutation:** the dispose write uses `useGuardedMutation().runMutation` + `withScopedApiRequestHeaders(buildOptimisticLockHeader(detail.updatedAt))`; 409 → `surfaceRecordConflict(err, t)`; expose `retryLastMutation` in the mutation context.
- **i18n:** `useT()` client / `resolveTranslations()` server; every string in `i18n/en.json`; internal-only throws/toasts prefixed `[internal]`.
- **Async/empty:** every page handles loading (`LoadingMessage`/`Spinner`), error (`ErrorMessage`/`Alert`), empty (`EmptyState`); every dialog: `Cmd/Ctrl+Enter` submit, `Escape` cancel.

## Widget injection plan (spot ids)

`widgets/injection-table.ts` registers:

| Spot id | Widget | Purpose |
|---|---|---|
| `workflows.instance.detail:timeline` *(new sub-spot to add in area 02/this area)* | `agent_orchestrator.injection.process-timeline` | Render `AgentTimeline` under the instance detail. If the instance detail page exposes no injection spot yet, add one additively (coordinate with workflows owner — same pattern as `sales.document.detail.order:details`). |
| `data-table:workflows.tasks.list:row-actions` | `agent_orchestrator.injection.task-proposal-link` | Row action "Review proposal" on USER_TASK rows that carry a `proposalId` → links to `/backend/caseload/{proposalId}`. |

Spot-id convention confirmed in repo: group spots `<module>.<surface>:<sub>` (e.g. `sales.document.detail.order:details`); DataTable spots `data-table:<tableId>:row-actions|columns|bulk-actions|filters|toolbar`. The workflows tasks table id is `workflows.tasks.list`. Widget bundles follow `InjectionWidgetModule` (`metadata: { id, title, features, priority, enabled }` + `Widget`), features gated on `agent_orchestrator.proposals.view` / `.dispose`.

## Phases

1. **P0 — Playground** (`backend/playground/page.tsx` + `ProposalCard` read-only + trace) — the dev wow; depends only on 01's `POST /agents/:id/run` + `GET /agents`.
2. **P0 — Caseload + Proposal card + I/O drawer** (`backend/caseload/*`, `components/ProposalCard.tsx`, `AgentIoDrawer.tsx`) — the HITL beat; depends on 03's `GET /proposals*` + dispose.
3. **P1 — Process-detail timeline** injection (`AgentTimeline` + `injection-table.ts`) — depends on workflows instance-detail spot + 03 reads.
4. **P1 — Overview tiles + Agents registry** (counts/list).
5. **P1 — Invoke-Agent node config UI** (`InvokeAgentNodeConfig.tsx`) — hand to area 02 for palette wiring.
6. **P2 — My Tasks row-action injection + Trace/Audit stubs.**

## Acceptance

1. **Operator disposes → workflow advances:** in `backend/caseload`, an operator opens a pending proposal, clicks **Approve** (or **Edit** → edited payload, or **Reject** → reason); the dispose POST returns 200, `flash` confirms, and the parked `INVOKE_AGENT` instance resumes (verified via the process-detail timeline flipping the step from "Parked" to done).
2. **Playground run:** selecting `deals.health_check` + a JSON input and Running renders a typed actionable `ProposalCard` + collapsible tools/steps trace from `POST /agents/:id/run`.
3. **RBAC:** caseload/proposal pages gate on `agent_orchestrator.proposals.view` (+ `.dispose` for the action buttons); agents/playground on `agent_orchestrator.agents.view`/`.run`; node config on `agent_orchestrator.workflows.author` — all via `page.meta.ts requireFeatures` (immutable ACL ids from area 01, never `requireRoles`).
4. **Tenant isolation:** all reads/writes go through area 01/03 APIs which filter by `organizationId`; the UI never constructs cross-tenant queries; a cross-tenant proposal id returns 404/403 and the page shows `RecordNotFoundState`.
5. **DS/i18n:** no hardcoded status colors or arbitrary values; brand-violet only on AI touchpoints; all strings i18n; `yarn lint` + the DS/i18n checkers pass.

## Risks & Impact Review

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Injecting a timeline into `workflows` instance detail needs a spot that doesn't exist yet | Med | Med | Add the injection spot **additively** (BC-safe), coordinate with workflows owner; same pattern as the existing `sales.document.detail.order:details` group spot. |
| Copying mockup's hardcoded colors / legacy monitor `bg-blue-100` into real components | Med | Med | DS checklist + Boy-Scout rule; review uses `StatusBadge`/status tokens only; `om-ds-guardian` pass. |
| Edit-disposition payload editing is unbounded/typed-per-agent | Med | Low | MVP: edit raw payload `Textarea` validated against the proposal's result schema client-side; reject invalid before POST. |
| Playground "Approve & run" implies an ad-hoc dispose with no workflow/process | Low | Low | In playground, Approve is disabled (with hint) unless a persisted proposal row exists; the run itself is read-only. |
| Four-verb buckets depend on USER_TASK shapes from 02/03 not finalized | Med | Low | MVP renders **Decide** from pending proposals; Do/Answer/Know render only when those task shapes are present — additive, no breakage. |
| False-409 if dispose touches sibling entities | Low | Med | Use the proposal's own `updatedAt` for the lock header; per shared contract, override parent header per child if `onSubmit` mutates others. |

## Integration Coverage

Playwright (`.ai/qa`), self-contained (create fixtures via API in setup, clean up in teardown; no seeded-data reliance):

- **Caseload → dispose → resume:** seed a tenant + an `INVOKE_AGENT` workflow instance parked on a proposal (via 02/03 fixtures) → open `/backend/caseload`, open the proposal, **Approve** → assert 200 + caseload no longer lists it + the instance step advances (process-detail timeline). Repeat for **Reject** (reason required) and **Edit** (edited payload persisted).
- **Playground run:** select agent + input, Run, assert the actionable card + trace render from `POST /agents/:id/run`.
- **Optimistic-lock 409:** dispose a proposal whose `updatedAt` is stale → assert the unified conflict bar appears (`surfaceRecordConflict`).
- **Cross-tenant denial:** as tenant A, request a tenant-B `proposalId` → assert 404/403 + `RecordNotFoundState`; assert dispose POST is rejected.
- **RBAC:** a user lacking `agent_orchestrator.proposals.dispose` sees the proposal (view) but the Approve/Edit/Reject actions are hidden/disabled; a user lacking `.view` cannot load the page.
- **API coverage:** `GET /agents`, `GET /proposals`, `GET /proposals/:id`, `GET /runs/:id`, `POST /agents/:id/run`, `POST /proposals/:id/dispose` exercised through the UI flows above.

## Migration & Backward Compatibility

Purely **additive**: new pages, new components, a new injection bundle, new i18n keys, and (if needed) one **additive** injection spot on the `workflows` instance-detail page (no removal/rename — follows `BACKWARD_COMPATIBILITY.md`). The dispose UI consumes area-03's API and area-01's ACL features; no existing contract surface (types, signatures, event ids, spot ids, routes, DB) changes here. ACL features are **consumed** in `page.meta.ts`, defined in area 01. The Invoke-Agent node config component is a new export consumed by area 02; its prop contract is the frozen area-02 activity-config schema. No deprecations.

## Final Compliance Report

- **Architecture:** UI-only in `agent_orchestrator/backend` + `ui`; no new entities, no cross-module ORM relations; reads/writes via 01/03 APIs (org-scoped). ✔
- **DS:** status tokens for states, brand-violet only for AI touchpoints, DS primitives throughout, no arbitrary values, Boy-Scout migration of any touched legacy color. ✔
- **Data/HTTP:** `apiCall*` only; guarded dispose with optimistic lock + `surfaceRecordConflict`; defensive JSON reads. ✔
- **i18n:** `useT()`/`resolveTranslations()`, all strings in `i18n/`, internal strings `[internal]`-prefixed. ✔
- **RBAC/tenant:** feature-based `requireFeatures` guards (immutable ids), org-scoped APIs, cross-tenant denied. ✔
- **Testing:** integration coverage for every dispose/run path + cross-tenant + 409 + RBAC. ✔
- **BC:** additive only; one additive injection spot if required. ✔

## Changelog

- **2026-06-20:** Created area-04 Cockpit UI build spec — real Open Mercato backend pages + widget injection translating `om-agent-cockpit-mvp.html`: operator caseload (four-verb), proposal disposition card + Agent I/O drawer, process-detail timeline injection, counts-only overview, agents registry, dev Playground, and the Invoke-Agent node config UI (coordinated with area 02). Trace inspector + Audit stubbed as DS empty states. UI-only, no entities; reads from 01/03, writes via 03 dispose; DS- and i18n-compliant.
