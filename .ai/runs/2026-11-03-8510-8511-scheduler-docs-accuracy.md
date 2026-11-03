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
- Exit-code tables elsewhere in the page are not reworked (separate concern, not requested).

## Implementation Plan

### Phase 1: #8510 — scheduler start output

- 1.1 Replace the local and async `scheduler start` transcripts with the lines `cli.ts` prints; drop the unparsed `--poll-interval` / `--verbose` options in favor of `SCHEDULER_POLL_INTERVAL_MS`.

### Phase 2: #8511 — queue inspection commands

- 2.1 Replace `queue failed|history|pending|retry|clean` snippets with `queue status` (job counts incl. Failed), `queue worker`, `queue clear`.
- 2.2 Add the documented-queue-subcommand guard test.

### Phase 3: Validation

- 3.1 Run the configured validation gate.

## Risks

- Docs build (MDX) must still pass — covered by `open-mercato-docs` build in `yarn test`.
- The guard reads the docs tree from the monorepo; it is a monorepo-only test (package tests do not ship to standalone apps).

## Progress

PR: #8626

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: #8510 — scheduler start output

- [x] 1.1 Replace scheduler start transcripts and options with actual CLI behavior — fcb195cce

### Phase 2: #8511 — queue inspection commands

- [x] 2.1 Replace unsupported queue subcommands with supported inspection paths — 72b7d3892
- [x] 2.2 Add documented-queue-subcommand guard test — 6c62e4e3f

### Phase 3: Validation

- [x] 3.1 Run the configured validation gate — local gate green
