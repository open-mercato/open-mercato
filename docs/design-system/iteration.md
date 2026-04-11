# T. Iteration & Feedback Mechanism

> DS lifecycle: sprints, feedback channels, RFC process, versioning, deprecation.

---


### T.1 DS Retrospective — 2 weeks after hackathon

**Target date:** ~April 25, 2026 (Friday)
**Duration:** 30 minutes
**Participants:** DS lead + 2-3 champions (section P) + 1-2 contributors who built UI in the last 2 weeks

**Agenda:**

| Min | Block | What we do |
|-----|------|-----------|
| 0-5 | **Data review** | Results of `ds-health-check.sh` vs baseline from hackathon. How many hardcoded colors removed? How many modules migrated? Adoption rate of new components. |
| 5-10 | **What worked** | Each participant: 1 thing that worked well. E.g. "codemod script saved me an hour", "lint warning saved me from a hardcoded color". |
| 10-20 | **What didn't** | 3 questions below. This is the most important part — 10 minutes, not 5. |
| 20-25 | **Token/component feedback** | Specific API issues: "StatusBadge is missing variant X", "token name Y is confusing", "FormField orientation doesn't work with Z". |
| 25-30 | **Next iteration** | 3 actionable items for the next 2 weeks. Recorded in a GitHub Discussion post. |

**3 questions for "what didn't" (designed to elicit the truth):**

1. **"In the last 2 weeks, did you ever bypass a DS guideline — e.g. use a hardcoded color or skip EmptyState? If so — why?"**
   Goal: Discover *why* people circumvent the system. Reasons: didn't know? Too hard? Missing variant? In a rush? Each answer leads to a different action.

2. **"Is there a component or token you looked for and couldn't find — and had to create a workaround?"**
   Goal: Discover gaps in the DS. Maybe a StatusBadge variant is missing. Maybe a border token for a context not covered by status colors is needed. This becomes the TODO list for iteration 2.

3. **"If you could reverse one DS decision — what would it be?"**
   Goal: Catch decisions that looked good on paper but don't work in practice. If 2/3 say "flat tokens have too many names" — consider simplifying. If they say "lint rules are too aggressive" — consider switching to warn.

### T.2 Feedback Channels — ongoing

#### 1. GitHub Label: `design-system`

| | |
|---|---|
| **What to tag** | Every issue, PR, or discussion related to DS: migrations, new components, token changes, lint rules |
| **Who monitors** | DS lead (you). Weekly scan: `gh issue list --label design-system` + `gh pr list --label design-system` |
| **Cadence** | Continuous. Weekly review. |
| **What we do with feedback** | Triage: bug (fix in the current sprint), feature request (add to DS backlog), question (answer + update docs if the question recurs) |

#### 2. GitHub Discussion: "Design System Feedback"

| | |
|---|---|
| **What goes here** | Questions ("should I use Alert or Notice?"), proposals ("I need variant X"), frustrations ("token naming is confusing") |
| **Who monitors** | DS lead + champions. Champions answer simple questions, escalate non-trivial ones. |
| **Cadence** | Response within <=48h (OSS standard). |
| **What we do with feedback** | FAQ: if a question recurs (>=3 times) — add it to DS.md. Proposal: if popular — DR + implementation. Frustration: investigate, acknowledge, fix or explain. |

#### 3. PR Review Comments: tag `[DS]`

| | |
|---|---|
| **What it is** | Reviewer adds a `[DS]` prefix to design system comments: `[DS] Use text-destructive instead of text-red-600` |
| **Who monitors** | DS lead. Monthly grep: `gh api search/issues -f q="[DS] repo:open-mercato/open-mercato"` |
| **What we do** | Recurring `[DS]` comments on the same topic -> new lint rule or docs update. E.g. if 5 PRs have the comment "[DS] missing EmptyState" and `require-empty-state` is `warn` — consider switching to `error`. |

#### 4. Monthly DS Digest

| | |
|---|---|
| **Format** | GitHub Discussion post, 5 bullets max |
| **Structure** | 1. Migrated modules (this month). 2. New tokens/components. 3. Top lint violations (trending). 4. Decisions made (link to DR). 5. Next month priorities. |
| **Who writes** | DS lead |
| **Cadence** | First week of month |
| **Why** | Gives contributors context without forcing them to follow every PR. A 2-minute read once a month. |

### T.3 Version Strategy

**Semver for DS: NO.** DS is part of the monorepo — versioned together with `@open-mercato/ui`. A separate DS version is overhead with no benefit in a monorepo. Changes to tokens/components go into the standard `RELEASE_NOTES.md` with a `[DS]` tag.

**Deprecation policy:** >=1 minor version between deprecated and removed. Consistent with `BACKWARD_COMPATIBILITY.md`. Specifically:
- Deprecated component (e.g. Notice): add `@deprecated` JSDoc + runtime `console.warn` in dev mode
- Bridge: re-export from the new location or wrapper
- After 1 minor version: remove from codebase, update migration guide

Same policy as Notice -> Alert (section 1.14 of the audit): deprecation announced -> bridge period -> removal.

**Changelog:** Every DS change goes into `RELEASE_NOTES.md` with a `[DS]` prefix:
```
## [DS] Semantic status tokens added
- 20 new CSS custom properties (--status-{error|success|warning|info|neutral}-{bg|text|border|icon})
- Light and dark mode values with WCAG AA contrast
- Migration: see packages/ui/decisions/DR-001.md
```

**Migration guides:** Every breaking change gets a migration guide in the format of section J (mapping table + codemod script). Who writes it: the person introducing the breaking change (enforced via PR template checkbox). Template: section J of this document.

### T.4 "Good Enough" Permission

> **Our design system doesn't have to be perfect. It has to exist.**
>
> 30% adoption in the first month is a success — it means new modules are being built consistently, even if legacy hasn't migrated yet. Tokens can change — that's why they're tokens and not hardcoded values. If a component API turns out to be bad after 2 weeks of use, we change it — we have a deprecation policy and codemod scripts for exactly these situations. Consistency is more important than perfection: 34 modules using a "good enough" token is better than 3 modules with an ideal palette and 31 with hardcoded colors. This design system is a product — and products iterate.
>
> Build, measure, improve. In that order.


---

## See also

- [Metrics](./metrics.md) — KPIs measured each sprint
- [Success Metrics Beyond Code](./success-metrics-cx.md) — human metrics
- [Decision Log](./decision-log.md) — decision registry from iterations
- [Research Plan](./research-plan.md) — research informing iteration
