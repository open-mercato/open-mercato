# create-mercato-app — agentic wizard must survive a non-interactive shell

Status: complete

## Goal

Make `npx create-mercato-app <name>` complete without a TTY. Today it creates the app and then
dies on the agentic-setup prompt, so the agent tooling — the whole point of the scaffold for
CI and agent-driven use — is never installed.

## Problem

With stdin/stdout not a TTY:

```
   Enter number(s) separated by comma [1]: Warning: Detected unsettled top-level await at
   .../create-mercato-app/bin/create-mercato-app:28
   await cliModule.main();
```

Exit code **13**. The app directory exists, but `.ai/` contains only `qa` — no `.claude/`,
no `.ai/harness`, no `.ai/skills`.

Root cause: `packages/create-app/src/setup/wizard.ts` calls `ask()` unconditionally.
It has no `isTTY` check anywhere, while `src/index.ts` guards both of its own prompts that
way — the starter preset (line 212) and git init (line 259) — and falls back to a documented
default instead of prompting.

## Scope

Apply the same guard the sibling prompts already use: in a non-interactive shell, take the
default the prompt itself advertises (`[1]`, Claude Code), print a dim one-line notice naming
`--agents` for explicit control, and continue. `--agents` / `--skip-agentic-setup` keep
precedence and are unaffected — they bypass the prompt before this point.

## Non-goals

- No change to the interactive flow, to the tool list, or to what any tool generator writes.
- No change to `--agents` parsing or to the preset/git-init prompts.

## Implementation Plan

### Phase 1: Fix and regression test

- Guard `promptSelection` on `process.stdin.isTTY` / `process.stdout.isTTY`.
- Add a regression test asserting the non-TTY path resolves without invoking `ask`, and that
  an explicit selection still wins.

### Phase 2: Validation

- `packages/create-app` test suite and typecheck.

## Risks

- Choosing the advertised `[1]` default rather than skipping means a non-interactive scaffold
  now installs Claude Code tooling where it previously installed nothing (by crashing). That
  matches the documented default and the preset prompt's precedent; `--agents none` remains the
  way to opt out.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix and regression test

- [x] 1.1 Guard promptSelection on a non-interactive shell — 27216cc97
- [x] 1.2 Add the regression test — 27216cc97

### Phase 2: Validation

- [x] 2.1 create-app suite and typecheck — 112 pass / 4 pre-existing fail, typecheck clean
