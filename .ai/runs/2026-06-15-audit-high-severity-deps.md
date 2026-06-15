# Execution Plan: Fix high-severity `yarn npm audit` failures

**Slug:** audit-high-severity-deps
**Branch:** fix/audit-high-severity-deps
**Base:** develop

## Goal

Make `yarn npm audit --all --recursive --severity high` (CI step `ci.yml:273`) pass
again by forcing patched versions of three transitively-pulled, vulnerable packages.

## Context

CI `audit` job fails with three high-severity advisories:

| Package | Advisory | Vulnerable | Pulled by | Patched target |
|---------|----------|-----------|-----------|----------------|
| `protobufjs` | GHSA-wcpc-wj8m-hjx6 (DoS via unbounded Any expansion) | `<=7.6.0` | `@grpc/proto-loader@0.8.1` (wants `^7.5.5`) | `7.6.4` |
| `ws` (8.x) | GHSA-96hv-2xvq-fx4p (memory-exhaustion DoS) | `>=8.0.0 <8.21.0` | `engine.io@6.6.5`, `jsdom@26.1.0` (`^8.17.1`/`^8.18.0`/`~8.18.3`) | `8.21.0` |
| `ws` (7.x) | GHSA-96hv-2xvq-fx4p (memory-exhaustion DoS) | `>=7.0.0 <7.5.11` | `webpack-bundle-analyzer@4.10.2` (`^7.3.1`) | `7.5.11` |

Root `package.json` already pins `"protobufjs": "7.5.8"` in `resolutions` — that pin is
itself the vulnerable version and must be bumped. `ws` has no resolution yet.

`ws` 7.x consumer is kept on the 7.x line (`7.5.11`) to avoid the major-version API
break that a blanket bump to 8.x would cause in `webpack-bundle-analyzer`.

## Scope

- `package.json` `resolutions` only.
- `yarn.lock` regenerated to match.

### Non-goals

- No upgrade of the direct dependents themselves (`@grpc/proto-loader`, `jsdom`,
  `engine.io`, `webpack-bundle-analyzer`) — out of scope and higher risk.
- No source/code changes; no behavior change.

## Risks

- A blanket `ws` resolution could break `webpack-bundle-analyzer` (expects ws 7 API);
  mitigated by scoping the 7.x descriptor to `7.5.11`.
- `--immutable` install in CI requires the committed `yarn.lock` to be exactly
  consistent with `package.json`; verified locally by re-running audit + a clean install.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Bump resolutions and regenerate lockfile

- [ ] 1.1 Bump `protobufjs` resolution to `7.6.4` and add scoped `ws` resolutions (`^7.3.1`→`7.5.11`, 8.x→`8.21.0`)
- [ ] 1.2 Run `yarn install` to regenerate `yarn.lock`; confirm resolved versions

### Phase 2: Verify the audit gate

- [ ] 2.1 Run `yarn npm audit --all --recursive --severity high` and confirm it passes
- [ ] 2.2 Confirm `yarn install --immutable` is a no-op (lockfile consistent)
