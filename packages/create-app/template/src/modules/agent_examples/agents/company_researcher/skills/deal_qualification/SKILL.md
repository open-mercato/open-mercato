---
id: deal_qualification
label: Deal qualification playbook
description: How to judge whether a company is a good, well-paying sales prospect from public web signals.
tools: []
---
Use this playbook to turn what you found on the public web into a `dealFitScore` (0–100), a `payingLikelihood` (`low`/`medium`/`high`), and a short recommendation.

Signals that make a company a GOOD paying prospect (each is positive):

- **Revenue / profitability** — meaningful and growing revenue, or a public statement of profitability.
- **Funding** — a recent raise, a well-known investor, or a public listing (durable ability to pay).
- **Headcount momentum** — growing team, open roles, or a hiring spree (budget and expansion).
- **Enterprise customers** — recognizable logos or case studies (they buy, and they pay real money).
- **Budget / pricing fit** — evidence they already pay for comparable tools or services.

Red flags that lower the score (each is negative):

- Layoffs, hiring freezes, or shrinking headcount.
- Missed payments, lawsuits over unpaid bills, insolvency, or a poor payment reputation.
- A long silence — no verifiable public activity for a year or more.
- No sign of budget: tiny team with no revenue, funding, or paying customers.

Turn the signals into a score with the `score` script (invoke it via `run_skill_script` with
`skillId: "deal_qualification", scriptName: "score"`). It takes 0..1 signal strengths and returns a
`dealFitScore` (0–100), `payingLikelihood`, and a `rationale`. Feed it your honest read of each signal:

- `revenueStrength` — how strong the revenue/profitability evidence is (0 = none, 1 = large and growing).
- `fundingStrength` — funding / public-company strength (0 = none, 1 = well-funded or public).
- `growthStrength` — headcount / hiring / customer momentum (0 = shrinking, 1 = clearly scaling).
- `riskLevel` — severity of red flags (0 = none, 1 = severe distress).

Map the size you estimated to `companySizeBucket`: roughly `micro` (<10), `small` (10–50),
`mid_market` (50–1000), `enterprise` (>1000) employees; use `unknown` when you cannot ground it.

Always sanity-check the script's number against your own judgement, and justify the score in
`recommendation` with the specific signals you relied on. When evidence is thin, prefer a conservative
score and a `low` or `medium` `payingLikelihood` rather than guessing high.
