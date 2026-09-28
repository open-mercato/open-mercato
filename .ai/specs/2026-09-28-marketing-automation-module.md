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

### Journey preview

What a named customer would receive, and when. The most useful screen in the module for an author, and
the one with the strongest temptation to build wrongly.

It drives the REAL executor rather than describing what the executor would do. An explainer that
reimplements the sequencing is a second engine, and the moment it drifts it is worse than nothing —
an author trusts a preview exactly where they cannot check it themselves. So the engine runs with side
effects that record instead of act: every step handler is replaced by one that reports "would run" while
KEEPING its channel, because the send gates key off the channel and a preview whose steps had none would
show messages escaping quiet hours and the frequency cap.

The clock is then advanced to each resume point and the engine re-entered, so the timeline follows waits
instead of stopping at the first one — an author sees the date of the last message without doing the
arithmetic. Pauses are reported as entries of their own, each carrying the engine's own reason, because
"waits a day because you asked" and "held until 09:00 by quiet hours" are different answers to the
same-looking gap. Bounded at 60 steps and a year ahead: a journey longer than that is a loop somebody
should look at, not a preview worth rendering.

Nothing is written and nothing is sent. `recordSend` is a no-op, so the preview cannot count against the
very frequency cap it is explaining, and it never appears in the campaign's reports as traffic — both
asserted, along with the absence of a run, because "a preview that enrols somebody" is the failure this
design exists to avoid.

### Send timing, learned per customer

With opens recorded, the hour a customer usually reads email is knowable, so a send can be moved to it.
Deliberately the customer's OWN history rather than a cohort average: "9am is best" is a statement about
a population, and the point of per-customer timing is that the night-shift worker is not the population.

Below five opens there is no pattern, only noise — two opens at 3am would otherwise schedule every
future send for 3am, which is the kind of confident optimisation that is worse than none. Ties resolve to
the earlier hour: with equal evidence the earlier slot reaches the customer sooner, and a deterministic
rule beats one that depends on row order. The grouping happens in SQL in the CUSTOMER's timezone; doing
it afterwards would group by server hour and relabel, which is a different and wrong answer for anybody
outside the server's timezone.

The executor's two deferral gates are now one decision, in one order, and only one order is defensible:
**the optimisation proposes and quiet hours dispose.** Quiet hours are a promise to the customer; the
preferred hour is an optimisation, so reversing them could land an "optimised" send at 3am. The
preferred hour is queried ONLY when the policy asks for it — a query per send is affordable, a query per
send nobody wanted is not — and that is asserted, because every other executor test leaves the flag off
and would never reach the branch.

Send rules — the frequency cap, quiet hours and this flag — are campaign-wide and are edited in the
editor's inspector when no node is selected. They were implemented, tested and **unauthorable** before
that panel existed, which is the same defect as scheduled triggers: a guard nobody can switch on is a
guard nobody has.

### Results: A/B outcomes and attributed revenue

The lane a run walked is RECORDED on the run at enrolment, not recomputed. The choice is deterministic,
so recomputing would agree — until the author edits the split, at which point every historical run would
be re-attributed to a lane it never walked and the comparison would quietly become fiction. It is
recorded only for runs that have a subject, because a subject-less run is flattened with the run's own
id, which does not exist yet at enrolment.

Opens and clicks are counted as UNIQUE RUNS rather than raw events: a mail client re-fetching a pixel is
not a second person reading the message, and a winner picked on raw opens rewards whichever variant
reached the more aggressive inbox previewers.

`pickSplitWinner` refuses to answer until EVERY lane has reached the minimum sample, and refuses a tie.
Declaring a winner before each lane has been received is the standard way to pick whichever variant went
out first; an automation that does it confidently is worse than one that says "not yet". The refusal is
the feature. Promotion is then a separate, author-initiated action: `apply_split_winner` splices the
winning lane in place — exactly where `flattenSteps` would have put it, so subjects already in that lane
keep walking the same chain — under the same optimistic lock a save uses, and refuses a result that
would not be runnable.

Attribution is linear multi-touch: the orders a customer placed after clicking, within a window, with
each order's revenue split EQUALLY across the campaigns they clicked. Linear rather than last-touch on
purpose — last-touch is easier and systematically flatters whichever campaign ran closest to the
purchase, usually the one that needed the least persuasion. Equal shares claim nothing about which
message did the work, and they sum to exactly the order total. Three rules make the number honest: a
campaign clicked twice before one order is ONE touch, currencies are never summed together, and a
campaign filter is applied AFTER the split rather than before it — narrowing the query first would hide
the other touches on the same order and hand this campaign a share it did not earn.

The split maths and the share maths are pure functions with their own tests, separate from the queries
that feed them, because they are the parts with decisions in them.

### Scheduled campaigns and sweep sources

Some campaigns have nothing to react to. Nothing HAPPENS to make a customer dormant, and nothing
happens when an order becomes old enough to ask about — there is only a question to ask periodically.
Those are scheduled campaigns, and until the canvas could author one they existed in the schema and in
the worker but not in any user interface, which made every periodic campaign API-only.

Sweep sources are now a registry (`lib/sweep-sources.ts`). Two shapes exist and they are genuinely
different: the `customers` source walks the population and is narrowed by the campaign's own audience,
while a ROW source is driven by a query of its own and yields one candidate per row. Adding a row
source is a query and a label — the worker, the validator's accepted ids, the palette and the audience
builder's offered paths all derive from the registry rather than from four lists that would drift.

A row source may attach a **durable claim** to a candidate. It shares the run table's occurrence index,
so the database enforces it, but carries a `claim:` prefix because the two kinds of key have opposite
lifetimes: an event key is released after six hours so a repeat of the same fact can legitimately
re-enter, while "we already asked this customer to review order X" must never be released. That is what
makes the review request exactly-once without a marker table of its own, and it is why the expiry job
skips prefixed keys.

Two lessons came out of the first integration run, both of them defects this design invited:

- The save refused two schedules at the same interval over different sources as duplicates, although
  the canvas had just let somebody build them. The interval alone is not a schedule's identity; the
  source is part of it, in the node id and in the duplicate check alike.
- A payload that did not parse threw past the route as a 500. It is the client's mistake and answers
  400 with a code the editor can localize.

Win-back needed no new code at all: a daily sweep over the population plus
`orders.count >= 1 AND orders.daysSinceLast >= 90`, which the narrowing pushes to the database. The
review request needed one row source. Both are covered end to end by `TC-MA-010`.

### Lead score, tiers and the customer profile

The score is a LEDGER, not a total in a column. A total has to be incremented, and an increment is the
one write a retry cannot repeat safely: a step awarding 10 points, redelivered, would award 20. Entries
are keyed by the run and step that produced them, so a redelivery collides instead of double-counting,
and the score is `sum(points)` — the same shape as the order aggregates, which means the audience
narrowing pushes `score.points >= 100` down for free. The ledger also answers "why does this customer
have 40 points", which a total never can.

The narrowing repeats the order-aggregate rule exactly, because the trap is the same: the ledger can
only return customers who HAVE entries, and a customer who never scored totals zero, so
`score.points <= 10` is true for them and must not be pushed down.

Tiers are derived from the score, never stored: the score changes continuously, so a tier column would
need a job to keep it true and would be wrong in between. The ladder is per-tenant configuration
(`moduleConfigService`, key `loyaltyTiers`) with a default of bronze/silver/gold at 0/100/500, because
a tier system that requires setup before it does anything is one nobody sees. `score.tier` compares with
`=` or `IN`; `score.tierRank` exists so "at least silver" is expressible as `>= 1`, and is -1 below
every bound so those comparisons stay false for the unranked. Tier predicates are deliberately NOT
pushed to the database — the tier is derived, and pushing it would duplicate the threshold logic in SQL
where it could drift.

The score change is emitted as `marketing_automation.customer.score_changed` and is itself a trigger,
carrying the PREVIOUS total as well as the new one. That is what lets an audience say "reached 100
points" — `trigger.previousPoints < 100 AND score.points >= 100` — rather than "is above 100 points",
which would fire again on every later change while the customer stayed above the line. No threshold
configuration exists because none is needed, and one installation can have as many thresholds as it
likes. The existing cascade guard covers the new loop: a campaign triggered by `score_changed` whose
steps include `add_points` is refused at save time.

The customer profile assembles all of it on one screen — score, tier, distance to the next tier, order
aggregates, tags, sends, opens, clicks, recent score entries and recent runs — because the module
already computes every one of those and computing them again per screen is how numbers start
disagreeing. It requires BOTH `marketing_automation.runs.view` and `customers.people.view`: it names an
identifiable person and reports their behaviour, which is the union of two disclosures. It is linked
from the run list, so it is reachable from the place where somebody asks who a run is about.

### Delivery tracking

Opens and clicks, because "did this campaign work" is the question the module exists to answer and
every later feature — attribution, A/B winners, send-time learning, deliverability guards — reads from
here rather than computing its own version.

Two PUBLIC endpoints, which is the only public surface this module has. A recipient's mail client
fetches them with no session, so a signed token is the entire authorisation, and it carries the
tenant and organization the write belongs to: an unauthenticated request has no scope of its own, and
reading one from a query parameter would let anybody write rows into any tenant. The token identifies
the SEND — campaign, run, step — never the person.

What each endpoint refuses matters as much as what it records:

- The pixel answers a 1×1 GIF **whatever** the token turns out to be. A broken image in somebody's
  inbox is worse than a lost statistic, and an error status would tell a prober which tokens are real.
  It is served `no-store`, or a proxy would serve the second open from cache and it would never be
  recorded.
- The click destination travels INSIDE the signature, which is what keeps the redirect from being an
  open one. Signed by us is still not the same as safe — the author writes the links — so the scheme
  is checked again at redirect time and anything but http(s) answers 404. The redirect is 302, because
  a permanent one would be cached and the second click would never reach us.
- An open token cannot be replayed as a click, or the other way round: the purpose is part of the
  signed claims.
- Recording failures never change the response. Somebody clicked a link in an email and expects the
  page, not an apology about our statistics.

The signing key is derived from the configured secret with a purpose label, so a tracking token can
neither be forged from nor confused for anything else signed with the same secret. The secret falls
back to the platform's data-encryption key material rather than requiring a new variable — tracking
that only works after an operator reads a changelog is tracking that quietly does nothing — but
session and JWT secrets are deliberately NOT candidates: a tracking token is handed to every recipient
and lives in mail archives forever.

`marketing_message_send_events` stores no IP address and no user agent. The question this table exists
to answer never needs them, and a marketing module that quietly builds a device-and-location log of
every recipient is a liability nobody asked for. Counts are reported with unique-recipient figures
alongside raw totals, because a mail client re-fetching the pixel is not a second person reading it.

`send_email` rewrites links and embeds the pixel after interpolation — a link assembled from a
substituted value has to be tracked too — and leaves the body untouched whenever anything needed is
missing or the author opted out per step. Tracking is an enhancement to a send; a send must never fail
because it could not be tracked.

### Event idempotency

Queues and webhooks redeliver as a matter of course: a BullMQ job whose worker died mid-handler comes
back, a provider retries a callback it never saw acknowledged. Without a key, the second delivery is
indistinguishable from a second thing happening and the customer receives the campaign twice.

The key is DERIVED from the delivery, not assigned: the platform's event bus passes a payload through
untouched and carries no per-emission identifier, so a redelivery is byte-identical and a sha256 over
the canonicalised `{eventId, tenantId, organizationId, payload}` is what makes the two recognisably
the same occurrence. Object keys are sorted before hashing, because the same payload assembled in a
different order would otherwise hash differently and the duplicate would slip through.

It is enforced by a PARTIAL UNIQUE INDEX on
`(tenant_id, organization_id, campaign_id, occurrence_key)` rather than by a check, because
check-then-insert cannot be made safe: two workers handed the same redelivered job both read "no run
yet" and both insert. `createRun` performs the insert on a FORKED entity manager so a rejected insert
cannot sit in the caller's persist stack and be retried by the next unrelated flush, and returns null
— a duplicate, which `dispatchEvent` counts separately from a guard, because the two say different
things when somebody asks why a campaign did not fire.

**The key is erased after six hours**, by the periodic resume scan. This is the part worth
understanding: two genuinely separate occurrences with identical payloads — a tag removed and re-added
— hash the same, so permanent uniqueness would quietly convert every `unlimited` re-entry policy into
`once`. Six hours is far longer than any redelivery a queue or provider attempts (minutes) and well
inside the day-scale windows a re-entry policy is expressed in. A sweep-started run has no occurrence
at all and stores null, which the partial index ignores.

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

## Review findings and what they taught

A code review and a security review of the whole branch produced 15 and 1 findings respectively. Every
one was verified in the source before being accepted, and every one is fixed. Four are worth recording
because they are patterns rather than typos:

**A guard that recurses in two places out of three.** `assertStepsAreRunnable` and `assertNoTrailingWait`
both descend into a split's lanes; the cycle check did not. So a campaign whose `add_tag` sat inside a
lane passed validation and then drove itself on every tag assignment, with only `MAX_RUNS_PER_SUBJECT`
braking it. Promoting a winning lane had the same hole, because it re-ran the other two assertions and
not this one. Both now call the same `assertNoLoopRisk`, which is exported and tested directly.

**A feature reachable only through the API.** Twice: scheduled triggers, then the send rules. Both were
implemented, tested, and impossible to author in the editor. The A/B split was a third and subtler case —
a new split's lanes are empty, and the palette derived its target from the SELECTED STEP, so there was
never a step inside a lane to select and the first step could not be added at all. The rule that comes
out of it: a capability is not delivered until something in the UI can produce it, and "there is an
endpoint" is not that.

**A defaulted value that disables a guard.** `updatedAt: body.updatedAt ?? ''` made the optimistic lock a
no-op, because the platform guard falls back to the extension header only when the expected version is
ABSENT, and an empty string is present. This is the second time in this module that a lock was silently
switched off by a value that looked harmless.

**Third-party error text is data, not diagnostics.** A transport rejection quotes the address it
rejected, and the executor copied it into the step log and `last_error`, which the runs API returns to a
principal holding `runs.view` alone — the one disclosure that endpoint exists to prevent. The transport
error is now caught at the send step, reported in full to the logger and the error reporter (a different
trust boundary), and re-thrown redacted; `redactEmails` is applied again before anything is persisted,
including in the dead-letter writer.

Also fixed: A/B results counted the campaign's shared trunk sends as each lane's own, which let the
"minimum sample per lane" gate be satisfied by a message neither lane sent; the customer profile reported
all-time sends beside engagement measured over the last ten runs; the attempt counter started a new run's
first failure at two, skipping the first backoff; a renamed variant key committed per keystroke and
stranded the results of every intermediate spelling; `hasActiveRun` was a read-then-write behind an
eight-way concurrent worker and is now backed by a partial unique index on the active statuses.

## Changelog

- **2026-09-28** — Phase 1 implemented: five tables and one migration; pure engine (audience
  veto, step planner, send gates, executor) with 101 unit tests; run persistence with
  claim-and-lease, backoff and dead-lettering; three event subscribers with context hydration;
  two scheduled sweep sources; three step types; campaign API with save-graph behind an
  optimistic lock; canvas editor reusing the `business_rules` condition builder; `en`/`pl`
  locales. Verified against a running instance: palette, create, save, round-trip, 409 on a
  stale save, and five rejected invalid graphs.
- **2026-09-28** — Backlog X-14: journey preview for one named customer, driven by the real engine with
  recording effects so every gate applies and the timeline cannot drift from what the campaign will
  actually do. Pauses carry the engine's own reason. 463 unit tests, 60 integration tests.
- **2026-09-28** — Review pass: 15 code-review findings and 1 security finding, all verified and fixed.
  Highlights: the cycle guard now recurses into split lanes (and runs when a winner is promoted), A/B
  lanes can be filled from the canvas at all, the winner promotion's optimistic lock no longer no-ops on
  a header-supplied version, transport error text is redacted before it is persisted or returned, A/B
  rates count only each lane's own sends, and one active run per (campaign, subject) is enforced by a
  partial unique index rather than by a check. 444 unit tests, 55 integration tests.
- **2026-09-28** — Backlog X-11: send timing learned from each customer's own open hours, with the
  optimisation subordinate to quiet hours, and a send-rules panel that makes the frequency cap and quiet
  hours authorable for the first time. 426 unit tests, 50 integration tests.
- **2026-09-28** — Backlog X-12/B-10: the lane each run walked is recorded rather than recomputed,
  per-variant A/B results with a winner that is withheld until every lane has a sample, author-initiated
  promotion of a winning lane under the optimistic lock, linear multi-touch revenue attribution, and a
  campaign results screen. 407 unit tests, 48 integration tests.
- **2026-09-28** — Backlog B-04/B-05 and the authoring gap behind them: sweep sources became a
  registry with durable per-row claims, the canvas can author a scheduled trigger (interval, source,
  re-entry window), a `fulfilled_orders` source makes review requests exactly-once per order, and
  win-back turned out to need no new code. Two defects found by the new integration tests: schedule
  identity ignored the source, and an unparseable payload answered 500. 385 unit tests, 41 integration
  tests.
- **2026-09-28** — Backlog B-01/B-02/B-03: lead scoring as an idempotent ledger with an `add_points`
  step and a `score_changed` trigger carrying the previous total, tiers derived from a per-tenant
  ladder, and the customer profile screen. 367 unit tests, 36 integration tests.
- **2026-09-28** — Phase 3: delivery tracking. `marketing_message_send_events`, two signed public
  endpoints (open pixel, click redirect), link rewriting and pixel embedding in `send_email` with a
  per-step opt-out, and a counts endpoint with unique-recipient figures. 322 unit tests, 28
  integration tests.
- **2026-09-28** — Phase 2.3: event idempotency. Occurrence key derived from the delivered payload,
  enforced by a partial unique index on `(tenant, org, campaign, occurrence_key)` and released after
  six hours so re-entry policies keep their meaning. Verified against Postgres: the redelivery is
  rejected, two key-less sweep runs are not. 269 unit tests.
- **2026-09-28** — Phase 2.2: set-level audience narrowing. Pure planner with a superset guarantee,
  candidate resolver over tag and order-aggregate queries, sweep enrols from candidates instead of
  scanning the organization, and an audience-estimate endpoint that is explicit about whether its
  number is exact or an upper bound. 251 unit tests.
- **2026-09-28** — Phase 2.1: A/B split. `split` step type with deterministic per-subject lane
  assignment, in-place flattening before planning, recursive save-time validation (unknown step
  types and trailing waits inside lanes are refused as they are at the top level), canvas fork and
  rejoin rendering with per-lane shares, a lane inspector, and `lib/canvas/step-tree.ts` for
  structural edits. 173 unit tests.
