# Marketing Automation Module — Agent Guidelines

A campaign is: a **trigger** (a platform event id, or a periodic sweep) → an **audience**
expression → an ordered list of **steps**, one of which may be an A/B **split** carrying lanes of
its own. Spec:
[`.ai/specs/2026-09-28-marketing-automation-module.md`](../../../../../.ai/specs/2026-09-28-marketing-automation-module.md).

## Always

- Keep `lib/engine/` pure — no React, no ORM, no container, no `reportError`. It is the only
  reason the sequencing rules are testable, and they are the part most worth testing.
- Express audience conditions as `business_rules` `ConditionExpression` trees. Never add a second
  condition language; `matchesAudience` is the only entry point.
- Evaluate an audience through `matchesAudience`, never `evaluateExpression` directly — the veto
  it adds is load-bearing (see Never).
- Keep every narrowing a SUPERSET of the audience (`lib/engine/narrowing.ts`). Resolve any ambiguity
  by widening, and push nothing down that you cannot prove. `matchesAudience` decides membership;
  the narrowing only decides who is worth projecting.
- Send through `sendEmail` from `@open-mercato/shared/lib/email/send`, and tag through the
  `customers.tags.assign` command. No direct provider calls, no new tag storage.
- Scope every query by BOTH `tenantId` and `organizationId`.
- Read `primary_email`, `display_name` and `customer_people.timezone` through
  `findOneWithDecryption`/`findWithDecryption` with the scope — they are encrypted at rest, and a
  plain `em.findOne` returns ciphertext that then compares against plaintext and silently fails.
- Repeat a worker's queue name as a string LITERAL in `metadata`. The generator extracts it from
  the AST and cannot resolve an import; the worker silently disappears from the registry.
  `workers/__tests__/queue-name-literals.test.ts` guards this.
- Report an error you catch with `reportError` in addition to logging it — at the I/O edges
  (`lib/dispatcher.ts`, `subscribers/`, `workers/`), never inside `lib/engine/`.
- Answer "what does this add to the customer profile?" for every new capability. A feature nothing
  reads is write-only, and this module has already shipped that defect once.
- Add a new step type through `registerMarketingSteps` with `labelKey`, `paramsSchema` and
  `uiFields` populated. Those three are what make it appear in the palette with a working
  inspector form and server-side validation.
- Edit the authored steps through `lib/canvas/step-tree.ts`, never by indexing into
  `definition.steps`. With splits a campaign is a tree, and an edit that assumes a flat array
  silently ignores everything authored inside a lane.
- Add a periodic candidate source through `ROW_SWEEP_SOURCES` in `lib/sweep-sources.ts`. The worker,
  the validator's accepted ids, the palette and the audience builder's offered paths all derive from
  that registry; a source added anywhere else is invisible to at least one of them.
- Give a row source a `claimKey` when it must act on a thing exactly once ever, and leave it off when
  repeats are legitimate. A review request must never be sent twice; a quote-expiry reminder is
  supposed to be repeatable, and the campaign's re-entry policy is what governs it.
- Recurse into `readVariants(step).steps` in anything that walks a definition — save validation,
  position pruning, analytics. Forgetting to is how a lane ends up exempt from a rule the trunk
  obeys.

## Ask First

- Before changing what an ABSENT consent record means. It currently permits sending
  (`UNRECORDED_CONSENT_ALLOWS_SENDING`), because refusing would disable every campaign on every existing
  installation the moment it shipped. Flipping it is a product decision, not a fix.
- Before making any step type send on a new channel (SMS, WhatsApp, push) — a provider belongs in
  its own `packages/channel-*`, not here.
- Before adding a table. The authored graph lives in `campaigns.definition` jsonb on purpose;
  triggers are a table only because their lookup runs on every platform event.
- Before changing a key of the subject document. Field paths are what saved audiences reference,
  so a rename silently breaks every campaign that used it.

## Never

- Never let a numeric aggregate be `null` in the subject document. `compare()` in
  `business_rules` returns `-1` for a null left operand, so `orders.daysSinceLast <= 30` becomes
  TRUE for a customer who has never ordered and a win-back campaign mails every never-buyer.
  Omit the key instead; `matchesAudience` also vetoes magnitude comparisons on absent operands.
- Never push an order-aggregate comparison down when a customer with no orders satisfies it
  (`orders.count <= 5`, `= 0`, `totalGross >= 0`). The aggregate query can only return customers who
  have orders, so pushing it would drop every never-buyer from a campaign that includes them.
- Never conflate the two kinds of stop. A `wait` has done its job, so the run resumes AFTER it;
  quiet hours have not let the message out, so it resumes AT the same step. Swapping them either
  drops a send or sends twice.
- Never make the frequency cap per-campaign. Five campaigns each politely sending one message
  still buries the customer, which is why `marketing_message_sends` is counted across all of them.
- Never add a validation rule that walks `definition.steps` without descending into `readVariants`. Two
  of the three save-time assertions did; the third did not, and a campaign hid a self-driving cycle in a
  split lane. `assertNoLoopRisk` is the shared one — call it, do not re-implement it.
- Never default an expected-version token to `''`. The platform lock falls back to the extension header
  only when the value is ABSENT, so a default silently switches the lock off. Pass `undefined`.
- Never persist or return third-party error text from a step that handles an address. Redact it at the
  step (`lib/redact.ts`), log the original, and re-throw the redacted form.
- Never let send-time optimisation override quiet hours. The optimisation proposes, quiet hours dispose;
  the other order lands an "optimised" send at 3am.
- Never learn a send hour from fewer than `MINIMUM_OPENS_FOR_PATTERN` opens, and never group open hours
  in server time — both produce a confident answer about the wrong customer.
- Never accept a survey score that came from `Number(value)` alone. `Number(null)`, `Number('')` and
  `Number(false)` are all 0 — a valid NPS score, and the worst one, so a missing answer would be stored as
  the strongest possible complaint.
- Never make erasure delete rows. It nulls the subject link — including inside the run context's jsonb —
  so the person is unidentifiable while last quarter's reported totals stay true. And never erase a consent
  record: forgetting an unsubscribe is how somebody gets mailed again.
- Never check consent after a timing gate. Consent is permission and the others are scheduling, so a
  refused message is DROPPED, never deferred — deferring it only sends it later.
- Never score RFM against fixed day counts. The digits are quintiles over the tenant's OWN buyers, computed once
  a day by the sweep and read as one row — "bought in the last 30 days" is excellent for a coffee subscription and
  meaningless for a mattress shop. Below `MINIMUM_BUYERS_FOR_RFM` nothing is scored, and a never-buyer scores
  nothing rather than 1-1-1, which would read as "our worst customer" and be swept into every win-back audience.
- Never project a customer's value from one order. One purchase is not a rate, and projecting from it ranks a
  one-off big spender above somebody who buys steadily every month. The cadence window is first order → NOW, never
  first → last, or two orders in one week followed by two years of silence reads as a hundred a year forever.
- Never measure a step inside a split lane against the trunk step before the split. Only a share of the people
  who reach a split enter each lane, so the comparison would report the split's own weights as a drop-off and
  make every A/B test read as a catastrophe on the screen meant to evaluate it. A lane step's predecessor is the
  SPLIT — and so is the predecessor of the first step after one, because which lane somebody walked is
  path-dependent and the split is the last point all of them shared.
- Never sort the step funnel by volume. Its value is the AUTHORED order, which is the order the customer
  experiences; sorted by counts it stops being a funnel and becomes a list.
- Never count a funnel in messages. A journey with three emails would report three times the "sent" of a
  one-email journey and look like it reached three times as many people. And never add a `delivered` stage while
  the platform has no provider feedback: it could only be the sent count wearing a more confident name.
- Never read a purchased CATEGORY from the order snapshot. It is the one purchase fact read from the catalogue,
  because a category is a current classification while a sku is a historical fact — and reading both sides from the
  same live table is what lets the category narrowing claim to be exact rather than a superset.
- Never let a template ship a step whose PARAMS do not validate. Checking step types alone let two templates ship
  a `wait` measured in days when the step counts minutes; they imported and the save refused them.
- Never judge an A/B winner on revenue the lanes cannot be compared on. Different currency codes have no
  ordering, a mixed-currency lane cannot be summed, and a lane with nothing attributed yet is not evidence that
  nothing will be — `pickSplitWinner` withholds the verdict in all three cases instead of ranking numbers that do
  not mean what they say. And never measure the auto-promotion's margin on the click rates when revenue decided:
  a lane can earn twice as much per recipient on marginally fewer clicks.
- Never split the winner metric into two settings. One tenant setting governs the suggestion on the results
  screen AND the unattended promotion, because being shown a click winner while a revenue winner is applied for
  you is worse than either alone.
- Never promote an A/B winner automatically on the screen's own rule. Suggesting needs "not tied"; rewriting
  somebody's campaign unattended needs twice the sample and a relative margin, because 3.0% against 2.9% is a coin
  toss. It stays off until a tenant switches it on.
- Never put anything but a subscriber in `subscribers/`. The generator registers every file in that folder, so a
  helper living there becomes a subscriber for the empty-string event.
- Never make a reorder reminder once-ever or daily. The cycle NUMBER goes in the claim key: without it a durable
  claim reminds somebody about their coffee once in their life, and without a claim they are nagged every morning.
- Never let a link in an email change anything on GET. SafeLinks, antivirus gateways, proxies and chat
  unfurlers fetch every URL in a message, so a mutating GET lets them unsubscribe people and invent NPS
  scores indistinguishably from the recipient. GET asks, POST acts — and RFC 8058 one-click still POSTs, so
  the one-click promise is kept where it is actually made.
- Never decide whether the author placed the unsubscribe link AFTER tracking has been applied. The rewriter
  turns their link into a tracking URL, so the check finds nothing and appends a second way out. And never
  track the unsubscribe URL itself: an unsubscribe counted as a click inflates every rate and lets the
  variant that drove the most opt-outs win the A/B test.
- Never divide a per-run numerator by a per-message denominator. Opens and clicks are counted as unique runs,
  so the rates and the minimum-sample gate divide by people REACHED; per-message, a lane holding two emails
  has every rate halved and loses to a one-email lane whatever it says.
- Never let a truncation sentinel pass through a filter that removes rows. The membership resolver detects its
  ceiling by asking for one candidate more than it will examine; one deleted customer among them used to eat
  the sentinel, and five screens printed a truncated count as a total.
- Never let the unsubscribe endpoint confirm something it did not do. A person who believes they
  unsubscribed and did not is worse off than one who sees an error.
- Never put an identity in an unsubscribe link. It names the run; the endpoint resolves the customer.
- Never give an AI tool the power to enable a campaign. Publishing starts messaging real customers and is
  gated behind a human permission; `ai-tools/__tests__` refuses any tool whose name suggests it.
- Never push an ENCRYPTED field down to SQL. Customer addresses are encrypted at rest, so a country
  comparison in SQL matches nothing and says nothing — `narrowing.ts` refuses `address.*` on purpose and
  a test asserts each field.
- Never read a purchased product from the catalogue. Use the order line's `catalog_snapshot`: a renamed,
  re-skued or deleted product must still target the customers who bought it.
- Never let a test send take its recipient from the request. It comes from the session, or the endpoint
  is a spam relay with a campaign editor attached.
- Never explain the engine with a second implementation. The journey preview drives `executeRun` itself
  with recording effects (`lib/preview.ts`); anything that re-derives the sequencing will drift from it,
  and a preview is trusted precisely where nobody can check it.
- Never recompute which lane a run walked. It is recorded on the run; recomputing agrees until the
  author edits the split, and then every historical A/B result becomes fiction.
- Never normalise the link report's shares into a pie. Each share is of everyone who clicked ANYTHING, so they
  overlap and sum past one whenever somebody clicked two links — that is the honest answer. Normalising would
  silently switch the question to share of CLICKS, where one person clicking twice outranks two people clicking
  once.
- Never count raw opens or clicks in a comparison. Count unique runs, or the variant that reached the
  more aggressive inbox previewers wins.
- Never cache a lead score in a column, and never make a tier a stored field. The score is
  `sum(points)` over its ledger so a redelivered step cannot double-award, and the tier is derived from
  the score so it cannot be stale between recalculations.
- Never store an IP address or a user agent on a delivery event. The question the table answers does
  not need them, and a marketing module that builds a device-and-location log of every recipient is a
  liability nobody asked for.
- Never sign a tracking token with a session or JWT secret, and never put a destination in the URL
  instead of inside the signature — the first widens the blast radius of a token that lives in mail
  archives forever, the second is an open redirect wearing the shop's domain.
- Never make an occurrence key permanent, and never derive it from anything but the delivered
  payload. It is a duplicate guard for a window: kept forever it turns every `unlimited` re-entry
  policy into `once`, because two separate occurrences with identical payloads hash the same.
- Never proceed without the claim token returned by `claimRun`, and never write a run without
  re-asserting it — that is the entire concurrency story.
- Never let a per-subject failure abort a batch. A sweep and the due-run scan catch per row.
- Never relax save-time validation to match the dispatcher. Runtime skips an unknown step type so
  an installation change cannot strand a journey; the writer rejects it, because at author time it
  is always a mistake and a campaign that looks saved and does nothing is the worst failure mode
  this module has.
- Never key a schedule on its interval alone — in a node id, a duplicate check or anywhere else. The
  source is part of its identity, and treating the interval as the key made the save refuse a campaign
  the canvas had just allowed.
- Never let a malformed payload reach the route as a throw. Parse with `safeParse` and answer 400 with
  a `marketing_automation.validation.*` code; a 500 tells the author nothing they can act on.
- Never draw a user-editable edge on the canvas. The only branch the engine has is a split, and
  which lane a subject takes is decided by the engine, not by an edge somebody drew — an author who
  can draw an edge has been promised a topology it cannot run. Edges are derived; order lives in the
  definition arrays.
- Never match a birthday on the year. A stored year may be a guess, a placeholder or absent, so the sweep matches
  month and day and puts the YEAR in the claim key — that is what makes the campaign annual rather than once ever.
- Never read a custom field by the customer id. It is stored against the person PROFILE id, so the birthday
  source joins `customer_people` to `customer_entities`; the run is about the customer.
- Never derive the agent's tool list from the pack. It is written out by hand so a tool added to the module does
  not arrive in the agent's hands for free — an enable tool would otherwise hand it the power to publish, which
  is the one thing this module reserves for a person.
- Never let the deliverability breaker trip on a small sample. A guardrail that pauses working campaigns gets
  switched off, and then it is not a guardrail.
- Never claim the breaker measures bounces or complaints. Those need provider feedback the platform has no
  contract for; it watches the failure rate of attempted sends, which is the signal this module owns.
- Never invent a customer field the platform does not have. Channel targeting is "has bought in this channel"
  (`orders.channels`, derived from orders) and language is the customer's OWN choice in the preference centre —
  a "belongs to this store" column or a language guessed from an address would each be a second source of truth
  for something that already has one, or none.
- Never answer a readiness check from a "setup completed" flag. A flag says what somebody clicked; the question
  is what is true now, and an installation whose email channel was deleted last week is not set up.
- Never take the subject of a portal route from the request. It comes from the portal session, or the preference
  centre lets anybody unsubscribe anybody.
- Never merge the recipient's own frequency preference into the campaign's cap. Each is evaluated in its own
  window — "three a week" and "two a day" have exact answers only as written — and the customer's can only ever
  make things quieter, never louder.
- Never treat a customer pause as an unsubscribe. A pause is "not now", so it DEFERS at the same step; an
  unsubscribe is "no", so it drops. And when a pause ends inside quiet hours, take the later instant: both are
  promises.
- Never reassign a lead that already has an owner unless explicitly asked. Taking a customer away from the rep
  who has been talking to them is the most damaging thing routing can do, and a re-entry would do it on every
  pass if the default were the other way.
- Never route with a stored round-robin cursor. Least-loaded-wins is stateless, self-correcting when the pool
  changes, and deterministic on ties — a cursor needs resetting and keeps feeding a rep who has been away.
- Never store a colleague's name or email in module config. Keep the user id and let the staff directory answer
  both; a copy goes stale the day they change either.
- Never send a digest that says nothing happened. It is the notification that teaches people to ignore
  notifications.
- Never read a shopper's price from a targeted price row. A watch compares the UNTARGETED list price — regular
  kind, quantity one, no channel, user, group or customer dimension, inside its window — because a contract
  price for a different buyer is not this customer's price.
- Never treat a missing current price as a price drop. A product that was unpublished has not become cheaper,
  and "it is gone" is not the message the customer asked for.
- Never keep a watch's reference price when the product got DEARER. The reference follows the price upwards so
  a recovery to where the customer started is announced, and a partial recovery is not.
- Never emit a price-drop event before the watch bookkeeping is committed. The reference price and the notified
  timestamp are the only things stopping a redelivered scan from telling the same person twice.
- Never add a back-in-stock scan by reading `wms` tables. Stock belongs behind the availability contract that
  does not exist yet; the module says so in the roadmap rather than reaching across a module boundary.
- Never resolve segment membership anywhere but `resolveSegmentMembers`. Five callers need that answer — the
  members screen, overlap, size snapshots, bulk actions and the CSV export — and the moment two of them
  compute it differently one of the screens starts disagreeing with what actually sends.
- Never treat a narrowed candidate set as people. A tag, an order or a score entry can point at a deleted
  customer or at a COMPANY, so candidates are filtered to live persons in BOTH paths. Skipping it made
  comparing two segments report an empty overlap where one side plainly contained the other.
- Never queue a bulk action with a member LIST. Carry the segment and resolve when the job runs, or the action
  applies to who was in the segment when somebody pressed a button — including the people who have left it.
- Never report a truncated count without saying so. Every membership answer carries a qualifier, and an
  overlap of two samples is a sample.
- Never define a segment in terms of segments. Membership is computed FROM the subject document, so a nested
  segment would evaluate against a key still being built; the writer refuses it and `computeSegmentSlugs`
  empties the key before evaluating, so an older row cannot reintroduce the cycle.
- Never resolve segment membership with a second implementation. It is `matchesAudience` over a subject
  document — the same call the dispatcher makes — because a members screen that disagrees with what actually
  sends is the screen people trust.
- Never let `buildSubjectDocument` default segment definitions to none. An empty list makes every
  `segments CONTAINS …` audience quietly false; when they are not passed, they are loaded.
- Never rename a segment's slug. Saved audiences reference it, and a rename empties every campaign that
  targeted the segment without reporting anything.
- Never invent a code alphabet. `lib/engine/referral-code.ts` uses Crockford base32 with its documented fold;
  the first hand-rolled attempt folded a character onto one that was itself in the alphabet, so a legitimate
  code stopped resolving. A test asserts no valid character is ever rewritten.
- Never reissue a customer's referral code. It is already printed in every message that mentioned it, so
  `ensureReferralCode` is idempotent and one live code per customer is enforced by a partial unique index.
- Never fire a referral reward on the claim. A claim is somebody typing a code; the conversion is their first
  order, and only the second is worth paying for. The conversion is a conditional UPDATE so two orders
  arriving together cannot both emit it.
- Never make the referral claim endpoint public. It attaches a customer to a code, so an unauthenticated
  version is a reward-fraud machine; a storefront claims through its own backend, which holds a credential.
- Never return the referrer from a claim. The caller does not need it, and answering turns a shared code into
  a way to look up who shared it.
- Never let history bookkeeping fail a save. `recordRevision` swallows its own errors and logs them: the
  cost of a lost revision is a gap in a list, the cost of a rolled-back save is an author's work.
- Never restore a version by writing to the campaign directly. Replay it through
  `marketing_automation.campaigns.save_graph` with the CURRENT `updatedAt`, so a restore is validated,
  collides with a concurrent edit and becomes a new version instead of rewriting the old one.
- Never write a job-log row only on success. The row is created before the work, so a job killed mid-flight
  stays visible as `running` — the one state a success-only log can never show.
- Never generate copy per recipient at send time. A draft is authored once, reviewed by a human and saved to
  the campaign; generating per customer would mail text nobody read, scale cost with the audience, and make a
  slow provider a delivery failure. Personalisation is interpolation's job and the recommendation block's.
- Never render a model's HTML in the admin UI, and never save it without passing it through
  `parseDraftedCopy`. It is untrusted markup until a person has read it — the parser sanitises, the editor
  shows it as text, and the author applies it deliberately.
- Never put a tenant-supplied string in the system half of a prompt. Brand voice, campaign names and briefs
  go inside the `<briefing>` fence in the user message, labelled as data, so an injection attempt is content
  rather than instruction.
- Never sign an inbound hook token with the tracking claim shape. A run-shaped claim set with a hook id in
  the run slot verifies perfectly and means nothing; `lib/inbound.ts` has its own key label so a click URL
  from an email cannot be replayed as a hook post, and a test asserts exactly that.
- Never let the inbound endpoint report whether an address matched a customer. A leaked hook URL would then
  be an address-existence oracle over the whole customer list; the outcome goes on the hook row, where the
  admin screen shows it to somebody who is logged in.
- Never print a price from an order line's catalogue snapshot. It records what somebody else paid when they
  paid it; offering it back is a price the shop may no longer honour.
- Never recommend a product the customer already owns from the generic ranker. Repeat purchases are the
  reorder engine's job, which knows a product's interval — guessing here offers a fridge to somebody who
  just bought a fridge.
- Never make a content block's key editable, and never render a missing block as its own reference. Messages
  point at a block by key, so a rename empties it out of every campaign that used it, and printing
  `{{block:footer}}` into an email is worse than printing nothing.
- Never store a subject's variant choice, and never derive it from anything but the step id and the
  subject id. Stability across a resume is the whole point: a run that pauses on a wait inside a lane
  and comes back into the other lane delivers a mixture of both variants, and the test measures
  nothing.

## Validation Commands

```bash
yarn workspace @open-mercato/marketing-automation test
yarn workspace @open-mercato/marketing-automation typecheck
yarn i18n:check-sync && yarn i18n:check-usage
node --require ./scripts/typescript-js-require-hook.cjs node_modules/eslint/bin/eslint.js \
  --config eslint.ds.config.mjs packages/marketing-automation
```

Integration tests need a running app plus workers:
`yarn dev` and `yarn mercato queue worker --all --with-scheduler`.

```bash
OM_INTEGRATION_MODULES=marketing_automation yarn test:integration
```

Always with that filter. A bare `yarn test:integration` takes ~2.6 minutes for this module's specs
because `--grep` and the module filter are applied AFTER Playwright has compiled all ~1270 discovered
spec files in the monorepo; narrowing `testMatch` up front runs the same specs in ~6 seconds.

The dev server resolves this package through `node_modules`, which Next does not watch, so a rebuilt
`dist` does NOT reach a running server: rebuild, then restart the dev runtime, before trusting a red
integration result. A stale server is why a save-validation change once appeared not to work. Keep
`yarn dev` in a terminal of its own — touching `apps/mercato/.env` restarts only the app runtime
there, whereas a detached `yarn dev` exits instead of restarting.

## Key Reference Files — Copy From Here

| Concern | File |
|---|---|
| step sequencing, the two stops | `lib/engine/executor.ts`, `lib/engine/chain-planner.ts` |
| audience evaluation and the missing-operand veto | `lib/engine/audience.ts` |
| frequency cap, quiet hours | `lib/engine/gates.ts` |
| claim-and-lease, backoff, dead-lettering | `lib/runs.ts`, `lib/engine/scheduling.ts` |
| score ledger, idempotent awarding | `lib/scores.ts`, `steps/add-points.ts` |
| tier ladder, derivation and its defaults | `lib/engine/tiers.ts`, `lib/tiers.ts` |
| everything known about one customer | `api/customers/[id]/profile/route.ts` |
| NPS asking, answering and the latest score | `lib/survey.ts`, `steps/nps-survey.ts`, `api/survey/` |
| subject export and erasure, and what they keep | `lib/gdpr.ts` |
| consent state, its trail, and the send gate | `lib/consent.ts`, `api/unsubscribe/` |
| reusable HTML blocks and their substitution | `lib/content-blocks.ts`, `api/content-blocks/` |
| recommendation ranking and its two signals | `lib/engine/recommendations.ts`, `lib/recommendations.ts` |
| per-tenant settings, and the only screen that writes them | `api/settings/route.ts` |
| agent/MCP authoring tools and their invariants | `ai-tools/authoring-pack.ts` |
| daily series behind the results chart | `lib/analytics/daily-series.ts` |
| which links were clicked, and its overlap rule | `lib/analytics/links.ts` |
| drop-off INSIDE a journey, and the split rule | `lib/analytics/step-funnel.ts` |
| journey preview, and why it reuses the engine | `lib/preview.ts` |
| learned send hour, and its minimum evidence | `lib/analytics/send-time.ts` |
| A/B results, winner rules, the two metrics | `lib/analytics/split-results.ts`, `lib/winner-metric.ts` |
| linear revenue attribution | `lib/analytics/attribution.ts` |
| periodic candidate sources and their claims | `lib/sweep-sources.ts` |
| duplicate-delivery guard and its window | `lib/occurrence.ts`, `lib/runs.ts` → `createRun` |
| signed tracking tokens, link rewriting | `lib/tracking/` (`token.ts`, `rewrite.ts`, `urls.ts`) |
| the only PUBLIC routes in the module | `api/track/open`, `api/track/click`, `api/unsubscribe`, `api/survey`, `api/inbound` |
| signed inbound hook URLs and their payload split | `lib/inbound.ts`, `api/inbound-hooks/` |
| AI copy drafting, its prompt and its sanitiser | `lib/ai-copy.ts`, `lib/engine/copy-draft.ts` |
| campaign history, versions and restore | `lib/revisions.ts`, `api/campaigns/[id]/revisions/` |
| background job log and its retention | `lib/job-runs.ts`, `api/jobs/` |
| referral codes, claims and the subject flip | `lib/referrals.ts`, `lib/engine/referral-code.ts` |
| saved segments, membership and its cycle rule | `lib/segments.ts`, `lib/engine/segment-expression.ts` |
| ONE membership resolver, shared by five callers | `lib/segment-members.ts` |
| daily segment sizes and their retention | `lib/segment-snapshots.ts` |
| a queued bulk action with real progress | `workers/segment-action.ts`, `api/segments/[id]/actions/` |
| price watches, the drop rules and the scan | `lib/engine/price-watch.ts`, `lib/product-watches.ts` |
| lead routing and the weekly rep digest | `lib/engine/lead-routing.ts`, `lib/lead-digest.ts` |
| what the recipient asked for, and the gate | `lib/preferences.ts`, `lib/engine/gates.ts` → preference |
| the only PORTAL route in the module | `api/portal/preferences/` |
| the first-run readiness checks | `lib/engine/readiness.ts`, `api/readiness/` |
| the campaign authoring agent and its limits | `ai-agents.ts`, `ai-tools/__tests__/agent-cannot-publish.test.ts` |
| the deliverability breaker and what it can see | `lib/engine/deliverability.ts`, `lib/deliverability.ts` |
| a custom field added to another module's record | `ce.ts` (birth date on the person profile) |
| a step that writes into the run context | `steps/issue-referral-code.ts` |
| enrolment shared by events and sweeps | `lib/dispatcher.ts` → `startCampaignForSubject` |
| trigger context hydration | `lib/trigger-catalog.ts` |
| a step handler with a channel | `steps/send-email.ts` |
| an idempotent step | `steps/add-tag.ts` (409 "already assigned" is success) |
| audience pushdown planner and its superset rule | `lib/engine/narrowing.ts` |
| candidate resolution and the set algebra | `lib/audience/set-resolver.ts` |
| canvas ↔ definition mapping, fork and rejoin | `lib/canvas/graph-mapping.ts` |
| structural edits over the step tree | `lib/canvas/step-tree.ts` |
| deterministic lane assignment, flattening | `lib/engine/split.ts` |

## Gotchas Carried From Production Experience

- A referral conversion's event SUBJECT is the referrer, not the buyer. No audience expression can turn one
  person's order into a different person's run, which is why it is an event of its own rather than a rule over
  `sales.order.created`.
- `customers.person.created` puts the PERSON PROFILE id in `payload.id`; the customer is
  `payload.entityId`. Reading `id` keys every run and every tag on the wrong row.
- `sales.order.created` carries only `{ id, organizationId, tenantId, userId }` — no customer and
  no total. Anything an audience compares must be hydrated in `lib/trigger-catalog.ts`.
- Sales money columns are `numeric` mapped to `string`. Parse deliberately.
- A cancelled order is `canceled` OR `cancelled`; the codebase tolerates both.
- `add_tag` emits `customers.tag.assigned`, which is itself a trigger. Two things stop a cycle:
  the save refuses a campaign whose trigger is an event its own steps emit, and
  `MAX_RUNS_PER_SUBJECT` bounds runs per subject per hour across ALL campaigns. An in-context
  depth counter was tried first and could not work — the events are emitted by the modules that
  own them and carry nothing of ours, so nothing could increment a depth across the hop.
- `em.getConnection().execute` does not bind a JS array to `= any(?)` — it errors rather than binding. Expand
  placeholders (`in (?, ?, …)`) and spread the values; they are still parameters.
- `moduleConfigService.getValue` takes the scope inside an OPTIONS object (`{ scope }`) while `setValue`
  takes it positionally. Passing it positionally to `getValue` compiles, drops the scope and reads the
  instance-wide record instead, so a tenant's configured value never applies — and nothing fails, because
  the default is a legitimate answer. Both config loaders had this bug;
  `lib/__tests__/module-config-scope.test.ts` now asserts the scope arrives.
- An integration test that mutates a customer it did not create will break a different spec. TC-MA-020 awarded
  a point to whichever customer the installation listed first, and TC-MA-009 — which asserts an untouched
  customer has no points — started failing two commits later. Create the fixture, use it, delete it.
- New features reach existing tenants only after `yarn mercato auth sync-role-acls`, and the dev
  server caches the generated ACL registry — restart it or a wildcard has nothing to expand.

## Not Implemented, Deliberately

- `storefront.cart.abandoned` — no cart entity exists in the platform. It is in the catalog as
  unavailable with a reason so the palette explains itself; blocked on `SPEC-029`.
- SMS, WhatsApp and push: a channel provider belongs in its own `packages/channel-*`, not here.
- An RSS content block: parsing XML needs a production dependency and fetching an operator-typed URL needs an
  SSRF policy, which is a platform decision rather than one this module makes for itself.
- A product-feed content block: `{{recommendations}}` already degrades to best sellers with no history, so a
  shared block would be a second rendering of the same HTML for a cost nobody has reported.
- A campaign calendar and a form-based authoring fallback: the first shows facts three existing screens already
  answer, the second is a second authoring surface for one model. Reasons in the roadmap spec.
- Everything else in the roadmap's blocked table — each needs a cart, a channel account, storefront tracking,
  the availability contract, provider feedback, ad credentials, push rails, a `search` scope decision or a change
  to the frozen `workflows` enum.
