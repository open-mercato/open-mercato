# Execution plan — Turbopack stale-cache invalidation on structural changes

**Date:** 2026-05-06
**Slug:** turbopack-stale-cache-structural
**Branch:** `fix/turbopack-stale-cache-structural`
**Owner:** pkarw

## Goal

When module files in a standalone Open Mercato app are added, removed, or edited, `next dev --turbopack` keeps serving stale compiled chunks (or stale compile errors) until a full dev-server restart. Hook the existing **structural changes system** (`yarn mercato configs cache structural`) so it also nudges Turbopack's filesystem watcher into re-evaluating the generated module barrels — without killing the dev server. Provide a `dev:reset` escape hatch for the rare cases where Turbopack's internal cache stays stuck.

## Scope

- `packages/core/src/modules/configs/cli.ts` — extend `runStructuralCachePurge` with on-disk barrel mtime bumping.
- `packages/core/src/modules/configs/lib/` — new helper `touchGeneratedBarrels` (testable in isolation).
- `apps/mercato/scripts/dev-reset.mjs` + `package.json` — new `yarn dev:reset` script.
- `packages/create-app/template/scripts/dev-reset.mjs` + `package.json.template` — same for standalone consumers.
- `packages/cli/AGENTS.md`, root `AGENTS.md` — doc note on the new Turbopack invalidation behavior.
- Unit tests for the new helper.

## Non-goals

- Reworking the generator architecture or checksum protocol.
- Killing/restarting `next dev` from inside CLI commands.
- Fixing general Turbopack bugs unrelated to module structural changes.
- Wholesale `.next/cache` deletion during dev (the surgical mtime nudge is preferred).

## Background — what each piece currently does

| Surface | Current behavior |
|---|---|
| `mercato configs cache structural` | Wraps `runCachePurge` with `pattern: 'nav:*'`. Pure Redis-segment purge; no filesystem touch. |
| `runCachePurge` (Redis) | Deletes `nav:*` cache keys for all/specific tenants. |
| `mercato generate` post-step | Already invokes `configs cache structural --all-tenants --quiet` after every successful generate (`packages/cli/src/mercato.ts:520`). |
| Generator | Uses checksum (content + structure) — skips writing `modules.app.generated.ts` when bytes unchanged. Deterministic — no timestamps embedded. |
| Dev wrapper | `scripts/dev.mjs` spawns `mercato generate watch` + `next dev`. Watcher subprocess re-runs generator on file change. No `.next` deletion logic. |
| Existing AGENTS.md guidance | Already tells agents to run `yarn mercato configs cache structural --all-tenants` after structural changes — currently only purges nav cache. |

## Root-cause hypothesis

Turbopack's compiled-chunk cache is keyed by file fingerprint (mtime + size). When the generator skips a write (checksum match), the barrel file's stat doesn't advance. If Turbopack has cached an erroneous compile result for a leaf imported via the barrel (e.g. the user fixes a bad import), Turbopack does not always re-stat the leaf chain because no upstream import metadata changed. Forcing a fresh mtime on the generated barrels (without touching content) makes Turbopack treat the import graph as new and re-evaluate dependents.

## Implementation plan

### Phase 1 — Generator-side: bump barrel mtimes during structural cache purge

1. Add `packages/core/src/modules/configs/lib/touchGeneratedBarrels.ts` exporting `touchGeneratedBarrels(opts: { cwd?: string; quiet?: boolean })`.
   - Walks up from `cwd` (default `process.cwd()`) up to 4 levels looking for `.mercato/generated/`.
   - For each `*.generated.ts` and `*.generated.checksum` it finds, rewrites the file with identical bytes (`fs.readFileSync` → `fs.writeFileSync`) so both mtime and ctime advance.
   - Returns `{ dir, files }` for telemetry; throws nothing — silent skip when dir absent.
2. Wire `runStructuralCachePurge` (configs/cli.ts) to call `touchGeneratedBarrels` after the Redis purge.
   - Honor `--quiet` flag (no log output).
   - Log a single line in non-quiet mode: `🔁 [structural] touched N generated barrel(s) → /<path>/.mercato/generated/`.
3. Don't change the existing `nav:*` Redis purge behavior.

### Phase 2 — Standalone escape hatch: `yarn dev:reset`

1. Create `apps/mercato/scripts/dev-reset.mjs`:
   - Resolves app `.next/` relative to script location.
   - `fs.rmSync('.next/cache/turbopack', { recursive: true, force: true })`.
   - Also removes `.next/cache/webpack` (defensive — unused under turbopack but harmless).
   - Prints a 3-line recovery message: what was cleared + restart hint.
2. Add `"dev:reset": "node scripts/dev-reset.mjs"` to `apps/mercato/package.json`.
3. Mirror the script under `packages/create-app/template/scripts/dev-reset.mjs` and the script entry into `packages/create-app/template/package.json.template`.
4. Cross-platform: pure Node, no shell, no `rm -rf`.

### Phase 3 — Tests

1. `packages/core/src/modules/configs/__tests__/touchGeneratedBarrels.test.ts`:
   - Creates `tmp/.mercato/generated/foo.generated.ts` with known content + old mtime; runs helper; asserts content unchanged but mtime advanced.
   - Asserts no-throw when `.mercato/generated/` is missing.
   - Asserts only `*.generated.{ts,checksum}` files are touched (not e.g. `manual.ts`).

### Phase 4 — Docs

1. Update `packages/cli/AGENTS.md` "Generators / structural cache" section: explicit note that structural cache purge also bumps generated barrel mtimes to invalidate Turbopack.
2. Update root `AGENTS.md` line `Agents MUST automatically run yarn mercato configs cache structural --all-tenants ...` to mention Turbopack-cache invalidation alongside `nav:*` Redis purge.
3. Add `yarn dev:reset` to "Key Commands" in root AGENTS.md and to the standalone template README troubleshooting section if present.

### Phase 5 — Validation gate + PR

1. `yarn build:packages`
2. `yarn generate`
3. `yarn i18n:check-sync`
4. `yarn i18n:check-usage`
5. `yarn typecheck`
6. `yarn test`
7. `yarn build:app`
8. Self-review against `code-review` skill + `BACKWARD_COMPATIBILITY.md`.
9. Open PR with labels `bug`, `needs-qa`, `review`.

## Risks

- **Mtime nudge ineffective** — If Turbopack ignores filesystem mtime changes for already-compiled chunks, the fix won't help. Mitigation: rewriting the file (even with same bytes) triggers a full write event which Turbopack's chokidar instance must re-stat. Manual repro in Phase 5 confirms.
- **Wider blast radius than `nav:*`** — Touching generated barrels triggers HMR cascade. Acceptable: structural cache is only invoked on explicit structural changes, so the user already expects re-evaluation.
- **Standalone vs monorepo path resolution** — Generated dir lives at `<app>/.mercato/generated/` in both layouts; CLI is invoked from app cwd, so resolution is identical. Test covers cwd-walk fallback.
- **Forced rewrite on every `yarn generate`** — Marginal disk noise (4 small files re-written). Negligible, and only when structural purge actually runs (post-generate, explicit calls).

## External References

None — no `--skill-url` provided.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Generator-side touch helper

- [x] 1.1 Add `touchGeneratedBarrels` helper module — eb7ee11e5
- [x] 1.2 Wire helper into `runStructuralCachePurge` — eb7ee11e5
- [x] 1.3 Verify `yarn mercato configs cache help` still passes — eb7ee11e5

### Phase 2: `dev:reset` escape hatch

- [x] 2.1 Add `apps/mercato/scripts/dev-reset.mjs` + package.json entry — e14701495
- [x] 2.2 Add standalone template `scripts/dev-reset.mjs` + package.json.template entry — e14701495

### Phase 3: Unit tests

- [x] 3.1 Add `touchGeneratedBarrels` unit tests — 9d0f5ebd2

### Phase 4: Docs

- [x] 4.1 Update `packages/cli/AGENTS.md` — b78894e1b
- [x] 4.2 Update root `AGENTS.md` + standalone template AGENTS.md — b78894e1b

### Phase 5: Validation gate + PR

- [x] 5.1 Full validation gate (typecheck, tests, builds, i18n) — 6a0cd5536
- [x] 5.2 Self code-review + BC check — PR #1818 review comment
- [x] 5.3 Open PR with labels — PR #1818
