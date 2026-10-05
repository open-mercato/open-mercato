# Marketing automation — demo script

**About 20 minutes.** Short on time? Do screens 0–4 and stop. That is the whole story in 10 minutes.

**Setup:** Acme Corp, `http://localhost:3000`, interface in English.

---

## If you remember nothing else

Five sentences. Everything below is just showing them.

1. **The shop already knows the customer. This module acts on that, by itself, over time.**
2. **It is not an integration with a marketing tool. It is the tool, inside the shop.**
3. **The audience is a live query. Not an export from last night.**
4. **One customer database. One place for consent.**
5. **It refuses to show numbers that would be lies.** That is the part nobody else does.

---

## Do not touch on camera

- **Draft with AI** — no API key here. It will show an error.
- **Enable** on a campaign — sends real email. Open the dialog, then cancel.
- **Erase data**, **Restore**, **Delete**, **Award 10 points to members** — not reversible.
- On **Referrals**, do not say how many codes there are. The screen shows one, the database has five. The other four belong to customers who no longer exist, and the screen is right to hide them.

---

## Screen order

0. Why this exists — no screen, 2 min
1. Campaigns — 1 min
2. Results — 4 min
3. Runs — 1.5 min
4. Customer profile — 4 min
5. Campaign editor — 4 min
6. Win back — scheduled trigger — 2 min
7. Segments — 1 min
8. Score rules — 40 s
9. Content blocks — 30 s
10. Price watches — 40 s
11. Referrals — 30 s
12. Lead routing — 40 s
13. Inbound hooks and requests — 1 min
14. Settings — 1 min
15. Getting started — 40 s
16. Background jobs — 40 s

---

## 0. Why this exists

**No screen. Talk to the camera.**

Say:
- Open Mercato already knows everything about a customer. Orders. What they bought. Consent. Tags.
- It had nothing that *does* something with that. On its own. Over time.
- That is this module. A campaign is three things: what starts it, who it applies to, what then happens.
- It starts on something real. Someone registered. An order arrived. A watched price dropped.

Then the key line:
- **This is not an integration with a marketing tool. It is that tool, living inside the shop.**

Why that matters — four things:
- **The audience is a live query.** "Bought once, nothing for 90 days" is checked against real orders, at the moment of sending. An external tool checks a copy from the last sync. That is how people get "we miss you" the day after they bought.
- **One customer database.** Not two. Nothing to reconcile.
- **Consent lives with the customer.** Unsubscribe works instantly, everywhere. A GDPR erasure really erases, because there is no second copy somewhere else.
- **Revenue is a join, not a guess.** The orders are in the same system. No UTM tags, no faith in cookies.

Punch: a shop that already knows everything about a customer stops handing that away just to be able to write to them.

---

## 1. Campaigns

`/backend/marketing/campaigns`

Show: four rows. Only "Welcome new customers" is enabled.

Say:
- Four campaigns. One running.
- "Welcome new customers" has four steps. It starts when someone registers.
- "Win back quiet buyers" runs on a schedule instead.
- Every campaign is the same three things. Trigger, audience, steps.

Punch: a disabled campaign is not hidden somewhere else. Same object, different state.

---

## 2. Results

`/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030/results`

Show, in order: the four tiles, the funnel, Step by step, What they clicked, A/B results.

Say:
- Top tiles count **messages**. 84 sent. Three held back by the send rules.
- The funnel counts **people**. 68 entered. 42 got a message. 24 opened. 9 clicked.
- Look at the gap. 84 messages reached 42 people, because this campaign sends two emails each.
- If the funnel counted messages, it would claim twice the reach.
- Click any stage. It takes you to those exact people.

Punch: at the bottom the A/B test refuses to name a winner. 26 against 42 means nothing. It says so instead of showing a green badge.

If asked about the 0 in "Ordered afterwards": there are no orders after a click in this demo data. It is an honest zero, not a broken chart.

---

## 3. Runs

Click **Runs** in the campaign header.

Show: the table. Expand one row. Point at **Put back in the queue** — do not click.

Say:
- One row per person the campaign started for.
- "Waiting" means they are sitting in a Wait step. There is a date when they move on.
- Expand a row and you see every step. What ran. What was skipped. Why.
- Retry warns you that the run carries on from the step that failed. It may send a real email.

Punch: retry here is not refreshing a page. It is a letter to a named person. So it says so.

---

## 4. Customer profile

`/backend/marketing/customers/b0494b70-f980-4317-b509-5611f6febe20`

Show: the tiles, then **Why did they not get a campaign?**, then scroll to **What happened** at the bottom.

Say:
- One person, the way the engine sees them.
- Lead score 50. That is not a stored number. It is the sum of a ledger. A step delivered twice cannot award twice.
- RFM is scored against *this shop's* buyers. Not fixed day counts. "Bought in the last 30 days" is great for coffee and meaningless for mattresses.
- The 5.4K projection needs a second order. One purchase is not a rate.

Then the best bit — **Why did they not get a campaign?**
- Pick a campaign. Click **Explain**.
- It walks every gate in the order the engine walks them, and names the one that decided.

Punch: this is the question support gets every week. Everywhere else it becomes a ticket for engineering.

At the bottom, **What happened**:
- Entered the campaign. Message sent. Opened. Clicked. Points awarded. In order.
- Only bad things are coloured. If everything is coloured, colour means nothing.

---

## 5. Campaign editor

`/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030`

Show: the canvas, click the A/B split node, open **Send rules**, click **Preview**.

Say:
- Same campaign, from the inside. Trigger, audience, four steps.
- Step three is an A/B test. Fifty-fifty.
- A customer gets one variant and keeps it. Even if the run pauses for a week and comes back.
- In **Send rules**: the limit of three messages a week counts **across every campaign**. Not per campaign.
- Five campaigns each politely sending one message still bury the customer.
- **Preview** writes out the whole journey with times. It sends nothing.

Punch one: you cannot draw a line between steps. The only branch the engine has is an A/B split. Letting you draw one would promise a shape it cannot run.

Punch two: set a send hour by hand and the "learn the best hour" option switches off, and says so. A human decision beats a guess about the same thing.

---

## 6. Win back quiet buyers

`/backend/marketing/campaigns/4377aaaa-abc3-49b4-8077-20ac0acd2694`

Show: the trigger node — **On a schedule**, **All customers**, every 1d. Then **Edit audience**.

Say:
- This one does not react to an event. It sweeps the database once a day.
- The audience: at least one order, and at least 90 days since the last one.
- "Re-enter after 60 days" stops the same person falling in over and over.

Punch: the hint says someone who never ordered has no "days since last order", so this never matches them. Without that rule, win-back campaigns email "come back" to people who never bought. That is the most common failure in this whole category of tool.

---

## 7. Segments

`/backend/marketing/segments`

Say:
- A segment is an audience you name once and reuse anywhere.
- Under the member list there is always a note: either everyone was checked, or this is a sample.
- Membership is computed by the same code that runs when sending. So this screen cannot drift from reality.

Punch: a sample is never shown as a total.

---

## 8. Score rules

`/backend/marketing/score-rules`

Say:
- Points for *who* someone is. Where they live. What they spent.
- Campaigns award points for what they *did*. These two stack.
- The rule name is what the customer's history shows as the reason. So write it for whoever reads that.

Punch: deleting a rule takes the points back, and the dialog says so. The score is a ledger, not a column.

---

## 9. Content blocks

`/backend/marketing/content-blocks`

Say:
- A piece of HTML you write once and reuse in every message. A footer, a delivery note.
- Fix it here, it changes everywhere.

Punch: the reference cannot be renamed. Renaming it would empty that block out of every campaign that used it.

---

## 10. Price watches

`/backend/marketing/demand`

Say:
- Customers asked to be told when a product gets cheaper.
- You see how many wait, and how many were already told.

Punch: this is demand that declared itself, before you decide on a discount. It is the highest-intent signal a shop gets.

---

## 11. Referrals

`/backend/marketing/referrals`

Say:
- Codes given to customers. Who used them, and who then bought.

Punch: those two are not the same. The reward lands on the referred person's first order, because typing a code costs nothing and proves nothing.

Remember: do not say how many codes there are.

---

## 12. Lead routing

`/backend/marketing/lead-routing`

Say:
- Three sales reps. The next lead goes to whoever carries the fewest.
- The badge says exactly who is next.

Punch: no round-robin counter. A counter needs resetting when someone joins or leaves, and keeps feeding a rep who has been away for two weeks. Counting current work fixes itself.

---

## 13. Inbound hooks and requests

`/backend/marketing/inbound-hooks` and `/backend/marketing/inbound-requests`

Say:
- An address an outside form can post to, to start a campaign.
- The second screen shows what actually arrived. Body and all.
- "Nobody matched" is not a failure. The request was accepted. The address just is not a customer here.

Punch: the hook never tells the caller whether an address matched. A leaked URL would otherwise become a way to test who your customers are.

---

## 14. Settings

`/backend/marketing/settings`

Show: scroll it. Point at **Brand voice** and the loyalty tiers.

Say:
- Everything per-shop in one place. Product link format. Rep pool. Suppression list. Tier thresholds.
- **Brand voice** is the text the AI writer is told to match.

Punch: the suppression import can only ever unsubscribe people. It cannot add anyone. A file is not consent.

---

## 15. Getting started

`/backend/marketing/setup`

Say:
- Eight checks. All green here. Status says **Ready to send**.

Punch: this is not a "setup completed" flag somebody ticked once. Each line is checked live. If the email channel gets deleted next week, this screen goes red.

---

## 16. Background jobs

`/backend/marketing/jobs`

Say:
- What the system does on its own. Sending. Waking up journeys. Recalculating points.
- Nothing to click. Come here when a campaign did not send.
- Look at the newest entry. Hours old means the automation stopped.

Punch: see "Nothing to do, 100 times in a row"? That is deliberate. A hundred identical rows would bury the one line that matters.

---

## Closing line

Pick one:

- Everything you just saw runs on the shop's own data. Nothing was exported anywhere.
- Most of this demo was about numbers the system refuses to show you. That is the hard part, and it is what makes the rest worth trusting.

---

## URLs

| Screen | URL |
|---|---|
| Campaigns | `/backend/marketing/campaigns` |
| Results | `/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030/results` |
| Runs | `/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030/runs` |
| Editor | `/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030` |
| Win back | `/backend/marketing/campaigns/4377aaaa-abc3-49b4-8077-20ac0acd2694` |
| Profile | `/backend/marketing/customers/b0494b70-f980-4317-b509-5611f6febe20` |
| Segments | `/backend/marketing/segments` |
| Score rules | `/backend/marketing/score-rules` |
| Content blocks | `/backend/marketing/content-blocks` |
| Price watches | `/backend/marketing/demand` |
| Referrals | `/backend/marketing/referrals` |
| Lead routing | `/backend/marketing/lead-routing` |
| Inbound hooks | `/backend/marketing/inbound-hooks` |
| Inbound requests | `/backend/marketing/inbound-requests` |
| Settings | `/backend/marketing/settings` |
| Getting started | `/backend/marketing/setup` |
| Background jobs | `/backend/marketing/jobs` |
