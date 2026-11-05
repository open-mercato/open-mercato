# Execution Plan — Consolidate dependency bumps (joi, webpack-dev-server, esbuild)

## Goal

Combine three Dependabot dependency bumps — originally opened against `main` —
into a single PR against `develop`, then close the originals:

- #3053 — `joi` 17.13.3 → 17.13.4 (transitive, lockfile-only)
- #3052 — `webpack-dev-server` 5.2.3 → 5.2.5 (transitive, lockfile-only)
- #3051 — `esbuild` 0.28.0 → 0.28.1 (devDependency across 9 package.json files + lockfile)

## Scope

- `yarn.lock` — three disjoint resolution/checksum updates.
- 9 `package.json` files declaring `"esbuild": "^0.28.0"` → `"^0.28.1"`:
  root, channel-gmail, channel-imap, checkout, create-app, gateway-stripe,
  storage-s3, sync-akeneo, webhooks.

### Non-goals

- No source/code changes, no API surface, no behavior change.
- No upgrade of any dependency beyond the exact versions Dependabot picked.

## Approach & rationale

`develop`'s `yarn.lock` and root `package.json` blobs are **byte-identical** to
the base blobs the three Dependabot PRs were generated against
(`def48ebc1f…` / `ee87116037…`). The three diffs touch disjoint regions of the
lockfile (esbuild ≈ L4522, joi ≈ L20510, webpack-dev-server ≈ L29934), so each
PR diff applies cleanly to `develop` with no conflict. Applying Dependabot's
authoritative diffs (rather than re-resolving by hand) keeps the lockfile
internally consistent exactly as CI on the original PRs already validated.

## Risks

- **Lockfile integrity**: validated by running `yarn install` after applying.
- **patch-version bumps only** — minimal regression surface. The original PRs'
  CI already exercised these exact resolutions; the new PR re-runs the full CI
  suite against `develop`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Apply bumps

- [x] 1.1 Apply #3053 (joi) lockfile diff — d089c226b
- [x] 1.2 Apply #3052 (webpack-dev-server) lockfile diff — 08f5269cc
- [x] 1.3 Apply #3051 (esbuild) package.json + lockfile diff — f0300599d

### Phase 2: Validate & ship

- [x] 2.1 Run `yarn install --immutable` to confirm lockfile consistency — passed (no tracked-file mutation)
- [x] 2.2 Open PR against `develop`, label, close originals — #3054
- [x] Post-review fix: clear CI audit gate — pin esbuild 0.28.1 (transitive ~0.28.0 survived) + @grpc/grpc-js 1.14.4 via resolutions — 30a55a2a4
