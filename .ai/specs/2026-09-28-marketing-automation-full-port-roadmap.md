# Marketing Automation — Full Port Roadmap (epic-level)

Companion to [`2026-09-28-marketing-automation-module.md`](2026-09-28-marketing-automation-module.md),
which specifies Phase 1 as built. This document plans the rest: functional parity with the
Magento module the work is ported from, **including** the expensive items.

Epic-level and deliberately not a feature spec: each phase below gets its own
`{date}-{title}.md` when it starts. Precedent for an epic-level entry: `SPEC-024`.

## Discovery: settled facts

The pre-work plan left six questions open. They are answered — in code, not documentation —
and three of its four risks are void as a result.

| Question | Answer | Consequence |
|---|---|---|
| Event bus between modules? | **Exists** — `packages/events`, `createModuleEvents`, `subscribers/*.ts` with `metadata = { event }` | Building one would have duplicated the platform. Risk void. |
| Transactional email? | **Exists** — `sendEmail` in `@open-mercato/shared`; `communication_channels` registers the transport; providers in `channel-resend`, `channel-ses`, `channel-gmail` | A separate `transactional-mail` module would have duplicated core. Risk void. |
| Orders / customers / cart in core? | Orders and customers **yes** (`sales`, `customers`). Cart **no** | Abandoned cart is blocked, not merely deferred. New finding the pre-work plan did not anticipate. |
| B2B accounts? | Companies exist in `customers`; quotes with `validUntil` in `sales`; a `sales.orders.approve` ACL feature already exists. **No** credit-limit concept | Order approval may be partly present — verify before building (Phase 7.1). |
| DI registration? | Awilix; `register(container)` per module | Confirmed. |
| Multi-tenancy automatic? | **No** — every query must carry `tenantId` and `organizationId` by hand | Risk **confirmed and live**. Enforced explicitly throughout Phase 1. |

Two corrections to the pre-work plan's design, already implemented:

- **Tags are not a new entity.** `customer_tags` + `customer_tag_assignments` exist with
  commands. A parallel tag table would fork segmentation away from the CRM.
- **Web push is the cheapest channel, not the most expensive.** `push_notifications` plus
  `channel-apns`/`channel-fcm`/`channel-expo` already exist; hand-rolling RFC 8291 is
  unnecessary.

## External dependencies — optional, taken last

Three items depend on third parties rather than on code. They are scheduled last and treated as
optional; what matters is knowing precisely what each one does and does not block.

| Item | Blocks | Does NOT block |
|---|---|---|
| Meta WhatsApp Business verification and template pre-approval (days to weeks) | 6.4 in full | anything else |
| An SMS account and sender number | 6.3 in full | anything else |
| A publicly reachable URL | Only verification from a real inbox: a mail client fetching the open pixel over the internet | **Building and testing Phase 3, 4.1, 4.2 and 4.3.** The tracking endpoints are ordinary routes; integration tests exercise them directly on localhost, and the funnel, A/B winner and send-time optimization read from the database, not from the network |

So the only real cost of deferring all three is that WhatsApp and SMS are absent, and that an
open/click demo has to be shown through the database and the runs view rather than through a real
mailbox. No earlier phase is gated.

## Coverage audit against the source module — 2026-09-28

A full inventory of the source module was taken (14 triggers, 19 conditions, 15 actions, 62 tables,
35 cron jobs, 24 ACL resources, one flat admin entry whose dashboard links 20+ screens) and compared
against every phase above. Phase 1 counts as coverage; frequency cap, quiet hours, dead-lettering,
nested AND/OR audiences, canvas authoring and queue durability are already delivered and are not
listed here.

**Not in the source module either, so not port targets:** geographic or location targeting (no
country/region/city/postcode/radius condition exists anywhere in it), birthday and anniversary
campaigns, landing pages, an on-site form builder, charts in reports, and per-campaign store or
language targeting. Anything we build in those areas would be new product, not a port.

### Whole subsystems with no phase yet

Ordered by how much of the original's value they carry.

**A. Lead scoring engine** — points per customer, demographic score rules with an admin CRUD, a
`score_threshold_crossed` trigger, a `score_at_least` audience predicate, an `add_points` step, and
bulk scoring over a segment. It is the backbone several other features hang off.

**B. Loyalty tiers** — bronze/silver/gold derived from score thresholds, a `loyalty_tier_at_least`
predicate, and a tier distribution on the dashboard. Cheap once A exists.

**C. Customer 360** — one read-only screen aggregating everything the module already computes about
one customer: score, tier, recency, frequency, monetary total, RFM label, tags, NPS, matching
segments, order count and total. Almost free once the pieces exist, and it is the screen that makes
the module feel like a CDP rather than a campaign list.

**D. Referral programme** — referral codes, redemption on first order, and a `referral_converted`
trigger whose context targets the REFERRER rather than the buyer.

**E. Price-drop and back-in-stock alerts** — customer watch subscriptions, two scan jobs, two
triggers, and a guest notifier. Needs catalogue price/stock reads, which the platform has.

**F. Review-request automation** — a delayed request after a completed order, claimed once per order.

**G. Win-back lifecycle** — inactivity tagging plus a win-back send, with the day threshold as
configuration. Phase 2.2's narrowing already makes the audience side cheap.

**H. NPS surveys** — a single-question 0–10 prompt, an `nps_score_at_least` predicate, and a public
answer endpoint.

**I. Product recommendations** — co-purchase affinity with best-seller padding, injected into a
message as a content block.

**J. Multi-touch revenue attribution** — linear split of an order's revenue across every campaign
click-through inside a window. Phase 4.1 stops at single-touch conversion.

**K. Two-way messaging inbox** — inbound replies stored and readable, with STOP-keyword opt-out
detection feeding the consent register.

**L. Per-provider outbound rate limiting** — pacing, distinct from the retry and dead-letter handling
Phase 6 delegates to `communication_channels`.

**M. GDPR export and erasure** — Phase 6.1 covers the consent model only; the source also exports and
erases a customer's data across every table and keeps an append-only consent audit log.

**N. Free gift offers** — cascading subtotal tiers with a gift pool. Arguably promotions rather than
marketing automation, and it depends on cart/pricing surfaces.

**O. Ad audience sync** — hashed segment members pushed to Google Ads and Meta.

**P. Product/shopping feeds** — Google Merchant and Meta catalogue feeds, cached per store.

**Q. AI content generation** — an LLM step writing copy into the run context.

**R. Operational observability** — a job-run log, an admin audit trail of who changed which campaign,
email template versioning with restore, and a dashboard beyond one widget.

**S. Lead routing** — round-robin assignment of new leads to sales reps, plus a weekly rep digest.

**T. Setup wizard** — a guided first-run screen.

### Phases that name a feature but cover a fraction of it

- **Segments (5.1/5.2)** omit audience-size history, the segment overlap tool, queued bulk actions
  over a segment's members, and import/export.
- **Audience predicates (5.3)** cover RFM/CLV percentiles only. Missing: `purchased_sku`,
  `purchased_category` with a window, `event_occurred` (cart add, wishlist add), plus the predicates
  belonging to A, B and H.
- **Reorder (7.4)** covers reminders; omits the cycle-detection engine, its admin grid with manual
  recalculation, building a cart from a detected cycle, and drift-based at-risk tagging.
- **B2B quotes** are stubbed as one trigger; the source has an offer lifecycle with expiry reminders,
  overdue expiry, and customer self-service extension.
- **Content blocks** (Phase 8's "dynamic content") are four producer types in the source — snippet,
  RSS with a fetch cache, product feed and recommendations.
- **Inbound webhook as a trigger** — Phase 8 lists the outbound step only.
- **Test dispatch (2.4)** is explicitly dry; the source also has a real test send per channel and a
  per-node "send test" on the canvas.
- **Anonymous visitors** — visitor tags as a first-class segmentation primitive, a
  `visitor_tag_added` trigger, and anonymous→customer identity stitching on login.
- **Push subscription management** — the admin grid and register/unregister endpoints.

### What this changes about the plan

Nothing already built is invalidated. The audit says the engine and authoring surface are ported and
the remaining work is mostly FEATURE BREADTH on top of them — which is the right order, because every
item above is a step type, a predicate, a trigger source or a screen, and all four are extension
points Phase 1 deliberately made public.

Priority for the next phases, if breadth is the goal: **A + B + C** together (scoring, tiers, Customer
360) because they compound and produce a visible screen, then **G + E + F** (win-back, alerts, review
requests) because they are three campaigns merchants ask for first and each is one trigger source plus
one audience predicate, then **J** (attribution) since Phase 3's tracking now makes it possible.

## Backlog — every remaining capability, scored

One row per shippable capability. `Size` is honest engineering effort on top of what already exists:
**S** ≈ a step type or a predicate plus tests, **M** ≈ a table, a job and a screen, **L** ≈ a
subsystem with an external dependency or a new provider package. `Extends` names the Phase 1
extension point it plugs into, which is the reason most of these are S rather than M: the engine was
built to be extended, so breadth is additive by construction.

### Parity — capabilities the source module has

| ID | Capability | Why a merchant pays for it | Size | Extends | Depends on |
|---|---|---|---|---|---|
| B-01 | Lead scoring: points per customer, rules, `score_threshold_crossed` trigger, `score_at_least` predicate, `add_points` step | Turns behaviour into one number a salesperson can sort by; every "hot lead" workflow starts here — ✅ 2026-09-28 — ledger, not a total, so a redelivered step cannot double-award | M | step registry + trigger catalog + subject document | — |
| B-02 | Loyalty tiers derived from score thresholds, `loyalty_tier_at_least` predicate | Lets one campaign say "gold customers only" without maintaining a list — ✅ 2026-09-28 — derived from the score, ladder configurable per tenant | S | subject document + audience fields | B-01 |
| B-03 | Customer 360 screen: score, tier, RFM, recency, frequency, spend, tags, segments, sends, opens, clicks | The screen that makes the module a customer profile rather than a send log; nearly free because the data already exists — ✅ 2026-09-28 — linked from the run list; every later item adds a section | M | backend page + read API | B-01, B-02, 3.1 |
| B-04 | Win-back lifecycle: inactivity tagging and a win-back send with a configurable day threshold | The single highest-ROI campaign in ecommerce — ✅ 2026-09-28 — needed no new code: a daily population sweep plus a narrowable audience | S | sweep source + audience narrowing | — |
| B-05 | Review-request automation: delayed request after a completed order, claimed once per order | Review volume is a ranking and conversion input, and nobody asks manually — ✅ 2026-09-28 — a row sweep source with a durable per-order claim | S | sweep source | — |
| B-06 | Price-drop and back-in-stock alerts: watch subscriptions, two scan jobs, two triggers, guest notifier | Recovers demand that already declared itself; the highest intent signal a shop gets — ✅ 2026-09-29 **for price drops**; back-in-stock is BLOCKED and the block is real: the platform has no availability contract (`.ai/specs/2026-08-14-availability-contract.md` is unimplemented), stock lives in the optional `wms` module's inventory balances, and reading its tables from here is exactly the cross-module coupling this codebase forbids. The watch table, the scan pass, the trigger and the screens are in place, so the second scan is a few dozen lines once `availabilityService` exists. A guest notifier is also deferred — it needs an identity for somebody who has no customer record | M | trigger catalog + new table | catalogue price/stock reads |
| B-07 | NPS survey: 0–10 prompt step, `nps_score_at_least` predicate, public answer endpoint | Closes the loop from sending to satisfaction, and feeds segmentation — ✅ 2026-09-28 — the step renders the scale itself; the score is signed, not a parameter | M | step registry + public route | — |
| B-08 | Product recommendations: co-purchase affinity with best-seller padding, injected into a message | Raises revenue per send without the author writing anything — ✅ 2026-09-29 — `{{recommendations}}` in a body, ranked by distinct co-purchasing customers and padded with best sellers, shown on the customer profile with the signal that chose it; links go through a per-tenant product URL template, so recommendation clicks are tracked and attributed like any other | M | step registry + interpolation context | order history reads |
| B-09 | Referral programme: codes, redemption on first order, `referral_converted` trigger targeting the REFERRER | Acquisition at near-zero cost; the trigger's subject flip is the whole trick — ✅ 2026-09-29 — Crockford base32 codes (one live code per customer, forever), a two-stage claim→convert model so a reward is only ever paid for a real purchase, and an event whose SUBJECT is the referrer while the buyer travels as trigger context. The claim endpoint is authenticated on purpose: a public one would let anybody attach any customer to any code | M | trigger catalog + new tables | — |
| B-10 | Multi-touch revenue attribution: linear split across every click-through inside a window | Answers "what did marketing earn", which is the question that renews the budget — ✅ 2026-09-28 — linear, computed from recorded clicks; a campaign filter applies after the split | M | tracking events + order reads | 3.1, 3.2 |
| B-11 | Segment overlap, audience-size history, queued bulk actions over members, import/export | Makes segments operable rather than merely definable — ✅ 2026-09-29 (export; import deferred) — overlap resolves both sets at ONE instant and reports whether the answer is exact or sampled; sizes are snapshotted once a day by the sweep, made idempotent by a unique index on the day rather than by a flag; bulk actions are real `ProgressJob`s over a queue, resolving membership when they RUN so they act on who is in the segment then. **Import is deferred on purpose:** importing a member list means a segment that is a stored list rather than a rule, which is a different entity with a different membership model — recorded as a follow-up rather than bolted onto the rule-based one | M | segments + progress module | 5.1 |
| B-12 | Reorder-cycle engine: per-customer/SKU interval detection, drift-based at-risk tagging, build-a-cart, admin grid | Consumables businesses live on this; it is the one feature with no substitute | L | sweep source + new tables + cart | 7.4, cart surface |
| B-13 | Audience predicates: `purchased_sku`, `purchased_category` with a window, `event_occurred` (cart add, wishlist add) | Product-level targeting is the difference between a newsletter and a campaign — ✅ 2026-09-28 (SKU) — read from the order line catalogue snapshot, pushed down; category and behaviour predicates still open | S | subject document | order/behaviour reads |
| B-14 | Two-way messaging inbox: inbound replies stored and readable, STOP-keyword opt-out feeding consent | A reply nobody reads is a customer you lost; STOP handling is also a legal duty | L | webhooks module + new table | 6.x channel |
| B-15 | GDPR export and erasure across every table, plus an append-only consent audit log | Legally required once you store engagement data, and a deal-blocker in enterprise procurement — consent model and one-click unsubscribe ✅ 2026-09-28; export and erasure ✅ 2026-09-28 — erasure unlinks rather than deletes, and keeps the unsubscribe on purpose | M | commands + admin screen | 6.1 |
| B-16 | Per-provider outbound rate limiting (pacing, distinct from retry) | One burst can get a sending domain throttled or blocked for everyone | M | queue + new table | 6.x |
| B-17 | Content blocks: snippet, RSS with a fetch cache, product feed, recommendations | Lets marketing change message content without touching campaigns — ✅ 2026-09-29 (snippet) — reusable HTML referenced as `{{block:key}}`, edited on its own screen and offered by the palette; RSS, product feed and recommendation blocks stay open and belong with B-08 | M | step params + new table | B-08 |
| B-18 | Inbound webhook as a trigger, signed | Makes the module reactable-to by anything outside the platform — ✅ 2026-09-29 — a signed, revocable URL per hook; the endpoint emits the platform event so audiences, re-entry and duplicate guards apply unchanged. **Deliberately not the `webhooks` module:** its inbound machinery verifies a THIRD PARTY's signing scheme through a provider adapter, whereas here we issue the URL ourselves; going through it would also mean an operator had to create an endpoint there and pick our adapter before any campaign could fire | S | trigger catalog + webhooks module | — |
| B-19 | Real test send per channel, and a per-node "send test" on the canvas | Authors do not trust a campaign they could not try once — ✅ 2026-09-28 — email only, and only ever to the caller own address | S | canvas + step registry | 2.4 |
| B-20 | Anonymous visitors: visitor tags as a first-class primitive, `visitor_tag_added`, identity stitching on login | Most of a shop's traffic is not logged in; without this they are invisible to marketing | L | trigger catalog + new tables | storefront tracking |
| B-21 | Free gift offers: cascading subtotal tiers with a gift pool | Raises average order value; arguably promotions rather than automation | L | cart/pricing surfaces | cart |
| B-22 | Ad audience sync: hashed segment members to Google Ads and Meta | Extends a segment beyond email at no extra content cost | L | new provider package | 5.1 |
| B-23 | Product/shopping feeds: Google Merchant and Meta catalogue, cached per store | Table stakes for paid acquisition | L | new provider package | catalogue |
| B-24 | AI content generation step: LLM writes subject and body into the run context | Removes the blank-page problem that stops campaigns being written at all — ✅ 2026-09-29, **as an authoring-time draft rather than a step**: a Draft button in the message inspector returns a subject and body for the author to edit, grounded in the campaign, its triggers, the tenant brand voice and the placeholders and blocks that actually exist. Per-recipient generation was rejected — copy nobody read would reach customers (the module's rule is AI authors, humans publish), cost would scale with the audience, and a slow model at send time would block or skip messages. Personalisation per customer is already interpolation's and the recommendation block's job | M | step registry + ai-assistant | — |
| B-25 | Operational observability: job-run log, admin audit trail of campaign changes, email template versioning with restore | What you need the morning after a campaign went wrong — ✅ 2026-09-29 — one revisions table serves BOTH the audit trail and the restorable versions (they are the same data); a restore replays the ordinary save command, so it is validated, version-checked and becomes a new version rather than rewriting history. The job log records the start before the work, so a job killed mid-flight is visible as `running` rather than as nothing | M | workers + admin screens | — |
| B-26 | Lead routing: round-robin assignment to sales reps, weekly rep digest | B2B: a lead with no owner is a lead nobody calls — ✅ 2026-09-29 — **least-loaded wins, not round robin**: a stored cursor needs a table, has to be reset when the pool changes, and keeps feeding a rep who has been away. Counting current work is stateless, self-correcting and answers the question an operator actually has. The digest is an IN-APP notification rather than email, because emailing a rep means reading the auth module's users or copying their address into marketing config, while the notifications module delivers to a user id and respects their own channel preferences. **No new table:** the owner is the customers module's field, written through `customers.people.update` | M | new tables + admin CRUD | B-01 |
| B-27 | Setup wizard: guided first run | The difference between an installed module and a used one | S | onboarding module | — |
| B-28 | Push subscription management: admin grid, register/unregister endpoints, service worker | Operability for the push channel | M | public routes + new table | 6.2 |

### Beyond parity — what Open Mercato makes cheap that the source module never had

These are NOT in the source. They are listed because the platform already carries the hard part, so
each is unusually cheap here, and because a port that only reproduces the original has not used its
new home.

| ID | Capability | Why it belongs here | Size | Platform surface it reuses |
|---|---|---|---|---|
| X-01 | Geographic targeting: country, region, city, postcode, and radius predicates | The most-asked targeting dimension in the original's own feature requests, and absent from it — ✅ 2026-09-28 — per-customer only: addresses are encrypted at rest, so this can never be narrowed in SQL | M | customer addresses + audience fields |
| X-02 | Birthday and anniversary campaigns | One date field and a sweep source; the highest open-rate message a shop sends. **Checked 2026-09-28: the platform stores no birth date** — not on `customer_entities`, not on the person profile — so this needs a custom field defined per installation and a sweep source that reads it through the query engine's `cf:` filters. Still S–M, but it depends on a field the merchant must define, which is worth saying out loud rather than discovering mid-demo | M | sweep source + custom fields |
| X-03 | Per-campaign store, channel and language targeting | The original cannot do it at all; multi-channel is native here | M | channel/organization scoping |
| X-04 | Campaign authoring by an AI agent: describe a campaign in chat, get a draft graph to review | The platform ships an agent runtime with mutation approval; a campaign is a JSON definition, which is exactly what an agent can safely propose | M | `ai-assistant`, `prepareMutation`, agent tools |
| X-05 | MCP tools for campaigns: list, inspect, estimate audience, enable, from any MCP client | Makes the module scriptable by external assistants with no new API design — ✅ 2026-09-28 — six tools; none can enable a campaign, asserted by a test | S | `registerMcpTool` |
| X-06 | Charts on the campaign dashboard: sends, opens, clicks, revenue over time | The original has tiles and tables only; the platform ships a chart family — ✅ 2026-09-28 — daily series generated in SQL so empty days are zeroes, not gaps | S | `ui` chart components |
| X-07 | In-app notifications and progress for long operations (bulk enrolment, segment actions) | Operators can watch work finish instead of guessing | S | `core:progress`, notifications, DOM event bridge |
| X-08 | Customer-portal preference centre: the recipient manages their own consent and frequency | Fewer unsubscribes, and consent that is provably first-party — ✅ 2026-09-29 — the middle ground consent lacks: "at most N a week" and "pause for 30/90/180 days" beside unsubscribe. The engine honours both as a SECOND cap (its own weekly window, never merged with the campaign's) and a deferral — a pause is "not now", so it moves the message rather than dropping it, while a cap drops it like the campaign's own. The subject always comes from the portal session and never from the request, or the page would let anybody unsubscribe anybody |
| X-09 | Segment membership in the search index, so campaigns can target fulltext and vector queries | Semantic audiences ("customers who bought something like X") are impossible in the original | L | `search` module |
| X-10 | Workflow bridge: let a campaign step start a platform workflow, and a workflow start a campaign | Marketing and operations stop being two disconnected automations | M | `workflows` module |
| X-11 | Optimal send-time per recipient learned from their own open history | The original has a send-time gate but no learning; tracking data now makes it possible — ✅ 2026-09-28 — per-customer, minimum five opens, always subordinate to quiet hours | M | 3.1 tracking events |
| X-12 | A/B winner auto-selection on click-through once a minimum sample is reached | Completes the split feature already shipped — ✅ 2026-09-28 — as a SUGGESTION plus an author action, not an automatic rewrite; auto-apply on a schedule is a follow-up | S | 2.1 split + 3.1 tracking |
| X-13 | Deliverability guardrails: bounce-rate and complaint-rate circuit breaker that pauses a campaign | Protects the sending domain, which no amount of content quality can undo | M | 3.1 events + campaign state |
| X-14 | Dry-run preview of a whole journey for one named customer: every step, every gate, every timestamp | The fastest way for an author to trust a campaign, and a superb demo — ✅ 2026-09-28 — drives the real executor with recording effects, so it cannot drift from the engine | M | executor + audience narrowing |

### What is actually blocked, and what is only work

The distinction that matters for planning. Nothing below is blocked on difficulty — the engine's
extension points make most items a step type, a predicate or a sweep source. These are blocked on
something that is not ours to write:

| Blocked item | What it waits for |
|---|---|
| B-12 reorder engine (build-a-cart half), B-21 free gifts | A cart entity. The platform has orders and quotes; `SPEC-029` (storefront) owns the cart |
| B-14 two-way inbox, B-16 provider pacing | A live SMS or WhatsApp channel provider — an account with a verified sender, not code |
| B-20 anonymous visitors | Storefront behaviour tracking, which is a storefront concern |
| B-22 ad audiences, B-23 product feeds | Google Ads / Meta credentials and an approved app |
| B-28 push management | Push rails plus a public origin for the service worker |
| X-09 semantic segments | A decision about indexing customers, which touches the `search` module's own scope |
| X-10 workflow bridge | A contract decision in `workflows`, whose activity enum is a frozen surface |

**Everything else on both tables is plain work**, and most of it is S: one step type or one predicate
plus its tests, five locale files and a migration when it needs a table — the same shape as the A/B
split, which took one sitting end to end. The per-feature cost that is easy to underestimate is not
the logic, it is the tests, the five locales, the DS lint and the migration review that make it
survivable in review. That is the rate limiter, and it is the reason each item is sized in this table
rather than waved at.

### The customer profile is built early and extended, not built last

`B-03` ships before most of the capabilities it will eventually display, deliberately. Every later
feature adds one card or one section to it, which costs minutes, whereas leaving the screen until the
end means every intermediate feature is invisible while it is being built — and a feature nobody can
see is a feature nobody notices is WRITE-ONLY. That defect already happened once in this module:
delivery tracking recorded opens and clicks that nothing read, until a counts endpoint was added in
the same phase. "What does this add to the customer profile?" is the question that catches it, so from
here on every backlog item answers it.

### Suggested shipping order

Value per unit of effort, given what already exists:

1. **B-01, B-02, B-03** — scoring, tiers, Customer 360. They compound, and they end in a screen.
2. **B-04, B-05, X-02** — win-back, review requests, birthdays. Three merchant-recognisable campaigns, each one sweep source.
3. **X-12, B-10, X-11** — A/B winners, attribution, send-time learning. All unlocked by Phase 3 and all invisible without it.
4. **X-14, B-19** — journey preview and real test send. Author confidence, and the two best things to show on a demo.
5. **B-13, X-01** — product-level and geographic targeting. The two dimensions authors reach for next.
6. **X-04, X-05, X-06** — agent authoring, MCP tools, charts. Each one is small here and each one is impossible in the original.
7. **B-27, X-03** — setup wizard and per-channel targeting. Both unblocked, both additive.
   (X-08 the portal preference centre landed 2026-09-29.) (B-06 price drops and B-26 lead routing landed 2026-09-29; B-06's
   back-in-stock half is blocked on the availability contract.) (X-07 progress arrived with B-11: bulk segment actions are
   `ProgressJob`s on the shared top bar.)
   (B-07 NPS, B-15 GDPR, B-17 content blocks, B-08 recommendations, B-18 inbound hooks, B-24 AI copy
   drafting, B-25 observability and B-09 referrals landed on 2026-09-28/29.)
8. The blocked table above, each item the moment its dependency lands.

Target for the current push: every unblocked item. The blocked ones are documented so nobody mistakes
a missing dependency for a missing plan.

## Phase 2 — structural decisions and shared foundations

Everything later rests on these, and each gets more expensive the more steps exist.

**2.1 Branching model — nested variants.** ✅ Implemented 2026-09-28. Landed as described, with
the lane choice derived from `hash(step id, subject id)` rather than stored, so a resume cannot land
a subject in the other lane. `flattenSteps` runs before `planSteps`, so the planner and the executor
stayed index-based and no column was added. Editor-side tree edits live in `lib/canvas/step-tree.ts`.
The top level stays a spine, so the canvas keeps its honesty (no user-drawn edges) and gains a split
node with N lanes that fan out and rejoin.
*We did not inherit the original's limitation that variant steps cannot carry their own delay —
steps live in jsonb with stable ids, so a lane can contain a wait. A lane that ENDS on a wait is
refused, for the same reason a trailing wait at the top level is: it parks its subjects forever.*

**2.2 Set-level audience evaluation.** ✅ Implemented 2026-09-28 as a NARROWING rather than a second
evaluation path. A set walk that returned "the matching subjects" would need a second, independent
definition of matching, and the two would drift — so the planner returns a superset of candidates and
`matchesAudience` stays the only authority on membership. Aggregates go through the same shared SQL
filter as `subject-document.ts` rather than `queryEngine`, which has no aggregate surface; tag and
order predicates are pushed down, negations and per-event leaves are not. The sweep now enrols from
candidates, and `POST /campaigns/:id/audience-estimate` exposes the count with an honest qualifier.
This is the foundation segments need (Phase 5). Files: `lib/engine/narrowing.ts`,
`lib/audience/set-resolver.ts`.

**2.3 Event idempotency.** ✅ Implemented 2026-09-28. The deterministic queue job id is not available
— `EnqueueOptions` carries only `delayMs`, and adding a job id would change a contract surface in
`packages/queue` that every strategy would have to honour — so the guarantee lives where it belongs
anyway: a partial unique index on `(tenant, org, campaign, occurrence_key)` over the run table, with
the key derived from the delivered payload. Released after six hours, because two separate
occurrences with identical payloads hash the same and permanent uniqueness would turn every
`unlimited` re-entry policy into `once`. Provider webhooks duplicate routinely, so this was needed
before any webhook-driven channel.

**2.4 Dry-run and test dispatch.** A CLI command and an API endpoint that answer "who would
receive this, and what would they get" without sending. The `marketing_automation.test_dispatch`
feature already exists with no implementation behind it. Cheap, and it is the safe way to
demonstrate a campaign.

**2.5 Runs UI.** `marketing_campaign_runs` and its `step_log` exist with no page. An operator
cannot currently see who is mid-journey, what each step did, or why a run died.

## Phase 3 — delivery tracking (prerequisite for three later features) — ✅ Implemented 2026-09-28

**3.1** `marketing_message_send_events` — delivered / opened / clicked / bounced, keyed to
`marketing_message_sends`.
**3.2** Tracking endpoints: a signed open pixel and a signed click redirect. No PII in the URL;
the token identifies the send, not the person.
**3.3** `send_email` rewrites links and embeds the pixel.

Unlocks 4.1, 4.2 and 4.3 — all three read from here, which is why tracking comes before them
rather than alongside. Verified without a public URL exactly as planned: the integration tests mint
tokens with the server's own secret, call the endpoints and assert the recorded counts, including
every refusal (tampered token, wrong purpose, non-http destination).

Landed with two decisions worth carrying forward: the event table stores no IP and no user agent, and
the signing secret falls back to the platform's data-encryption key material so tracking works without
new configuration — never to a session or JWT secret, because the token lives in mail archives forever.

## Phase 4 — what tracking unlocks

**4.1** Per-campaign funnel (sent → delivered → opened → clicked → converted) plus a dashboard
widget via `widgets/dashboard/` and `analytics.ts`.
**4.2** A/B winner selection on click-through once each lane has enough sends. Needs 2.1 + 3.
**4.3** Send-time optimization: defer a send to each customer's historically best hour.
Email-only, because it is the only channel with open/click data. Needs 3.

## Phase 5 — segments and richer targeting

**5.1** ✅ 2026-09-29 — `MarketingSegment` holds the same condition expression a campaign audience does;
membership is `matchesAudience` over the subject document, narrowed through 2.2 where the expression allows.
The slug is derived from the name once and then immutable, because saved audiences reference it.
**5.2** ✅ 2026-09-29 — no new operator was needed: membership is published as a `segments` array on the
subject document, so `segments CONTAINS 'slug'` and `NOT CONTAINS` come free from the existing evaluator. A
segment may not be defined in terms of segments — nesting invites a cycle, and a cycle in per-customer
evaluation is a stack overflow inside a dispatch.
**5.3** RFM and CLV projections on the subject document, plus percentile comparisons.

## Phase 6 — channels

**6.1 Consent model — do this before any new channel.** The platform has none, so Phase 1 does
not gate sends on a marketing opt-in. **Compliance-blocking for production use.** Nearest prior
art: `consent_flag` in `SPEC-055` and the tenant legal-documents/consent-versioning spec.
**6.2 Push** — a `push` step over the existing `push_notifications` rails. Cheapest.
**6.3 SMS** — a new `packages/channel-<provider>` implementing `ChannelAdapter` with
`channelType: 'sms'`, a `sms` notification delivery strategy for per-user opt-out, a delivery
status webhook, and an opt-out table. Blocked on the account (see Start now).
**6.4 WhatsApp** — provider package, admin-managed template approval lifecycle, status webhook.
Blocked on Meta verification (see Start now).

Every channel step routes through the `communication_channels` outbound queue so retries,
dead-lettering and per-tenant credentials apply, rather than calling a provider directly.

## Phase 7 — B2B

**7.1 Verify first.** `sales.orders.approve` already exists as an ACL feature. Establish what
`sales` already does for approvals before building a parallel flow.
**7.2** Credit limit: entity per company, an endpoint for "my limit", threshold alerts, and an
optional hard checkout block at full utilization.
**7.3** Order approval: token-based approve/reject from an email without logging in, plus
escalation when an approval goes unanswered.
**7.4** Reorder reminders from each customer's own purchase interval — cheap, reuses the subject
document and the existing sweep.

## Phase 8 — breadth and authoring comfort

Remaining triggers already stubbed in the catalog (quote, invoice, payment, deal won/lost, tag
removed) — mostly copy-paste subscribers. Steps: `notify`, `send_webhook` (over
`@open-mercato/webhooks`), dynamic content, coupon generation (**verify a coupon primitive
exists before promising it**). Campaign calendar, template library, import/export (nearly free —
the graph already *is* the contract), and a form-based authoring fallback beside the canvas.

## Blocked on other work

Abandoned cart, browse abandonment and on-site behaviour tracking all need cart sessions and a
storefront: `SPEC-029`. The trigger is listed in the catalog as unavailable with a reason so the
palette explains itself, and its context contract is written down.

## Definition of done, per phase

Each phase ships: its own spec, integration tests for every affected API path and key UI path,
i18n in all five locales, and a green run of the ordered `validation.commands` gate from
`.ai/agentic.config.json`. A phase that sends messages also ships a dry-run path before it
ships the send.
