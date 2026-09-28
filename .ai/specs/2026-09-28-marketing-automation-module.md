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

### A/B split

A `split` step carries variant lanes in its params, each lane its own step array. The engine
resolves it before planning: `flattenSteps` replaces the split with the lane this subject belongs
to, in place, so the chain continues afterwards and a split is a detour rather than a terminus —
which is what lets a campaign test one message and then carry on with shared follow-up steps.

The lane is chosen by hashing `(step id, subject id)`, not stored. Stability is the requirement,
not novelty: a run that pauses on a wait inside a lane and resumes an hour later must come back to
the same lane, or the customer receives a mixture of both variants and the test measures nothing.
Deriving the choice makes that true by construction, with no extra column, no migration, and
nothing that can disagree with itself after a restore. Because the executor still walks a flat list,
`current_step_index` keeps its meaning and the schema is unchanged.

Weights are cumulative ranges over that hash, so lanes need not be integers or sum to anything. A
lane with a non-positive weight or no key is dropped rather than kept as unreachable, because the
canvas must not show a branch that never runs. Nesting is capped at five levels, which turns a
hand-edited or imported definition that is cyclic in spirit into a truncated campaign instead of a
stack overflow in a worker.

### Set-level audience narrowing

A sweep's cost is projecting, not matching. Building a subject document is a decrypting read plus
three queries, so asking it of every person in an organization to find the few hundred who qualify
is the difference between a sweep that finishes and one that does not.

So before projecting anything, the audience expression is pushed down as far as the database can
answer it (`lib/engine/narrowing.ts`, pure) and only the candidates it returns are projected
(`lib/audience/set-resolver.ts`). Tag membership becomes a lookup; `orders.count`,
`orders.totalGross` and `orders.daysSinceLast` become one aggregate over the SAME orders
`subject-document.ts` counts — the filter is shared between them precisely so the two definitions of
"an order that counts" cannot drift.

**The rule that makes this safe: a narrowing may only ever return a SUPERSET.** `matchesAudience`
remains the sole authority and runs on every candidate. A narrowing that is merely imprecise wastes
a few projections; one that is too tight silently stops mailing customers who qualify, and nothing
in the system would report it. Every decision therefore resolves ambiguity by widening:

- An AND ignores the leaves it cannot express. An OR with one inexpressible branch expresses
  nothing at all — unioning the rest would drop the subjects that only match the branch we could
  not translate. A NOT is never translated.
- A comparison a never-buyer satisfies (`orders.count <= 5`, `= 0`, `totalGross >= 0`) is not
  pushed down at all, because the aggregate query can only return customers who HAVE orders.
- A recency bound is widened by a day, because `daysSinceLast` is whole days floored and an exact
  SQL bound would sit within a day of the boundary the evaluator uses.
- A candidate set above 100k ids is abandoned, which falls back to walking the population.

The property is tested as a property, not on examples: 21 realistic audiences × 200 subject
documents assert that no subject `matchesAudience` accepts is excluded by the narrowing, and that a
plan reporting itself `complete` agrees with the evaluator exactly.

`complete` is what makes an audience countable, and it is the foundation segments will be built on.
`POST /campaigns/:id/audience-estimate` takes the audience in the BODY — so an author gets the
number for what is on their screen, not for what they last saved — and answers `exact` only when
the whole expression was expressible, otherwise `atMost`, because the remaining leaves are decided
per customer at send time.

### Canvas

The canvas renders a spine with detours, not a free graph, because that is what the engine
executes. Steps read top to bottom; a split forks to the right, one column per lane, and the trunk
resumes below the deepest lane, with an edge from every lane's last step into it — the same rejoin
`flattenSteps` performs, so the picture and the execution agree by construction. An empty lane
exits at the split node itself so nothing downstream is stranded. Edges are
derived on every render and never persisted; connecting is disabled. Step order lives in the
definition array and is changed with explicit controls, never by dragging — coordinate-derived
ordering would let a three-pixel nudge reorder a campaign. Layout travels inside the definition,
so a save round-trips positions with no separate client key.

One audience node rather than a node per condition: a failed audience simply stops the run, so
there is no "condition failed" branch for an edge to leave from.

Once lanes exist a campaign is a tree, so every editor action — change params, reorder, delete,
add — has to find the chain that owns a step instead of indexing into `definition.steps`. That is
`lib/canvas/step-tree.ts`, pure and recursive, which keeps the page a rendering of state and the
rules testable without React. A step never changes lane by being reordered, and a rename or weight
that `readVariants` would drop is refused rather than applied, because applying it would delete the
lane the author is editing together with the steps inside it.

## Data Models

Five tables, all `organization_id`/`tenant_id` scoped, UUID PKs.

| Table | Purpose |
|---|---|
| `marketing_campaigns` | name, `is_enabled`, and the authored graph in one `definition` jsonb (audience, steps, canvas layout, send policy) |
| `marketing_campaign_triggers` | one row per way the campaign starts; `kind` = `event` \| `schedule`, plus `sweep_source`, `sweep_params`, `reentry_after_days` |
| `marketing_campaign_runs` | one subject's journey: `current_step_index`, `step_log`, `status`, `resume_at`, `claimed_at`, `claim_token`, `attempts` |
| `marketing_message_sends` | outbound history per subject per channel, including suppressions |
| `marketing_dispatch_dead_letters` | append-only record of a dispatch that could not be processed |

**No decrypted PII is persisted by this module.** The platform encrypts `primary_email` and
`display_name` at rest, so the run context carries neither, and the send history records no
address — `subject_entity_id` already identifies the recipient. The send step resolves the address
through the decrypting finder at the moment it sends, which costs one scoped read and also means a
customer who corrects their address mid-journey receives the remaining steps at the new one. A
first pass cached the address in the run context and stored it in the send history, which created
two unencrypted mirrors of a protected field in tables the encryption maps do not cover.

Three shape decisions worth stating:

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
and sends nothing. It reports presence (`exists`, `hasEmail`, `tagCount`) rather than the address
and tag list: the route is reachable with `test_dispatch`, which implies no `customers.*` grant, so
returning the decrypted email would have made a marketing preview a way to read the CRM without the
permission that protects it.

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

**Customer-controlled values reach an HTML sink.** Campaign copy interpolates `{{path}}` values,
and a display name is customer-settable in many deployments, so an unescaped substitution would let
a customer inject markup — most usefully a link — into a message delivered from the tenant's own
verified sending domain, inheriting its reputation. *Severity: medium — phishing with aligned SPF
and DKIM.* *Mitigation: `interpolate` is sink-aware and escapes for `html`; subjects and plain-text
bodies are left verbatim because they are not HTML.* *Residual: a campaign author can still write
hostile markup directly into the body, which is inherent to letting them author HTML at all.*

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
- **2026-09-28** — Phase 2.2: set-level audience narrowing. Pure planner with a superset guarantee,
  candidate resolver over tag and order-aggregate queries, sweep enrols from candidates instead of
  scanning the organization, and an audience-estimate endpoint that is explicit about whether its
  number is exact or an upper bound. 251 unit tests.
- **2026-09-28** — Phase 2.1: A/B split. `split` step type with deterministic per-subject lane
  assignment, in-place flattening before planning, recursive save-time validation (unknown step
  types and trailing waits inside lanes are refused as they are at the top level), canvas fork and
  rejoin rendering with per-lane shares, a lane inspector, and `lib/canvas/step-tree.ts` for
  structural edits. 173 unit tests.
