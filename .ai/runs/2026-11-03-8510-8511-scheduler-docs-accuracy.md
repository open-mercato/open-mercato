# Execution plan — scheduler docs accuracy (#8510, #8511)

Refs: #8510, #8511 (follow-ups deferred from #7650)

## Goal

Make `apps/docs/docs/cli/scheduler.mdx` describe only behavior the CLI actually has: real `scheduler start` output, and only registered `mercato queue` subcommands — with a guard that keeps documented `queue` subcommands registered.

## Scope

- `apps/docs/docs/cli/scheduler.mdx` — `scheduler start` section (local and async output samples, options, examples) and the queue inspection snippets (Debugging, Monitoring, Queue Management).
- `packages/cli/src/__tests__/` — one focused Jest guard: every `mercato queue <subcommand>` written in `apps/docs/docs/**/*.mdx` resolves to a registered built-in `queue` command (checked side-effect free via `--help` through the real dispatcher).

## Non-goals

- No new runtime CLI commands (no `queue failed/history/pending/retry/clean`).
- No change to `packages/cli/src/mercato.ts` or `packages/scheduler/src/modules/scheduler/cli.ts`.
- `tail -f logs/scheduler.log` and the lock-acquisition troubleshooting entry stay as they are (proposed follow-up).

## Implementation Plan

### Phase 1: #8510 — scheduler start output

- 1.1 Replace the local and async `scheduler start` transcripts with the lines `cli.ts` prints; drop the unparsed `--poll-interval` / `--verbose` options in favor of `SCHEDULER_POLL_INTERVAL_MS`.

### Phase 2: #8511 — queue inspection commands

- 2.1 Replace `queue failed|history|pending|retry|clean` snippets with `queue status` (job counts incl. Failed), `queue worker`, `queue clear`.
- 2.2 Add the documented-queue-subcommand guard test.

### Phase 3: Validation

- 3.1 Run the configured validation gate.

### Phase 4: Independent review findings

Source: independent `om-code-review` pass on PR #8626 (head `bbbd74c91`).

- 4.1 Align `scheduler run` (arguments, output samples, exit codes) and the Exit Codes Reference with `cli.ts`; add bootstrap failure to `scheduler start` exit code 1; say where the queue-jobs `jobId` comes from.
- 4.2 Re-run the configured validation gate.
- 4.3 Apply the independent re-review findings (disabled-schedule skip, completed-run removal, exit-1 causes, best practice wording).

## Risks

- Docs build (MDX) must still pass — covered by `open-mercato-docs` build in `yarn test`.
- The guard reads the docs tree from the monorepo; it is a monorepo-only test (package tests do not ship to standalone apps).

## Progress

PR: #8695

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: #8510 — scheduler start output

- [x] 1.1 Replace scheduler start transcripts and options with actual CLI behavior — fcb195cce

### Phase 2: #8511 — queue inspection commands

- [x] 2.1 Replace unsupported queue subcommands with supported inspection paths — 72b7d3892
- [x] 2.2 Add documented-queue-subcommand guard test — 6c62e4e3f

### Phase 3: Validation

- [x] 3.1 Run the configured validation gate — local gate green

### Phase 4: Independent review findings

- [x] 4.1 Align scheduler run and exit-code docs with source — 5fbfbf679
- [x] 4.2 Re-run the configured validation gate — local gate green (docs OOM workaround)
- [x] 4.3 Apply independent re-review findings — af5129a60 (targeted: guard 2/2, docs test + build 24/24)

## Carry-forward

2026-11-04T15:36:40Z — carried forward from #8626 to #8695 by `om-auto-review-pr` autofix. Original implementation by @pgaluszk is preserved. Registered the documented queue-subcommand guard in the existing repo-wide guard manifest so docs-only changes run it. Narrow local verification: manifest tests 16/16, guard 2/2, registered-runner invocation and JavaScript syntax check pass; an unsupported queue command fails the guard.
