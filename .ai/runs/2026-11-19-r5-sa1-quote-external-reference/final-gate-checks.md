# Final gate — 2026-11-19-r5-sa1-quote-external-reference

**Run at:** 2026-11-19T23:34:14Z (local mode: no compose `app` container; worktree has its own `yarn install`)
**Head before gate:** 74e2b5f448 (code); 42b0c6b0b0 adds the integration spec

## validation.commands (in order)

| Command | Result |
|---|---|
| `yarn build:packages` | pass |
| `yarn generate` | pass |
| `yarn build:packages` | pass |
| `yarn i18n:check-sync` | pass |
| `yarn i18n:check-usage` | pass |
| `yarn typecheck` | pass — 42/42 tasks |
| `yarn test` | 49/51 tasks pass. `create-mercato-app#test` fails: its agent-harness suites (OMH-*) shell out to the live codex/claude CLIs and fail locally on any branch; this PR touches nothing in create-app. Turbo aborted `@open-mercato/core#test` with it, so core was re-run alone: `yarn workspace @open-mercato/core test` → 2939 suites passed (35 skipped), 30167 tests passed |
| `yarn build:app` | pass |

## Step-specific gates

- `data/__tests__/validators.order-lines.test.ts`: 9 passed; 3 of the new cases fail against the unwidened validators.
- `commands/__tests__/documents.quote-external-reference.test.ts` (real `sales.quotes.create` handler): 4 passed; the 2 persistence cases fail without the `documents.ts` hunk.
- `packages/core/src/modules/sales` jest: 177 suites / 1648 tests passed.
- `yarn mercato db generate` (empty throwaway DB): `sales: no changes`. Counter-check with the snapshot entries removed: the generator emits exactly the two `create index … (tenant_id, external_reference)` statements. The generator would also add `"collation": null` to two unrelated columns (pre-existing drift); kept out, per "snapshot: the index entries only". Unrelated `forms`/`wms` drift output was discarded.
- UPGRADE_NOTES.md: "Sales line validators" entry present, covering order and quote lines.

## Integration suite

- `yarn test:integration:ephemeral "TC-SALES-(R5-SA1|4021)"` on a freshly built ephemeral env (fresh DB, every migration applied at boot, including the two concurrent index migrations): 3 passed (4.5m).
- Full suite not run: this change is API/validator-only; the targeted run covers the affected paths (POST /api/sales/quotes, POST /api/sales/orders, the order-line invariant).

## Design-system pass

- Skipped: no UI file touched.
