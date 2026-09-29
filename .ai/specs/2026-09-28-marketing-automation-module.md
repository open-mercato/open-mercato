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

### NPS survey

One question, answered in a click from the email.

**The step composes its own message**, which no other sending step does. An eleven-point scale is eleven
signed links, and asking an author to place eleven placeholders correctly — in every locale, in every
template — would make the feature technically available and practically unused. The author writes the
subject line and the question; the module renders the scale. It declares `channel: 'email'`, so consent,
quiet hours and the frequency cap apply to it exactly as to a campaign message: a survey IS a message, and a
customer who unsubscribed did not ask to be surveyed either.

**The score travels inside the signature.** A different score is a different link, not a different
parameter, so a recipient cannot change their own answer by editing the URL. The purpose is signed too, so an
open, click or unsubscribe token cannot be replayed as an answer.

**The prompt row is written before the message goes out**, and only once per (run, step). A row without a
message is an unanswered survey, which is visible; a message without a row is an answer with nowhere to go.
Asking twice would give one person two chances to answer one question, which quietly doubles their weight in
the result.

**A second answer overwrites the first.** Somebody who clicks 3 and then 8 has told us 8; keeping the first
click measures reflexes rather than opinion. The thank-you page offers an optional comment, which is usually
where the value actually is, and it posts back to the same signed URL so the token remains the only thing
identifying the answer.

The audience gains `survey.nps`, and it is pushable for EVERY operator — including the downward comparisons
that `orders.count` refuses. The contrast is the point: a customer with no orders has a real zero, so
`orders.count <= 5` is true for them and the aggregate cannot return them; a customer who never answered has
null, and `matchesAudience` vetoes magnitude comparisons against null, so they can never match and restricting
candidates to answerers stays a superset. The rule was always about semantics, not about which table a number
came from. The set-level query reads each subject's LATEST answer, because somebody who scored 3 last year and
9 last week is a promoter and targeting the old answer would address a feeling they no longer have.

One defect the tests caught immediately: `isValidNpsScore` accepted `null`, because `Number(null)` is 0 — a
valid NPS score, and the worst one. A missing answer would have been recorded as the strongest possible
complaint and would have looked like data.

### Subject access and erasure

Both halves live in one file because they must agree: an export that omits a table lies to the person
asking, and an erasure that misses the same table lies to the regulator. The table list is written once and
a test holds both functions to it.

**Erasure unlinks; it does not delete.** The subject id is nulled on every row — including inside the run
context's jsonb, because nulling the column and leaving the id one key deeper is erasure in name only — and
the rows stay. Two reasons, the second decisive:

1. Nothing else in those rows identifies anybody. This module never stored a name, an address or a phone
   number; the run context, the send history and the event table were each designed to hold none. A row
   with no subject id identifies nobody, which is what erasure has to achieve.
2. Deleting them would silently rewrite history. A campaign that reported 4,000 sends last quarter would
   start reporting 3,850, and every number an operator wrote down would quietly stop matching. Erasure is
   a duty to one person; falsifying an audit trail is a harm to everybody else.

**Consent records are kept, with the subject id.** This looks like the opposite of erasure and is the
expected practice: forgetting that somebody unsubscribed is how they get mailed again — the exact harm they
acted to prevent. Once the platform erases the customer row itself, that uuid points at nobody while still
suppressing the id forever. The erasure report says how many consent records it kept, so the operator sees
the decision rather than discovering it.

**No new ACL feature.** Both actions are gated by the pair that already describes them —
`marketing_automation.runs.view` plus `customers.people.manage`. Minting a `gdpr.*` feature would have meant
editing the platform's own ACL translation catalogue for a permission that is exactly the intersection of two
existing ones, and a module should not grow the platform's permission surface to describe something already
describable. Erasure additionally requires `{"confirm":"erase"}` in the body: a destructive action reachable
by URL alone is one somebody performs by accident.

### Consent and one-click unsubscribe

The feature without which this module should not send anything in production.

**Two tables, deliberately.** `marketing_consents` holds one row per (customer, channel) with the current
answer; `marketing_consent_events` is append-only. They answer different questions with opposite access
patterns: the send gate needs one indexed row per message, a regulator needs the whole history and never in
a hurry. Keeping them together would mean either an aggregate on the hottest path in the module or a
history that can be overwritten — and a consent trail that can be overwritten is not a trail. A repeated
"unsubscribe" still appends an event, because when somebody acted is a fact.

**Silence means permitted**, and that is a decision rather than an oversight. The platform has no global
consent model for this module to inherit, so treating an absent record as refusal would have disabled every
campaign on every existing installation the moment this shipped — a behaviour change delivered as a bug
report. An installation that needs opt-in imports its consent, which is what the `import` source is for.
The constant is named `UNRECORDED_CONSENT_ALLOWS_SENDING` so the choice is visible where it is made.

**Consent is checked before every other send gate.** Quiet hours and the learned send hour say "not yet";
the frequency cap says "not this one"; consent says "not at all". So it DROPS the message rather than
deferring it — deferring something a customer asked not to receive only sends it later — and records the
suppression with reason `unsubscribed`, so the reason appears in reporting instead of the message simply
never existing.

**The unsubscribe link carries no identity.** It reuses the tracking token machinery — signed, public,
scoped, purpose-pinned, so an open token cannot be replayed as an unsubscribe — and names the RUN. The
endpoint resolves the customer from the run, so the URL that ends up in mail archives, forwarded messages
and corporate scanners identifies nobody. It answers HTML, because a mail client opens it in a browser and
somebody who has just asked to be left alone deserves a sentence rather than a JSON object; `no-store` and
`no-referrer`, and POST behaves identically for RFC 8058 one-click clients.

**It never claims success it did not achieve.** A signed link whose run no longer exists answers 404 with an
apology and a way to reach a human, and a failed write answers 500 — because somebody who believes they
unsubscribed and did not is the worst outcome this feature can produce, worse than an honest error.

`{{unsubscribeUrl}}` is offered to the author so they can place the link where their design wants it, and a
minimal footer is appended only when they did not. That footer is the one place this module modifies an
author's HTML, which the link rewriter otherwise refuses to do: a marketing email with no way out is not a
shippable default, and in much of the world it is not lawful.

### Charts, and an agent that can author

**Charts.** Sends, opens and clicks per day, over the report window. Grouped in SQL over a GENERATED date
series rather than in JavaScript over rows: a chart that skips empty days draws a line through them and
implies activity that did not happen, and filling the gaps afterwards means the query and the filling
disagree about what a day is. Days bucket in UTC — arbitrary, but engagement arrives from mail clients all
over the world, so every bucketing is arbitrary and an arbitrary rule everybody can see beats a clever one
nobody can reproduce. The chart is drawn only once something has happened, because an empty ninety-day
line reads as a campaign that failed rather than one that has not run.

**An agent that can author.** A module-root `ai-tools.ts` contributes six tools, which the platform
registers for both the MCP server (external agents) and the in-app chat. Deliberately thin: the step
registry, the trigger catalogue and the save command already ARE the authoring API, so each tool delegates
to one of them rather than growing a parallel surface.

Three invariants, each with a test:

- **Nothing is ever published.** There is no tool that enables a campaign, and the test refuses any tool
  whose name looks like it publishes or destroys. Enabling starts messaging real customers, it is gated
  behind its own human permission, and an agent that could do it would turn a misunderstood sentence into
  mail nobody approved. Draft, review, publish by hand.
- **Nothing bypasses the save validation.** `save_campaign_graph` goes through the command, so an agent's
  graph faces the same checks a person's does and gets the same stable codes back — a code an agent can
  act on, rather than prose it can only apologise for.
- **Nothing crosses a tenant.** `requireToolScope` refuses a principal without both halves of the scope
  rather than answering with data from somewhere.

`describe_building_blocks` exists because availability differs per installation: an agent that composes a
campaign from what it remembers of the documentation writes graphs the save refuses.

### Product and geographic targeting

Two new audience dimensions, and they sit on opposite sides of the pushdown line — which is the whole
lesson of this pair.

**Product** (`orders.skus CONTAINS 'ATLAS-RUNNER'`) is read from each order line's CATALOGUE SNAPSHOT
rather than from the catalogue. A product that was renamed, re-skued or deleted must still target the
customers who bought it, and the snapshot is the only record of what they actually bought. The variant
sku is the fallback, because a shop that skus only variants would otherwise return nothing. It is a plain
jsonb extraction on a joined table, so it pushes down and an estimate over it is exact.

**Place** (`address.country`, `address.city`, `address.region`, `address.postalCode`) cannot push down at
all: every column of a customer address is encrypted at rest, so a SQL comparison would run against
ciphertext and match NOTHING — silently, which is the worst possible failure for an audience. So the
planner refuses those fields explicitly, with a test for each, and a geographic campaign is evaluated per
customer: correct, and more expensive than every other predicate. The address itself is read through the
decrypting finder, preferring a shipping address over a billing one over anything else — deterministic
beats theoretically-best, because an audience that depends on row order is worse than one that is merely
approximate.

### Real test send

One real message, rendered through the SAME function a real send uses, delivered to the CALLER's own
address — taken from the session, with no way for the request to name a recipient. That restriction is
the feature: a "send a test to this address" endpoint is a spam relay with a campaign editor attached,
whoever holds the permission.

Untracked and unrecorded: a test has no run, and counting the author's own opens as engagement would
corrupt the campaign's figures. A missing email channel answers 400 with its own code rather than 502,
because "nothing is configured to send with" and "the transport refused your message" have completely
different remedies — and the first is the state every fresh installation is in.

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

- **2026-09-29** — X-02: birthday campaigns, which were recorded as blocked and turned out not to be. The
  platform stores no birth date, and the conclusion that this needed a core change was wrong: custom fields are
  the platform's own way for one module to extend another's record, so the field is declared in this module's
  `ce.ts` on the person profile. The sweep source matches **month and day only** — a stored year may be a guess,
  a placeholder or absent, and matching it would make the campaign fire once ever instead of once a year — and
  puts the YEAR in its claim key, which is what makes it annual while still being idempotent within a day. A
  window that crosses new year is handled by comparing month-day strings rather than doing date arithmetic, which
  is the case arithmetic gets wrong; 29 February simply does not match in a year without one, rather than
  surprising somebody on the 1st of March. The field lives against the person PROFILE id, so the query joins
  through to the customer entity — the mapping this module's guidance already warns about. 736 unit tests, 146
  integration tests.

- **2026-09-29** — X-04 and X-13. **The Campaign Author agent** turns a described intention into a saved draft
  over the tool pack that already existed. Its tool list is written out by hand rather than derived from the
  pack: a tool added to the module must not arrive in the agent's hands for free, and the enable tool this
  module refuses to write would otherwise hand it the power to publish. Eight tests assert that — every tool it
  may call exists, none of them suggests enabling, publishing or sending, every write is confirm-required, the
  loop is bounded, and the prompt says plainly that publishing is a human decision. **The deliverability
  breaker** pauses a campaign whose recent sends are mostly failing, by unpublishing it through the ordinary
  command rather than setting a flag of its own — a campaign that looks enabled and sends nothing is the worst
  of both — and notifies by FEATURE rather than by person, because whoever published it may have left while the
  people who can fix it are those holding the manage grant. It is conservative in both directions: a small
  sample never trips it and a campaign that is merely unlucky is left alone, since a guardrail that pauses
  working campaigns gets switched off. It watches the failure rate of attempted sends, and says so: bounce and
  complaint rates need provider feedback webhooks the platform has no contract for, recorded as a core proposal
  rather than faked. **A gap closed on the way:** a failed send was not recorded as a send at all, so a campaign
  being refused by the transport looked quiet rather than broken — the results screen understated it as "fewer
  sends" and the breaker would have had no signal. 727 unit tests, 146 integration tests.

- **2026-09-29** — X-03 and B-27, closing the unblocked backlog. **Channel targeting** is
  `orders.channels CONTAINS '<code>'`, pushed down to SQL as a join on `sales_channels`, and means "has bought
  through this channel": the platform has no "belongs to this store" field on a customer, so deriving it from
  orders is both the only honest answer and the one an operator means. The negative form is deliberately not
  pushed down — "never bought in this channel" cannot be produced as a superset without listing everybody.
  **Language targeting** is `customer.locale`, sourced from the customer's own choice in the preference centre
  rather than from their address: guessing from a country is how people receive marketing they cannot read, so
  the absence of a choice is null rather than a default. Per-language copy is then one campaign or one split
  lane per language, which the existing primitives already compose — no per-locale body map was added, because
  that would be a second authoring model for the same thing. **The setup wizard** is a readiness checklist
  computed from LIVE state rather than from a "setup completed" flag: a flag says what somebody clicked, and the
  question is what is true now — which makes the same screen the answer to "why did nothing send" months later.
  Blocking checks (an email channel, a campaign, publishing it) are separated from recommended ones (tracking,
  segments, blocks), because a campaign without tracking still delivers; it just cannot report. One knowingly
  ugly compromise is documented in the route: "is a tenant-wide email channel configured" is read with raw SQL
  against `communication_channels`, because no service answers it and a wizard that claims readiness without
  checking is the failure the screen exists to prevent — recorded in the roadmap as a core proposal.
  705 unit tests, 146 integration tests.

- **2026-09-29** — X-08: the customer-portal preference centre. A signed-in customer can subscribe or
  unsubscribe, cap themselves at N messages a week, or pause for 30/90/180 days — the middle ground consent
  does not have, and the reason a preference centre reduces unsubscribes rather than collecting them: somebody
  who only wanted less mail has otherwise had one button, and it says stop. The engine honours both new
  instructions: the customer's cap is evaluated as a SECOND cap in its own weekly window rather than merged
  with the campaign's, because "three a week" and a shop's "two a day" only have exact answers as written, and
  a preference may only ever make things quieter; the pause DEFERS at the same step rather than dropping,
  because it is "not now" and not "no" — and when a pause ends inside quiet hours the later instant wins, since
  both are promises. The subject always comes from the portal session and never from the request: a preference
  centre that took an id from its input would let anybody unsubscribe anybody. Consent written here is recorded
  with the `customer` source on the same append-only trail as a one-click unsubscribe, which is what makes it
  provably first-party. What reads it: the send gate, and the customer profile, which shows what the person
  asked for beside the consent they gave — "subscribed, but at most one a week and paused until March" is a
  customer nobody should be surprised by. 699 unit tests, 141 integration tests.

- **2026-09-29** — Backlog B-26: lead routing. An `assign_owner` step gives a new lead to the rep in the
  configured pool who currently carries the fewest — **least-loaded wins rather than round robin**: a stored
  cursor needs a table, has to be reset whenever the pool changes, keeps feeding a rep who has been away for a
  fortnight, and answers a different question from the one an operator has. Counting live work is stateless,
  self-correcting and deterministic on ties, so a re-run assigns the same person. A lead that already has an
  owner is left alone unless the step is explicitly told otherwise, because taking a customer away from the rep
  who has been talking to them is the most damaging thing routing can do — and a campaign re-entry would do it
  on every pass if the default were reversed. **No new table:** the owner is the customers module's own field,
  written through `customers.people.update` so the audit entry, the event and the cache invalidation all hold.
  The weekly digest is an **in-app notification, not email**: emailing a rep means either reading the auth
  module's user table or copying their address into marketing config — a cross-module read or a stale duplicate
  — while the notifications module delivers to a user id, localises the copy and respects that person's own
  channel preferences, including email if that is what they want. It sends only when something arrived, decides
  for itself whether a week has passed (from the job log, which is already the operator's record of it), and
  the module stores rep IDS only, so a name or address change needs nothing here. What reads it: a lead-routing
  screen showing each rep's load and their week, names resolved live from the staff directory. 687 unit tests,
  138 integration tests.

- **2026-09-29** — Backlog B-06, price-drop half: product watches. A customer can be registered as waiting for
  a SKU to get cheaper; the periodic pass compares today's untargeted list price against the price they last
  saw and fires `marketing_automation.product.price_dropped` with the drop percentage, so an audience can
  require a real discount rather than any change. Decisions, each with a test: the reference is what THAT
  customer last saw rather than an all-time low, because otherwise a recovery looks like a drop; a drop under
  5% is rounding, tax or currency noise; a missing current price is not a drop, since an unpublished product
  has not become cheaper; the reference follows the price UPWARDS so a partial recovery is not announced; and a
  watch may not fire again for seven days, or a shop moving a price down in three steps sends three emails.
  The scan commits its bookkeeping before the events go out, so a crash between them sends nothing rather than
  twice. Watches are idempotent per customer and SKU and asking again does NOT reset the reference, which
  would cancel a drop the customer was already owed.
  **Back-in-stock is blocked, and the block is real:** the platform has no availability contract, stock lives
  in the optional `wms` module's inventory balances, and reading its tables from here is the cross-module
  coupling this codebase forbids — so it is recorded rather than bodged. What reads it: the customer profile
  shows what they are waiting for with the price then and now, and a price-watch screen ranks products by how
  many people are waiting, which is demand that has declared itself. 678 unit tests, 133 integration tests.

- **2026-09-29** — Backlog B-11: segments made operable. Membership resolution moved into ONE shared resolver
  now used by five callers (members screen, overlap, daily sizes, bulk actions, CSV export), because the
  moment two of them compute it differently a screen starts disagreeing with what actually sends. Overlap
  resolves both sets at the same instant and intersects them, reports counts only — naming the overlap would
  make it a people-listing endpoint with a different permission — and says whether the answer is exact or a
  sample, since an overlap of two samples is a sample. Sizes are snapshotted once a day by the sweep pass,
  made idempotent by a unique index on the calendar day rather than by a "have I done this" flag, and each
  point records whether it was exact so a chart cannot silently mix the two. Bulk actions are real
  `ProgressJob`s on a dedicated queue: they carry the SEGMENT rather than a member list, so they apply to who
  is in it when the job runs, check cancellation per customer, award points through the ledger's existing
  idempotency (progress job as the run, customer as the step) and tag through the platform command. Export is
  CSV with an explicit completeness header; **import is deferred on purpose** — a segment whose membership is
  an imported list is a second membership model, and recording that is better than bolting it on.
  **A real inconsistency surfaced:** a narrowed candidate set can contain deleted customers and companies,
  while walking the population yields people only, so comparing two segments reported an empty overlap where
  one side plainly contained the other. Candidates are now filtered to live persons in both paths, matching
  the sweep and the audience estimate. 666 unit tests, 128 integration tests.

- **2026-09-29** — Phase 5.1 and 5.2: saved segments. A segment is a NAMED audience expression — the same
  `business_rules` condition tree a campaign uses, so it needed no new condition language, no new evaluator
  and no new narrowing rules. Membership is published as a `segments` array on the subject document, which
  means `segments CONTAINS 'lapsed-vip'` (and `NOT CONTAINS`) work through the existing evaluator with no new
  operator: 5.2 cost nothing once 5.1 existed. Decisions: the slug is derived from the name once and then
  immutable, because saved audiences reference it and a rename would silently empty every campaign that
  targeted the segment; a segment may not be defined in terms of segments, refused at the writer AND made
  harmless at the reader by emptying the key before evaluating, since a cycle in per-customer evaluation is a
  stack overflow inside a dispatch; a null expression means everybody, which is a legitimate thing to name;
  and a deleted segment matches nobody rather than having its references rewritten out of campaigns nobody
  asked us to edit. Definitions are loaded once per dispatch and once per sweep job, and
  `buildSubjectDocument` loads them itself when they are not passed — defaulting to none would make every
  segment audience quietly false. The members endpoint reuses the dispatcher's own matcher and says whether
  its answer is exact or a sample. What reads it: a segments screen with an inline member preview, the
  audience panel listing the references an author can target, and the customer profile showing which segments
  a person is in. 661 unit tests, 121 integration tests.

- **2026-09-29** — Backlog B-09: the referral programme. A customer's code is Crockford base32, eight
  characters, one live code per person forever — reissuing it would break every message that already printed
  it — with the standard fold so a code typed in lower case, with dashes, or with `O` for zero still resolves.
  A hand-rolled alphabet was tried first and folded `L` onto a character that was itself valid, which broke
  legitimate codes; the test that now guards that is the reason to prefer a documented encoding.
  Two stages: a **claim** when somebody enters a code, and a **conversion** when that person places their
  first order — only the second is worth a reward, and it is a conditional UPDATE so two orders arriving
  together cannot both pay out. The conversion emits an event whose **subject is the referrer**, with the
  buyer travelling as trigger context: no audience expression could turn one person's order into another
  person's run, which is exactly why this needs an event of its own. Claiming is authenticated on purpose — a
  public endpoint attaching any customer to any code is a reward-fraud machine — and it never returns the
  referrer, since that would turn a shared code into a way to look up who shared it. Self-referral and a
  second claim are each refused with their own code. What reads it: the customer profile shows the code, how
  many used it and how many bought, plus who referred this customer; a referrals screen ranks codes by
  conversions, because "who brings people who actually buy" is the question being asked. 643 unit tests, 116
  integration tests, including one that claims a code, places a real order and waits for the conversion.

- **2026-09-29** — Backlog B-25: operational observability. `marketing_campaign_revisions` serves both the
  audit trail and the restorable versions, because they are the same data: every save records what the
  campaign looked like AFTER it, so version 1 is the first save rather than a gap. A restore replays the
  ordinary save command with the campaign's current `updatedAt`, which means it is validated by the current
  rules, collides with a concurrent edit, emits the same event, and becomes a NEW version noted as
  `restored:N` rather than rewriting history. Thirty versions are kept per campaign, pruned on write rather
  than by a job nobody scheduled. `marketing_job_runs` records each sweep and each due-run pass with the
  counters it produced, written BEFORE the work starts so a job killed mid-flight is visible as `running`
  instead of leaving no trace — and a failure is recorded and then re-thrown, because swallowing it to keep
  the log tidy would turn a failed job into a successful one. Neither recorder can break the work it
  describes. Two screens read them: a History panel in the campaign editor with per-version restore, and a
  background-jobs list. 631 unit tests, 110 integration tests.

- **2026-09-29** — Backlog B-24: AI copy drafting, deliberately at AUTHORING time rather than as a step.
  A Draft button in the message inspector returns a subject, HTML body and plain-text body for the author to
  edit; nothing is saved until they save the campaign. The draft is grounded in the campaign name, its
  triggers, a new per-tenant brand-voice setting, and the placeholders and content blocks that actually
  exist, so it cannot invent a placeholder that renders as literal braces in an inbox. Rejected: generating
  per recipient at send time, which is what the source module did — copy nobody read would reach customers
  (this module's rule is that AI may author and only a human may publish), the cost would scale with the
  audience, and a slow or failing provider at send time would block or silently skip a message.
  Personalisation per customer is already interpolation's and the recommendation block's job, and both are
  deterministic and free. The model's output is treated as untrusted markup: scripts, embedded documents,
  inline event handlers and `javascript:`/`data:` URLs are stripped by `parseDraftedCopy`, and the editor
  shows the draft as text rather than rendering it. Tenant-supplied strings — brand voice, campaign name,
  brief — live inside a `<briefing>` fence in the user message so an injection attempt is data. Both AI
  packages are OPTIONAL peers loaded at call time, so an installation without them still dispatches
  campaigns and this endpoint simply answers 503. **A leak was also fixed:** the new inbound-hook end-to-end
  test awarded a point to whichever customer the installation listed first, which broke TC-MA-009 two
  commits later; it now creates and deletes its own customer. 625 unit tests, 105 integration tests.

- **2026-09-29** — Backlog B-18: inbound hooks. A signed, revocable URL per hook starts one campaign from
  outside the platform; the receiver emits `marketing_automation.inbound.received` and the existing
  subscriber path applies the audience, the re-entry policy, the per-subject budget and the
  payload-derived duplicate guard, so nothing about dispatch is duplicated. Decisions: its own signer
  rather than the tracking claim shape, because a hook has no run and a hook id in the run slot would
  verify and mean nothing; the token is derived from the row rather than stored, so the URL can always be
  shown again while a database copy alone is useless; revocation is a column checked on receipt; and the
  endpoint answers 202 to every caller that got past the signature, because reporting whether an address
  matched would make a leaked URL an address-existence oracle — the outcome is recorded on the hook and
  shown only behind a login. **Not built on the `webhooks` module:** its inbound machinery exists to verify
  a third party's signing scheme through a provider adapter, while here we issue the URL ourselves, and
  routing through it would have required an operator to create an endpoint there and select our adapter
  before any campaign could fire. 609 unit tests, 100 integration tests, including one that posts to a real
  hook and waits for the run to appear.

- **2026-09-29** — Backlog B-08: product recommendations, plus the module's first settings screen.
  `{{recommendations}}` in an email body renders products chosen by co-purchase affinity — ranked by
  DISTINCT co-purchasing customers rather than line counts, so one enthusiast cannot outvote a pattern —
  padded with best sellers so the block is never empty, and never offering back what the customer already
  owns. The same list appears on the customer profile with the signal that chose it, because a
  recommendation nobody can inspect is one nobody will trust. Links go through a per-tenant product URL
  template, which means recommendation clicks are rewritten by the existing tracking pass and show up in
  attribution like any other click. No prices: a catalogue snapshot records what somebody else paid.
  **A real bug surfaced while testing it:** `moduleConfigService.getValue` takes its scope inside an
  options object while `setValue` takes it positionally, and the tier-ladder loader passed it
  positionally — so a tenant's configured ladder was written per tenant and read instance-wide, silently,
  since the defaults are a legitimate answer. Fixed, with tests that assert the scope arrives, and the
  ladder is now editable on the new settings screen alongside the URL template. 596 unit tests, 91
  integration tests.

- **2026-09-29** — Backlog B-17 (snippet part): reusable content blocks. `marketing_content_blocks`
  with a key unique among LIVE rows only, a `{{block:key}}` reference resolved before interpolation,
  a screen to edit them, and the keys offered by the palette so the campaign editor can name what
  exists. Decisions: a separate syntax from `{{customer.name}}` because a block is trusted author
  HTML inserted raw while interpolation escapes customer data; a missing block renders nothing rather
  than its own reference; substitution is not recursive; the key is immutable after creation, since a
  rename would silently empty the block out of every campaign referencing it; and the CRUD is
  hand-written rather than `makeCrudRoute` because every other write in this module is an explicit
  route with `enforceCommandOptimisticLock`, and two CRUD styles in one module read worse than either.
  RSS, product-feed and recommendation blocks remain open and belong with B-08. 568 unit tests, 87
  integration tests.

- **2026-09-28** — Phase 1 implemented: five tables and one migration; pure engine (audience
  veto, step planner, send gates, executor) with 101 unit tests; run persistence with
  claim-and-lease, backoff and dead-lettering; three event subscribers with context hydration;
  two scheduled sweep sources; three step types; campaign API with save-graph behind an
  optimistic lock; canvas editor reusing the `business_rules` condition builder; `en`/`pl`
  locales. Verified against a running instance: palette, create, save, round-trip, 409 on a
  stale save, and five rejected invalid graphs.
- **2026-09-28** — Backlog B-07: NPS survey as a self-composing email step with a signed 0–10 scale, a public
  answer endpoint with an optional comment, the latest score on the customer profile, and `survey.nps` as a
  pushable audience field. 547 unit tests, 83 integration tests.
- **2026-09-28** — Backlog B-15 completed: subject access export and erasure, reachable from the customer
  profile. Erasure unlinks rather than deletes so historical totals stay true, and deliberately keeps the
  unsubscribe record. 512 unit tests, 76 integration tests.
- **2026-09-28** — Phase 6.1 and X-08: marketing consent as a send gate ahead of every timing gate, an
  append-only consent trail beside the current state, and a public one-click unsubscribe whose link
  identifies nobody. Silence is permitted, stated in a named constant. 504 unit tests, 72 integration
  tests.
- **2026-09-28** — Backlog X-06 (charts) and X-05 (MCP/agent tools): a daily series generated in SQL so
  gaps are zeroes rather than absences, and a six-tool authoring pack that can draft a campaign but can
  never publish one. 492 unit tests, 66 integration tests.
- **2026-09-28** — Backlog B-13 (product) and X-01 (geography), plus B-19 (real test send). The two
  targeting dimensions land on opposite sides of the pushdown line: a purchased SKU is exact in the
  database, an address can never be because it is encrypted — asserted per field so nobody optimises it
  later. Test sends can only reach the caller's own address. 475 unit tests, 66 integration tests.
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
