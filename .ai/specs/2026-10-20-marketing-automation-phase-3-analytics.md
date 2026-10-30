# Marketing Automation — Phase 3: Analytics and Results

| Field | Value |
|-------|-------|
| **Status** | Specification (per-phase slice) |
| **Created** | 2026-10-20 |
| **Modules** | `marketing_automation` (`packages/marketing-automation`) |
| **Parent spec** | [`.ai/specs/2026-09-28-marketing-automation-module.md`](2026-09-28-marketing-automation-module.md) — Problem Statement, Data Models, API Contracts, Risks & Impact Review, Final Compliance Report and Changelog are shared across all phases and are not repeated here. |
| **Delivery plan** | [`.ai/specs/2026-10-02-marketing-automation-phased-delivery.md`](2026-10-02-marketing-automation-phased-delivery.md) — this file is P2–P5's "relevant sections out of" the module spec, per that spec's Migration & Backward Compatibility section |
| **PR** | [#6866](https://github.com/open-mercato/open-mercato/pull/6866) |

## Scope

The results screen and the numbers behind it: the daily series, the step funnel, which links were
clicked, linear revenue attribution, A/B lane results with their winner rules, and the learned send
hour. Every section here is a statement about what a campaign **did**; none of it is needed to run
one, which is why it travels as its own phase after Phase 2's delivery/tracking primitives exist.

## Architecture (extracted from the module spec)

### Charts

Sends, opens and clicks per day, over the report window. Grouped in SQL over a GENERATED date
series rather than in JavaScript over rows: a chart that skips empty days draws a line through them and
implies activity that did not happen, and filling the gaps afterwards means the query and the filling
disagree about what a day is. Days bucket in UTC — arbitrary, but engagement arrives from mail clients all
over the world, so every bucketing is arbitrary and an arbitrary rule everybody can see beats a clever one
nobody can reproduce. The chart is drawn only once something has happened, because an empty ninety-day
line reads as a campaign that failed rather than one that has not run.

### Send timing, learned per customer

With opens recorded (Phase 2), the hour a customer usually reads email is knowable, so a send can be moved
to it. Deliberately the customer's OWN history rather than a cohort average: "9am is best" is a statement
about a population, and the point of per-customer timing is that the night-shift worker is not the
population.

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
send nobody wanted is not.

Send rules — the frequency cap, quiet hours and this flag — are campaign-wide and are edited in the
editor's inspector when no node is selected.

### Results: A/B outcomes and attributed revenue

The lane a run walked is RECORDED on the run at enrolment, not recomputed. The choice is deterministic,
so recomputing would agree — until the author edits the split, at which point every historical run would
be re-attributed to a lane it never walked and the comparison would quietly become fiction. It is
recorded only for runs that have a subject, because a subject-less run is flattened with the run's own
id, which does not exist yet at enrolment.

Opens and clicks are counted as UNIQUE RUNS rather than raw events: a mail client re-fetching a pixel is
not a second person reading the message, and a winner picked on raw opens rewards whichever variant
reached the more aggressive inbox previewers.

A winner is judged on the metric the TENANT chose — clicks per recipient, or attributed revenue per
recipient (`splitWinnerMetric`, default clicks). Clicks are available on every campaign; revenue is the
better question, because a variant that collects clicks and sells less is the classic A/B trap and the
module could not see it. Revenue is refused rather than approximated when the lanes are not comparable:
different currency codes have no ordering, a `mixedCurrency` lane cannot be summed, and a lane with
nothing attributed yet is not evidence that nothing will be. One setting governs BOTH the suggestion on
the results screen and the unattended promotion, because being shown a click winner while a revenue
winner is applied for you is worse than either alone. The lanes' revenue is attributed over the same
window as the attribution block and the funnel, so the three reconcile. `decideAutoWinner` measures its
relative margin on whichever metric decided — reading the click rates there would refuse a revenue
promotion for failing a margin nobody was judging on.

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

### The per-step funnel

Aggregated from the `step_log` every run already carries, so a six-step journey can finally say where
people stop. Read in authored order, never sorted by volume; a step inside a split lane is measured
against the SPLIT rather than the trunk (otherwise the lane weights read as a drop-off), and so is the
first step after one, because which lane somebody walked is path-dependent. Skips and failures are
reported separately: a gate doing its job is not an error.

### Link report

`link_url` stops being write-only: the results screen ranks which links were clicked, counted in PEOPLE
with the raw clicks beside them (the two diverging is how "came back to it" becomes visible) and with the
steps each link appeared in. Shares are of everyone who clicked anything and overlap deliberately; the
ranking says when it was cut rather than reading as an inventory.

## Out of scope for this phase

Score, tiers, segments and the customer profile are Phase 4. The authoring agent and AI copy are
Phase 5. Delivery tracking itself (the pixel/click endpoints this phase's numbers are built from) is
Phase 2.
