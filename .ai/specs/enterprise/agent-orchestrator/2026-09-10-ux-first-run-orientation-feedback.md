# Agent Orchestrator — First-Run Orientation: feedback-derived task list

**Date:** 2026-09-10 · **Status:** F1, F2(a), F4, F5, F6, F7(a), F7(b) implemented 2026-09-14; F3 and F8 gated (see Changelog)
**Source:** unstructured feedback from a first-time tester walking the cockpit end-to-end on
`feat/agent-orchestrator-mvp` (PR #5718). Verbatim text in [Appendix A](#appendix-a--source-feedback-verbatim).
**Scope:** `packages/enterprise/src/modules/agent_orchestrator/backend/**` (+ its `i18n/*.json`);
three tasks reach into core — F2(c) nav ordering and F3's i18n values in
`packages/core/src/modules/workflows` (F2(c) still **Ask First**), and F7(b)'s additive nav-badge field in
`packages/shared` + `packages/ui` (**approved 2026-09-14**, additive-only).
**Naming decision (2026-09-14):** the user-facing name for the workflow surface is **Automations**
(pl **Automatyzacje**), replacing "Workflows" / "Przepływy pracy" in all UI copy. Module id, routes,
event ids and code identifiers stay `workflows` — see [F3](#f3--adopt-one-vocabulary-automations).
**Related:** [`2026-09-06-business-process-workflow-unification.md`](./2026-09-06-business-process-workflow-unification.md)
(owns the Process ↔ Workflow model — F3 supplies the label it ships under),
[`2026-07-12-ux-navigation-pass.md`](./2026-07-12-ux-navigation-pass.md) (shipped; F5 extends its Playground work).

## TLDR

The tester's verdict was not "this is broken" — every screen worked. It was **"I did not know where to
start, and I did not know that nothing would happen until I approved it."** Two orientation failures,
not feature gaps:

1. **The sidebar is ordered by operator frequency, but a first-time user needs the order of *use*.**
   Today the Agents group renders Overview → Caseload → Processes → Traces → Agents → Playground →
   Process definitions → Audit. The learning path is Agents → Playground → build an automation → Caseload →
   Traces/Audit. The user reverse-engineered that path by exhaustion.
2. **The propose-only contract — the product's central safety promise — is stated nowhere up front.**
   She ran an agent, waited for something to happen, and only later discovered proposals sitting in the
   Caseload awaiting her decision.

Eight tasks below. **F1, F4, F6 are the minimum viable fix** (nav order, a start-here path, a propose-only
line); they are all copy/metadata-level and carry no contract risk.

## Task index

| ID | Task | Problem in one line | Surface | Size | Priority |
|----|------|--------------------|---------|------|----------|
| [F1](#f1--reorder-the-agents-sidebar-group-to-the-order-of-use) | Reorder the Agents sidebar group | Menu order is frequency-first, so a newcomer meets the *outputs* before the *inputs* | 8 × `page.meta.ts` | XS | **P1** |
| [F2](#f2--the-golden-path-crosses-two-sidebar-groups-with-no-bridge) | Bridge Agents → Automations | Step 3 of the path lives in a different sidebar group under a different vocabulary | meta + one nav link (**Ask First** if core) | S | **P1** |
| [F3](#f3--adopt-one-vocabulary-automations) | Adopt one vocabulary: **Automations** | Four names ("Procesy", "Definicje procesów", "Definicje Przepływów Pracy", "Instancje Przepływów Pracy") for two concepts | i18n ×5 locales, both modules | S–M | **P2** |
| [F4](#f4--no-first-run-orientation-on-overview) | "Start here" path on Overview | Nothing on the landing page says what to do first | `backend/overview` + i18n | S | **P1** |
| [F5](#f5--playground-does-not-say-how-to-make-a-run-real) | Playground → "make this real" CTA | Sandbox previews an action; the path to executing one (an automation with an `INVOKE_AGENT` step) is undocumented in-product | `backend/playground` + deep link | S–M | **P2** |
| [F6](#f6--the-propose-only-contract-is-invisible-until-it-surprises-you) | Propose-only explainer | The safety promise is only stated *after* a gated decision happens | 4 pages + i18n | S | **P1** |
| [F7](#f7--pending-proposals-never-announce-themselves) | Announce pending proposals | The user waited instead of being told a decision was hers to make | module `notifications.ts` **+** additive nav-badge field in `shared`/`ui` | M | **P2** |
| [F8](#f8--reuse-the-playground-pattern-elsewhere-positive-signal) | Reuse the Playground pattern | The one screen she called fully clear is the one nothing else copies | multiple | M | **P3** |

---

## F1 — Reorder the Agents sidebar group to the order of use

### Problem

> *"na starcie nie wiedziałam, od czego zacząć … dopiero po przejściu całej ścieżki złapałam, że kolejność
> to: Agenci → Piaskownica → zbuduj przepływ → Kolejka zadań → Ślady/Audyt"*

The sidebar sorts by `pagePriority` when present, else `pageOrder`
(`packages/shared/src/modules/navigation/backendChrome.ts:14`). Current declared values put the
**outputs of the system before its inputs**:

| Rendered order today | Page | `pagePriority` | `pageOrder` |
|---|---|---|---|
| 1 | Overview / Przegląd | 10 | 90 |
| 2 | Caseload / Kolejka zadań | 11 | 91 |
| 3 | Processes / Procesy | 12 | 92 |
| 4 | Traces / Ślady | 15 | 95 |
| 5 | Agents / Agenci | 20 | 120 |
| 6 | Playground / Piaskownica | 30 | 130 |
| 7 | Process definitions / Definicje procesów | 40 | 160 |
| 8 | Audit / Audyt | 60 | 180 |

That order is defensible for a daily operator (the Caseload is where they live) and actively misleading
for everyone on day one. The tester independently proposed the fix, so treat it as validated.

### What to change

Rewrite `pagePriority` in the eight `page.meta.ts` files under
`packages/enterprise/src/modules/agent_orchestrator/backend/` to:

| Target order | Page | New `pagePriority` |
|---|---|---|
| 1 | Overview | 10 |
| 2 | Agents | 20 |
| 3 | Playground | 30 |
| 4 | Process definitions | 40 |
| 5 | Processes | 50 |
| 6 | Caseload | 60 |
| 7 | Traces | 70 |
| 8 | Audit | 80 |

**Do not** fix this by editing `pageOrder` alone — `pagePriority` wins wherever it is declared, so a
`pageOrder`-only change is a silent no-op. Either restate both consistently or drop `pagePriority` from
these eight metas and let `pageOrder` rule.

### Acceptance criteria

- The Agents group renders in the eight-row order above, verified in the running app (not only in the metas).
- No `pagePriority`/`pageOrder` pair in the group disagrees about relative position.
- ACL-hidden pages still collapse cleanly (a user without `processes.view` sees no gap or stray separator).

### Open question

Do we want to keep the operator-first order behind a preference (the sidebar already supports
customization — `packages/ui/src/backend/sidebar/SidebarCustomizationEditor.tsx`), or is one order enough?
Recommendation: one order. A returning operator learns a menu in a day; a newcomer never gets a second first run.

---

## F2 — The golden path crosses two sidebar groups with no bridge

### Problem

> *"Procesy, Definicje procesów, Instancje przepływów, Wizualny edytor, Piaskownica 🙈"*

That list is not one menu — it is the tester scanning **two** sidebar groups trying to find the entry
point. `Definicje Przepływów Pracy`, `Instancje Przepływów Pracy` and `Wizualny Edytor Przepływów Pracy`
belong to core `workflows` (group `workflows.module.name` = *"Silnik procesów biznesowych"*,
`packages/core/src/modules/workflows/backend/{definitions,instances,definitions/visual-editor}/page.meta.ts`),
while `Procesy` / `Definicje procesów` / `Piaskownica` belong to the enterprise `agent_orchestrator` group.

Step 3 of the golden path ("zbuduj przepływ") is therefore in a group the user has no reason to associate
with agents, and F1 alone cannot fix it — cross-group ordering is not a thing.

Those labels are what the code ships **today**; [F3](#f3--adopt-one-vocabulary-automations) renames them to
**Automatyzacje**. F2 is about reachability and does not depend on F3 landing first — but any new copy F2
adds must already use the Automations vocabulary, so the bridge is never built under the retired name.

### What to change

Pick one (in ascending order of blast radius):

- **(a) Link, don't move** — the Agents-group orientation block (see F4) and the Playground CTA (see F5)
  link straight to `/backend/workflows/definitions` and the visual editor, labeled **Automatyzacje**. No nav change at all.
  **Recommended** — this is the cheapest change that removes the dead end.
- **(b) A nav alias** — declare an agent-orchestrator page in the Agents group that redirects to the
  automation definitions list, labeled **Automatyzacje**. Costs a route; no core touch.
- **(c) Reposition the automations group** so it renders directly under Agents. Touches core nav ordering
  and affects installations that never enabled the orchestrator → **Ask First**.

### Acceptance criteria

- From every screen on the golden path there is a visible, single-click route to the *next* screen,
  including the cross-group hop into automation definitions.
- No user-facing string is hard-coded; all new copy lands in `i18n/{en,pl,de,es,ko}.json`.

---

## F3 — Adopt one vocabulary: Automations

### Decision

The user-facing name for the workflow surface is **Automations** (pl **Automatyzacje**). "Workflow" /
"Przepływ pracy" is retired from UI copy in every locale. This is a **label** decision only — the module
id `workflows`, its routes (`/backend/workflows/**`), event ids, DI keys and i18n **key names** are
contract surface (`BACKWARD_COMPATIBILITY.md`) and stay exactly as they are. Only translation *values* change.

### Problem

Four labels currently name what a user experiences as two concepts:

| Label today (pl) | Label today (en) | Owner | Route |
|---|---|---|---|
| Procesy | Processes | agent_orchestrator | `/backend/processes` |
| Definicje procesów | Process definitions | agent_orchestrator | `/backend/processes/definitions` |
| Definicje Przepływów Pracy | Workflow Definitions | core workflows | `/backend/workflows/definitions` |
| Instancje Przepływów Pracy | Workflow Instances | core workflows | `/backend/workflows/instances` |

"Proces" and "przepływ pracy" are the same thing to a business user; "definicja" vs "instancja" is a
distinction the product asks them to hold before it has explained why it matters. The tester recited all
four labels as one undifferentiated wall.

### What to change

Target vocabulary — one term per concept:

| Concept | en | pl | Current key |
|---|---|---|---|
| The surface / sidebar group | Automations | Automatyzacje | `workflows.module.name` |
| The template a human authors | Automation | Automatyzacja | `workflows.definitions.title` → "Automations" (list), singular on detail |
| One execution of it | Automation run | Uruchomienie automatyzacji | `workflows.instances.title` → "Automation runs" / "Uruchomienia automatyzacji" |
| The graph editor | Automation editor | Edytor automatyzacji | `workflows.backend.definitions.visual_editor.title` |

Deliverables:

- A glossary section in [`2026-09-06-business-process-workflow-unification.md`](./2026-09-06-business-process-workflow-unification.md)
  (or this folder's `README.md`) fixing the table above, so later work cannot reintroduce "Workflow".
- An i18n **value** pass across `workflows/i18n/*.json` and `agent_orchestrator/i18n/*.json` (5 locales:
  en, pl, de, es, ko). German/Spanish/Korean take the equivalent of "Automation", not a transliteration
  of "Workflow".
- Resolve the agent_orchestrator side against the unification spec: whichever of "Procesy" /
  "Definicje procesów" it leaves without a distinct meaning is removed rather than kept as a synonym of
  Automatyzacje.
- Sweep the strings that embed the old word mid-sentence (hints, empty states, error copy), not only nav
  labels — `grep -ri "workflow\|przepływ" packages/core/src/modules/workflows/i18n/`.

### Acceptance criteria

- No user-visible string in either module contains "Workflow" / "Przepływ pracy" in any of the 5 locales,
  outside of code identifiers shown deliberately (e.g. a technical id column).
- Every nav label, page title and breadcrumb uses exactly one term per concept.
- `yarn i18n:check-values` reports no missing keys for the renamed set; no i18n **key** was renamed.
- The glossary is linked from `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md` and
  `packages/core/src/modules/workflows/AGENTS.md`.

### Status (2026-09-14) — naming surface done, body copy deferred with cause

The **naming surface is relabelled in all five locales**: `workflows.module.name`,
`definitions.title`, `create`/`edit`, the visual editor, `instances.*`, `events.*` and
`commandSettings.pageTitle` — the keys `page.meta.ts` actually renders into menus, page titles and
breadcrumbs. Each locale was written by hand, not substituted, because the noun's **gender changes**:
`automatización` is feminine where `flujo` was masculine (so `del flujo` → `de la automatización`),
`Automatisierung` is feminine and compounds through an `-s-` Fugenlaut, and Polish `automatyzacja`
inflects (`Utwórz automatyzację` accusative, `edytor automatyzacji` genitive).

**Deferred: ~1,580 body-copy values** across `workflows/i18n/*.json` (≈315 per locale) and
`agent_orchestrator/i18n/*.json` (≈20 per locale) that mention the old word mid-sentence. A scripted
substitution over these produces grammatically broken copy in pl/de/es — `Instancja Przepływu
Podrzędnego` → `Automatyzacji Podrzędnego` needs the adjective to agree (`Podrzędnej`), and
`Instancia del subflujo` → `Instancia del subautomatización` is simply wrong Spanish. Shipping 1,500
broken strings is worse than a consistent old term, so these need a native or translation-service pass
rather than a regex. **English body copy can be done mechanically and safely** and is the obvious next
increment.

The agent_orchestrator side needs **no removal**: the unification spec keeps Business Process as a
projection over workflow execution, so "Procesy" (business processes) and "Automatyzacje" (the engine)
are genuinely distinct concepts, not synonyms. The earlier plan to delete one of them does not apply.

### Dependency and risk

Ordered after the unification spec lands its model change, so the rename runs once. **Risk:** the word
"workflow" also appears in docs (`apps/docs/**`), the create-app template and AI agent/tool descriptions
that users read — decide in the glossary whether those follow now or stay until the docs pass, and say so
explicitly rather than leaving a half-renamed product.

---

## F4 — No first-run orientation on Overview

### Problem

> *"na starcie nie wiedziałam, od czego zacząć 😄 … Najbardziej intuicyjny ekran dla mnie [za wyjątkiem
> Przeglądu 😄]"*

The Overview is the landing page and the one screen she pointedly excluded from "intuitive". It renders
KPI tiles, a stuck queue and health — all of which read as noise before the user has produced any data.
Its empty state is a single line (`agent_orchestrator.overview.empty` / `.emptyDescription`) that
describes emptiness rather than prescribing a first step.

### What to change

Add a **"Start here"** orientation block to `backend/overview/page.tsx`, rendered above the tiles:

- Five numbered steps, each a link and each showing whether it is done, derived from data the page
  already loads or one cheap count each:
  1. **Agenci** — review the agents available to you → `/backend/agents` *(done when the agent list is non-empty)*
  2. **Piaskownica** — run one against an example input → `/backend/playground` *(done when this tenant has ≥1 run)*
  3. **Automatyzacja** — add an `INVOKE_AGENT` step so the agent runs for real → automation definitions (`/backend/workflows/definitions`) *(done when ≥1 definition contains an `INVOKE_AGENT` node)*
  4. **Kolejka zadań** — approve or reject what the agent proposed → `/backend/caseload` *(done when ≥1 proposal has been disposed)*
  5. **Ślady / Audyt** — see what actually happened → `/backend/traces` *(never "done"; always available)*
- Dismissible per user, and auto-collapsed once steps 1–4 are all done (persist the dismissal the way the
  module already persists per-user UI state; do not invent a new mechanism).
- Reuse existing DS components — `EmptyState`, `Button`, `StatusBadge` are already imported by this page.
  No new primitive, no arbitrary Tailwind values, no hard-coded status colors.

### Acceptance criteria

- A tenant with zero agent runs lands on Overview and sees the five-step path without scrolling on a 1280×800 viewport.
- Each step links to a real route the current user is allowed to open; steps gated away by ACL are hidden, not broken.
- Dismissal survives a reload and is per user, not per tenant.
- All copy in `i18n/{en,pl,de,es,ko}.json`; `yarn i18n:check-hardcoded` stays clean for this file.

---

## F5 — Playground does not say how to make a run real

### Problem

> *"musiałam trochę poeksplorować najpierw, żeby zrozumieć, jak sprawić, aby agent faktycznie coś zrobił,
> a nie tylko 'pokazał, co by zrobił' w piaskownicy, że trzeba zbudować odpowiedni przepływ pracy z krokiem
> 'wywołaj agenta'."*

The Playground already links forward to the trace and the created proposal
(`backend/playground/page.tsx:470-486`, shipped by the 2026-07-12 navigation pass). What it never says is
that a Playground run is a *rehearsal*, and that production execution requires an automation definition
carrying an `INVOKE_AGENT` activity (`packages/core/src/modules/workflows/components/nodes/InvokeAgentNode.tsx`,
config field `components/fields/AgentInvokeConfigField.tsx`). She found this by exploration, and explicitly
guessed that experienced users would not — which is exactly the population that does not need the product to be good.

### What to change

- One line of copy in the Playground compose card, above the Run button: this is a rehearsal; the agent
  proposes, and to have it run on real events you add it as a step in an automation.
- A **"Use this agent in an automation"** action on the post-run success card, next to "View trace" /
  "Open this proposal", deep-linking to the visual editor with the selected agent pre-bound to a
  new `INVOKE_AGENT` node. If the editor cannot yet accept a pre-selected agent via query param, ship the
  plain link to `/backend/workflows/definitions/create` first and file the pre-binding as a follow-up —
  do not block the copy fix on it.
- Gate the action on the automation-authoring feature; hide (do not disable) it for users without it.

### Acceptance criteria

- A user who has only ever opened the Playground can reach an automation definition containing an
  `INVOKE_AGENT` step without leaving the product for documentation.
- The new action never renders for a user who lacks permission to author automations.
- No raw `fetch`; any new call goes through `apiCall` per `AGENTS.md`.

---

## F6 — The propose-only contract is invisible until it surprises you

### Problem

> *"pod kątem głównego mechanizmu, gdzie agent tylko proponuje, a człowiek zatwierdza w Kolejce zadań …
> co jest oczywiście sensowe i bezpieczne, ale też najpierw czekałam, a dopiero potem się zorientowałam,
> że mam propozycje wymagające decyzji człowieka. Może warto gdzieś wyświetlić komunikat, że agenci tylko
> proponują, że nic nie zmienia się w systemie bez zatwierdzenia w Kolejce zadań?"*

Propose-only is the module's defining guarantee. Today it is stated in exactly one place, and only
*reactively*, after a gated decision has already occurred: `agent_orchestrator.proposal.gateReadonly`
("This decision is gated to a human…"). A user's first mental model is therefore formed by silence.

### What to change

One short, consistently worded statement — *agents only propose; nothing changes in the system until
you approve it in the Caseload* — surfaced in four places:

| Surface | Placement |
|---|---|
| Overview | inside the F4 "Start here" block (one line, not a second banner) |
| Agents list | a subtitle line under the page title |
| Playground | in the compose card, merged with the F5 rehearsal line — one sentence, not two |
| Caseload | in the empty state, so "nothing here" reads as "nothing awaits you" rather than "nothing works" |

Rules: one i18n key reused everywhere (`agent_orchestrator.proposeOnly.notice`) so the wording cannot
drift; static text, **no modal, no dismissible toast** — this is a standing property of the system, not
an announcement. Where an agent's autonomy is configured to auto-approve
(`agent_orchestrator.settings.autoApproval.*`), the line must not claim a human gate that no longer
applies — either scope the copy to gated agents or say "unless auto-approval is configured".

### Acceptance criteria

- The statement is reachable on first load of Overview, Agents, Playground and Caseload without interaction.
- Exactly one i18n key backs all four; translated in all 5 locales.
- The copy is accurate for tenants with auto-approval enabled.
- No DS violations: semantic tokens only, no `text-amber-*`-style status colors.

---

## F7 — Pending proposals never announce themselves

### Problem

> *"najpierw czekałam, a dopiero potem się zorientowałam, że mam propozycje wymagające decyzji człowieka"*

She was waiting on the system while the system was waiting on her. Nothing pushes: the module ships ten
subscribers (`subscribers/*.ts`, including `process-proposal-created.ts`) and **no `notifications.ts`** —
`agent_orchestrator.proposal.created` only recomputes the process projection. The sidebar likewise carries
no unread affordance: `BackendChromeNavItem` (`packages/shared/src/modules/navigation/backendChrome.ts`)
has no badge/count field at all.

### Scope decision (2026-09-14)

**Both layers are in scope.** They solve different halves of the failure: the notification tells you *once,
when it happens*; the badge answers *"is there anything waiting for me right now?"* on every page, which is
the question she was actually asking while she waited. Ship (a) first — it is self-contained — then (b).

### (a) In-app notification — enterprise module only, no core change

- Add `notifications.ts` to `packages/enterprise/src/modules/agent_orchestrator/`, per
  `packages/core/AGENTS.md` → Notifications.
- Emit on `agent_orchestrator.proposal.created` when the proposal is still awaiting a human
  (`disposition === 'pending'`), addressed to holders of **`agent_orchestrator.proposals.dispose`**
  (the real feature id — `acl.ts:24`; `proposals.view` alone is read-only and must not be paged), linking
  to `/backend/caseload/<proposalId>`.
- Honor wildcard ACL matching when resolving recipients (`packages/core/AGENTS.md` → Access Control).
- **Idempotency:** the subscriber is persistent and can redeliver — key the notification on the proposal id
  so a replay updates rather than duplicates.
- **Never fires for:** auto-approved proposals (`settings/auto-approval`), `source !== 'runtime'` (eval
  replays are records, not work — mirrors the caseload filter at `api/proposals/route.ts:74`), and
  `none_proposed` outcomes.

### (b) Pending count on the Caseload nav item — additive core change

**Approved as an additive contract change** (`BACKWARD_COMPATIBILITY.md`: additive-only on the nav payload
type). Three pieces:

1. **Type** — add an optional `badge?: { count: number; tone?: 'default' | 'attention' }` (or a bare
   `badgeCount?: number`, decide at implementation) to `BackendChromeNavItem` in
   `packages/shared/src/modules/navigation/backendChrome.ts`. Optional field, so every existing producer
   and consumer keeps compiling and rendering unchanged.
2. **Rendering** — the sidebar item in `packages/ui` renders the count when present, using the DS `Badge`
   primitive and semantic tokens (no `bg-red-*`). Zero and `undefined` render nothing — never a "0" chip.
3. **Feeding it — client-side, NOT in the cached payload.** The nav payload is cached for **30 minutes**
   behind a module-surface fingerprint (`NAV_CACHE_TTL_MS`, `packages/core/src/modules/auth/api/admin/nav.ts:21`).
   A per-user, per-minute count served through that cache would be both stale and cache-poisoning. Instead:
   - count source: `GET /api/agent_orchestrator/proposals?disposition=pending&pageSize=1` → read `total`
     (the list route already filters `source: 'runtime'` and is org/tenant-scoped; `pageSize` stays ≤100 per `AGENTS.md`);
   - live refresh via the DOM Event Bridge — `agent_orchestrator.proposal.created` and
     `.disposed` are **already** `clientBroadcast: true` (`events.ts:17-18`), so `useAppEvent` updates the
     badge with no new event work. Coalesce (the module's `useCoalescedReload` pattern) to bound refetch rate;
   - the count is fetched by an agent-orchestrator client widget that injects into the nav item, so core
     gains the *capability* and the enterprise module owns the *number* — no core→enterprise dependency.
4. Hidden entirely for users without `agent_orchestrator.proposals.view`; shows only what their scope returns.

### Acceptance criteria

**(a)**
- Creating a gated proposal produces exactly one notification per eligible recipient, with a working deep link.
- Redelivering the event produces no duplicate.
- Auto-approved, eval-sourced and `none_proposed` proposals produce none.
- Recipients are resolved by `proposals.dispose`, verified against a user holding only `proposals.view` (gets nothing).

**(b)**
- With one pending proposal, the Caseload nav item shows "1" on every backend page; disposing it clears the
  badge without a reload (event-driven).
- Zero pending renders no chip.
- The nav payload cache is untouched: no new field is served through `/api/auth/admin/nav`, and its hit rate
  is unchanged.
- A user without `proposals.view` sees no badge and triggers no count request.
- DS-clean: `Badge` primitive, semantic tokens, no arbitrary values.

**Both**
- Integration coverage for the notification path and the count endpoint ships in the same PR
  (per `.ai/qa/AGENTS.md`); the badge gets UI QA evidence.

### Sequencing note

(a) and (b) are separable PRs and should be — (b) touches two packages including a core contract surface
and will want its own review. Do not block (a) on it.

---

## F8 — Reuse the Playground pattern elsewhere (positive signal)

### Problem

> *"Najbardziej intuicyjny ekran dla mnie … to Sandbox, wybór agenta, wstawienie przykładu, uruchomienie —
> tu wszystko jasne 🙂"*

Recorded as a design finding, not a complaint: the pattern that worked is **pick a thing → prefill a real
example → run it → see the result inline**. It is also the only screen in the module that offers a
worked example. Everything else starts from a blank form.

### What to change

Apply the same three affordances where a user currently faces an empty canvas:

- Automation definition creation: offer a ready-made "agent proposes → human approves" starter graph,
  not an empty editor.
- Process definitions: prefill one example trigger.
- Caseload: show one example decision in the empty state rather than only "nothing here".

### Acceptance criteria

- Each of the three screens offers at least one prefilled, runnable example on first visit.
- Examples are tenant-safe: they create nothing until the user explicitly saves or runs.

### Priority note

P3 — do this after F1/F4/F6 have been validated with a second first-time tester. It is the largest task
here and the least certain.

---

## Suggested sequencing

1. **F1 + F4 + F6** — one PR, copy and metadata only, no contract risk. This is the whole "I didn't know
   where to start / I didn't know it only proposes" complaint, closed.
2. **F5 + F2(a)** — one PR: the Playground learns to point at automations, which is also the cross-group bridge.
3. **F7(a)** — its own PR, ships with integration coverage.
4. **F7(b)** — separate PR: the additive `BackendChromeNavItem` badge field in core plus the
   agent-orchestrator widget that feeds it. Touches two packages, wants its own review.
5. **F3** — after the unification spec's model change lands, so the Automations rename runs once.
6. **F8** — after re-testing with a fresh user.

## Out of scope

- Any change to the propose-only execution semantics themselves. The tester called the mechanism
  *"oczywiście sensowe i bezpieczne"* — the model is right; only its discoverability is wrong.
- Documentation-site work. Every fix here must land **in-product**; a docs page the user must know to look
  for does not solve a first-run problem.

---

## Appendix A — source feedback (verbatim)

> no to na starcie nie wiedziałam, od czego zacząć 😄
> Procesy, Definicje procesów, Instancje przepływów, Wizualny edytor, Piaskownica 🙈 i dopiero po przejściu
> całej ścieżki złapałam, że kolejność to: Agenci → Piaskownica → zbuduj przepływ → Kolejka zadań →
> Ślady/Audyt, dlatego przyszło mi do głowy, że UX-owo lepiej byłoby ustawić zakładki w menu w kolejności
> użycia: Przegląd → Agenci → Piaskownica → Definicje Przepływów Pracy → Procesy → Kolejka zadań → Ślady →
> Audyt, ale up to you ;)
>
> Najbardziej intuicyjny ekran dla mnie [za wyjątkiem Przeglądu 😄] to Sandbox, wybór agenta, wstawienie
> przykładu, uruchomienie — tu wszystko jasne 🙂
>
> ogólnie musiałam trochę poeksplorować najpierw, żeby zrozumieć, jak sprawić, aby agent faktycznie coś
> zrobił, a nie tylko 'pokazał, co by zrobił' w piaskownicy, że trzeba zbudować odpowiedni przepływ pracy
> z krokiem "wywołaj agenta". Ale podejrzewam, że dla osób pracujących na co dzień z systemem i agentami
> nie będzie to trudne ani nieoczywiste 😉
>
> A tak pod kątem głównego mechanizmu, gdzie agent tylko proponuje, a człowiek zatwierdza w Kolejce zadań,
> dopiero wtedy akcja się wykonuje, co jest oczywiście sensowe i bezpieczne, ale też najpierw czekałam,
> a dopiero potem się zorientowałam, że mam propozycje wymagające działania, decyzji człowieka. Może warto
> gdzieś wyświetlić komunikat, że agenci tylko proponują, że nic nie zmienia się w systemie bez
> zatwierdzenia w Kolejce zadań?

## Appendix B — feedback → task traceability

| Feedback statement | Tasks |
|---|---|
| "nie wiedziałam, od czego zacząć" | F4, F1 |
| "Procesy, Definicje procesów, Instancje przepływów, Wizualny edytor, Piaskownica 🙈" | F2, F3 |
| proposed menu order by usage | F1, F2 |
| "Sandbox … tu wszystko jasne" (positive) | F8 |
| "jak sprawić, aby agent faktycznie coś zrobił … krok 'wywołaj agenta'" | F5 |
| "agent tylko proponuje … nic nie zmienia się bez zatwierdzenia" | F6 |
| "najpierw czekałam, a dopiero potem się zorientowałam, że mam propozycje" | F7 |

## Changelog

- 2026-09-10 — written from a first-time tester's walkthrough of PR #5718.
- 2026-09-14 — naming decision recorded (Automations / Automatyzacje, F3); F7 scope widened to both layers.
- 2026-09-14 — **implemented on `feat/agent-orchestrator-mvp`** (PR #5718), one commit per sequencing stage.
  The stages could not become separate PRs against `develop`: the whole `agent_orchestrator` module is
  absent there (the branch is 644 commits ahead), so a PR against `develop` would carry the entire MVP diff.
  - **F1** — the eight `page.meta.ts` files restated both `pagePriority` and `pageOrder` in the order of use
    (Overview 10 → Agents 20 → Playground 30 → Process definitions 40 → Processes 50 → Caseload 60 →
    Traces 70 → Audit 80).
  - **F4** — `components/StartHereGuide.tsx`, mounted on Overview above the tiles. Progress is derived from
    data the cockpit already serves (agents list, runs list, and a 25-row proposals probe whose
    `workflowInstanceId` answers "has an automation actually invoked an agent"), so no endpoint was added.
    Dismissal reuses `usePersistedBooleanFlag` rather than a new mechanism.
  - **F6** — `components/ProposeOnlyNotice.tsx`, one key (`agent_orchestrator.proposeOnly.notice`) on
    Overview, Agents, Playground and the Caseload empty state. The copy covers auto-approval, so it stays
    true on tenants that raised the autonomy ceiling.
  - **F5 + F2(a)** — the Playground compose card gained the rehearsal sentence and a
    "Use this agent in an automation" action (repeated on the post-run card), gated on
    `workflows.definitions.create` and hidden — not disabled — without it. `lib/automationLinks.ts` holds the
    cross-group hrefs. **Correction to this spec's earlier drafts:** the automations routes are
    `/backend/definitions` and `/backend/definitions/visual-editor`, NOT `/backend/workflows/definitions`;
    the editor href is re-exported from the workflows module's own `WORKFLOW_STUDIO_CREATE_HREF` (the
    retired `/backend/definitions/create` route forwards there).
  - **F7(a)** — `notifications.ts` plus two persistent subscribers. `proposal-pending-notification`
    re-reads the row before notifying, because `DispositionServiceImpl` auto-approves INLINE after the run
    and the emitted payload therefore still says `pending`; it skips eval-sourced and `none_proposed`
    proposals and addresses `agent_orchestrator.proposals.dispose` (**not** `proposals.decide`, which does
    not exist — an error in this spec's first draft). `proposal-disposed-notification-clear` removes the
    notification on any verdict, which also closes the narrow create-side race. Nine unit tests.
  - **F7(b)** — **deviation, deliberate:** the additive `badge` field on `BackendChromeNavItem` was NOT
    added. A count carried in the chrome payload would be served from a 30-minute cache
    (`NAV_CACHE_TTL_MS`, `auth/api/admin/nav.ts:21`), so the field would be one nothing could populate
    correctly — a trap rather than a capability. Core instead gained two honest capabilities:
    `packages/ui/src/backend/nav/navBadges.ts` (a client-side store; zero and absent both render nothing)
    and the `backend:nav:badges` headless injection spot, mounted once per shell. The enterprise widget
    `agent_orchestrator.injection.caseload-nav-badge` owns the number, counts via
    `?disposition=pending&pageSize=1`, and live-updates off the already-`clientBroadcast`
    `proposal.created` / `proposal.disposed` events through a coalesced reload. Five unit tests.
- **Not done, and why:**
  - **F3** — gate still closed. `2026-09-06-business-process-workflow-unification.md` is `Status: in
    progress` (last changelog 2026-09-08), and renaming before its model change lands means renaming twice.
    New copy shipped in the stages above already uses the Automations vocabulary, so nothing was built under
    the retired name.
  - **F8** — gated on re-testing with a fresh first-time user, per this spec's own sequencing. It is the
    largest and least certain task here and should be validated before it is built.

