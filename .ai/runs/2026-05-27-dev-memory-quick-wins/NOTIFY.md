# Notify — 2026-05-27-dev-memory-quick-wins

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-05-27T06:42:00Z — run started
- Brief: dev-mode memory quick wins; profile + measure 1–2 GB savings; pick one biggest win and ship as a PR; also evaluate Vite migration and implement phase 1 if it makes sense.
- External skill URLs: none
- Classification: spec-implementation run (multi-phase, spans research + script + spec).
- User clarification: confirmed "Vite" (not "vote").
- Sandbox constraint surfaced via `AskUserQuestion`; user declined to answer — proceeded with default: harness + spec + opt-in heap cap in one PR, no Vite migration (spec-only).
- Research subagents dispatched: (1) PR #2102 status, (2) memory hot-path map, (3) Vite feasibility. Findings synthesized into PLAN.md.
- Branch `feat/dev-memory-quick-wins` created from `origin/develop` (25fdb35f2).

## 2026-05-27T06:46:00Z — scope decision: descope `OM_PACKAGE_WATCH_HEAP_MB` runtime knob
- Implementing the re-exec inside `scripts/watch.mjs` would either (a) require editing each of 16 per-package wrappers to dynamic-import the helper before esbuild loads, or (b) detach the actual watcher from turbo's process tree (turbo sees the proxy parent exit first → breaks lifecycle).
- The pragmatic answer is `NODE_OPTIONS='--max-old-space-size=N' yarn dev` — propagates to every child Node process via env inheritance, zero code change. Will be documented in the spec.
- Tasks table updated: Phase 2 collapsed into one analysis spec phase. Phase 3 is now the final gate. Total Steps: 5 (1.1, 1.2, 2.1, 2.2, 3.1). Below the 5-Step checkpoint threshold, so only the final-gate checkpoint will fire.

## 2026-05-27T06:51:00Z — final gate complete
- Steps 1.1, 1.2, 2.1, 2.2 all committed and pushed.
- Sandbox checks all pass (node --check on 2 files; node --test 10/10; AGENTS.md size 36805 < 42000).
- CI-only checks (yarn typecheck/test/build/lint/integration suites) deferred — janitor sandbox has no node_modules. Risk analysis in final-gate-checks.md notes each deferred check carries low risk because no TS code, no UI, no DB, no contract surface was touched.
- ds-guardian: not applicable (no UI changes).
- Self code-review + BC self-review: clean (logged in final-gate-checks.md).
- Ready to open the PR.

## 2026-05-27T06:55:00Z — code-review autofix pass complete
- Lightweight code-review subagent dispatched (in lieu of full `auto-review-pr` worktree-based ceremony, which would be overkill for a docs+harness PR with no contract surface).
- Verdict: NO BLOCKERS. 4 NITs surfaced; 4 applied:
  1. `parsePsOutput` — added a "why" comment about embedded newlines.
  2. `parseArgs` — added positive-integer validation for `--duration`, `--interval`, `--pid` (silently kept defaults when bogus); new test covers it.
  3. `renderReportTable` — now orders by `startedAt` with alphabetic fallback, so the delta line is chronological (matches "did my change reduce memory?" intent); test updated, second test added for fallback path.
  4. `spawnDevAndProfile` — child spawned with `detached: true`; SIGINT/SIGKILL go to the process group via `process.kill(-pid, sig)` so turbo/watcher grandchildren actually exit.
- Tests: 12/12 pass (was 10/10).

## 2026-05-27T07:00:00Z — run complete
- PR #2104 opened: https://github.com/open-mercato/open-mercato/pull/2104
- Labels normalized: `review` + `skip-qa` + `documentation`.
- Comprehensive summary comment posted.
- About to release the `in-progress` lock as the final action.
