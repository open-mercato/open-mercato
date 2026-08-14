# Execution plan — keep automated-principal identity on command-bus audit entries without narrowing the actor contract (adopted from PR #5277)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-14 because PR #5277 carried no execution plan (the original `om-auto-fix-issue` chain opened the PR through `om-open-pr`, which writes no `Tracking plan:` line).
**PR:** #5277 · **Branch:** `fix/issue-4732-command-bus-audit-system-actor` · **Base:** `develop`
**Author:** @Paul-Mlodochowki — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal
Command-bus audit entries written outside a request must record *which* automated principal performed the mutation, **without** changing what is stored for any actor value the `actionLogCreateSchema` contract already accepts.

## Scope
- `packages/core/src/modules/audit_logs/services/actionLogService.ts` — the `sanitizeActor` pre-validation step and the module-level actor helpers.
- `packages/core/src/modules/audit_logs/services/__tests__/actionLogService.test.ts` — regression coverage for the boundary this change moves.
- The PR body's `What Changed` / `Tests` / `Breaking Changes` sections, which currently assert two claims the review measured to be false.

## Non-goals
- The dedicated `system_source` column suggested by issue #4732 — it needs a migration plus entity/API/UI changes and stays a future decision.
- Making `context.systemActor` queryable (list-API filters, grid column, encryption-map exemption) — a follow-up once the column decision is made.
- `AccessLogService` (`services/accessLogService.ts:322-336`), which carries the same actor pattern on the read-logging path — its own issue.

## Evidence
| Conclusion | Drawn from | Confidence |
|---|---|---|
| The goal is to preserve automated-principal attribution on command-bus audit entries | Issue #4732 title and body; PR #5277 `## 🎯 Goal` | high |
| The current head narrows the actor contract: `UUID_REGEX` (v1–5) is stricter than `z.string().uuid()` (v1–8 + nil + max) | `om-auto-review-pr` review by @pkarw, blocker 1, with measured before/after table against `origin/develop` | high |
| The nil UUID is a live input class, not a contrived one | `packages/scheduler/src/modules/scheduler/lib/commandContext.ts:5,17` — `SCHEDULER_SYSTEM_ACTOR_ID` is `auth.sub` for every schedule without `createdByUserId` (verified in the worktree) | high |
| Undo/redo of scheduler-originated actions would start returning HTTP 400 | Review blocker 2; `api/audit-logs/actions/undo/route.ts:92`, `redo/route.ts:96` resolve `target.actorUserId ?? auth.sub` and the lookups filter strictly on `actorUserId` | high |
| "not a UUID ⇒ system actor" persists malformed subjects as authoritative attribution | Review major 3, measured: actor `'not-a-uuid'` yields `context_json = {"systemActor":"not-a-uuid"}` where `develop` yielded `null` | high |
| The existing suite cannot see either blocker | Review gate table: `audit_logs` 83/83 and `@open-mercato/core` 9625/9625 green on the unfixed head | high |
| Two PR-body claims are unfounded as written | Review minors 5 and 6, each with a measured counter-example | high |

## Assumptions
- **The reviewer's first suggested remedy is the intended one:** keep the sentinel in `actor_user_id` rather than teaching undo/redo to cope with a null actor. It is the smaller change, it closes both blockers at once, and it is the more reversible of the two. Contradict this by saying so on the PR.
- **`system:` is the recognized synthetic-actor shape.** It is the convention issue #4732 itself uses (`system:<module>`) and it mirrors the existing `API_KEY_ACTOR_PREFIX` handling. Anything else keeps `develop`'s behavior of being dropped.
- **A widened regex mirroring zod's accepted set is an acceptable fallback for the schema predicate,** used only when the zod runtime is unavailable — the file already handles that case explicitly via `isZodRuntimeMissing` / `runtimeValidationAvailable`, and calling `uuid.safeParse` unguarded would reintroduce that failure mode inside the sanitizer.
- **255 characters is a defensible cap** for the stored `systemActor` string: long enough for every `system:<module>:<detail>` identifier in the repo, short enough that a corrupted subject cannot bloat an encrypted JSON column.

## Risks
- The actor predicate sits on the write path of every audited command, so an error here silently mis-attributes an audit trail rather than failing loudly. Mitigated by pinning each input class (v4, v7, nil, max, `api_key:`, `system:`, garbage) with an explicit test.
- The fix deliberately *reverts* part of the current head's behavior. Reviewers reading only the latest diff may read that as a regression; the summary comment states the before/after explicitly.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Add a `sanitizeActor` pre-validation step preserving the synthetic actor under `context.systemActor`, fold the duplicated actor helpers to module level, and cover the `system:<module>` path with four unit tests — 0fa8d28ed

### Phase 2: Close the two blockers — stop narrowing the actor contract

- [x] 2.1 Derive the actor with the same predicate the schema uses, so nil / v6–v8 / max UUID actors keep `actor_user_id` and `source_key` (closes blocker 1, and with it blocker 2's undo/redo 400) — 3dd1c2bef
- [x] 2.2 Gate the system branch on the recognized `system:` shape with a bounded stored length, so a malformed subject is dropped as before rather than persisted as authoritative attribution (major 3); trim the actor once at the top of `sanitizeActor` (nit 7) and document how `context.systemActor` relates to `context.source` (nit 8) — 3dd1c2bef

### Phase 3: Pin the boundary this change moves

- [x] 3.1 Add regression tests for the nil UUID (`SCHEDULER_SYSTEM_ACTOR_ID`), a UUIDv7 actor, the max UUID, and a garbage actor — each asserting `actorUserId`, `sourceKey`, and `contextJson` (major 4) — 3dd1c2bef

### Phase 4: Correct the PR's own claims

- [ ] 4.1 Replace the unfounded tenant/org-id benefit with the real one (`validationWarningLogged` is a module-global one-shot that system actors used to burn), and state the `context.systemActor` queryability trade-off honestly instead of claiming immediate UI visibility (minors 5 and 6)

### Phase 5: Validate and finalize

- [ ] 5.1 Run the configured validation gate, then the `om-auto-review-pr` pass, and finalize the PR body, labels, and summary comment
