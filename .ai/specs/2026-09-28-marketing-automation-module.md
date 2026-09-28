# Marketing Automation Module

## TLDR

A new optional package, `@open-mercato/marketing-automation` (module id `marketing_automation`),
adds marketing campaigns to Open Mercato: a platform event or a periodic sweep starts a run, an
audience expression decides who it applies to, and an ordered list of steps runs for that
subject. Authored on a visual canvas.

It composes existing platform primitives rather than adding a parallel stack: audience
conditions are `business_rules` expression trees evaluated by its own evaluator and edited by its
own builder; `add_tag` calls the existing `customers.tags.assign` command; email goes through the
shared `sendEmail` transport; background work uses `@open-mercato/queue` and, optionally,
`@open-mercato/scheduler`. No changes to `packages/core`.

## Overview

Phase 1 delivers the campaign engine, its durability, three event triggers, two scheduled sweep
sources, three step types, the authoring API and the canvas. Later phases add channels, split
testing, analytics and segmentation.

## Problem Statement

Open Mercato has no marketing automation. This is documented in the repository's own analyses:

- `.ai/specs/analysis/ANALYSIS-008-hubspot-crm-integration.md` — *"OM has `CustomerTag` for
  grouping but no dynamic segmentation engine"*, and *"HubSpot workflows are marketing
  automation; OM workflows are business process orchestration"*, with marketing workflows marked
  out of scope.
- `.ai/specs/analysis/ANALYSIS-002-orocrm-integration.md` — *"Mercato has no marketing automation
  module"*; marketing lists and email campaigns both marked not feasible.

Operators therefore cannot express "when this happens, to these customers, do this" without
writing code, and the lifecycle messaging every commerce and B2B deployment eventually needs —
welcome, post-purchase, re-engagement, offer-expiry reminders — has no home.

## Proposed Solution

A campaign is three things:

1. **Triggers** — either platform event ids (`sales.order.created`) or a periodic sweep.
2. **An audience** — one `ConditionExpression` evaluated against a projected subject document.
3. **Steps** — an ordered list; `wait` is an ordinary step that parks the rest of the journey.

### Why not the existing engines

`workflows` and `business_rules` both already evaluate conditions and run actions, and both were
considered:

- **`workflows`** was rejected as the dispatcher. Its `ActivityType` enum is a FROZEN contract
  surface per `BACKWARD_COMPATIBILITY.md`, so marketing actions cannot be added without the
  deprecation protocol. More importantly the granularity is wrong: a durable workflow instance
  per contact per campaign means one state machine and one event log per *marketing recipient*,
  where this engine materializes nothing until a wait forces it to. A second, smaller execution
  concept is the price; the mitigation is that it is a few hundred lines of mostly-pure functions
  introducing no new infrastructure.
- **`business_rules`** was rejected as the *action* layer — `getActionHandler()` in
  `lib/action-executor.ts` is a hardcoded map with no extension point — but adopted wholesale as
  the *condition* layer. Audiences are its `ConditionExpression` trees, validated by its
  `conditionExpressionSchema` and compared by its `evaluateExpression`, which is what lets its
  `ConditionBuilder` component edit them with no change to core and makes future segmentation the
  same shape over the same document.

### Reused rather than rebuilt

| Need | Reused |
|---|---|
| audience conditions | `business_rules` `conditionExpressionSchema`, `evaluateExpression`, `ConditionBuilder` |
| tagging | command `customers.tags.assign` — no new tag storage |
| email | `sendEmail` from `@open-mercato/shared/lib/email/send`; transport supplied by `communication_channels` |
| triggers | the platform event bus, via `subscribers/*.ts` |
| background work | `@open-mercato/queue` |
| periodic ticks | `@open-mercato/scheduler`, as an optional peer |
| canvas | `@xyflow/react`, already a dependency of the root and of `packages/core` |

## Architecture

### Execution

`subscribers/*.ts` → `workers/dispatch.ts` → `lib/dispatcher.ts` → `lib/engine/executor.ts`.

The subscriber checks whether any campaign listens on the event before enqueuing, so an
installation with no campaign for an event pays one index probe rather than a queue round trip —
otherwise enabling this module would tax every order, registration and tag change.

`lib/engine/` is pure: no React, no ORM, no container. That is what makes the sequencing rules
testable without a database, and they are the part most worth testing.

### Two kinds of stop

The executor distinguishes them because conflating them drops or duplicates a send:

- a `wait` step has done its job, so the run resumes **after** it;
- quiet hours have not let the message out, so the run resumes **at** the same step.

### Durability

One conditional `UPDATE` claims a run under a 15-minute lease, and every later write re-asserts
the claim token, so a worker that dies mid-step is recovered rather than stranding a customer.
The delayed queue job is the low-latency path; the periodic due-run scan is the safety net. Both
go through the same claim, which is what makes running them together safe rather than a
double-execution hazard.

Retry backoff is `min(5 * 2^(attempts-1), 120)` minutes with five attempts, then the run is
marked `dead` — visible to an operator rather than deleted.

### Re-entry policy

Explicitly three-valued (`unlimited` / `once` / `cooldown`). A nullable number made "do not
check" and "only ever once" indistinguishable. A scheduled sweep without a cooldown re-enrols the
same customer on every tick, because the audience it matches ("dormant for 90 days") stays true.

### Cascade guard

`add_tag` emits `customers.tag.assigned`, which is itself a trigger, so campaigns can drive each
other in a cycle. Two defences, because the obvious one does not work:

- **At save time** a campaign whose trigger is an event its own steps emit is refused.
- **At run time** `MAX_RUNS_PER_SUBJECT` bounds runs per subject per hour across every campaign,
  which bounds a cycle however many campaigns are in it and also absorbs an event storm from an
  import.

A depth counter carried in the dispatch context was implemented first and removed: the events are
emitted by the modules that own them and carry no field of ours, so nothing could increment the
depth across a hop and the guard was inert.

### Canvas

The canvas renders a spine, not a free graph, because that is what the engine executes. Edges are
derived on every render and never persisted; connecting is disabled. Step order lives in the
definition array and is changed with explicit controls, never by dragging — coordinate-derived
ordering would let a three-pixel nudge reorder a campaign. Layout travels inside the definition,
so a save round-trips positions with no separate client key.

One audience node rather than a node per condition: a failed audience simply stops the run, so
there is no "condition failed" branch for an edge to leave from.

## Data Models

Five tables, all `organization_id`/`tenant_id` scoped, UUID PKs.

| Table | Purpose |
|---|---|
| `marketing_campaigns` | name, `is_enabled`, and the authored graph in one `definition` jsonb (audience, steps, canvas layout, send policy) |
| `marketing_campaign_triggers` | one row per way the campaign starts; `kind` = `event` \| `schedule`, plus `sweep_source`, `sweep_params`, `reentry_after_days` |
| `marketing_campaign_runs` | one subject's journey: `current_step_index`, `step_log`, `status`, `resume_at`, `claimed_at`, `claim_token`, `attempts` |
| `marketing_message_sends` | outbound history per subject per channel, including suppressions |
| `marketing_dispatch_dead_letters` | append-only record of a dispatch that could not be processed |

Two shape decisions worth stating:

- **The graph lives in jsonb, not child tables.** A save is one row update, so step ids stay
  stable and an in-flight run is never orphaned by an edit. Triggers are the exception because
  "which campaigns listen to this event" runs on every platform event and needs an index.
- **`marketing_message_sends` counts across campaigns.** A per-campaign frequency cap would let
  five campaigns each politely send one message and still bury the customer.

### The subject document

Audience field paths are the paths of this shape, so renaming a key changes every saved audience:

```
{ customer: { id, email, displayName, createdAt } | null,
  tags: string[],
  orders: { count, totalGross, lastPlacedAt?, daysSinceLast? },
  trigger: { …scalars the trigger contributed } }
```

`lastPlacedAt` and `daysSinceLast` are **absent**, never null, when the subject has never
ordered. See Risks.

## API Contracts

| Route | Verbs | Features |
|---|---|---|
| `/api/marketing_automation/campaigns` | GET, POST | `campaigns.view` / `campaigns.manage` |
| `/api/marketing_automation/campaigns/[id]` | GET, DELETE | `campaigns.view` / `campaigns.manage` |
| `/api/marketing_automation/campaigns/[id]/save-graph` | PUT | `campaigns.manage` |
| `/api/marketing_automation/campaigns/[id]/enabled` | PUT | `campaigns.publish` |
| `/api/marketing_automation/campaigns/[id]/test-dispatch` | POST | `test_dispatch` |
| `/api/marketing_automation/palette` | GET | `campaigns.view` |

`save-graph` replaces name, description, triggers and definition in one transaction behind an
optimistic lock, answering the canonical 409, and reports how many customers are waiting
mid-journey. It deliberately does **not** carry `isEnabled`: taking a campaign live is what starts
messaging real customers, so it is its own endpoint behind `campaigns.publish`, and the guard is a
declarative route feature rather than a condition inside a handler. `test-dispatch` answers "would
this subject enter, and what would happen" using the same evaluator and planner the engine uses,
and sends nothing.

**Save-time validation is deliberately stricter than the dispatcher.** At runtime an unknown step
type is skipped so an installation change cannot strand a journey; at author time it is rejected
with 400, because there it is always a mistake and a campaign that looks saved and silently does
nothing is the worst failure mode a marketing tool has. Also rejected: a trailing `wait`, a
duplicate trigger, an unavailable trigger, and invalid step parameters.

The palette is derived from the live registries, so a step type contributed by another module
appears with a working inspector form and server-side validation and no UI code of its own.

### ACL

`marketing_automation.campaigns.view` · `.manage` · `.publish` · `.test_dispatch` ·
`runs.view`. `publish` and `test_dispatch` are separate from `manage` because flipping a campaign
live and test-firing one are the two acts that send real messages, and "can draft a campaign" is
a different trust level from "can send to the list".

## Risks & Impact Review

**A missing operand silently widened every audience.** `compare()` in
`business_rules/lib/expression-evaluator.ts` returns `-1` when the left side is null or
undefined, sorting "no data" below every number. Without a guard,
`orders.daysSinceLast <= 30` is TRUE for a customer who has never ordered, so a win-back
campaign mails every never-buyer. *Severity: high — wrong recipients, at volume.* *Mitigation:
`matchesAudience` owns the boolean combination and vetoes magnitude comparisons whose operand is
absent; equality and emptiness are not vetoed so "customers with no orders" stays expressible.
Aggregates omit unknown keys instead of nulling them.* *Residual: an audience written directly
through the API can still use a field this module does not project; it evaluates false, which is
the safe direction.*

**Editing a campaign changes what parked customers receive next.** *Severity: medium.*
*Mitigation: `save-graph` returns the number of waiting runs and the editor surfaces it.*
*Residual: the author is informed, not prevented.*

**No marketing consent model exists in the platform.** Sends are not gated on a marketing opt-in
because there is nothing to gate on. *Severity: high for a real deployment — compliance.*
*Mitigation: documented here and in the module guide as blocking for production use; the send
path has a single seam to add it.* *Residual: Phase 1 must not be used on live customer data.*

**At-least-once delivery.** A crash between sending and recording can resend on resume.
*Severity: medium.* *Mitigation: `add_tag` treats "already assigned" as success, so it is
idempotent; sends are recorded immediately after the call.* *Residual: a duplicate email is
possible; exactly-once needs the hub's idempotency key (Phase 2).*

**Sweeping customers is O(customers).** *Severity: low-medium.* *Mitigation: keyset pages of 200
with `em.clear()` per page, ids only, hourly tick.* *Residual: a very large organization will
want a narrowing pre-filter.*

**Abandoned cart is not implementable.** No cart entity exists. *Mitigation: the trigger is in
the catalog as unavailable with a reason, so the palette explains itself; the context contract is
written down.* *Residual: blocked on `SPEC-029`.*

## Final Compliance Report

| Rule | Status |
|---|---|
| Changes outside the new package kept minimal | One new package, three registration lines, and five `auth.acl.features.marketing_automation.*` titles in `packages/core/src/modules/auth/i18n/*` — required by `acl-feature-catalog.i18n.test.ts`, which holds every module's ACL declarations to a translated title |
| No direct cross-module ORM relationships | Met — cross-module reads are scoped `findOne`/`find` by FK id |
| Tenant/organization scoping on every query | Met |
| Mutations through commands | Met — create, save_graph, delete; `add_tag` calls the customers command |
| Optimistic locking on a user-editable entity | Met — `updatedAt` in every response; the canvas and the list send it through `withScopedApiRequestHeaders(buildOptimisticLockHeader(…))` and the commands enforce it with `enforceCommandOptimisticLock`, so conflicts surface through the shared bar on both save and delete |
| zod validators with `z.infer` | Met — `data/validators.ts` |
| No `any` | Met |
| No raw `fetch` in UI | Met — `apiCall`/`apiCallOrThrow` |
| i18n, no hardcoded user-facing strings | Met — `en` and `pl`, 76 keys |
| DS tokens only, no status colours or arbitrary values | Met — `om-ds/*` clean at error severity |
| `openApi` exported from every route | Met |
| Queue names as literals in worker metadata | Met, with a test asserting they match the constants |
| Encrypted reads use the decrypting finders | Met — `findOneWithDecryption` for email, name, timezone |
| Module `AGENTS.md` | Met |
| Integration tests ship with the change | Met — `__integration__/TC-MA-*.spec.ts` |

## Changelog

- **2026-09-28** — Phase 1 implemented: five tables and one migration; pure engine (audience
  veto, step planner, send gates, executor) with 101 unit tests; run persistence with
  claim-and-lease, backoff and dead-lettering; three event subscribers with context hydration;
  two scheduled sweep sources; three step types; campaign API with save-graph behind an
  optimistic lock; canvas editor reusing the `business_rules` condition builder; `en`/`pl`
  locales. Verified against a running instance: palette, create, save, round-trip, 409 on a
  stale save, and five rejected invalid graphs.
