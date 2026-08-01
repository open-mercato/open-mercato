# Phase 3 — Synthesis (MD → summary + backlog) + the depth gate

The full Phase-3 procedure: read the now-complete MD, produce two derived artifacts, then pass the reporting-fidelity gate. Never re-derive findings from memory — always read the MD (this is what keeps it audit-friendly).

## Steps

1. **Aggregate stats**: total epics/stories, verdict distribution **split by license tier** (a `✅ (core)` and a `✅ (licensed)` are different promises to the client), the **criteria total** (sum the gate-verified `N/M` fractions across capability stories — the client-facing "how much of what you specified is already there", honest per the output contract because both numbers are counts), atomic-commit effort totals by verdict and by priority, stories blocked by dependencies, and `needs-review` count (surfaced separately, never folded into the distribution).
2. **Produce `<project>-summary.md`** (template below). Fold every PR that trips the significance trigger (additions ≥ `platform.significantPrAdditions`, or review state APPROVED / CHANGES_REQUESTED) into **Top risks** or **Open questions** — named and sized, with its review discussion from Phase 2 step 8 condensed to one line ("reviewer drove the flow end-to-end; narrow fixes pending" reads very differently from a bare open tag). Never leave a significant PR as a per-story field only a reader who opens every story block would see.
3. **Produce `<project>-backlog.md`** (template below) — a sequenced delivery plan; every item links its Story ID(s).
4. **Run the depth gate** — deterministic, read-only, after the summary exists:
   ```bash
   <skill-dir>/bin/gap-depth-check .ai/gap-analysis/<project>.md \
     .ai/tmp/om-gap-analysis/pipeline-snapshot-<project>.md \
     .ai/gap-analysis/<project>-summary.md \
     ${MIN_ADDITIONS:+--min-additions "$MIN_ADDITIONS"}
   ```
   - **exit 0** → every significant cited PR reached the summary. Proceed.
   - **exit 1** → the report names each unsurfaced PR, its size/review state, and the citing stories. Fix the summary (step 2) and re-run — the run does not pass until synthesis surfaces it. The gate only reads; it never touches a Verdict, Evidence, or Effort value.
   - **exit 2** → wrong/missing inputs; fail-closed, fix the invocation.
5. **Update source MD frontmatter**: `phase: complete`.
6. **Present all three files.** Phase 3 is idempotent — re-run freely.

## Summary template — `<project>-summary.md`

```markdown
---
project: <slug>
generated: <ISO date>
source: <project>.md
type: gap-analysis-summary
---

# Gap Analysis Summary — <Project Display Name>

> Verdicts are grounded against the platform's `<platform.branch>` branch<, N commits ahead of the release branch — some covered capabilities may not have shipped in a tagged release yet | when the orientation preflight reported the ahead-count; otherwise: which may include work not yet in a tagged release>.

## Executive summary
<2–3 plain-language paragraphs: how much already exists (and how much of that is free-core vs licensed), the biggest risks, the recommended start. May be read by a client stakeholder.>

## Coverage at a glance
| Verdict | Stories | Share | Effort (commits) |
|---|---|---|---|
| ✅ Implemented (core) | <n> | <n>/<total> | — |
| ✅ Implemented (licensed / companion) | <n> | <n>/<total> | — |
| 🟡 Partial | <n> | <n>/<total> | <sum> |
| ❌ Missing | <n> | <n>/<total> | <sum> |
| ⚠️ Unclear | <n> | <n>/<total> | <sum> |

<!-- Share is N/total, never a bare percentage — the output contract forbids it.
     The tier split keeps the headline honest: coverage that carries a license
     cost is never blended into the free-core number. Split 🟡 rows by tier too
     when the run has both. -->
**Acceptance criteria covered**: <sum covered>/<sum total> across all capability-verdict stories (gate-verified per story).
**Total effort to close gaps**: <sum> atomic commits across <k> stories.

## Coverage by epic
| Epic | Implemented | Partial | Missing | Unclear | Notes |
|---|---|---|---|---|---|
| 1. <name> | <n> | <n> | <n> | <n> | <one-line takeaway> |

## Top 5 risks
Each cites a Story ID, why it matters, and what unblocks it. Prefer P0+❌, then P0+🟡, then P1+❌ with downstream deps. Don't pad to 5. A significant open PR (large or human-reviewed) that a story's coverage depends on belongs here, named and sized — e.g. "most of Epic 3 sits in companion PR #29 (+60k additions, CHANGES_REQUESTED — reviewer calls it close): adopting it vs building is the engagement's biggest fork."

## Recommended sequencing
<Which epics first and why, referencing dependencies. Concrete.>

## What's already strong
<What the platform already covers — frames the engagement positively. Note the tier where it matters: "covered, in the licensed overlay" is a scoping fact.>

## Open questions
<⚠️ Unclear stories, scoping assumptions the client should confirm, and significant open PRs whose adopt-vs-build decision is the client's.>
```

## Backlog template — `<project>-backlog.md`

```markdown
---
project: <slug>
generated: <ISO date>
source: <project>.md
type: gap-analysis-backlog
---

# Implementation Backlog — <Project Display Name>

> Grouped into delivery phases by dependency order. Effort tags are atomic-commit scores (same currency as the gap analysis).

## Phase A — Foundation
<Stories whose absence blocks everything else. Usually P0 + ❌/🟡, no deps.>

### A.1 — <Item title>
- **Stories**: <1.1, 1.2>
- **Verdict context**: ❌ Missing
- **Effort**: <0–5>
- **Scope flag**: <app | platform | companion | external — FLAG platform/companion: those are upstream contributions needing an upstream PR + approval before this phase can ship>
- **Dependencies**: none
- **Outcome**: <what's true when done>
- **Implementation notes**: <condensed suggested path from the MD>

## Phase B — Core capabilities
## Phase C — Differentiation & polish
## Out of scope (for now)
## Cross-cutting work

## Effort roll-up
| Phase | Items | Effort (commits) |
|---|---|---|
| A — Foundation | <n> | <sum> |
| B — Core | <n> | <sum> |
| C — Polish | <n> | <sum> |
| Cross-cutting | <n> | <sum> |
| **Total** | **<n>** | **<sum>** |
```

## Cross-check before writing files

- Every Story ID in the backlog exists in the source MD.
- Stories across phases (A+B+C+out-of-scope) = total minus `✅ Implemented` needing no work.
- Effort totals in the summary equal the backlog roll-up.

If anything doesn't add up, surface it as a footnote — never silently fudge.
