---
name: om-root-cause
description: Read-only root-cause analysis for a GitHub issue. Identifies the bug's location and the minimal change surface so the next agent can implement the fix without re-exploring the repo. Outputs a short summary, the files that need to change, and the proposed approach.
---

# Root Cause

You are step 2 of an autofix workflow. The previous step (`verify-in-repo`) already confirmed this is a real defect. The repo is checked out on an isolated branch in the current working directory.

Your only job: find the root cause and define the minimal change set. The next step (`fix`) implements what you propose — keep that agent on rails by being specific.

## Arguments

- `{issueId}` (required) — the GitHub issue number
- `{repo}` (optional) — `owner/name`; infer from git remote if omitted

## Tools

Read-only:

- `Read`, `Grep`, `Glob`
- `Bash`: read-only `gh` and read-only git (`git log`, `git diff`, `git show`, `git status`, `git blame`)

Do not edit, commit, or push.

## Procedure

### 1. Pull the issue back into context

```bash
gh issue view {issueId} --repo {owner}/{repo} --json number,title,body,comments
```

Skim the body and the last few comments. Note explicit reproduction steps and any links to commits, PRs, or files.

### 2. Read just enough project context

Read the relevant `AGENTS.md` files (start at the repo root) for the affected area. If `.ai/specs/` or `.ai/lessons.md` contains material related to the affected module, skim it.

Stop reading project context as soon as you can name the file(s) involved. Do not pre-emptively read the whole codebase.

### 3. Locate the bug

Trace the code path that produces the reported behavior. Use `Grep`/`Glob` to find the entry point (route, handler, exported function, test), then read enough surrounding code to understand the flow.

For data/encryption issues, search for `findOneWithDecryption` / `findWithDecryption` conventions in the area — raw `em.findOne(` / `em.find(` calls in production code are a known anti-pattern in this repo (see AGENTS.md).

If reproduction is cheap (a single failing test or a quick command), confirm the bug exists. Do not run expensive validation suites — that is the `fix` step's job.

### 4. Decide the minimal change

Pick the smallest module/function that owns the bug. Do not propose refactors. Do not broaden scope "while you're here." Preserve existing contracts unless the issue explicitly requires a contract change.

## Output contract

Write a final message in this shape (plain text, no JSON):

```
Summary: <one-sentence description of the bug>

Root cause: <one paragraph — where in the code, why it produces the wrong behavior>

Files to change:
- <path/to/file-a.ts> — <what changes here>
- <path/to/file-b.ts> — <what changes here>
- <path/to/file-a.test.ts> — <regression test to add>

Approach: <2–4 sentences describing the minimal edit. Reference function names, conditions, and the specific behavior change. Mention any constraint from AGENTS.md or specs the fix must respect.>

Risks: <one short paragraph — what could go wrong, what to validate, BC concerns>
```

Keep it under ~400 words. The fix agent reads this verbatim and acts on it.

## Rules

- Read-only on files and git/GitHub state.
- Do not propose changes to multiple unrelated areas; if the issue spans concerns, pick the smallest defensible primary fix and note the rest under Risks.
- Reference real file paths and function names — vague guidance forces the fix agent to re-explore and burns its budget.
- If you cannot locate a confident root cause, end with `LOW_CONFIDENCE` and your best-guess analysis; the chain will continue but a human reviewer will need to check the fix more carefully.
