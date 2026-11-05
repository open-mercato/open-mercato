# Issue 8200: contributed row action correction

The parent identified a regression in the original feature implementation: when a widget contributes a row action to `data-table:audit_logs.actions.list:row-actions`, DataTable merges built-ins only from the returned element’s `items` array. The plain controls div exposed none, so the contributed menu replaced Undo/Redo.

The audit-local `AuditLogRowActions` adapter exposes typed action items with stable `undo` and `redo` IDs and renders the existing icon controls when no widget contributes actions. DataTable performs its existing merge and placement handling. Only permitted, eligible, enabled native operations enter the merged menu: shared `RowActions` has no disabled-item contract. Older redo remains disabled in the no-widget icon layout and unavailable in a contributed menu. No shared UI, API, permissions, schema or audit write contract changed.

The consumer tests now use the actual widget registry, loader, DataTable and RowActions. They cover eligible done/undone action coexistence and stable-ID placement, exact native and contributed handler dispatch, sticky action cells, click isolation, denied operations, older redo eligibility, pending-operation protection and the existing no-widget behavior.

## Focused regression evidence

Runner: local, qualified official Node 24.19.0 and pinned Yarn 4.17.1, using the task-owned independent clone and task-private short TMPDIR/TMP/TEMP. Both runs used the same test assertions and the following native command, sequentially, each with a 300-second process bound:

```sh
yarn workspace @open-mercato/core test --runInBand src/modules/audit_logs/components/__tests__/AuditLogsActions.rowClick.test.tsx
```

- Previous component from `c1e3763958dd6e0d6118101c972f79bc1c0d41df`: exit 1 in 8.836s; 3 failed / 9 passed. All three failures could not find the built-in menu action (eligible done, eligible undone and pending-undo scenarios). This reproduces the parent’s source finding.
- Corrected component: exit 0 in 2.036s; 1 suite / 12 tests passed (Jest 1.175s).
- Test SHA256 in both runs: `06e388f85a374ad7a76194ffffdd0e815e4870c043e1ceee640a068ad37979d4`.
- Previous component SHA256: `f0255c8da59095f8e0eb9ad54b8dfefc4355aa1b46d24f313e58b1d1f303625f`.
- Corrected component SHA256: `79e6fc4535763525bb8daa20f4173cf48ae8b0043ac1572061a5b9c1bc53bc23`.
- The clone’s committed baseline was `d43b6f9b3ebf7cc6ad707da3a1823ee5e1f81089`; its original component was verified byte-identical to c1e3763. Only the component and regression file were overlaid. The corrected source was restored after the sequence. Lockfile SHA256 remained `5fdecd1c962ca8de95f899b7022499c060e0d93f860960c7e9b29addc88db858`.
- Owned launcher/test processes were absent after completion. Logs and process metadata are preserved outside the Git worktree.

Independent read-only source review found no blocking defect. Its suggested pending-operation coverage was added before these runs. `git diff --check` passed. This focused result does not replace the configured gate, which must be rerun on the corrected candidate. The original full-suite failures and prior browser evidence remain separately documented in the November 4 review. Fresh full-gate and applicable browser verification, implementation PR publication and post-publication review remain outstanding.

The separate design spec PR [#8673](https://github.com/open-mercato/open-mercato/pull/8673) is now merged. The implementation branch excludes the old autosave’s separate spec addition.
