---
title: "Credit the author, not the merger, when generating a changelog"
modules: ["platform"]
areas: ["spec-pr","ai-workflow"]
topics: ["data-integrity","generated-files"]
---

# Credit the author, not the merger, when generating a changelog

**Context**: The `0.6.7` changelog credited `#4566` "implementation of WMS" to the maintainer who merged the `feat/wms` branch. The PR's 192 commits contained zero by that maintainer — 100 by the contributor and 92 by an AI agent — and the same work was listed a second time under its sub-PR `#1701`. Two more entries (`#4276`, `#4761`) credited maintainers who had written "Original author: @…" and "Carries the registry from #N" in the PR body.

**Problem**: `om-auto-update-changelog` resolves credit from the merged PR's `author` field, corrected only by the `Supersedes #N` / `Credit: original implementation by @user` templates that `om-auto-review-pr` writes. Those templates cover the carry-forward flow and nothing else. An umbrella PR merging a long-lived feature branch, or an informal hand-off written in prose, silently transfers a contributor's credit to whoever pressed the merge button — the most damaging error a changelog can contain, because it is published and attributed.

**Rule**: Never treat the merged PR's author field as the credited author without verification. Before assembling a release entry, tally each PR's commit authorship (excluding bots and AI agents: `[bot]`, `dependabot`, `renovate`, `app/*`, `web-flow`, `claude`, `cursoragent`, `copilot`, `codex`, `devin`) and hand-review every mismatch. A credited author with **zero** commits is correct only when a `Credit:` / `Supersedes` template is present; without one it is a bug. A PR author who wrote none of a large PR's commits is an umbrella merge — credit the dominant commit author, and coalesce the umbrella with its sub-PRs into one bullet instead of listing the work twice. Scan PR bodies for free-text attribution (`Original author:`, `Carries … from #N`, `credit to @…`, `took over`) that the templates do not cover, and make every such capture lazy (`.*?`) so a body that also pings a reviewer does not credit the bystander.

The same harm arrives through the *exclusion* filter, not only the credit resolver. `#3799` was dropped from the 0.6.7 entry because a bare `#3799` search matched a different bullet that merely mentioned it — `"Close template-sync gap that let PR #3799 ship unsynced. (#3802)"` — so a shipped feature lost both its line and its author's credit. Match the reference slot (the `(#N)` group at the end of a bullet, before the optional `*(@author)*`), never a bare number anywhere in the file, and justify every exclusion per PR in the changelog PR body so a reviewer can falsify it.

**Applies to**: `.ai/skills/om-auto-update-changelog/SKILL.md`, the shared `om-auto-update-changelog` and `om-auto-review-pr` skills, and any tooling that attributes work from tracker metadata rather than from commits.
