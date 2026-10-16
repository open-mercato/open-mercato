# Notify — 2026-10-16-ai-decision-model-port

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-16T17:11:12Z — run started
- Brief: implement `.ai/specs/2026-10-06-ai-decision-model-port.md` (decision model port: shared types, ai-assistant schemas/registry/adapters/service, env, docs).
- External skill URLs: none
- Decision: branch cut from `upstream/develop` (f9a5776a0, identical to the fork's `origin/develop`); pushes go to the fork (`origin`), PR targets `open-mercato/open-mercato:develop`.
- Decision: adapters land before the registry (spec order swapped, see PLAN.md Deviations).
- Limitation: account has pull-only permission upstream — label and assignee operations will be logged skips; the claim is the claim comment only.

## 2026-10-16T17:28:10Z — checkpoint 1 (Steps 1.1–1.5)
- All targeted checks passed (ai-assistant 1647 tests, shared ai tests, shared tsc, scoped tsc, eslint). UI pass skipped: no UI surface.
- Delegations: Steps 1.2, 1.3, 1.4 to standard-tier executors; Step 1.5 to a capable-tier executor. All landed on first attempt, no rescues.
- Decisions recorded from executors: OpenRouter request JSON is built by hand because `JSON.stringify` reorders integer-like keys (`"2"` before `"10"`), which would break option order (spec D2); score `probabilities` accepted as array or index-keyed object (vendor shape not fully published); vendor `error.code` only included when it matches a safe token pattern, vendor messages never surfaced; missing API key at call time → `unavailable`; an already-aborted caller signal is checked after resolution (no provider + aborted → `unavailable`).
- Convention: Tasks `Commit` column records the pre-amend SHA (self-referential SHA is impossible with the same-commit flip).
