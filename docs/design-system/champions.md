# P. Champions Strategy

> DS ambassador program: identification, recruitment, activation, retention, metrics.

---


### P.1 Champion Profile

**Ideal DS champion in the OSS context:**

**Technical traits:**
- Active in a module with a large UI surface (Sales, Catalog, Customers — not CLI/Queue)
- Has at least 5 merged PRs with backend page components
- Understands Tailwind and React at a level sufficient to refactor colors without assistance

**Soft traits:**
- Responds to issues / code review comments (not a ghost contributor)
- Has expressed frustration with UI inconsistency or dark mode bugs (this is natural motivation)
- Has an "ownership feeling" toward their module — wants it to look good

**How to find them in Open Mercato:**

```bash
# Top 10 contributors in backend page files (last 6 months)
git log --since="2025-10-01" --format="%aN" \
  -- "packages/core/src/modules/*/backend/**/*.tsx" \
  | sort | uniq -c | sort -rn | head -10

# Contributors who fixed colors/dark mode (motivation signal)
git log --since="2025-10-01" --all --oneline --grep="dark\|color\|theme" \
  -- "packages/core/src/modules/*/backend/**" | head -20

# Modules with the largest DS debt (migration targets)
for module in packages/core/src/modules/*/; do
  count=$(grep -r "text-red-\|bg-green-\|bg-blue-\|text-green-\|bg-red-" "$module" 2>/dev/null | wc -l)
  echo "$count $(basename $module)"
done | sort -rn | head -10
```

**What motivates them:**
- **Recognition:** Being listed as a DS champion in the changelog and README
- **Clean code ownership:** Their module is exemplary, not legacy
- **Influence:** Shaping component APIs instead of just consuming them
- **Learning:** Gaining design system experience in a real project

### P.2 Champion Program — concrete plan

#### 1. Identification (before hackathon)

**Criteria:** >=5 PRs with UI changes + activity in the last 3 months + module with >10 hardcoded status colors.

Run the commands from P.1. Select 3-5 people: ideally one from each of Sales, Catalog, HR/Workflows, Integrations.

#### 2. Recruitment (hackathon day)

**Message (GitHub Discussion mention or DM):**

> Hey @{username}, I see you maintain the {module} module — you've got a great {specific thing, e.g. "detail page with tabs"} there. We're working on design system foundations for Open Mercato and looking for 3-5 people to migrate their module first (after customers). What you get: your module becomes the reference example, you influence the API of new components (StatusBadge, FormField), and you get early access to tokens + codemod scripts that do 80% of the work automatically. Interested? The total effort is ~2h with codemod + 1h manual review. Hit me up if you want to discuss on a call or async.

#### 3. Champion onboarding (week 1)

What they receive:
- **Early access:** Branch `docs/design-system-audit-2026-04-10` with tokens and components, before it lands on main
- **15-min async walkthrough:** Loom recording (not a synchronous call — respect timezones) showing: (a) before/after demo from N.2, (b) how to use the codemod script, (c) how to verify the result
- **Their module as target:** Codemod script prepared to run on their module — the champion runs it, reviews, and commits

#### 4. Activation (week 2-3)

What they do:
- **Migrate their module** — run the codemod, review the diff, fix edge cases, create a PR
- **Review DS PRs:** Added as reviewers on PRs from other modules labeled `design-system` — they check token usage and component patterns
- **Feedback loop:** Report issues with component APIs, unclear token names, missing variants. Format: GitHub Discussion post "DS Feedback: {topic}" with a concrete example

#### 5. Recognition (ongoing)

- **Changelog mention:** "Module {name} migrated to DS tokens by @{champion}" in RELEASE_NOTES.md
- **CONTRIBUTORS.md:** "Design System Champions" section with a list of people and modules
- **GitHub label:** `ds-champion` on their contributor profile (if the project has such mechanisms) — in practice a mention in Discussion and changelog is sufficient

### P.3 First Follower Strategy

**Who to convince FIRST: the Sales module maintainer.**

Why Sales:
- **Largest UI surface after customers** — orders, quotes, invoices, shipments, payments. Many status badges (draft -> confirmed -> shipped -> paid -> cancelled).
- **Most hardcoded status colors** — each document type has a different color palette (quote = blue, order = green, invoice = amber). This is the most visible DS debt.
- **Success in Sales is spectacular** — changing status colors across 5 document types simultaneously delivers a wow effect. A before/after demo from the Sales module is 3x more convincing than one from a simple module.
- **The Sales maintainer is motivated** — dark mode in Sales is particularly broken (hardcoded colors on dark backgrounds in document tables).

**Which module migrates FIRST after customers: Sales.**

For the same reasons. Customers is the proof of concept (DS maintainers do it themselves). Sales is the proof of adoption (someone else does it with DS tools). This is the transition from "we did it" to "others can do it".

**How the first follower's success convinces others:**

1. The Sales champion creates a migration PR — visible in the activity feed
2. The PR includes before/after screenshots (dark mode fix = impressive)
3. Discussion post: "Migrated Sales to DS tokens — 47 hardcoded colors -> 0. Took 2 hours with codemod."
4. Other maintainers (Catalog, Workflows, Integrations) see: this is not theory, it's 2 hours of work with a concrete result
5. FOMO effect: "My module looks worse than Sales in dark mode. I should migrate."

Migration order after Sales: **Catalog** (products, variants, prices — many statuses), then **Workflows** (visual editor, status badges on steps), then the remaining modules organically.


---

## See also

- [Stakeholder Buy-in](./stakeholder-buyin.md) — organization-level strategy
- [Contributor Experience](./contributor-experience.md) — CX that champions promote
- [Research Plan](./research-plan.md) — research conducted with champion support
