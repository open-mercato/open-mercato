## 📸 UI evidence — automated scenarios PASS

Exact head: `70cc8403b64b1800744730a64167278a65486c22`. Source: [live integration CI](https://github.com/open-mercato/open-mercato/actions/runs/40554280334/job/122370296069), Playwright Chromium in the CI ephemeral app, admin role. This is a review of actual CI screenshots/results; no separate local/manual browser session is claimed.

**76 passed, 0 failures, 0 flaky, 0 skipped.** All ten new visual cases passed on their first attempt. [Full report/artifact](https://github.com/open-mercato/open-mercato/actions/runs/40554280334/artifacts/12759170768).

| Scenario (both light and dark) | Observed |
|---|---|
| Empty Claims, Registrations, Troubleshooting guides and Vendor policies | Matching search response and rendered empty state; exactly two pinned headers match a normal header within 1 RGB channel. |
| Own populated Vendor policy, rest and hover | Both pinned headers and row cells match normal cells; screenshot attachments captured. Fixture cleaned in finally. |
| Policy viewport reduced to 600 px | All sticky-class cells use non-sticky computed positioning. |

The original styling fails the same pixel assertion in the local negative control. The old search locator reproduces sidebar entry/response timeout; the scoped helper passes 20/20 repeated runs without retries.

Coverage limits: populated rows/hover on the other three lists, manual horizontal scrolling, and independent manual QA were not separately exercised. Existing pinned-edge shadows remain visible by design. `needs-qa` remains; this evidence grants no QA or merge approval.

<details>
<summary>light screenshots from exact-head CI (click to expand)</summary>

![light claims empty header](https://raw.githubusercontent.com/open-mercato/open-mercato/qa-evidence-pr-8035-70cc8403b-20261027/pr-8035/light-claims-empty-header.png)

![light registrations empty header](https://raw.githubusercontent.com/open-mercato/open-mercato/qa-evidence-pr-8035-70cc8403b-20261027/pr-8035/light-registrations-empty-header.png)

![light guides empty header](https://raw.githubusercontent.com/open-mercato/open-mercato/qa-evidence-pr-8035-70cc8403b-20261027/pr-8035/light-guides-empty-header.png)

![light policies empty header](https://raw.githubusercontent.com/open-mercato/open-mercato/qa-evidence-pr-8035-70cc8403b-20261027/pr-8035/light-policies-empty-header.png)

![light policy rest](https://raw.githubusercontent.com/open-mercato/open-mercato/qa-evidence-pr-8035-70cc8403b-20261027/pr-8035/light-policy-rest.png)

![light policy hover](https://raw.githubusercontent.com/open-mercato/open-mercato/qa-evidence-pr-8035-70cc8403b-20261027/pr-8035/light-policy-hover.png)

</details>

<details>
<summary>dark screenshots from exact-head CI (click to expand)</summary>

![dark claims empty header](https://raw.githubusercontent.com/open-mercato/open-mercato/qa-evidence-pr-8035-70cc8403b-20261027/pr-8035/dark-claims-empty-header.png)

![dark registrations empty header](https://raw.githubusercontent.com/open-mercato/open-mercato/qa-evidence-pr-8035-70cc8403b-20261027/pr-8035/dark-registrations-empty-header.png)

![dark guides empty header](https://raw.githubusercontent.com/open-mercato/open-mercato/qa-evidence-pr-8035-70cc8403b-20261027/pr-8035/dark-guides-empty-header.png)

![dark policies empty header](https://raw.githubusercontent.com/open-mercato/open-mercato/qa-evidence-pr-8035-70cc8403b-20261027/pr-8035/dark-policies-empty-header.png)

![dark policy rest](https://raw.githubusercontent.com/open-mercato/open-mercato/qa-evidence-pr-8035-70cc8403b-20261027/pr-8035/dark-policy-rest.png)

![dark policy hover](https://raw.githubusercontent.com/open-mercato/open-mercato/qa-evidence-pr-8035-70cc8403b-20261027/pr-8035/dark-policy-hover.png)

</details>
