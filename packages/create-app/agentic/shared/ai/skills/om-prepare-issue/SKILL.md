---
name: om-prepare-issue
description: Capture a feature the user wants built later without building it now. Researches and writes a spec via the om-spec-writing conventions, ships it as a docs-only spec PR against `develop` (reusing om-auto-create-pr mechanics; `skip-qa`, `documentation`), then opens a tracking GitHub issue that links the spec path and the spec PR so the work can be picked up later with om-auto-fix-github or om-implement-spec. Use for "park this idea", "write a spec and an issue for later", "prepare an issue to build X eventually", "spec it out but don't implement yet".
---

# Prepare Issue (deferred work)

Turn a "we want this eventually" brief into durable, actionable backlog without implementing it.

## When to use

- The user wants to **capture** a feature ("park this idea", "spec it out but don't implement yet") — you produce three linked artifacts, not a diff.
- Not for building the feature now — hand off to `om-auto-create-pr` (free-form task) or `om-implement-spec` (after the spec exists).
- Not for resuming an in-progress run — use `om-auto-continue-pr {prNumber}`.

## What it contains

A linear pipeline that produces three linked artifacts: (1) a **spec** under `.ai/specs/` written to `om-spec-writing` standards, (2) a **docs-only spec PR** against `develop` (`documentation`, `skip-qa`), and (3) a **tracking GitHub issue** linking the spec path and spec PR. It reuses the worktree/branch/commit/label discipline of `om-auto-create-pr`, the spec methodology of `om-spec-writing`, and the issue-claim/linking conventions of `om-auto-fix-github`.

## Arguments

- `{brief}` (required) — free-form description of the feature to capture. One sentence or several paragraphs.
- `--slug <kebab-case>` (optional) — override the slug used in the spec filename and branch. Default: derived from the brief.
- `--enterprise` (optional) — write the spec under `.ai/specs/enterprise/` instead of `.ai/specs/`. Default: OSS scope.
- `--priority <low|medium|high|extreme>` (optional) — priority label for the tracking issue. Default: unset (treated as `priority-medium`).
- `--no-issue` (optional) — write the spec and open the spec PR, but skip issue creation.
- `--force` (optional) — bypass the claim-conflict check when a previous run left a branch or spec file behind.

## Reference map — load what the task needs

| When | Load |
|------|------|
| Executing the run — pre-flight/claim, triage, write the spec, worktree + spec PR, tracking issue, cross-link, report | [`instructions.md`](instructions.md) |
| Spec methodology (skeleton-first, Open Questions gate, integration coverage) | [`../om-spec-writing/SKILL.md`](../om-spec-writing/SKILL.md) |
| Worktree/branch/commit/label discipline reused for the PR | [`../om-auto-create-pr/SKILL.md`](../om-auto-create-pr/SKILL.md) |

## Non-negotiables

- Captures deferred work only. NEVER implement the feature, write module code, or run migrations. The only file added is the spec.
- Write the spec to `om-spec-writing` standards, including the Open Questions hard gate and the integration-coverage section.
- The spec PR is docs-only: run only the docs-only validation gate, never the full code gate. Labels are `review`, `documentation`, `skip-qa` — never `needs-qa`.
- Base branch is always `develop`; branch uses the `feat/prepare-<slug>` prefix. The tracking issue MUST link the spec path and the spec PR. Never paste secrets into the spec, PR, or issue.
