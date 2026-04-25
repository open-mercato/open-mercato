# WIC Assessment Guide (Agentic Workflow)

This document defines the process for calculating **Wildly Important Contribution (WIC)** for Open Mercato, written to be consumed directly by a Language Model (AI Agent).

The process no longer relies on hard-coded JS. Instead, the Agent fetches raw data via a fetcher tool and then analyses it "by eye" using the rules below.

**CRITICAL DETERMINISM RULE:** As the evaluating Agent you must be 100% objective, impartial, and repeatable. Your job is **strictly** to apply the scoring algorithm below to the provided dump. You must not invent new rules, change the point weights, or favour contributions that do not strictly match a row in the scoring table. If the dump is identical, your report MUST be identical to the previous run. Before awarding each point, prove in the logic columns which row of the table the WIC is drawn from.

## Step 1: Fetch the WIC Data

Always start by freezing the GitHub contribution dump via the in-repo wrapper:

`bash .ai/skills/wic-evaluator/scripts/freeze_fixture.sh --profiles <logins> --from <YYYY-MM-DD> --to <YYYY-MM-DD> --output <path>`

The default format is markdown. If you need the full, non-reduced view (recommended for deterministic replay), add `--format json` and save the file with a `.json` extension.

Then read the generated file carefully. It contains every Pull Request and Issue for the profiles under review, including related comments, reviews with `authorAssociation`, changed files, and active `Bounty` tasks.

## Step 2: Agent Analysis

Your job is to classify every meaningful piece of work by the given person into a WIC score using the key below. Always group logically connected PRs and Issues into a single _Feature_ (e.g. spec + implementation).

### What is a WIC

A WIC is a meaningful contribution that genuinely moves the platform forward.

### Common Rejections and Exclusions

- If the code change is small and has no real architectural weight (e.g. a few changed lines, routine package fixes, dependency updates) -> **reject it (0 pts, Routine Maintenance)**.
- If a PR was opened but closed without merging, reject it — unless the dump contains an explicit Core Team approval signal (a review with `state: "APPROVED"` from a user whose `authorAssociation` is `MEMBER`, `OWNER`, or `COLLABORATOR`, or an equivalent accepting comment) -> **otherwise reject.**
- Work split across several PRs for the same problem (e.g. SPEC-xyz) gets one score — the highest applicable.

### Deterministic Grouping Rules

- Group only those PRs and Issues that are **explicitly** linked in the dump itself.
- An explicit link means at least one of the following signals:
  - the same spec / issue / bounty identifier in the title or body
  - a direct cross-reference from one artifact to another in visible dump text
  - an obvious "spec + implementation" chain described verbatim in the dump
- Do not combine several unrelated small fixes into one Feature just because they share the same month or the same author.
- If the link is not explicit in the dump, score the artifacts separately.
- If, after separate scoring, several small fixes each score `0.25`, sum them into `WIC Score`, but **do not** fabricate a single synthetic Feature from them and **do not** raise `WIC Level`.

### Base Scoring Table

| Contribution type | WIC Level | Base points |
| :--- | :--- | :--- |
| **Complete Core Module** (major infrastructure change) | L4 | 1.0 |
| **New Feature / Spec + Implementation** (new, comprehensive feature with a spec) | L4 | 1.0 |
| **Major PoC / Industry Prototype** (large working research concept) | L2 | 1.0 |
| **Comprehensive Feature Spec** (a large, substantial spec for a new feature on its own) | L3 | 0.5 |
| **Complex Bug / Deep Refactor** (large multi-file refactor, hard bugs) | L1 | 0.5 |
| **Restoration / Small Hardening / Accepted Bug Report** (simple bugs and small improvements) | L1 | 0.25 |
| **Routine maintenance** | - | 0.0 |

### "Accepted Bug Report" Rule

- A closed Issue on its own is not enough for `Accepted Bug Report`.
- An Issue-only artifact can score `0.25` only when **the visible dump** contains an explicit acceptance signal — e.g. an accepting comment, an APPROVED review, or a clear link to a merged fix that resolves the same problem.
- If no such signal is visible in the dump, treat the Issue as **insufficient evidence** and award `0`.
- Do not assume hidden acceptance "because the issue looks important".

### Impact Bonus (Impact Score)

Judge the *breadth* of the contribution as a human — if the implementation of a new feature was huge, contained thousands of lines of code, complete E2E / Unit tests, and touched many modules, you may add to the base score **+0.25 for large Scope and +0.25 for thoroughness (e.g. E2E/Unit test coverage)**. (Max Impact is `+0.5`.)

### Bounty Bonus (Multiplier)

If the data dump contains an active `Bounty` task, you must carefully evaluate whether the author's submitted PR was *intentionally written to fulfil that specific Bounty*.

- Judge the business intent — even if the keywords look similar (e.g. "optimization"), ask whether the PR actually delivers on the bounty's promise.
- Do not add the Bounty bonus for entirely new, huge features if the bounty is about DRY/refactoring.
- When you award a Bounty, multiply the final contribution score (Base + Impact) by **1.5**. The resulting delta is recorded as `Bounty Bonus`.

## Step 3: Produce the Final Report

Publish the analysis as the exact markdown table below, using these columns with no renaming. One row per person per month; the `WIC Level` is the highest level achieved.

### Monthly `WIC Level` Rule

- The monthly `WIC Level` is **the maximum level across included, scored Features after base classification**.
- `Impact Bonus` and `Bounty Bonus` **never** raise `WIC Level`; they only change `WIC Score`.
- A sum of many small `L1` items does not raise the level to `L2`, `L3`, or `L4`.
- If there is no scored work in the month, write `-`.
- If the highest-classified included work is `L3`, the monthly `WIC Level` must be `L3` even if total points exceed `1.0`.

| Person | GH profile | Month | WIC script version | WIC Score | WIC Level | Bounty bonus | Why bonus | What we included and why? | What we excluded and why? |
|---|---|---|---|---:|---|---:|---|---|---|
| Name | github_login | YYYY-MM | 1.0-agent | *[Sum of Base+Impact+Bounty across all scored work]* | *[Max achieved L]* | *[Sum of points from the Bounty multiplier only]* | *[Bounty title, if granted]* | *[Briefly describe work A: level, base, +impact, PRs; work B: ...]* | *[Rejected items with reason (e.g. routine maintenance)]* |

**Final recommendation:** When you have finished the calculation and are second-guessing the outcome, ask yourself as the AI reviewer: *If this person had only done this one thing for us this month, would it genuinely push the project forward?* If the objective answer is yes — keep the full score. If you have doubts — cut it down to `0.25`. Never award points for "good intentions" or concept-only work, unless the table explicitly allows it (e.g. *Comprehensive Feature Spec*). If the code is unmerged and there is no explicit Core Team approval, that PR scores `0`. When interpretation is ambiguous, pick the more conservative classification and the narrower grouping.
