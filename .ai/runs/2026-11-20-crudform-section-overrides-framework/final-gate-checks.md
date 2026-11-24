# Final gate evidence

## Configured validation

All eight commands in the ordered local gate passed on `8c2c97c79e` with Node 24.22.3 and Yarn 4.17.1. All 51 test tasks passed, and the app built. A separate uncached typecheck passed all 42 tasks. The repaired fixture head `5cf51831dd` also passed all 42 uncached typecheck tasks.

## Integration and UI evidence

- The isolated app passed 21 Example and Staff Playwright checks with screenshots. It covered concurrent edits, independent resource versions, rollback, authorization and organization scoping, and ERP retry and deletion. [Browser results and screenshots](https://github.com/open-mercato/open-mercato/pull/10067#issuecomment-7049223654)
- A fresh packed standalone app ran the missing-provider and exact observer-mask cases. [Checkpoint 7 evidence](https://github.com/open-mercato/open-mercato/pull/10067#issuecomment-7047639284)
- The six cases in the repaired Todo spec each passed twice with retries disabled on the fresh Enterprise-enabled local app. This includes both concurrent outcomes, stale browser edits, server defaults, legacy saves and replay.
- GitHub passed 14 of 15 integration shards on `8c2c97c79e`. The remaining shard exposed a test that assumed the first update won and a browser test that waited for the OSS banner while CI showed the Enterprise conflict dialog. The repaired fixtures remain subject to the full integration run. [CI run](https://github.com/open-mercato/open-mercato/actions/runs/44812902523)

The full GitHub integration matrix passed all 15 shards on `fd0b28bed3`. The required Linux `test` job repeatedly exited during typechecking without a compiler diagnostic, including a job-only retry. [Full CI run](https://github.com/open-mercato/open-mercato/actions/runs/44825377493)

After the base sync, all eight required GitHub checks, all 15 integration shards, and CodeQL passed on `8542a3b7f9`. Production Chromium on Node 24.19.0 verified the preceding UI commit `8a2157b491`, including the localized rejection summary, field messages, corrected save, access denial, and Polish mobile layout. [Main CI](https://github.com/open-mercato/open-mercato/actions/runs/45221726667) · [CodeQL](https://github.com/open-mercato/open-mercato/actions/runs/45221719538)

The advisory mutation run on `8542a3b7f9` reached the 150-minute limit. Commit `c9e6a15379` raised the package job limit to 240 minutes. Check the PR for the rerun on its current head. [Canceled mutation job](https://github.com/open-mercato/open-mercato/actions/runs/45221726367/job/137858210152) · [Current PR checks](https://github.com/open-mercato/open-mercato/pull/10067/checks)

The standalone `test:create-app:integration` run reproduced missing runtime fixture state. The runner now uses the disposable app's database and queue directory, passes the same test login fixture to initialization and Playwright, and keeps a dedicated outbox worker alive across retries. Both brand persistence and ERP delivery passed on the fresh standalone app with the repaired worker setup. The canonical focused runner is being repeated to verify that setup from startup through teardown.

## Standalone harness

The twelve new cases fail the focused route and source contract against the previous baseline and pass against the new owner changes. All 255 deterministic cases pass, the knowledge-change contract certificate passes, and every new case has a live Codex pass. The last single live cohort passed 10 of 12, with the other two passing separately. A fresh macOS scaffold using verified package archives passed generation, typecheck, lint and build.

Full provider-backed release certification remains open. The Linux sandbox passed containment and deterministic validation. Its foundation reached the 6 GiB container limit during typecheck and build. The isolated Linux provider runner lacked an active session.

## Design and review

Design-system lint and client-boundary checks passed. No new design-system violations were verified in the changed lines. Independent review approved the implementation and re-reviewed the generated inventories and bootstrap fixtures. [Implementation review](https://github.com/open-mercato/open-mercato/pull/10067#issuecomment-7049691627)
