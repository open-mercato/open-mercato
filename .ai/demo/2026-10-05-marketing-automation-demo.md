# Marketing automation — demo script (screen recording)

**Length:** about 24 minutes. The results screen and the customer profile alone are 9 minutes — if you only have 10, do screens 1–5 and stop there.

**Installation:** Acme Corp, `http://localhost:3000`, interface in English.

## Screen order

0. **Why this exists** — no screen, to camera (2 min)
1. Dashboard — the **Marketing this week** tile (optional, 30 s)
2. **Campaigns** — the campaign list (1 min)
3. **Results** for "Welcome new customers" (4 min)
4. **Runs** for the same campaign (1.5 min)
5. **Customer profile** — Riley Nguyen (4 min)
6. Campaign editor, "Welcome new customers" — canvas, steps, **Send rules**, **Preview** (4 min)
7. Campaign editor, "Win back quiet buyers" — scheduled trigger and **Audience** (2 min)
8. **Segments** (1 min)
9. **Score rules** (40 s)
10. **Content blocks** (30 s)
11. **Price watches** (40 s)
12. **Referrals** (30 s)
13. **Lead routing** (40 s)
14. **Inbound hooks** and **Inbound requests** (1 min)
15. **Marketing settings** (1 min)
16. **Getting started** (40 s)
17. **Background jobs** (40 s)

## Three sentences to open with

> This is marketing automation built into Open Mercato — campaigns that react to what a customer actually did in the shop, with no export to a separate tool. You'll see a live welcome campaign and its results, one customer's full history, and then the editor where all of it is put together. Watch less for the feature list and more for what this module refuses to show you — because almost every one of those refusals is there because showing it would be a lie.

---

## 0. Why this exists — before you click anything (2 min)

**Show nothing. Talk to the camera, or to a title slide.**

**What to say:**

> Open Mercato already holds everything it knows about a customer: orders, line items, categories, sales channels, quotes, tags, consent. What it did not have was anything that **acts** on that knowledge — on its own, over time, without somebody clicking export.
>
> That is what this module does. A campaign is three things: what starts it, who it applies to, and what then happens. It is started by something that actually happened in the shop — somebody registered, an order was delivered, a watched product got cheaper — or by a scheduled sweep of the customer base, like "people who have bought before and not for three months".
>
> Here is the sentence the whole demo rests on: **this is not an integration with a marketing tool, it is that tool living inside the shop.** Everything you are about to see follows from it.

**How that differs from wiring up Klaviyo or Mailchimp — four concrete things:**

1. **The audience is a query against live data, not against an export.** "Bought at least once and nothing for 90 days" is evaluated against the real orders at the moment of sending. In an external tool it is a copy from the last sync — which is where "we miss you" emails to somebody who bought yesterday come from.
2. **One customer database, not two.** Nothing to reconcile, no duplicates, no argument about which side is right.
3. **Consent lives with the customer.** An unsubscribe takes effect immediately and across every campaign at once, not after the next sync. A GDPR erasure actually erases, because there is no second copy somewhere else.
4. **Revenue closes the loop without guessing.** The orders are in the same system, so "this campaign earned that much" is a join across two tables rather than query parameters on links and faith in cookies.

**What it is NOT:** it is not switched on for everyone, and it does not pretend to replace a team. It is opt-in, and it still runs without the sales or catalog modules — it simply tells you, honestly, what it cannot measure without them.

**The point:** a shop that already knows everything about a customer stops handing that knowledge to somebody else just to be able to write to them.

---

## 1. Dashboard — the "Marketing this week" tile

**Path:** `http://localhost:3000/backend` — the **Marketing this week** tile.

**What to show:** the tile itself: **Messages sent** with how many were held back and how many failed underneath it, **Engagement** (opened / clicked), **Attributed revenue**, and the counter at the bottom, "X of Y campaigns live". Open the **Period** selector to show the window can be changed.

**What to say:** We start on the screen everybody opens first thing in the morning. This tile answers one question — what went out this week, who engaged with it, and what it earned — across the whole organisation rather than one campaign at a time. Messages held back and messages that failed are counted next to the sends, not folded into them. That way "sent" always means exactly what it says.

**The point:** There is no "delivered" figure anywhere on this tile, because the platform gets no delivery feedback from the mail provider — a "delivered" number would only be the sent count wearing a more confident name.

---

## 2. Campaigns — the campaign list

**Path:** `/backend/marketing/campaigns`

**What to show:** four rows. Columns **Name**, **Triggers**, **Steps**, **Enabled**, **Updated**. Point out that only "Welcome new customers" has **Enabled** switched on. Hover the question mark next to the page title and read the help text. Show the **New campaign** and **Start from a template…** buttons.

**What to say:** Four campaigns, one of them running. "Welcome new customers" has four steps and starts on the **Customer registered** event. "Win back quiet buyers" runs on a schedule, and "Birthday treat" and "Ask for a review after delivery" are single-step automations. Every campaign here is the same three things: a trigger, an audience, and the steps that follow.

**The point:** A disabled campaign isn't hidden or moved to a different tab, because it's the same object in a different state, not a different kind of thing.

---

## 3. Results — "Welcome new customers"

**Path:** `/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030/results` (or open the campaign and click **Results** in the header)

**What to show, in order:**

- The four tiles at the top: **Sent 84** with **3 held back by send rules** underneath, **Opened 24**, **Clicked 9**, **Attributed revenue**. Open the question mark on **Sent** and on **Clicked**.
- The **Funnel** section: 68 **Entered** → 42 **Received a message** → 24 **Opened** → 9 **Clicked** → 0 **Ordered afterwards**. Point at the caption, **People, not messages**.
- **Over time** — the daily chart.
- **Step by step** — columns **Step**, **People**, **From previous**, **Of the first step**, **Skipped**, **Failed**. Point out the rows marked **in lane a** and **in lane b**.
- **What they clicked** — and read the caption under the table.
- **A/B results** — variant a has 26 people, variant b has 42, and the verdict reads **Not enough data yet (50 recipients per variant needed)**.

**What to say:** This is the same campaign seen from the results side. The tiles at the top count messages: 84 sent, three held back by the send rules. The funnel below counts people instead: 68 entered the campaign, 42 received a message, 24 opened, 9 clicked. Notice the gap — those 84 messages reached 42 people, because this campaign sends each of them two emails. If the funnel counted messages, it would claim to have reached twice as many people as it did. Below that, **Step by step** runs in the authored order, which is the order the customer experiences, rather than sorted by size. And at the bottom there's an A/B test that declines to name a winner.

**The point:** Where another tool would show a green "Variant B wins" badge, this one shows the sentence "Not enough data yet (50 recipients per variant needed)" and no button to apply a result — 26 against 42 means nothing, so the system doesn't pretend it does.

**If somebody asks about the 0 in "Ordered afterwards":** Revenue is attributed linearly inside a window after a click, and split evenly across the campaigns that played in that window — and on this demo data there are no orders after a click. That isn't a broken chart, it's an honest zero.

---

## 4. Runs — who got stuck, and where

**Path:** click **Runs** in the campaign header (`/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030/runs`)

**What to show:** the run table. Columns **Customer**, **Trigger**, **Status**, **Progress**, **Started**, **Resumes**, **Attempts**, **Last error**. Show the status filter (**All**, **Waiting**, **Completed**, **Failed**, **Given up**). Expand **Steps** on one row. Point at **Put back in the queue** on a failed row — but don't click it.

**What to say:** One row per customer the campaign started for. **Waiting** means the person is sitting in a **Wait** step and has a date when they'll move on. **Given up** is a run that exhausted its attempts. Expanding **Steps** shows step by step what ran, what was skipped and what failed. On a failure there's **Put back in the queue**, with a warning that the run carries on from the step that failed — which may send this customer an email.

**The point:** The retry confirmation says out loud that this may send a message, because "retry" in a marketing tool isn't refreshing a view, it's a letter to a named person.

---

## 5. Customer profile — Riley Nguyen

**Path:** in **Runs**, click the customer name → **Open the customer profile**. Direct: `/backend/marketing/customers/b0494b70-f980-4317-b509-5611f6febe20`

**What to show, in order:**

- The header: the name, the **Bronze** medal, and the **Recalculate score**, **Export data**, **Erase data** buttons.
- The tiles: **Lead score 50**, **Orders 3**, **Lifetime spend 1.3K**, **Buys from**, **RFM 10/15**, **Projected value 5.4K**, **Latest NPS**, **Messages sent**. Open the question mark on **RFM** and on **Projected value** and read them out.
- The **Why did they not get a campaign?** section — pick a campaign from the list and click **Explain**. Show the answer and the gates it walked: **Audience**, **Consent**, **Campaign frequency cap**, **Their own weekly limit**, **Quiet hours**, **Customer pause**.
- Keep scrolling: **Marketing consent**, **Waiting for a price drop**, **Referrals**, **What the next message would offer**, **What they asked for**, **Segments**, **Tags**, **Recent score changes**, **Recent campaign runs**.
- Finish on **What happened** — the timeline. Show the entries "Entered the campaign", "Message sent", "Opened the message", "Clicked a link", "+25 points", and the **Show older** button.

**What to say:** This is one person, seen the way the campaign engine sees them. Lead score 50, tier Bronze — and that isn't a number stored in a column, it's the sum of a ledger, which is what stops a step delivered twice from awarding points twice. The RFM digits, 10 out of 15, are quintiles against this shop's own buyers rather than fixed day counts: "bought in the last 30 days" is excellent for a coffee subscription and meaningless for a mattress shop. The 5.4K projection needs a second order before it appears, because one purchase is not a rate. And here is the screen that customer support actually rings about: **Why did they not get a campaign?** — pick a campaign, click **Explain**, and the system walks every gate in the same order the engine walks them and names the one that decided.

**The point:** "Why did they not get a campaign?" answers the question that in every other tool turns into a ticket for the engineering team — and it distinguishes "later, not never" from a refusal, because consent says no permanently while quiet hours only move the message.

**Add at the timeline:** At the bottom is **What happened** — entering the campaign, the send, the open, the click, the points awarded, in order, each with the campaign name beside it. Only the bad things are coloured: held-back messages, failures and unsubscribes. A timeline where every row is coloured is a timeline where colour means nothing.

---

## 6. The campaign editor — how this is put together

**Path:** `/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030`

**What to show, in order:**

- The canvas: the trigger node **Customer registered**, the **Audience** node reading **Everyone the trigger produces**, then **Step 1 Send email**, **Step 2 Wait**, **Step 3 A/B split** with lanes a and b, and **Step 4 Add score points**.
- The palette on the left, with its **Triggers** and **Steps** tabs and a **Search** box. Scroll the step list: **Send email**, **Wait**, **A/B split**, **Add tag**, **Add score points**, **Assign to a sales rep**, **Issue a referral code**, **Ask for an NPS score**, **Tell a colleague**, **Signal an outside system**.
- Click the **A/B split** node and show the two variants — "Ten percent on your first order" and "What people near you are buying" — the 50/50 weights, and the hint **Each customer is assigned one variant and stays in it**.
- Hover the connector between two steps and show the text **Steps run top to bottom. Reorder with the arrows, not by dragging.**
- Click **Step 1** and in the inspector show **Subject**, **Body**, **Track opens and clicks**, **Recommended products**. Point at **Draft with AI** and **Send a test to me** — but don't click either.
- Expand **Send rules**. Show **Limit how many messages one customer receives** set to 3 per 168 hours and read the hint under it. Show **Do not send during quiet hours**, **Send at a fixed hour, in the recipient's local time**, and **Send at the hour each customer usually opens email** with its note, **Ignored while a fixed hour is set above**.
- Click **Preview**, pick a customer, and show the journey written out with times.
- Click **Show saved versions** and show the history. Do not click **Restore**.

**What to say:** This is the same campaign from the inside. The top of the canvas is the trigger and the audience, then four steps, and the third is an A/B test with two variants at fifty-fifty. A customer is assigned one variant and stays in it — including when the run pauses on a wait and comes back to life a week later, because the variant is derived from the step id and the customer id rather than drawn again on each resume. Look at **Send rules**: the limit of three messages a week is counted **across every campaign**, not per campaign. Five campaigns each politely sending one message still buries the customer. And below that, **Preview** writes out the whole journey with times and sends nothing.

**The point, part one:** You cannot draw an edge on this canvas, because the only branch the engine has is an A/B split — an author who can draw an edge has been promised a topology the engine cannot run.

**The point, part two:** Send-time optimisation is switched off the moment you set an hour by hand, and the interface says so — a human decision outranks a guess about the same question, and two settings that look additive are a trap.

**Add at Preview:** The preview is not a second implementation of the engine. It drives the same `executeRun`, with the effects recorded instead of performed — because a preview is trusted precisely where nobody can check it.

---

## 7. "Win back quiet buyers" — a scheduled trigger and the audience builder

**Path:** `/backend/marketing/campaigns/4377aaaa-abc3-49b4-8077-20ac0acd2694`

**What to show:** the trigger node: **On a schedule**, source **All customers**, **every 1d**, and **Re-enter the same customer after (days)** set to 60. Then click **Edit audience** and show the two conditions: **Number of orders** — **at least** — 1, and **Days since last order** — **at least** — 90, joined by **Match all of these**. Hover the question mark on **Days since last order** and read the hint. Open the field list and show the groups **Customer**, **Orders**, **Engagement**, **Loyalty**, **Value**, **Survey**, **Location**, **Lists they are on**. Show the **Advanced editor** and come back with **Back to the guided editor**.

**What to say:** This campaign doesn't react to an event — it sweeps the database once a day looking for people who match a condition. The audience says: has at least one order, and at least 90 days since the last one. **Re-enter the same customer after** is what stops the same person falling into the campaign over and over. The field list holds everything this module knows about a customer — orders, engagement, loyalty, value, survey answers — and for a condition the guided editor doesn't cover there's an **Advanced editor**.

**The point:** The hint on "Days since last order" says that somebody who has never ordered has no such day, so this condition never matches them. That's not an interface detail — without that rule, win-back campaigns mail "come back to us" to people who never bought anything, which is the single most common failure in this category of tool.

---

## 8. Segments

**Path:** `/backend/marketing/segments`

**What to show:** two segments, columns **Name**, **Reference**, **Members**. Open one, show **Who is in it**, **Members**, and the caption under the list (**Every candidate was checked**, or **A sample…**). Show **Size over time**, then the **Compare and act** section with **Overlap with**, **Award 10 points to members** and **Export CSV**. Don't run anything.

**What to say:** A segment is an audience you name once and target from any campaign with "segments contains". Under the member list there is always a qualifier: either every candidate was checked, or this is a sample. Membership is computed by the same call the dispatcher makes when it sends, so this screen cannot drift away from what actually went out. And a bulk action never stores a list of people — it carries the segment and resolves it when the job runs.

**The point:** Nowhere here is a sample presented as a total — every membership answer carries its qualifier, and so does the overlap between two segments.

---

## 9. Score rules

**Path:** `/backend/marketing/score-rules`

**What to show:** two rules with status **Active**, columns **Name**, **Points**, **Status**. Open one for editing and show **Who gets the points** and the hint on the name field.

**What to say:** Score rules award points for **who** a customer is — where they live, which tags they carry, how much they've spent — on top of whatever campaigns award for what they did. The rule's name is what shows up in a customer's score history as the reason for the points, so you write it for whoever reads that list. A rule cannot refer to the score itself or to segments, because it would be computing from the thing being computed.

**The point:** The delete confirmation says that everybody this rule awarded points to will lose them — because the score is a ledger rather than a column, so removing a rule genuinely changes the answer.

---

## 10. Content blocks

**Path:** `/backend/marketing/content-blocks`

**What to show:** three blocks, columns **Reference** and **Name**. Open one for editing and show that **Reference** cannot be changed. Show the **Reusable blocks you can paste into the body** list.

**What to say:** A block is a piece of HTML written once and pulled into messages with `{{block:key}}` — a footer, a header, a seasonal banner. The reference is frozen once the block is saved, because messages point at the block through it.

**The point:** A missing block renders as nothing rather than as its own reference — printing `{{block:footer}}` into a customer's email is worse than printing an empty space.

---

## 11. Price watches

**Path:** `/backend/marketing/demand`

**What to show:** eight products, columns **Product**, **Waiting**, **Already told**. Read the caption above the table.

**What to say:** These are the products customers asked to be told about when the price drops — the clearest demand signal a shop ever gets. A drop of 5 percent or more fires the campaign triggered by **Watched product price dropped**. The **Already told** column is what stops the same person hearing the same thing twice.

**The point:** The comparison is against the untargeted list price, not against this shopper's own price — a contract price for a different buyer is not this customer's price. And a product that was unpublished is never treated as a price drop, because "it's gone" is not the message anybody asked for.

---

## 12. Referrals

**Path:** `/backend/marketing/referrals`

**What to show:** the table, with columns **Code**, **Referrer**, **Used the code**, **Bought**, **Issued**. Click **Open profile** on a row.

**What to say:** Referral codes are handed out by the **Issue a referral code** campaign step, which writes them into the message as `{{referral.code}}`. The columns keep two different things apart: how many people typed the code in, and how many of them then actually bought something.

**The point:** The reward fires on the referred customer's first order, not on the code being claimed — a claim is just somebody typing something, and the order is the half worth paying for. And a code is never reissued, because it is already printed in every message that ever mentioned it.

---

## 13. Lead routing

**Path:** `/backend/marketing/lead-routing`

**What to show:** three sales reps carrying 5, 5 and 6 leads, the **Next lead goes here** marker, and the **New this week** column.

**What to say:** The **Assign to a sales rep** step gives each new lead to whoever currently has the fewest. Ties break deterministically, so this screen really does show who is next. The pool of reps is configured on **Marketing settings**.

**The point:** There is no round-robin cursor here to reset — "least loaded wins" is self-correcting when somebody goes on holiday, where a cursor would keep feeding leads to the person who isn't there. And a lead that already has an owner is left alone by default, because taking a customer away from the rep who has been talking to them is the most damaging thing routing can do.

---

## 14. Inbound hooks and Inbound requests

**Path:** `/backend/marketing/inbound-hooks`, then `/backend/marketing/inbound-requests` (or **Show what arrived**)

**What to show:** three hooks, two **Live** and one **Revoked**, and the **Activity** column. Show **Copy URL** and **Copy curl command**. Expand **How another system posts to a hook**. Move to **Inbound requests**: eight requests, columns **Received**, **Customer**, **Outcome**, **Size**, with the outcomes **Customer found**, **No matching customer** and **No customerId or email in the payload**. Expand one row and show the payload.

**What to say:** A hook is a signed URL another system posts JSON to in order to start a campaign. A `customerId` or an `email` is enough; every other field reaches the campaign as `trigger.<field>`. **Inbound requests** shows what actually arrived, body included, so an argument about whether something was sent can be settled rather than guessed. Requests are kept for a few days and then deleted, because this is a wiring aid, not an archive.

**The point:** The endpoint itself never reveals whether an address matched a customer — a leaked hook URL would otherwise be an "is this person one of your customers" oracle over the whole list. The match outcome is only visible to somebody logged in, on this screen.

---

## 15. Marketing settings

**Path:** `/backend/marketing/settings`

**What to show:** the sections **A/B tests** (**Decide a test on**: Clicks per recipient / Revenue per recipient; **Let a decisive test promote its own winner**, switched off; **How much better the winner must be**), **Loyalty tiers**, **Customer value** with the projection horizon, **Brand voice**, **Product links in messages**, **Referral links**, and finally **Suppression list**. Read the hint under **Suppression list**.

**What to say:** Everything here applies to the whole organisation. One setting decides the A/B winner metric — and it governs both the suggestion on the results screen and any winner promoted for you, because being shown a click winner while a revenue winner is quietly applied on your behalf is worse than either alone. Automatic promotion is off by default, because promoting a winner rewrites somebody's campaign. **Brand voice** is a line or two about how this shop writes, handed to the model whenever anybody drafts a message with AI. And at the bottom, the import for an unsubscribe list from whatever tool you're leaving.

**The point:** That import can only ever take people **off** the list — there is no button for the other direction. A CSV is not consent, and an import that could add somebody would manufacture exactly the evidence a shop may one day have to produce.

**Add:** The import report also says how many addresses matched no customer here, and shows a sample — because addresses are encrypted at rest, the lookup only searches a bounded window, and an operator who can't see that has no way to know their list was applied only in part.

---

## 16. Getting started

**Path:** `/backend/marketing/setup`

**What to show:** eight items, all green, with the status **Ready to send**. Read the titles: **Configure an email channel**, **Set a signing secret and a public URL**, **Turn on the periodic jobs**, **Create a campaign**, **Publish it**, **Watch the first customer go through**, **Name an audience you will reuse**, **Write a reusable block**. Click **Check again**.

**What to say:** This is the screen you land on when nothing is going out. Eight things that have to be true before anything sends, all of them checked live every time the screen loads. The signing secret and public URL are required because without them no unsubscribe link can be built — and a message with no way out is refused rather than delivered.

**The point:** None of these items is read off a "setup completed" flag. A flag tells you what somebody once clicked; the question is what is true now. An installation whose email channel was deleted last week is not set up.

---

## 17. Background jobs

**Path:** `/backend/marketing/jobs`

**What to show:** the run list, columns **Job**, **Campaign**, **Started**, **Status**, **Result**. Show the **Waiting journeys** row reading **Nothing to do, 100 times in a row**. Show the job kinds: **Scheduled campaign sweep**, **Waiting journeys**, **Score rules**, **Weekly lead digest**, **Event dispatch**. Scroll down to **Dispatches that never ran**.

**What to say:** Every pass of this module's background work gets a row saying what it did: how many people it enrolled, how many messages it sent, how many it skipped. Passes that found nothing collapse into one line — "Nothing to do, 100 times in a row" — instead of a hundred identical rows you'd have to read past to find the one that did something. And the row is written **before** the work rather than after, so a job killed halfway stays visible as **Running**.

**The point:** Under **Dispatches that never ran** there is deliberately no replay button — a dispatch that failed for a reason nobody has read should not be retried, by a timer or by a click.

---

## What not to show, and why

**Do not click, under any circumstances:**

- **Enable** on a disabled campaign ("Win back quiet buyers", "Birthday treat", "Ask for a review after delivery"). Opening the **Publish this campaign?** dialog is fine and actually good on camera — it shows how many people match the audience and the most messages one person could receive — but **cancel it**. Confirming starts sending to real addresses.
- **Erase data** on Riley Nguyen's profile. Irreversible, and there is no second customer with a history this complete.
- **Restore** in the editor's **History**. It rewrites the campaign and creates a new version. Show the version list; don't restore.
- **Delete** on any campaign, segment, score rule or content block.
- **Award 10 points to members** in **Segments** — it writes points to every member and will contradict the numbers you just showed on the profile.
- **Recalculate score** on the profile — harmless, but it adds entries to the score history you show a moment later.

**Doesn't work on this installation:**

- **Draft with AI** in the email step inspector. The API keys in `apps/mercato/.env` are empty, so you'll get "No AI model is configured for this installation." Describe the feature instead and show **Brand voice** in settings; don't press the button.
- **Send a test to me** — it sends a real email to the signed-in account's address. Unless you verified before recording that the email channel actually sends, don't press it: a failure shows "The transport refused the test message."
- The preference centre and the unsubscribe page (customer portal). Those need a customer session, not an admin one. Talk about them at the **What they asked for** section on the profile, but don't try to open them.
- The **Marketing this week** tile — check before recording that it's enabled on this dashboard. If it isn't, start at screen 2; you lose nothing.

**Looks weak unless you explain it:**

- **Ordered afterwards: 0** in the funnel, and an empty **Attributed revenue**. There are no post-click orders in this data. Don't scroll past it — explain how attribution works and call the zero honest.
- The missing **End the test, keep this variant** button on the A/B section. That's not a bug, it's the whole point of the screen. If you don't say so, the viewer will assume the feature is broken.
- **Jobs** with its "Nothing to do, 100 times in a row" row. Unexplained it looks like a dead screen; with the remark about collapsing idle passes it's a design decision.
- The number of codes on **Referrals** depends on the organisation scope — don't say a figure out loud, say "the codes that have been issued".

---

## URL cheat sheet

Prefix: `http://localhost:3000`

| Screen | URL |
|---|---|
| Dashboard | `/backend` |
| Campaigns | `/backend/marketing/campaigns` |
| Welcome new customers — editor | `/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030` |
| Welcome new customers — Results | `/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030/results` |
| Welcome new customers — Runs | `/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030/runs` |
| Win back quiet buyers — editor | `/backend/marketing/campaigns/4377aaaa-abc3-49b4-8077-20ac0acd2694` |
| Ask for a review after delivery | `/backend/marketing/campaigns/43704edf-551c-4fd1-a336-c87d129d7ef1` |
| Birthday treat | `/backend/marketing/campaigns/c52b80b0-04e4-4b86-be2b-9e17f7807b25` |
| Customer profile — Riley Nguyen | `/backend/marketing/customers/b0494b70-f980-4317-b509-5611f6febe20` |
| Segments | `/backend/marketing/segments` |
| Score rules | `/backend/marketing/score-rules` |
| Content blocks | `/backend/marketing/content-blocks` |
| Price watches | `/backend/marketing/demand` |
| Referrals | `/backend/marketing/referrals` |
| Lead routing | `/backend/marketing/lead-routing` |
| Inbound hooks | `/backend/marketing/inbound-hooks` |
| Inbound requests | `/backend/marketing/inbound-requests` |
| Marketing settings | `/backend/marketing/settings` |
| Getting started | `/backend/marketing/setup` |
| Background jobs | `/backend/marketing/jobs` |
