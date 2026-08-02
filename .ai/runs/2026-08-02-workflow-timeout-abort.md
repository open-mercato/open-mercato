# Abort synchronous workflow activities when their timeout wins

Carry-forward of the one behavior left over from #4502 (itself a carry-forward of
#4495) after #4460 landed the rest of the #4424 timeout fix on `develop`.

## Context

`#4424` reported that per-activity timeouts were unreachable: the editor wrote
`timeoutMs`, the definition schema accepted only `timeout`, and the executor read
`timeoutMs`. Two independent carry-forward PRs fixed it:

- **#4460 — merged 2026-07-30.** Landed the schema/editor/executor alignment plus
  `resolveActivityTimeoutMs()`, which normalizes the deprecated `timeout` string.
  Issue #4424 was closed by it.
- **#4502 — still open, conflicting.** Carries the same fix a second time, so it now
  conflicts with `develop` on `validators.ts`, `TransitionsEditor.tsx` and
  `activity-executor.ts`. Its head branch lives in the upstream repository, which
  this account cannot push to, so the conflicts cannot be resolved in place.

Exactly one behavior in #4502 is **not** on `develop`: when an activity timeout wins
the `Promise.race` in `executeWithTimeout()`, the in-flight HTTP request is left
running. `executeCallApi()` and `executeCallWebhook()` already accept an
`AbortSignal` and forward it to `fetch`, but nothing ever creates or passes one — so
a timed-out `CALL_API` / `CALL_WEBHOOK` keeps its request alive while the retry loop
issues the next attempt, and the remote endpoint can observe the same side effect
several times.

## Scope

Wire the missing signal and nothing else. The duplicate `timeoutMs` plumbing from
#4502 is deliberately dropped — `develop` already has it, and re-landing it is what
makes that PR conflict.

## Tasks

- [x] Confirm `#4460` merged and `#4424` closed, and diff `#4502` against `develop`
      to isolate the residual behavior
- [x] Create an `AbortController` in `executeWithTimeout()` and abort it in the
      timeout callback
- [x] Thread the signal through `executeActivityByType()` into `executeCallApi()`
      and `executeCallWebhook()`
- [x] Add a regression test proving a synchronous webhook receives an aborted signal
      when its timeout elapses
- [x] Run the validation gate
- [ ] Open the replacement PR superseding #4502 with credit to the original authors

## Progress

- **2026-08-02** — Isolated the residual delta, applied the abort wiring on top of
  `develop`, kept the single regression test from #4502 and dropped the tests that
  cover behavior `develop` already ships.
