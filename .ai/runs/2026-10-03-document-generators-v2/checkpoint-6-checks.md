🤖 `om-auto-continue-pr-loop` — checkpoint 6 verification (lightweight)

Steps 5.6–5.7 (cbc9d9275, 59d63226c) complete — Phase 5 closed. Runner: local, **reduced validation mode**: the user's machine froze under repeated full typecheck/build/generate runs, so from this point only the Step's own test files are executed; the full gate is deferred to an explicit user request.

| Check | Result |
|---|---|
| `generate` + `preview` route tests (single files, `--runInBand`) | ✅ 2 suites / 30 tests |
| `documents` route tests (single file) | ✅ 11 tests |
| Package typecheck / build / `yarn generate` / full suites | ⏸ deferred (reduced validation mode) |
| UI / browser verification | ⏭ skipped — no UI touched |

Review notes:
- `/generate`: access check before load; render → mutation guards (`create`, resource kind `document_generators.generated_document`, user features from `rbacService.getGrantedFeatures(auth.sub, selected scope)`) → `history.prepare` (fails closed, outside best-effort) → `persist` in best-effort try/catch (logged + reported) → isolated `afterSuccess` callbacks only after the row committed.
- `/documents`: missing organization answers `200` with an empty page; `invalid_query` uses the translated `{ error, message }` envelope.
