# Checkpoint 6 — actual worker/CLI and paired checkout evidence

Runner: local Node24.22.3, TMPDIR=/tmp. Disposable PostgreSQL17 only. No production migrations. PR remains draft.

- Actual event bus + events worker + createPerJobWorkerHandler + runDatabaseCliCommand exercise the restricted production adapter: deliberate first-attempt subscriber failure, concurrent tenant retry, invalid/ambiguous job scope rejection before containers, fresh invocation tokens, awaited async disposal and distinct maintenance login. Harness TypeScript passes; live node:test wrapper passes2/2, zero skips:16 runtime/27 catalog checks. `/tmp/rls-entrypoints-{tsc,live,wrapper}.log`.
- Worker binding/disposal foundation: CLI11, scheduler16 tests; CLI tsc passes.
- Global owner classifiers merged225ba5212c. Parent reruns AI21/core14/events44 pass. Query-index and remaining nested queue owners remain assigned to45ec.
- Paired checkout benchmark24 cases/12000 acquisitions, pool1/3/10 at20/30/50/100 users. Zero errors/observed violations; privileged write counters pass. Raw data and spec-linked analysis uploaded; PR comment6858319187. Single local sample, queueing included, excludes HTTP/auth/ORM/startup; underlying pg waiting counts do not measure the boundary queue.
- People browser source parent discovery/typecheck passes. First native build failed scheduler declaration discovery, repaired443438 with16 tests. Second failed onboarding nested-closure narrowing, repaireddf385 with9 tests/onboarding tsc. Third native run65075 built app successfully and is starting; no browser assertions claimed at checkpoint time.
- Live vector child found actual PostgreSQL name[] parsing incompatibility. ea30 casts catalog array elements to text;35 focused storage tests pass. Dedicated disposable vector DB PUBLIC TEMP revoked. Child rerun pending; no live vector pass claimed.

Remaining: live People/screenshots, actual public/provisioning and vector gates, generated owner declarations, full ordered repository/integration/create-app gates, independent code/security review, requested fresh conflict-resolution task, final spec and PR readiness.
