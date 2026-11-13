# Handoff — full enterprise RLS

Branch: cez/82462d87
PR: https://github.com/open-mercato/open-mercato/pull/9424
Current phase/step: Phase 2 Step 2.1

## Completed

Design readiness re-review approved after exact lifetime and recovery contracts. Neutral lifecycle/context hooks, enterprise ALS and immutable checkout facades, role/catalog/manifest/policy verification are committed. Checkpoint 1 records 33 shared and 73 enterprise tests, typechecks, build, offline inventory and real PostgreSQL 16–18 proofs (3 integration tests each, no skips).

## Next concrete action

Enterprise bootstrap adapter is committed762a2d0ccc and verified (checkpoint2). Next wrap canonical JWT/API-key DB lookups in narrow identity scopes, then scope the dispatcher continuation before authorization and handlers. Preserve canonical actor validation before selected tenant, and attach only already-resolved auth to the Request to avoid recanonicalizing inside the selected scope.

## Remaining

All trusted request, portal/RSC/public-token, worker/event/scheduler, CLI and independent-pool paths; maintenance/migration reconciliation; real customer canary API/browser tests and screenshots; benchmark; full gates and independent final review. PR remains draft/in-progress, risk-high, needs-qa. No human decision pending.

## Environment

Local Node 24: MISE_NODE_VERSION=24.22.3 TMPDIR=/tmp TURBO_ENV_MODE=loose. Pin these for commits too (hooks invoke tsx). Dependencies are installed. Never migrate the user database. Dedicated PostgreSQL containers om-rls-82462-runtime (16,55278), om-rls-82462-pg17 (55279), om-rls-82462-pg18 (55280) remain for further tests; remove at completion. Proof fixture cleanup passed. Reuse the existing cezar worktree.
