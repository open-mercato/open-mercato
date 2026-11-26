# Key-rotation verification evidence

## Run functional QA

From the checkout, use Node.js 24, Yarn, a running local Docker engine, `curl`,
and `openssl`:

```sh
sh .ai/qa/2026-11-12-key-rotation-verification/run-native-qa.sh
```

The script installs locked workspace dependencies, starts disposable PostgreSQL 16
and dev Vault containers bound to loopback, and runs the Enterprise rotation
fixture. The fixture exercises all four provider routes and compares persisted
values for one- and two-tenant scopes. The script removes the containers and
temporary credentials on exit.

On macOS, expect 16 passing tests. On Linux, the macOS path-discovery test is
skipped. Record the commit, OS and test summary in the PR when sharing results.
This run uses synthetic data and supports functional QA. Release acceptance
also requires the recovery and custody rehearsal and the performance checks below.

## Rehearse the operator workflow

1. Use a disposable Enterprise instance with a known encrypted mapped field and
   an encrypted custom field. Set up the old and new test roots, archive custody,
   and offline database fence in the
   [derived-to-derived runbook](../../../apps/docs/docs/user-guide/key-rotation-protection.mdx#derived-to-derived-runbook).
2. Set `qa_tenant_id` to the test tenant UUID. Preview the scope, then rotate it.

   ```sh
   yarn mercato entities rotate-encryption-key --tenant "$qa_tenant_id" --dry-run
   yarn mercato entities rotate-encryption-key --tenant "$qa_tenant_id"
   ```

3. Check for the retained encrypted backup and a `passed` report with equal
   expected and compared row, field and byte counts. Read the same synthetic
   values using the new test root.
4. Rehearse [interruption and resume](../../../apps/docs/docs/user-guide/key-rotation-protection.mdx#interruption-and-failure)
   with the same fenced database, keys and run ID. Restore the backup into a
   [separate scratch database](../../../apps/docs/docs/deployment/enterprise-backup-recovery.mdx#isolated-recovery)
   and verify the original values using the retained old test root.

## Performance and acceptance evidence

Release acceptance is in progress. The JSON files marked exploratory retain earlier measurements, including a failed final-scan throughput target; they are not final release evidence.

The standalone runner exercises actual encrypted PostgreSQL scalar/custom-document data, native encrypted backup and offline verification, real Core maintenance helpers, authenticated timestamp pages/checkpoints and a complete independent final comparison. It uses Node 24 with `--max-old-space-size=128 --max-semi-space-size=4`, a PostgreSQL 16 container limited to four CPUs/eight GiB, and an isolated disk volume. These are explicit tested runner settings; whole-app bootstrap memory is outside this component measurement.

Cold preparation stops the task-owned PostgreSQL container, evicts only clean files in its named volume with the committed `evict.c` helper, then starts fresh PostgreSQL buffers. Autovacuum is disabled only on that disposable benchmark cluster to establish a reproducible quiescent backup boundary. No host-wide cache flush or shared database is used. The matched standalone reference runs after final comparison, without timestamp-intent lookup; this warm-reference advantage is conservative and retained in the reported target result.

The separate real Core CLI test uses the actual handler, actual commercial DI registration and real MikroORM; only the app container factory is replaced by the isolated fixture. Its functional evidence must not be presented as the standalone RSS benchmark.

The cc62 20 GiB warm run and73d3 worker1 GiB warm run are explicit failed acceptance cases. The worker case uses the complete verifier duration, including normal worker exit, for its final throughput gate. `worker-memory-attribution-diagnostic.json` contains only aggregate numeric process stats and fixed event labels from a diagnostic bundle; it is not acceptance evidence and does not prove a specific allocator mechanism. Every earlier failure remains retained.
