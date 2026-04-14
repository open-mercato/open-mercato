# S. Success Metrics Beyond Code

> Human metrics: adoption, onboarding time, satisfaction, PR review, community health.

---


### S.1 Contributor Experience Metrics

#### 1. Time to First DS-Compliant PR

| | |
|---|---|
| **How to measure** | Timestamp of the first UI-related commit -> timestamp of merge. Filter: PRs from new contributors (<=3 prior PRs) modifying `backend/**/*.tsx` files. |
| **Baseline** | Unknown — measure retrospectively from git log (last 5 new contributor PRs). Estimate: 3-5 days (including review rounds). |
| **Target** | <=2 days (including review). |
| **Cadence** | Per PR (automatic via git log), summarized monthly. |
| **Command** | `git log --format="%H %aI" --diff-filter=A -- "packages/core/src/modules/*/backend/**/*.tsx" \| head -20` |

#### 2. Review Rounds per UI PR

| | |
|---|---|
| **How to measure** | Count "changes requested" reviews on PRs modifying `backend/**/*.tsx`. Use GitHub API: `gh pr list --search "review:changes-requested" --json number,reviews`. |
| **Baseline** | Estimate: 2-3 rounds (based on audit findings — 372 hardcoded colors = many review comments). |
| **Target** | <=1 round (lint rules catch mechanical issues, reviewer checks logic). |
| **Cadence** | Monthly aggregate. |

#### 3. DS Component Adoption Rate

| | |
|---|---|
| **How to measure** | % of new `page.tsx` files (added in the last 30 days) importing >=3 DS components from the list: Page, PageBody, DataTable, CrudForm, EmptyState, StatusBadge, LoadingMessage, FormField. |
| **Baseline** | ~20% (estimate from audit — most pages don't use EmptyState, StatusBadge). |
| **Target** | 80% after 3 months, 95% after 6 months. |
| **Cadence** | Monthly. |
| **Command** | `git log --since="30 days ago" --diff-filter=A --name-only -- "**/backend/**/page.tsx" \| xargs grep -l "EmptyState\|StatusBadge\|LoadingMessage" \| wc -l` |

#### 4. DS Bypass Rate

| | |
|---|---|
| **How to measure** | Count lint warnings `om-ds/*` on new files in CI. New files = added in this PR (not legacy). |
| **Baseline** | N/A (lint rules don't exist yet). First measurement after hackathon. |
| **Target** | <5% of new files with DS warnings after 1 month. 0% after 3 months. |
| **Cadence** | Per CI run (automated), summarized weekly. |

#### 5. Contributor Satisfaction (qualitative)

| | |
|---|---|
| **How to measure** | Quarterly GitHub Discussion survey (3 questions — section S.2). |
| **Baseline** | First survey = baseline. |
| **Target** | Score >=7/10 on the quantitative question. |
| **Cadence** | Quarterly. |

### S.2 Quarterly Contributor Survey

**Format:** GitHub Discussion, category "Design System Feedback", pinned for 2 weeks.

**3 questions:**

1. **(Quantitative)** "On a scale of 1-10, how easy is it to build a new UI screen in Open Mercato using the current components and documentation?"

2. **(Qualitative)** "In 1-2 sentences, describe the last time you were building UI and didn't know which component or token to use."

3. **(Actionable)** "If we could change one thing about the design system — what would help you most?"

**Template for summary:**

```markdown
## DS Survey Q[N] 2026 — Summary

**Responses:** [N]
**Avg score (Q1):** [X]/10 (prev: [Y]/10, delta: [+/-Z])

### Top themes (Q2 — friction points):
1. [theme] — mentioned by [N] respondents
2. [theme] — mentioned by [N] respondents

### Top requests (Q3 — what to change):
1. [request] — mentioned by [N] respondents
2. [request] — mentioned by [N] respondents

### Actions taken:
- [concrete action based on feedback]
- [concrete action based on feedback]

### Deferred (and why):
- [request] — deferred because [reason]
```

### S.3 Leading vs Lagging Indicators

| Metric | Type | Why | How to respond |
|---------|-----|----------|--------------|
| **DS Bypass Rate** (S.1.4) | Leading | Increase = contributors are actively bypassing the system. Problem NOW, before hardcoded colors appear in the codebase. | Immediately: investigate why they bypass (missing component? bad API? unaware?). |
| **Review Rounds** (S.1.2) | Leading | Increase = DS is not eliminating mechanical issues. Reviewers still catch colors/spacing manually. | Within a week: check lint rule coverage, add missing rules. |
| **Hardcoded colors count** (F) | Lagging | This is a state measurement — it drops only when someone actively migrates. Doesn't signal new problems, confirms old ones. | Monthly trend. If not dropping — no migration activity. |
| **Arbitrary text sizes** (F) | Lagging | Same as above. | Monthly trend. |
| **Empty state coverage** (F) | Lagging | Coverage metric — grows slowly with new pages and migrations. | Monthly trend. |
| **DS Adoption Rate** (S.1.3) | Leading | Low = new pages built without DS. Problem grows with every new module. | Immediately: are templates easy to find? Are lint rules working? |
| **Time to First PR** (S.1.1) | Leading | Increase = DS is not speeding up onboarding. | Within 2 weeks: observe a new contributor (Q.3), identify friction. |
| **Contributor Satisfaction** (S.1.5) | Lagging | Quarterly retrospective of the current state. Doesn't signal problems in real-time. | Quarterly trend. If declining — deep dive into qualitative answers. |

**Principle:** React to leading indicators within a week. Review lagging indicators on a monthly/quarterly trend basis.


---

## See also

- [Metrics](./metrics.md) — technical metrics (health check)
- [Research Plan](./research-plan.md) — data collection methods
- [Iteration](./iteration.md) — how metrics inform the roadmap
