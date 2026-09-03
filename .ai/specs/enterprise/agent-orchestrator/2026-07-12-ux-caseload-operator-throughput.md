# Caseload Operator Throughput — Keyboard-First Review Flow (UX Remediation 4/5)

> Part of the [UX Remediation Plan](./2026-07-12-ux-remediation-plan.md) (spec 4 of 5). Findings source:
> [`.ai/analysis/2026-07-12-agent-orchestrator-ux-audit.md`](../../../analysis/2026-07-12-agent-orchestrator-ux-audit.md) — theme C
> + Caseload slice (C1 shipped separately in spec 1's inbox pager; this spec owns everything else in the operator loop).
> Q-gate decision **Q4 = full keyboard-first flow in this spec** (not just quick wins).

## TLDR

**Key Points:**
- Turns the Caseload from a mouse-driven review page into a high-volume triage tool: full keyboard flow (j/k + A/R/E), deliberate advance-to-next after dispose, queue-position indicator, and bulk-selection that survives live refreshes.
- Makes fast decisions *safe*, not just fast: row-level guardrail risk chips, undo-window on warn-flagged approves, real proposed-action summaries (kills the rationale-prose leak), structured field-level editing instead of whole-payload JSON surgery, and a visible auto- vs human-approved split.
- Pure UI/state work inside `agent_orchestrator` — **zero schema changes, zero new endpoints** (`guard_results` is already selected by the proposals list route; queue state moves into the URL).

**Scope:** `backend/caseload/page.tsx`, `backend/caseload/[proposalId]/page.tsx`, `components/{ProposalCard,proposalFactsData,types}.tsx|ts`, module i18n ×4, integration tests.

**Concerns:** hotkey ergonomics vs. accidental approves is a real tension — resolved with an undo-window pattern (see Design Decisions); global-shortcut collisions audited (Cmd+K palette, dialog-local Escape handlers).

## Overview

The Caseload is the operator persona's home: every `USER_TASK`-gated proposal lands here for approve / edit / reject. The operations-UI spec names **high-volume review** and **anti-rubber-stamping** as explicit goals. The live audit confirmed the decision *pane* is informative and fast — but the loop around it is all-mouse, loses state on live events, and hides risk until the pane is opened.

> **Market Reference**: Gmail/Linear-style triage (j/k + single-letter actions + undo toast) and Superhuman's "archive → advance" model. Adopted: vim-style navigation, single-key actions with an undo window, position indicator. Rejected: modal "confirm every action" dialogs (Zendesk-style) — they destroy throughput and train blind confirmation, the exact rubber-stamping failure the module is designed to avoid.

## Problem Statement

Audit findings this spec resolves (verified against code on 2026-07-12):

1. **All-mouse loop** — rows are plain buttons, decisions live in the pane footer; approve = 2 clicks, reject = 3 + typing; the only shortcut anywhere is Cmd+Enter inside dialogs (`backend/caseload/page.tsx:919-965`, `:1076-1096`).
2. **Accidental, disorienting "advance"** — after dispose the selection effect resets to `rows[0]` (`:919-923`), jumping the operator to the top instead of the neighbor.
3. **Live events wipe bulk selection** — `setSelectedIds(new Set())` fires on every `reloadToken` bump (`:381`), and any org-wide `proposal.*` event bumps it (`:312-314`).
4. **Risky rows look identical to safe rows** — no guardrail signal at row level; approve is a frictionless hover-icon adjacent to reject (`:566-595`), although `guard_results` is *already in the list response* (`api/proposals/route.ts:43`, mapped at `components/types.ts:266`).
5. **"Proposes" shows accidental prose** — `summarizeProposal` probes `DECISION_KEYS` that don't exist on the canonical `{actions, confidence, rationale}` payload and falls back to "first string value" = the rationale sentence (`:135-145`); it pollutes the column, the pane headline (`headlineOf`, `:168-170`), and the "All decisions" filter options (`:359`).
6. **Edit is whole-payload JSON surgery** — `isComplexPayload` is effectively always true for real proposals, so operators edit rationale+confidence+actions in one raw textarea (`components/ProposalCard.tsx:82-91`, `:264-276`).
7. **Queue context evaporates** — view/segment/search/sort/page live only in React state (`:217-229`); disposing from the detail page hard-pushes bare `/backend/caseload` (`[proposalId]/page.tsx:145`).
8. Smaller: Approved tab merges `approved,auto_approved,edited` behind one badge (`:76-81`, `:117-121`); dead select-all checkbox on non-pending tabs (`:541-562`); bulk failures flash one toast per row (`:409-429`); "Gated to you" vs "shared caseload" copy contradiction (`:626`).

## Proposed Solution

### Interaction model (the core design)

One explicit client-side state machine for the inbox, replacing today's implicit `selectedId` + effect:

```
Focus context:  QUEUE (list has focus)  |  PANE (decision pane focus)  |  MODAL (dialog/textarea open)
Cursor:         cursorId (proposal id) + cursorIndex (position in the loaded, filtered row set)

QUEUE/PANE hotkeys (inert in MODAL):
  j / ArrowDown   → cursor to next row        k / ArrowUp → previous row
  Enter / o       → open pane for cursor row (focus stays QUEUE-scoped)
  a               → approve cursor row   (undo window if warn-flagged — see below)
  r               → open reject dialog (mandatory reason; Cmd+Enter submits, Escape cancels — unchanged)
  e               → open structured edit for cursor row
  x               → toggle bulk-select on cursor row
  ?               → open shortcut legend popover
  Escape          → close pane / clear cursor (never intercepts while MODAL)
```

- **Modal guard**: a single `useCaseloadHotkeys` hook attaches one `document` keydown listener; it returns early when `event.target` is an editable element (`input`, `textarea`, `select`, `[contenteditable]`) or any Radix dialog is open. This coexists with the app shell's Cmd+K palette (modifier-based, no overlap — `packages/ui/src/primitives/command-menu.tsx`) and dialog-local Escape handlers (checked: `DataTable.tsx:733` listener is Escape-for-column-menu only).
- **Advance-to-next**: on dispose (single or via hotkey), cursor moves to the next *pending* row (`cursorIndex` preserved, i.e. the row that slid into the disposed row's slot); at end of queue, move backwards; when the queue empties, show the existing "caseload clear" empty state with focus returned to the tab bar.
- **Queue position**: the pane header renders "`{position} of {total}`" from `cursorIndex + (page-1)*pageSize` against the server `total` already returned by the list call.
- **Discoverability**: a `KbdShortcut` legend (primitives exist: `packages/ui/src/primitives/kbd.tsx`) — inline hint row under the inbox header ("j/k navigate · a approve · r reject · e edit · ? all shortcuts") plus a `?`-triggered popover with the full map. A/R/E letters also appear as `<Kbd>` chips on the pane footer buttons.

### Risk-aware speed (anti-rubber-stamp)

- **Row chips**: render a compact guardrail chip on inbox rows and a column cell in list view — `ShieldAlert` + count for `warn`, error-toned for `block`/`fail` — from the already-mapped `proposal.guardResults`. No API change.
- **Undo window instead of confirm**: approving a warn-flagged proposal (any `guardResults` entry with `result !== 'pass'`) does **not** open a dialog; it shows an 8-second undo flash ("Approved — Undo") and defers the actual `dispose` call until the window elapses or the operator navigates on. Undo cancels locally (no server round-trip). *Rationale*: a confirm dialog on every risky row trains click-through (the rubber-stamp failure mode) and halves throughput; a deferred-commit undo keeps one-keystroke speed while making mistakes recoverable. Reject keeps its mandatory-reason dialog (destructive + requires input anyway). Clean rows approve immediately, as today.
- **Approved-tab honesty**: `statusOf` splits `auto_approved` into its own badge (`caseload.status.autoApproved`, info tone) so auto vs human approval is visible where dispositions are reviewed.

### Content correctness

- **Export and use `summarizeProposalShaped`** (`components/proposalFactsData.ts:89` — currently module-private): `summarizeProposal` is replaced by a thin wrapper that parses the canonical payload and renders `actions[0].type` humanized + action count ("Set stage · +1 more"), falling back to the agent label. The "All decisions" filter options become the distinct humanized action types (bounded vocabulary) instead of prose sentences.
- **Structured edit**: `ProposalCard` gains an actions-aware editor — for each `actions[n]`, primitive fields of `action.payload` render as typed inputs (reusing `deriveProposedFields`, `proposalFactsData.ts:130`); `type` renders read-only; `confidence`/`rationale` are not editable (they are the agent's testimony, not the operator's). "Edit raw JSON" remains as an explicit escape hatch behind a toggle, editing only the `actions` array — never the whole payload. Submitted edits reassemble the canonical payload shape.

### State that survives

- **Selection preservation**: replace the wipe at `:381` with `setSelectedIds(prev => intersect(prev, pendingIdsInNewRows))`; deliberate context switches (tab/segment/view change) still clear.
- **Queue state in URL**: `view`, `segment`, `q`, `sort`, `page`, `pageSize` become search params (Next `useSearchParams` + `router.replace`, shallow). Round-trip mechanism is **explicit query-string passthrough only**: the list page appends its current queue params to the detail link (`/backend/caseload/<id>?<queueParams>`), and the detail page's post-dispose redirect (`[proposalId]/page.tsx:145`) and Back button rebuild `/backend/caseload?<queueParams>` from those forwarded params. Deep links to a filtered queue become shareable for free.
- **Bulk-failure summary**: the sequential bulk loop aggregates results and emits one flash ("7 approved, 3 failed — first error: …") instead of per-row toasts; failed ids stay selected for retry.
- **Dead select-all**: header checkbox renders only when the active tab has selectable (pending) rows.
- **Copy fix**: subtitle drops the "Gated to you"/"shared caseload" contradiction — pane label becomes `caseload.inbox.needsDecision` ("Needs a decision"); subtitle states the shared queue + active sort honestly (parameterized by the current sort label).

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Undo-window (deferred commit) over confirm dialog for warn-flagged approves | Preserves one-keystroke throughput; avoids training click-through; mistakes recoverable within 8 s; reject already has a dialog because it requires a reason |
| Single `useCaseloadHotkeys` hook, letter keys without modifiers | Gmail/Linear convention for triage surfaces; modifier-free is what makes 100+/day feasible; modal/editable guard prevents text-input collisions |
| Cursor state machine replaces `selectedId` effect | The `rows[0]` reset (`:919-923`) is the root cause of the disorienting jump; an explicit cursor makes advance-to-next, position display, and hotkey targeting one coherent model |
| Filter options from action types, not prose | Bounded, translatable vocabulary; prose options were unbounded and duplicated |
| No API/schema changes | `guard_results` already in the list select; totals already returned; everything else is client state |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Confirm dialog on risky approves | Throughput collapse + click-through training (see above) |
| Optimistic immediate dispose + server-side revert on undo | Requires an un-dispose command/API — bigger surface, race-prone; deferred commit is client-only |
| Global keyboard library (`react-hotkeys-hook` dep) | "Ask First" production dependency for one page; a 60-line hook suffices |
| Virtualized infinite queue instead of pages | Spec-1's pager already fixes reachability; virtualization is perf work out of remediation scope |

## User Stories / Use Cases

- **Operator** wants to clear the pending queue **without touching the mouse** so that 100+ decisions/day is realistic.
- **Operator** wants risky proposals **visibly marked in the queue** so that speed never means blind approval.
- **Operator** wants an approve **to be undoable for a few seconds** so that a slip of the finger isn't an audit event.
- **Team lead** wants **auto- vs human-approved visibly split** so that rubber-stamping is detectable.
- **Operator** wants to **share a link to a filtered queue** so that handoffs ("take the fraud segment") are one URL.

## Architecture

Client-only feature inside the existing page components; no new services, DI, events, or commands. Dispose calls keep the existing `useGuardedMutation` + optimistic-lock header path (`buildOptimisticLockHeader(row.updatedAt)`); the undo window merely *delays* the same call. The hotkey hook and cursor reducer live beside the page (`backend/caseload/hooks.ts`) — module-local, not in `packages/ui` (no second consumer yet; promote later if Traces wants j/k).

### Commands & Events
None added or changed. Existing `agent_orchestrator.proposal.disposed` flow untouched (the undo window fires the same dispose exactly once or not at all).

## Data Models
No changes. Reads use fields already present on `AgentProposal` list rows (`guard_results`, `disposition`, `updated_at`).

## API Contracts
No changes. (URL queue-state is client routing, not API.) The list route's existing `sortField/sortDir/segment/page/pageSize` params are simply mirrored into the page URL.

## Internationalization (i18n)

New/changed keys (en/es/de/pl, sorted; representative): `caseload.hotkeys.{legendHint,title,navigate,approve,reject,edit,select,open,help}`, `caseload.inbox.{position,needsDecision,riskFlagged}`, `caseload.status.autoApproved`, `caseload.undo.{approved,action}`, `caseload.bulk.summary`, `caseload.edit.{structuredTitle,rawToggle,actionLabel}`, subtitle rewrite keys. Filter options use humanized action types via `humanizeKey` — verify non-Latin-safe humanization; keep raw type as tooltip.

## UI/UX

- Inbox row: `[risk chip?] [confidence face] [summary] [agent] [waiting]` — risk chip leftmost (first thing scanned), `text-status-error-text`/warning tokens only.
- Pane footer: `[A] Approve  [R] Reject  [E] Edit` with `<Kbd>` chips; position indicator right-aligned in the pane header.
- Shortcut legend: `?` popover using `KbdShortcut`; Escape closes (house dialog rules).
- Undo flash: existing flash system with an action button; 8 s; screen-reader announced (`role="status"`).
- A11y: cursor row gets `aria-selected` + `tabIndex=0` roving focus; hotkeys are an *enhancement* — every action remains reachable by Tab+Enter.

## Migration & Compatibility
None: no schema, no API, no contract surfaces. URL params are additive (absent params = today's defaults). No BC review needed beyond exporting `summarizeProposalShaped` (additive export).

## Implementation Plan

### Phase 1 — Cursor model + advance-to-next (ships alone)
1. Extract inbox selection into a cursor reducer (`cursorId`/`cursorIndex`); replace the `rows[0]` reset effect; advance-to-neighbor on dispose; end-of-queue behavior; position indicator. Unit tests for the reducer (dispose mid-list, at end, queue empties, refresh reorders).
2. Selection preservation: intersect `selectedIds` with surviving pending ids on `reloadToken` refresh (deliberate context switches still clear). Unit test with a simulated live event.

### Phase 2 — Hotkeys + legend
1. `useCaseloadHotkeys` hook (modal/editable guard, scope rules); wire j/k/Enter/o/x/Escape.
2. Wire a/r/e to the pane actions; `<Kbd>` chips on footer buttons; `?` legend popover; inline hint row. Unit tests: guard inertness (focus in textarea/dialog), key→action dispatch.

### Phase 3 — Risk-aware approve
1. Row-level guard chips (inbox + list column) from `proposal.guardResults`.
2. Undo-window deferred dispose for warn-flagged approves (timer, navigate-away commits, undo cancels); auto_approved badge split. Unit tests: warn detection, commit-on-timeout, cancel, exactly-once dispose.

### Phase 4 — Content correctness
1. Export `summarizeProposalShaped`; replace `summarizeProposal`; filter options become humanized action types. Update pane headline.
2. Structured editor in `ProposalCard` over `actions[n].payload` via `deriveProposedFields`; raw-JSON escape hatch scoped to `actions`; payload reassembly + zod-shape guard before submit. Unit tests: field derivation, reassembly, raw-hatch parity.

### Phase 5 — State & polish
1. URL-encoded queue state + detail-page round-trip; bulk-failure summary flash; dead select-all removal; subtitle copy fix. i18n ×4; `yarn i18n:check-sync`.

### Testing Strategy / Integration coverage (implement with this change)
- `TC-AGENT-CASELOAD-010` — keyboard-only journey: seed 3 pending proposals → j/j/k navigation → `a` approves clean row → cursor advances to neighbor → `r` opens dialog, Cmd+Enter submits with reason → queue empties to clear-state. (API fixtures via direct seed, precedent `agentPerfFixtures.ts`.)
- `TC-AGENT-CASELOAD-011` — selection survives live event: select 2 rows → create a new proposal via API → SSE-driven reload → both checkboxes still set; disposed row drops out of the set.
- `TC-AGENT-CASELOAD-012` — risk chip + undo: seed a warn-flagged proposal (guard_results with `result:'warn'`) → chip visible in row → `a` shows undo flash, no dispose call for 8 s → Undo leaves it pending; second pass lets the window elapse → disposed exactly once.
- `TC-AGENT-CASELOAD-013` — URL state roundtrip: set segment/sort/page → open detail → dispose → return lands on the same segment/sort/page.
- `TC-AGENT-CASELOAD-014` — summary correctness: canonical `{actions:[{type:'set_stage',…}]}` payload renders "Set stage" in the column/headline/filter, never the rationale text.

## Risks & Impact Review

Data integrity: dispose stays a single existing guarded call (undo window = delayed invocation, never a second mutation); interruption during the window (tab close) means *no* dispose — safe direction. Concurrent dispose by another operator during a window surfaces as the existing 409 conflict bar. Cascading: none — no event/contract changes. Tenant isolation: unchanged (list route scoping untouched). Deployment: no migration; ships dark behind nothing (pure UI).

#### Hotkey collision / unintended action
- **Scenario**: a keystroke meant for a text field triggers approve (focus tracking bug), or a browser/extension shortcut overlaps.
- **Severity**: High (wrong disposition is an audit-visible action)
- **Affected area**: caseload inbox
- **Mitigation**: editable/modal guard tested at unit level; letter keys only act when a QUEUE/PANE context is provably focused; warn-flagged rows additionally get the undo window; reject always dialogs.
- **Residual risk**: clean-row misfire approves instantly with no undo — acceptable because it matches today's single-click exposure and remains correctable via the existing correction flow.

#### Undo window vs. real-time expectations
- **Scenario**: operator approves (deferred), immediately closes the laptop; dispose never fires; the item silently stays pending.
- **Severity**: Medium
- **Affected area**: disposition latency, SLA tiles
- **Mitigation**: `visibilitychange` (document hidden) is the **primary** early-commit trigger — it fires reliably on tab switch, minimize, and most close paths; `beforeunload` is a best-effort secondary only (an async authenticated fetch is not reliably delivered during unload, and `sendBeacon` cannot carry the guarded-mutation path); navigate-away within the app commits synchronously.
- **Residual risk**: hard crash inside the 8 s loses one approval — item remains pending (fail-safe direction), acceptable.

#### Cursor drift under live refreshes
- **Scenario**: SSE reload reorders rows while the operator is mid-j/k; cursor lands on an unexpected row and `a` approves it.
- **Severity**: Medium
- **Mitigation**: cursor follows `cursorId` (not index) across refreshes; if the id vanished, cursor moves to the *nearest* index without auto-acting; hotkeys are one-shot (no key repeat action).
- **Residual risk**: visual jump on reorder remains (inherent to a live queue); coalesced refresh (5 s) bounds frequency.

## Final Compliance Report — 2026-07-12

### AGENTS.md Files Reviewed
- `AGENTS.md` (root) · `packages/ui/AGENTS.md` · `packages/ui/src/backend/AGENTS.md` · `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md` · `.ai/ds-rules.md` · `.ai/qa/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root | No hardcoded user-facing strings | Compliant | All new copy via `t()`, keys ×4 locales |
| root | Optimistic locking on mutations | Compliant | Existing per-row `buildOptimisticLockHeader` path unchanged; undo delays, never duplicates |
| root | `useGuardedMutation` for non-CrudForm writes | Compliant | All dispose paths keep the existing wrapper |
| root | Integration coverage listed + implemented with the change | Compliant | TC-AGENT-CASELOAD-010…014 |
| ds-rules | Status colors via semantic tokens only | Compliant | Risk chips use `status-error/warning` tokens; confidence faces untouched (no-amber rule preserved) |
| ui AGENTS | Dialog Cmd+Enter / Escape | Compliant | Reject dialog unchanged; legend popover closes on Escape |
| root | No new production dependencies without asking | Compliant | Hand-rolled 60-line hotkey hook, no library |
| root | Keep `pageSize` ≤ 100 | Compliant | Unchanged options [10,20,50] |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No model/API changes; reads verified against `api/proposals/route.ts:43` |
| API contracts match UI/UX section | Pass | URL params mirror existing list params only |
| Risks cover all write operations | Pass | Dispose (single/bulk/undo-deferred) covered |
| Commands defined for all mutations | Pass | No new mutations |
| Cache strategy covers read APIs | Pass | No new reads |

### Non-Compliant Items
None.

### Verdict
**Fully compliant** — ready for implementation.

## Changelog
### 2026-07-12
- Initial specification (from UX audit theme C; Q4 resolved to full keyboard flow).
- Post-review fixes applied per fresh-context architectural review: M-8 (undo-window flush — `visibilitychange` primary, `beforeunload` best-effort only), L-5 (queue-state round-trip = explicit query-string passthrough; `document.referrer` mention removed).
- **Implemented** (all five phases, one commit each on `feat/agent-orchestrator-mvp`):
  - Phase 1 `b76b26444` — cursor reducer in `backend/caseload/hooks.ts` (`reconcileCursor`/`advanceCursorAfterDispose`, follows `cursorId`, nearest-survivor fallback), advance-to-neighbor, "{n} of {total}" position indicator, selection intersect on live reloads.
  - Phase 2 `91641ab78` — `useCaseloadHotkeys` (pure resolver, guards: repeat→modifier→modal→editable; legend popover treated as a modal layer), full j/k + a/r/e/x/o/?/Escape bindings, `role="listbox"` + roving tabIndex, Kbd hint row + `?` legend.
  - Phase 3 `3482249ad` — row guard chips (warn/block toned), 8 s undo-window deferred dispose (`createDeferredDisposeManager`, single `settle()` = structurally exactly-once; `visibilitychange` primary flush; inline undo bar — flash primitive has no action support), `auto_approved` badge split; test seam `window.__omCaseloadUndoWindowMs`.
  - Phase 4 `111cb2ab9` — `summarizeProposalActions` kills the rationale-prose leak in column/headline/filter/undo-bar (filter options = humanized action types); structured editor over `actions[n].payload` (`components/proposalEdit.ts`, validated against the server's own zod schemas; raw hatch scoped to actions; confidence/rationale never editable); playground read-only mode unaffected.
  - Phase 5 `1be13ce90` — queue state in URL (debounced replace, passthrough round-trip through the detail page), one aggregated bulk flash with failed rows kept selected, dead select-all removed, "Needs a decision" + active-sort subtitle copy.
  - TC-AGENT-CASELOAD-010…014 authored (env-gated). Final module suite at completion: 96 suites / 626 tests green.
