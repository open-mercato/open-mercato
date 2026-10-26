# Checkpoint 1 — Steps 0.1..1.8

**Covers:** 0.1, 0.2, 1.1, 1.2, 1.3, 1.3-fix, 1.4, 1.5, 1.5-fix, 1.6, 1.7, 1.8
**SHA range:** `29be10b03`..`c2d483322`
**Touched areas:** new `customer_groups` module (entities, migrations, DI service,
API routes for groups/memberships/reorder, admin backend pages: list with
drag-reorder, create/edit forms), `apps/mercato/src/modules.ts`,
`eslint.ds.config.mjs`.

## Checks run

| Check | Command | Result |
|---|---|---|
| Typecheck | `TMPDIR=/private/var/tmp npx tsc --noEmit -p packages/core/tsconfig.json` | ✅ clean |
| Unit tests | `TMPDIR=/private/var/tmp yarn workspace @open-mercato/core test -- customer_groups` | ✅ 4 suites / 15 tests pass |
| Optimistic-lock guard | `jest optimistic-lock-editable-entities` | ✅ 121/121 pass (CustomerGroup registered) |
| Codegen | `TMPDIR=/private/var/tmp yarn generate` | ✅ clean (unrelated pre-existing OpenAPI-bundler Node 24 `ERR_IMPORT_ATTRIBUTE_MISSING` fallback noted, not caused by this branch — reproducible on `develop` too) |
| Migration drift | `TMPDIR=/private/var/tmp yarn db:generate` | ✅ `customer_groups: no changes` (snapshot matches entities after the 1.3-fix); unrelated `wms` drift discarded each time per root AGENTS.md's coding-agent exception |
| Package build | `TMPDIR=/private/var/tmp yarn build:packages` | ✅ 38/38 tasks successful |
| DS lint (strict, this module's escalation block) | `node --require ./scripts/typescript-js-require-hook.cjs node_modules/eslint/bin/eslint.js --config eslint.ds.config.mjs packages/core/src/modules/customer_groups` | ✅ clean |

## UI verification — skipped, reason recorded

Phase 1's UI surface is not yet feature-complete: membership assignment on the
customer detail page (1.9), the orphan banner's data wiring (1.10), the group-picker
widget injected into `catalog`/`sales` (1.11), and the i18n locale files (1.12) are
still `todo`. Running integration tests or a browser smoke pass now would only
exercise a partial surface and would need to be re-run once those land. Deferred to
Step 1.14 (Phase 1 UI integration tests) and the final gate. No dev server was
started this checkpoint.

## Two real gaps found and fixed during this window (not scope creep — corrections to already-landed Steps)

1. **1.5-fix** (`99ac74b80`): `isDefault: true` had no clear-and-set semantics —
   flagged by the Step 1.8 agent, fixed with `beforeCreate`/`beforeUpdate` hooks that
   bulk-unset the tenant's other default group before save.
2. **1.3-fix** (`40a4d6961`... final `19de77865`/`40a4d6961` — see PLAN.md Commit
   column): `(tenant_id, priority)` was a plain `@Unique`, not partial — a
   soft-deleted group's priority stayed permanently reserved and would collide with
   the reorder command's gap-of-10 renumbering. Replaced with a partial unique index
   (`WHERE deleted_at IS NULL`), matching the existing `customer_groups_tenant_default_unique`
   pattern. New migration + snapshot update; `yarn db:generate` now reports "no changes".

## Known, accepted limitation (not a defect — an "Ask First" boundary)

The group list's drag-reorder animates only the row's drag-handle icon, not the
whole `<tr>`, because `packages/ui/src/primitives/table.tsx`'s `TableRow` does not
forward `ref` — `useSortable`'s `setNodeRef` has nothing else to attach to. The
underlying reorder mechanics (collision detection, priority assignment) are correct;
only the visual full-row lift is missing. Fixing it means changing a shared
`DataTable`/`Table` primitive's ref-forwarding contract, which `packages/ui/AGENTS.md`
gates behind "Ask First" — out of this PR's scope to change unilaterally.
