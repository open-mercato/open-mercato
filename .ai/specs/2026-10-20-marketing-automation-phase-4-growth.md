# Marketing Automation — Phase 4: Audiences at Scale and Growth

| Field | Value |
|-------|-------|
| **Status** | Specification (per-phase slice) |
| **Created** | 2026-10-20 |
| **Modules** | `marketing_automation` (`packages/marketing-automation`) |
| **Parent spec** | [`.ai/specs/2026-09-28-marketing-automation-module.md`](2026-09-28-marketing-automation-module.md) — Problem Statement, Data Models, API Contracts, Risks & Impact Review, Final Compliance Report and Changelog are shared across all phases and are not repeated here. |
| **Delivery plan** | [`.ai/specs/2026-10-02-marketing-automation-phased-delivery.md`](2026-10-02-marketing-automation-phased-delivery.md) — this file is P2–P5's "relevant sections out of" the module spec, per that spec's Migration & Backward Compatibility section |
| **PR** | [#6867](https://github.com/open-mercato/open-mercato/pull/6867) |

## Scope

Saved segments with one membership resolver shared by five callers, the lead-score ledger and the
rules that feed it, the tier ladder derived from it, referral codes with their conversion, price
watches, lead routing with the weekly rep digest, product/geographic audience targeting, and subject
export and erasure. These are the features an operator adds once campaigns are running, which is why
they come after the results screen (Phase 3) rather than before it.

## Architecture (extracted from the module spec)

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

`complete` is what makes an audience countable, and it is the foundation segments are built on.
`POST /campaigns/:id/audience-estimate` takes the audience in the BODY — so an author gets the
number for what is on their screen, not for what they last saved — and answers `exact` only when
the whole expression was expressible, otherwise `atMost`.

### Saved segments

A segment is a NAMED audience expression — the same `business_rules` condition tree a campaign uses, so
it needed no new condition language, no new evaluator and no new narrowing rules. Membership is
published as a `segments` array on the subject document, which means `segments CONTAINS 'lapsed-vip'`
(and `NOT CONTAINS`) work through the existing evaluator with no new operator. Decisions: the slug is
derived from the name once and then immutable, because saved audiences reference it and a rename would
silently empty every campaign that targeted the segment; a segment may not be defined in terms of
segments, refused at the writer AND made harmless at the reader by emptying the key before evaluating,
since a cycle in per-customer evaluation is a stack overflow inside a dispatch; a null expression means
everybody, which is a legitimate thing to name; and a deleted segment matches nobody rather than having
its references rewritten out of campaigns nobody asked us to edit.

Membership resolution lives in ONE shared resolver used by five callers (members screen, overlap, daily
sizes, bulk actions, CSV export), because the moment two of them compute it differently a screen starts
disagreeing with what actually sends. Overlap resolves both sets at the same instant and intersects
them, reports counts only, and says whether the answer is exact or a sample. Sizes are snapshotted once
a day by the sweep pass. Bulk actions are real `ProgressJob`s on a dedicated queue: they carry the
SEGMENT rather than a member list, check cancellation per customer, award points through the ledger's
existing idempotency, and tag through the platform command. Export is CSV with an explicit completeness
header; import is deliberately deferred — a segment whose membership is an imported list is a second
membership model.

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
decrypting finder, preferring a shipping address over a billing one over anything else.

### Lead score, tiers and the customer profile

The score is a LEDGER, not a total in a column. A total has to be incremented, and an increment is the
one write a retry cannot repeat safely: a step awarding 10 points, redelivered, would award 20. Entries
are keyed by the run and step that produced them, so a redelivery collides instead of double-counting,
and the score is `sum(points)` — the same shape as the order aggregates, which means the audience
narrowing pushes `score.points >= 100` down for free. The ledger also answers "why does this customer
have 40 points", which a total never can.

Tiers are derived from the score, never stored: the score changes continuously, so a tier column would
need a job to keep it true and would be wrong in between. The ladder is per-tenant configuration
(`moduleConfigService`, key `loyaltyTiers`) with a default of bronze/silver/gold at 0/100/500.
`score.tier` compares with `=` or `IN`; `score.tierRank` exists so "at least silver" is expressible as
`>= 1`, and is -1 below every bound so those comparisons stay false for the unranked.

The score change is emitted as `marketing_automation.score.changed` and is itself a trigger, carrying
the PREVIOUS total as well as the new one. That is what lets an audience say "reached 100 points" —
`trigger.previousPoints < 100 AND score.points >= 100` — rather than "is above 100 points", which would
fire again on every later change while the customer stayed above the line.

The customer profile assembles all of it on one screen — score, tier, distance to the next tier, order
aggregates, tags, sends, opens, clicks, recent score entries and recent runs — because the module
already computes every one of those and computing them again per screen is how numbers start
disagreeing. It requires BOTH `marketing_automation.runs.view` and `customers.people.view`: it names an
identifiable person and reports their behaviour, which is the union of two disclosures.

### Score rules — points for who a customer is

Ported from Ordo's demographic scoring. A rule is a name, signed non-zero points and a condition — the
same `ConditionExpression` a segment holds, evaluated by `matchesAudience` over the subject document. A
rule may read neither `score` (its own points would feed back into it) nor `segments` (a segment may
itself be defined on score); the writer refuses both and evaluation blanks both keys anyway.

What the rules award is kept in the existing ledger as `source = 'rule'` entries. Re-evaluating writes
only the DIFFERENCE between what the rules award now and what they awarded before. Concurrency needs no
lock: each rule entry carries `rule_sequence` under a partial unique index — two overlapping evaluations
read the same count, claim the same number, and one collides. Re-evaluated on person create/update and
tag assign/remove, by a queued pass after a rule changes, and by the same pass once a day from the
sweep. A per-person "Recalculate score" button backs `POST /customers/{id}/rescore`.

Rules score live PERSONS only, and never a person whose marketing data was erased. `isScorableSubject`
checks a dedicated `marketing_subject_erasures` record before anything is read.

### Subject access and erasure

Both halves live in one file because they must agree: an export that omits a table lies to the person
asking, and an erasure that misses the same table lies to the regulator.

**Erasure unlinks; it does not delete.** The subject id is nulled on every row — including inside the run
context's jsonb — and the rows stay. Nothing else in those rows identifies anybody, and deleting them
would silently rewrite history: a campaign that reported 4,000 sends last quarter would start reporting
3,850.

**Consent records are kept, with the subject id.** This looks like the opposite of erasure and is the
expected practice: forgetting that somebody unsubscribed is how they get mailed again. The erasure
report says how many consent records it kept.

**No new ACL feature.** Both actions are gated by `marketing_automation.runs.view` plus
`customers.people.manage`. Erasure additionally requires `{"confirm":"erase"}` in the body.

## Growth features (from the module's changelog)

- **Referral programme.** A customer's code is Crockford base32, one live code per person forever. A
  **claim** when somebody enters a code and a **conversion** on that person's first order — only the
  conversion is rewarded, via a conditional UPDATE so two orders arriving together cannot both pay out.
  The conversion emits an event whose subject is the REFERRER. Claiming is authenticated, and the
  endpoint never returns the referrer.
- **Price watches.** A customer can be registered as waiting for a SKU to get cheaper; the periodic pass
  compares today's list price against the price they last saw and fires
  `marketing_automation.product.price_dropped` with the drop percentage. The reference is what THAT
  customer last saw, follows the price UPWARDS on recovery, and a watch may not fire again for seven
  days. Back-in-stock is explicitly blocked: stock lives in the optional `wms` module and reading its
  tables from here is the cross-module coupling this codebase forbids.
- **Lead routing.** An `assign_owner` step gives a new lead to the rep in the configured pool who
  currently carries the fewest — least-loaded wins rather than round robin, stateless and
  self-correcting. A lead that already has an owner is left alone unless told otherwise. The weekly
  digest is an in-app notification, not email, delivered through the notifications module rather than a
  cross-module read of the auth user table.

## Out of scope for this phase

The engine, campaign CRUD and the canvas are Phase 1. Delivery tracking and consent are Phase 2.
Results and attribution are Phase 3. The authoring agent and inbound hooks are Phase 5.
