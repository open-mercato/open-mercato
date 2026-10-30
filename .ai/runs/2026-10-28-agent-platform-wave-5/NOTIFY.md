# Notify — 2026-10-28-agent-platform-wave-5

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-28T03:01:44Z — run started
- Brief: agent platform wave 5 — Integrity P3–P5, Identity P2–P4, Observability P3–P4, Chat P3–P4, Eval P3–P5, all in one PR (user decision).
- External skill URLs: none
- Stacked on feat/agent-platform-wave-4 (2d407b96f).
- Planning delegated to two read-only planners; their verified reports are research-*.md in this folder.
- Spec deviations adopted at planning (details in research files): audit correlation via a core projection column (encrypted context_json), no scripted provider, principal-denied tools in the manifest, effector correlation stamped by core workflows, citations in the tool-output uiParts envelope, citation registry as new ui code.

## 2026-10-28T04:01:22Z — checkpoint 1
- Phase 1 (Integrity P3–P5) verified: typecheck, AO jest 2515/2515, core guards, integration 16 passed / 3 skipped.
- Decision: checkpoints every 10+ Steps (user request).
- Fixes: 1.9-review-fix (optional ScorerRunView.guardrailChecks), 1.11-review-fix (guardrail row wrap).
- Delegations: executors for 1.1–1.11 (1.4 cheap tier).

## 2026-10-28T04:42:57Z — checkpoint 2 + safety stop
- Steps 2.1–2.7 verified after 2.7-review-fix (core guard violations). Integration 14 passed / 2 skipped; build:app pass.
- Paused for user review after ~20 consecutive Steps (skill safety stop).

## 2026-10-28T05:23:44Z — resumed
- User: "Auto continue" — proceed without further 20-Step safety pauses; checkpoints every 10+ Steps continue.

## 2026-10-28T06:18:37Z — checkpoint 3
- Steps 2.8–3.4 verified; fixes 2.10-review-fix (ambient correlation), 3.4-review-fix (sort comparators), 3.4-review-fix-2 (token route 500 on malformed client_id).
- Integration 26 passed / 5 skipped / 1 failed → fixed (re-run at the final gate).

## 2026-10-28T07:22:00Z — paused by the user
- User asked to stop after Step 4.6. Rows 3.5–4.6 are unit-verified by executors; checkpoint 4 (incl. integration) is due on resume.
- Step 4.6 added an additive `createdBefore` filter to GET /runs.

## 2026-10-29T19:25:58Z — resumed + checkpoint 4
- Resumed with om-auto-continue-pr-loop after bringing the stack up to date with `main` (2026-10-29).
- Step 4.7 delegated to one executor (standard tier); landed 9d6ae05fa. Scope addition: a metadata-level UI case so the tabs/dialog run without storage.
- Checkpoint 4 (3.5–4.7): all static + unit checks pass; integration 30 passed / 8 skipped (LLM provider or storage) / 0 failed; ACC-004 fix verified.

## 2026-10-30T03:49:26Z — checkpoint 5
- Phases 5–6 (Chat P3–P4) landed via executors: 5.1 (cheap tier), 5.2–5.5, 6.1 (capable tier), 6.2–6.4. 6.3's executor was interrupted by an account usage limit and resumed with its work intact.
- Decisions recorded in the chat-tracing spec changelog (2026-10-30); notable: conversationId accepts non-uuid ids, org-visible conversations grant run access, run citations cap 50.
- Wave-2 TC-AI-RUN-TRACE-016 test bug (providerOptions now rejected over HTTP) fixed on wave 2 and merged forward.
- Checkpoint 5 (5.1–6.4): static + unit + build:app pass; integration 57 passed / 12 skipped (LLM provider or storage) / 0 failed.

## 2026-10-30T04:06:31Z — step 7.4 decision
- `eval-set export` writes DB `llm_judge` assertions stored with `gate` severity as `warn` and prints a warning listing their keys (research silent; the file format refuses judge gates). An export that still fails file validation is refused with exit 2.
- `--cases` / `validate` accept only `.json`, `.yaml`, `.yml` (format by extension); `export --snapshot current` (default) is an alias of `latest`.

## 2026-10-30T04:20:25Z — step 7.5 decisions
- `POST /eval-sets/import` body: `{ file | text, format?, approve? }`; body capped at 2× OM_AGENT_EVAL_SET_MAX_BYTES (413, room for JSON-escaped `text`), the file itself at 1× (422 `eval_set_too_large`). Case names over the 200-char column are a 422 issue. No dry-run (research silent).
- Idempotency: assertions upsert by (org, agentId, key), reviving soft-deleted rows (the unique key spans them); cases match `sourceType:'file'` + deterministic `sourceId`, and a key equal to an existing case id of the agent (what `current` export emits) updates that case. Content change demotes approved → draft unless `approve`.
- No `enforceCommandOptimisticLock` in the import (bulk upsert by key, no client version) → no coverage-allowlist entry; undo/audit via the command. No per-case `eval_case.created` events (bulk).
- Export: judge-gate downgrade reported in the `x-om-eval-set-downgraded` header (body is the file); `x-om-eval-set-version` = the file's hash, `x-om-eval-set-source-version` = the exported manifest's. `includeFixtures` not implemented (DB manifests carry no fixtures). No new ACL features (spec: reuse eval.manage/eval.export).

## 2026-10-30T05:14:45Z — checkpoint 6
- Steps 7.1–7.10 landed via executors (7.2 cheap tier; 7.3, 7.5, 7.6, 7.8 capable tier). New production dependency `yaml` 2.9.0 in @open-mercato/enterprise (approved for Phase 7).
- Fixes: 7.10-review-fix (explicit sort comparators), 1.11-review-fix-2 (UXC-006 expected the raw guardrail kind).
- Checkpoint 6: static + unit + build:app pass after the fixes; integration 113 passed / 18 skipped / 1 failed → fixed, UXC 8/8.

## 2026-10-30T09:19:29Z — complete
- Steps 7.11, 7.12, 8.1 landed; checkpoint-free tail verified by the final gate.
- Stack re-synced with `main` (docs registry count conflict on wave 1, merged forward), module-facts caps re-measured.
- Review (delegated, wave-5 commits only): 1 major + 1 minor fixed; follow-ups listed in the review comment.
- Final gate passed; PR CI integration 15/15 shards green on `1d42639dd`. Status: complete. PR marked ready, `do-not-merge` kept, lock released.
